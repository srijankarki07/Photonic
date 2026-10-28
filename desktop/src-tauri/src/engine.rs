//! Engine sidecar supervisor.
//!
//! Owns the `photonic-engine` child process, speaks newline-delimited JSON over
//! its stdin/stdout, correlates responses by request id, relays events to the
//! webview, and restarts the process with backoff if it dies unexpectedly.
//!
//! This module is deliberately Tauri-light in its core (`EngineProcess`) so it
//! can be tested without an app handle. `EngineManager` is the Tauri-facing
//! supervisor.

use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const PROTOCOL_VERSION: u64 = 1;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const PING_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RESTARTS: u32 = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Errors and status
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl EngineError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable: false,
            hint: None,
        }
    }

    pub(crate) fn recoverable(mut self) -> Self {
        self.recoverable = true;
        self
    }

    pub(crate) fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for EngineError {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub ready: bool,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub last_error: Option<String>,
    pub engine_bin: Option<String>,
    pub protocol_version: u64,
}

impl EngineStatus {
    fn stopped() -> Self {
        Self {
            running: false,
            ready: false,
            pid: None,
            restart_count: 0,
            last_error: None,
            engine_bin: None,
            protocol_version: PROTOCOL_VERSION,
        }
    }
}

/// Parse the engine's `{"error": {...}}` envelope into a UI-safe error.
fn parse_engine_error(value: &Value) -> EngineError {
    let err = value.get("error").unwrap_or(&Value::Null);
    let hint = err.get("hint").and_then(Value::as_str).map(str::to_string);
    EngineError {
        code: err
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("engine_error")
            .to_string(),
        message: err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("The engine reported an unknown error.")
            .to_string(),
        recoverable: err
            .get("recoverable")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        hint: hint.map(|h| redact(&h)),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redaction
// ─────────────────────────────────────────────────────────────────────────────

/// Remove token-shaped values before anything is logged or shown.
/// Keeps surrounding text so errors stay useful.
pub fn redact(input: &str) -> String {
    const KEYS: [&str; 3] = ["androidId=", "Token=", "GP_AUTH_DATA="];
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    // Walk forward once. Never rescan the output, or the key before the
    // replacement would match again and loop forever.
    while let Some((index, key)) = KEYS
        .iter()
        .filter_map(|key| rest.find(key).map(|index| (index, *key)))
        .min_by_key(|(index, _)| *index)
    {
        out.push_str(&rest[..index]);
        out.push_str(key);
        out.push_str("<redacted>");

        let after_key = &rest[index + key.len()..];
        let value_len = after_key
            .find(['&', ' ', '\t', '\n', '\r', '"', '\''])
            .unwrap_or(after_key.len());
        rest = &after_key[value_len..];
    }

    out.push_str(rest);
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch resolution
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct EngineLaunch {
    pub program: String,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
    pub label: String,
}

/// Development convenience: locate the exploratory gpmc/gpd venv if the shell
/// did not export the overrides. Release builds set these from the bundle.
fn dev_envs() -> Vec<(String, String)> {
    let mut envs = vec![("PYTHONUNBUFFERED".to_string(), "1".to_string())];
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return envs;
    };
    let candidates = [
        ("PHOTONIC_GPMC", home.join("VM/gphototool/.venv/bin/gpmc")),
        ("PHOTONIC_GPD", home.join("VM/gphototool/.venv/bin/gpd")),
    ];
    for (key, path) in candidates {
        if std::env::var_os(key).is_none() && path.is_file() {
            envs.push((key.to_string(), path.to_string_lossy().into_owned()));
        }
    }
    envs
}

pub fn development_launch() -> Result<EngineLaunch, EngineError> {
    if let Ok(bin) = std::env::var("PHOTONIC_ENGINE_BIN") {
        let path = PathBuf::from(&bin);
        if bin.ends_with(".py") {
            return Ok(EngineLaunch {
                program: std::env::var("PHOTONIC_PYTHON").unwrap_or_else(|_| "python3".into()),
                args: vec![path.to_string_lossy().into_owned(), "serve".into()],
                envs: dev_envs(),
                label: bin,
            });
        }
        return Ok(EngineLaunch {
            program: bin.clone(),
            args: vec!["serve".into()],
            envs: dev_envs(),
            label: bin,
        });
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let venv_bin = manifest.join("../../engine/.venv/bin/photonic-engine");
    if venv_bin.is_file() {
        return Ok(EngineLaunch {
            program: venv_bin.to_string_lossy().into_owned(),
            args: vec!["serve".into()],
            envs: dev_envs(),
            label: venv_bin.to_string_lossy().into_owned(),
        });
    }

    let engine_src = manifest.join("../../engine/src");
    if engine_src.is_dir() {
        let mut envs = dev_envs();
        envs.push((
            "PYTHONPATH".into(),
            engine_src.to_string_lossy().into_owned(),
        ));
        return Ok(EngineLaunch {
            program: std::env::var("PHOTONIC_PYTHON").unwrap_or_else(|_| "python3".into()),
            args: vec!["-m".into(), "photonic_engine".into(), "serve".into()],
            envs,
            label: format!("python3 -m photonic_engine ({})", engine_src.display()),
        });
    }

    Err(
        EngineError::new("engine_missing", "The Photonic engine is not installed.")
            .with_hint("Run scripts/bootstrap-engine.sh, then restart Photonic."),
    )
}

fn resolve_launch(app: &AppHandle) -> Result<EngineLaunch, EngineError> {
    if !cfg!(debug_assertions)
        && let Some(engine) = bundled_binary(app, "photonic-engine")
    {
        let label = engine.to_string_lossy().into_owned();
        return Ok(EngineLaunch {
            program: label.clone(),
            args: vec!["serve".into()],
            envs: bundled_envs(app),
            label,
        });
    }

    development_launch().map_err(|_| {
        EngineError::new(
            "engine_missing",
            "The bundled Photonic engine could not be found.",
        )
        .with_hint("Reinstall Photonic. If you are developing, run scripts/bootstrap-engine.sh.")
    })
}

/// Find a binary shipped under `resources/binaries/<name>/` (one-dir
/// PyInstaller layout) or directly beside the executable.
fn bundled_binary(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        roots.push(dir);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in &roots {
        candidates.push(root.join("binaries").join(name).join(name));
        candidates.push(root.join("binaries").join(name));
        candidates.push(root.join(name).join(name));
        candidates.push(root.join(name));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn bundled_envs(app: &AppHandle) -> Vec<(String, String)> {
    let mut envs = vec![("PYTHONUNBUFFERED".to_string(), "1".to_string())];
    if std::env::var_os("PHOTONIC_GPMC").is_none()
        && let Some(gpmc) = bundled_binary(app, "gpmc")
    {
        envs.push((
            "PHOTONIC_GPMC".to_string(),
            gpmc.to_string_lossy().into_owned(),
        ));
    }
    envs
}

// ─────────────────────────────────────────────────────────────────────────────
// EngineProcess - transport only, no Tauri types
// ─────────────────────────────────────────────────────────────────────────────

type EventSink = Arc<dyn Fn(Value) + Send + Sync>;
type ExitHook = Arc<dyn Fn(u32) + Send + Sync>;
type PendingMap = Arc<Mutex<HashMap<String, Sender<Result<Value, EngineError>>>>>;

pub struct EngineProcess {
    pub pid: u32,
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    pending: PendingMap,
    alive: Arc<AtomicBool>,
    next_id: AtomicU64,
}

impl EngineProcess {
    pub fn spawn(
        launch: &EngineLaunch,
        on_event: EventSink,
        on_exit: ExitHook,
    ) -> Result<Arc<Self>, EngineError> {
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .envs(launch.envs.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|e| {
            EngineError::new(
                "engine_spawn_failed",
                format!("Could not start the Photonic engine: {e}"),
            )
            .with_hint("Check that the engine is installed and executable.")
        })?;

        let pid = child.id();
        let stdin = child.stdin.take().ok_or_else(|| {
            EngineError::new("engine_spawn_failed", "Engine stdin is unavailable.")
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            EngineError::new("engine_spawn_failed", "Engine stdout is unavailable.")
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            EngineError::new("engine_spawn_failed", "Engine stderr is unavailable.")
        })?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let child = Arc::new(Mutex::new(child));

        let process = Arc::new(Self {
            pid,
            stdin: Arc::new(Mutex::new(stdin)),
            child: child.clone(),
            pending: pending.clone(),
            alive: alive.clone(),
            next_id: AtomicU64::new(1),
        });

        // stdout: protocol responses + events
        {
            let pending = pending.clone();
            let alive = alive.clone();
            let on_event = on_event.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let value: Value = match serde_json::from_str(trimmed) {
                        Ok(value) => value,
                        Err(error) => {
                            eprintln!(
                                "engine: unparsable stdout line ({error}): {}",
                                redact(trimmed)
                            );
                            continue;
                        }
                    };

                    if let Some(id) = value.get("id").and_then(Value::as_str) {
                        let reply = if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                            Ok(value.get("result").cloned().unwrap_or(Value::Null))
                        } else {
                            Err(parse_engine_error(&value))
                        };
                        if let Some(sender) = pending.lock().unwrap().remove(id) {
                            let _ = sender.send(reply);
                        } else {
                            eprintln!("engine: response for unknown request id {id}");
                        }
                    } else if value.get("event").is_some() {
                        on_event(value);
                    } else {
                        eprintln!("engine: unexpected protocol line: {}", redact(trimmed));
                    }
                }
                alive.store(false, Ordering::SeqCst);
            });
        }

        // stderr: diagnostics only, always redacted
        {
            let on_event = on_event.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    let clean = redact(&line);
                    eprintln!("engine: {clean}");
                    on_event(json!({
                        "v": PROTOCOL_VERSION,
                        "event": "engine.log",
                        "data": { "level": "info", "message": clean }
                    }));
                }
            });
        }

        // supervisor: detect exit, fail pending calls, notify the manager
        {
            let child = child.clone();
            let alive = alive.clone();
            let pending = pending.clone();
            let on_exit = on_exit.clone();
            thread::spawn(move || {
                loop {
                    thread::sleep(Duration::from_millis(500));
                    let status = {
                        let mut guard = child.lock().unwrap();
                        guard.try_wait()
                    };
                    match status {
                        Ok(Some(exit)) => {
                            alive.store(false, Ordering::SeqCst);
                            let error = EngineError::new(
                                "engine_exited",
                                format!("The engine stopped unexpectedly (status {exit})."),
                            )
                            .recoverable();
                            let senders: Vec<_> =
                                pending.lock().unwrap().drain().map(|(_, tx)| tx).collect();
                            for sender in senders {
                                let _ = sender.send(Err(error.clone()));
                            }
                            on_exit(pid);
                            break;
                        }
                        Ok(None) => {}
                        Err(error) => {
                            alive.store(false, Ordering::SeqCst);
                            eprintln!("engine: supervisor error: {error}");
                            on_exit(pid);
                            break;
                        }
                    }
                }
            });
        }

        Ok(process)
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, EngineError> {
        self.call_with_timeout(method, params, DEFAULT_TIMEOUT)
    }

    pub fn call_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, EngineError> {
        if !self.is_alive() {
            return Err(EngineError::new(
                "engine_not_running",
                "The Photonic engine is not running.",
            )
            .recoverable()
            .with_hint("Restart the engine from Settings or Diagnostics."));
        }

        let id = format!("req-{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), sender);

        let request = json!({
            "v": PROTOCOL_VERSION,
            "id": id,
            "method": method,
            "params": params,
        });
        let line = format!("{request}\n");

        if let Err(error) = {
            let mut stdin = self.stdin.lock().unwrap();
            stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush())
        } {
            self.pending.lock().unwrap().remove(&id);
            return Err(EngineError::new(
                "engine_write_failed",
                format!("Could not send a request to the engine: {error}"),
            )
            .recoverable());
        }

        match receiver.recv_timeout(timeout) {
            Ok(reply) => reply,
            Err(RecvTimeoutError::Timeout) => {
                self.pending.lock().unwrap().remove(&id);
                Err(EngineError::new(
                    "engine_timeout",
                    format!("The engine did not answer '{method}' in time."),
                )
                .recoverable()
                .with_hint("Retry. If it keeps happening, check Diagnostics."))
            }
            Err(RecvTimeoutError::Disconnected) => Err(EngineError::new(
                "engine_exited",
                "The engine stopped before answering.",
            )
            .recoverable()),
        }
    }

    pub fn kill(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EngineManager - Tauri-facing supervisor
// ─────────────────────────────────────────────────────────────────────────────

struct ManagerInner {
    process: Option<Arc<EngineProcess>>,
    status: EngineStatus,
    restart_count: u32,
    last_error: Option<String>,
}

pub struct EngineManager {
    app: AppHandle,
    inner: Mutex<ManagerInner>,
    should_run: AtomicBool,
}

impl EngineManager {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            inner: Mutex::new(ManagerInner {
                process: None,
                status: EngineStatus::stopped(),
                restart_count: 0,
                last_error: None,
            }),
            should_run: AtomicBool::new(true),
        })
    }

    pub fn status(&self) -> EngineStatus {
        let inner = self.inner.lock().unwrap();
        let mut status = inner.status.clone();
        status.restart_count = inner.restart_count;
        status.last_error = inner.last_error.clone();
        status
    }

    fn emit_status(&self, status: &EngineStatus) {
        let _ = self.app.emit("engine:status", status.clone());
    }

    pub fn start(self: &Arc<Self>) -> Result<EngineStatus, EngineError> {
        self.should_run.store(true, Ordering::SeqCst);

        // Hold the lock across spawn + ping so concurrent starts cannot double
        // spawn the process. The command runs on a blocking thread.
        let mut inner = self.inner.lock().unwrap();
        if let Some(process) = inner.process.as_ref()
            && process.is_alive()
        {
            let mut status = inner.status.clone();
            status.running = true;
            status.pid = Some(process.pid);
            return Ok(status);
        }

        let launch = resolve_launch(&self.app)?;
        let label = launch.label.clone();

        let on_event: EventSink = {
            let app = self.app.clone();
            Arc::new(move |value: Value| {
                let _ = app.emit("engine:event", value);
            })
        };
        let on_exit: ExitHook = {
            let weak: Weak<EngineManager> = Arc::downgrade(self);
            Arc::new(move |pid: u32| {
                if let Some(manager) = weak.upgrade() {
                    manager.handle_exit(pid);
                }
            })
        };

        let process = EngineProcess::spawn(&launch, on_event, on_exit)?;
        let pid = process.pid;

        // Handshake. A failure does not prevent later calls, but it is surfaced.
        let mut ready = false;
        let mut handshake_error = None;
        match process.call_with_timeout("ping", json!({}), PING_TIMEOUT) {
            Ok(value) if value.get("pong").and_then(Value::as_bool) == Some(true) => ready = true,
            Ok(_) => {
                handshake_error = Some("The engine answered an unexpected handshake.".to_string())
            }
            Err(error) => handshake_error = Some(error.message),
        }

        if handshake_error.is_none() {
            inner.restart_count = 0;
        }
        inner.last_error = handshake_error;
        inner.process = Some(process);
        inner.status = EngineStatus {
            running: true,
            ready,
            pid: Some(pid),
            restart_count: inner.restart_count,
            last_error: inner.last_error.clone(),
            engine_bin: Some(label),
            protocol_version: PROTOCOL_VERSION,
        };

        let status = inner.status.clone();
        drop(inner);
        self.emit_status(&status);
        Ok(status)
    }

    pub fn stop(&self) -> EngineStatus {
        self.should_run.store(false, Ordering::SeqCst);
        let mut inner = self.inner.lock().unwrap();
        if let Some(process) = inner.process.take() {
            process.kill();
        }
        inner.status = EngineStatus {
            running: false,
            ready: false,
            pid: None,
            restart_count: inner.restart_count,
            last_error: inner.last_error.clone(),
            engine_bin: inner.status.engine_bin.clone(),
            protocol_version: PROTOCOL_VERSION,
        };
        let status = inner.status.clone();
        drop(inner);
        self.emit_status(&status);
        status
    }

    fn handle_exit(self: &Arc<Self>, pid: u32) {
        let mut should_restart = false;
        let mut status;
        {
            let mut inner = self.inner.lock().unwrap();
            let current_pid = inner.process.as_ref().map(|p| p.pid);
            if current_pid != Some(pid) {
                return;
            }
            inner.process = None;
            inner.last_error = Some("The engine stopped unexpectedly.".to_string());
            inner.status = EngineStatus {
                running: false,
                ready: false,
                pid: None,
                restart_count: inner.restart_count,
                last_error: inner.last_error.clone(),
                engine_bin: inner.status.engine_bin.clone(),
                protocol_version: PROTOCOL_VERSION,
            };
            status = inner.status.clone();

            if self.should_run.load(Ordering::SeqCst) && inner.restart_count < MAX_RESTARTS {
                inner.restart_count += 1;
                should_restart = true;
                status.restart_count = inner.restart_count;
            }
        }

        self.emit_status(&status);

        if should_restart {
            let manager = self.clone();
            let attempt = status.restart_count;
            let delay = Duration::from_secs(1u64 << attempt.min(4));
            thread::spawn(move || {
                thread::sleep(delay);
                if manager.should_run.load(Ordering::SeqCst) {
                    // A concurrent manual start may have won the race; start()
                    // is idempotent and returns the existing process.
                    let _ = manager.start();
                }
            });
        }
    }

    pub fn call(self: &Arc<Self>, method: &str, params: Value) -> Result<Value, EngineError> {
        let existing = {
            let inner = self.inner.lock().unwrap();
            inner.process.clone()
        };
        match existing {
            Some(process) if process.is_alive() => process.call(method, params),
            _ => {
                // Lazily start so a command can never race the initial boot.
                self.start()?;
                let process = {
                    let inner = self.inner.lock().unwrap();
                    inner.process.clone()
                };
                match process {
                    Some(process) if process.is_alive() => process.call(method, params),
                    _ => Err(EngineError::new(
                        "engine_not_running",
                        "The Photonic engine could not be started.",
                    )
                    .recoverable()
                    .with_hint("Check Diagnostics for the engine log, then retry.")),
                }
            }
        }
    }
}

impl Drop for EngineManager {
    fn drop(&mut self) {
        self.should_run.store(false, Ordering::SeqCst);
        if let Ok(mut inner) = self.inner.lock()
            && let Some(process) = inner.process.take()
        {
            process.kill();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_token_values() {
        let input = "androidId=abc123&Token=secret-token&Email=me%40example.com";
        let output = redact(input);
        assert!(!output.contains("abc123"));
        assert!(!output.contains("secret-token"));
        assert!(output.contains("Email="));
        assert!(output.contains("<redacted>"));
    }

    #[test]
    fn redacts_multiple_keys_without_looping() {
        let output = redact("Token=abc&Token=def GP_AUTH_DATA=ghi");
        assert!(!output.contains("abc"));
        assert!(!output.contains("def"));
        assert!(!output.contains("ghi"));
    }

    #[test]
    fn parses_engine_error_envelope() {
        let value = json!({
            "ok": false,
            "error": {
                "code": "not_found",
                "message": "Folder not found",
                "recoverable": false,
                "hint": "Choose a folder that still exists."
            }
        });
        let error = parse_engine_error(&value);
        assert_eq!(error.code, "not_found");
        assert_eq!(error.message, "Folder not found");
        assert_eq!(
            error.hint.as_deref(),
            Some("Choose a folder that still exists.")
        );
    }

    #[test]
    fn status_is_camel_case() {
        let status = EngineStatus::stopped();
        let json = serde_json::to_value(status).unwrap();
        assert!(json.get("restartCount").is_some());
        assert!(json.get("protocolVersion").is_some());
        assert!(json.get("engineBin").is_some());
    }
}
