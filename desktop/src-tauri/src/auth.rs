//! Guided authentication for Google Photos.
//!
//! The token is captured from the phone's ReVanced Photos sign-in flow through
//! `adb logcat`, validated in memory, and written straight to the OS keyring.
//! It is never returned to the webview, logged, or written to a file.

use crate::engine::EngineError;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const KEYRING_SERVICE: &str = "app.photonic.desktop";
const KEYRING_USER: &str = "google-photos";
const TOKEN_TTL_SECS: u64 = 24 * 60 * 60;
const DEVICE_WAIT: Duration = Duration::from_secs(60);
const CAPTURE_WAIT: Duration = Duration::from_secs(120);
const MAX_AUTH_LEN: usize = 5000;

/// The Photos master token can be exchanged for several scopes. The phone's
/// log contains one line per scope; only these grant photo access. The
/// `notifications` line is the one that silently produces 403s, so it must
/// never be accepted.
const PHOTOS_SCOPE: &str = "https://www.googleapis.com/auth/photos.native";
const PHOTOS_SERVICE: &str =
    "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos.native";
const ACCEPTED_SCOPES: [&str; 4] = [
    PHOTOS_SCOPE,
    "https://www.googleapis.com/auth/photos",
    "https://www.googleapis.com/auth/mobileapps.native",
    "https://www.googleapis.com/auth/plus.native",
];

// ─────────────────────────────────────────────────────────────────────────────
// Public status shapes
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub connected: bool,
    pub email_masked: Option<String>,
    pub captured_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub keyring_available: bool,
    pub error: Option<String>,
    pub error_hint: Option<String>,
}

impl AuthStatus {
    fn disconnected(keyring_available: bool) -> Self {
        Self {
            connected: false,
            email_masked: None,
            captured_at: None,
            expires_at: None,
            keyring_available,
            error: None,
            error_hint: None,
        }
    }

    fn from_error(error: &EngineError) -> Self {
        let unavailable = matches!(
            error.code.as_str(),
            "keyring_unavailable" | "keyring_locked" | "keyring_error"
        );
        Self {
            connected: false,
            email_masked: None,
            captured_at: None,
            expires_at: None,
            keyring_available: !unavailable,
            error: Some(error.message.clone()),
            error_hint: error.hint.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthEvent {
    pub phase: String,
    pub message: String,
    pub email_masked: Option<String>,
    pub error: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCheck {
    pub adb_found: bool,
    pub devices: Vec<AdbDevice>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthRecord {
    auth_data: String,
    email: String,
    captured_at: u64,
}

#[derive(Debug, Clone)]
struct ParsedAuth {
    auth_data: String,
    email: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation (pure; tested)
// ─────────────────────────────────────────────────────────────────────────────

fn validate_auth_data(input: &str) -> Result<ParsedAuth, EngineError> {
    let value = input.trim();
    if value.is_empty() {
        return Err(EngineError::new(
            "auth_empty",
            "The authentication line is empty.",
        ));
    }
    if value.len() > MAX_AUTH_LEN {
        return Err(EngineError::new(
            "auth_too_long",
            "The authentication line is unexpectedly long.",
        ));
    }
    if value.chars().any(char::is_whitespace) {
        return Err(EngineError::new(
            "auth_invalid",
            "The authentication line contains spaces or newlines.",
        )
        .with_hint("Copy the line from `androidId=` to the end, with no wrapping."));
    }
    if !value.starts_with("androidId=") {
        return Err(EngineError::new(
            "auth_invalid",
            "The authentication line must start with `androidId=`.",
        ));
    }
    if !value.contains("&Token=") {
        return Err(EngineError::new(
            "auth_invalid",
            "The authentication line is missing the Token field.",
        )
        .with_hint("Capture a fresh line; the token may have been truncated."));
    }
    let raw_email = field(value, "Email").ok_or_else(|| {
        EngineError::new("auth_invalid", "The authentication line is missing Email.")
    })?;
    let email = percent_decode(raw_email);
    if email.is_empty() || !email.contains('@') {
        return Err(EngineError::new(
            "auth_invalid",
            "The authentication line has an invalid Email field.",
        ));
    }

    let Some(scope) = service_scope(value) else {
        return Err(EngineError::new(
            "auth_invalid",
            "The authentication line is missing its service scope.",
        )
        .with_hint("Capture a fresh line from the Photos account screen."));
    };
    if !ACCEPTED_SCOPES.contains(&scope.as_str()) {
        return Err(EngineError::new(
            "auth_wrong_scope",
            "The phone shared a different Google sign-in.",
        )
        .with_hint(
            "Keep the Photos account screen open while Photonic listens for the photo access line.",
        ));
    }

    Ok(ParsedAuth {
        auth_data: with_photos_service(value).unwrap_or_else(|| value.to_string()),
        email,
    })
}

/// Pull the auth query string out of an arbitrary logcat line.
/// Returns the candidate without logging or copying it elsewhere.
fn extract_auth_candidate(line: &str) -> Option<&str> {
    let start = line.find("androidId=")?;
    let candidate = &line[start..];
    let end = candidate
        .find(|character: char| character.is_whitespace())
        .unwrap_or(candidate.len());
    Some(&candidate[..end])
}

fn field<'a>(data: &'a str, key: &str) -> Option<&'a str> {
    data.split('&').find_map(|part| {
        part.strip_prefix(key)
            .and_then(|rest| rest.strip_prefix('='))
            .filter(|value| !value.is_empty())
    })
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
        {
            out.push(high * 16 + low);
            index += 3;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Decoded OAuth scope carried by the auth line, without the `oauth2:` prefix.
fn service_scope(data: &str) -> Option<String> {
    let raw = field(data, "service")?;
    let decoded = percent_decode(raw);
    Some(
        decoded
            .strip_prefix("oauth2:")
            .unwrap_or(&decoded)
            .to_string(),
    )
}

#[cfg(test)]
fn has_photo_scope(data: &str) -> bool {
    service_scope(data)
        .map(|scope| ACCEPTED_SCOPES.contains(&scope.as_str()))
        .unwrap_or(false)
}

/// Swap only the `service` field, preserving every other field and its order.
fn with_photos_service(data: &str) -> Option<String> {
    let mut replaced = false;
    let parts: Vec<String> = data
        .split('&')
        .map(|part| {
            if part.starts_with("service=") {
                replaced = true;
                format!("service={PHOTOS_SERVICE}")
            } else {
                part.to_string()
            }
        })
        .collect();
    replaced.then(|| parts.join("&"))
}

/// Repair a saved record captured before scopes were checked. Returns true
/// when the record was changed.
fn repair_record(record: &mut AuthRecord) -> bool {
    let Some(scope) = service_scope(&record.auth_data) else {
        return false;
    };
    let repairable =
        ACCEPTED_SCOPES.contains(&scope.as_str()) || scope.ends_with("/auth/notifications");
    if !repairable {
        return false;
    }
    let Some(fixed) = with_photos_service(&record.auth_data) else {
        return false;
    };
    if fixed == record.auth_data {
        return false;
    }
    record.auth_data = fixed;
    true
}

fn mask_email(email: &str) -> String {
    let (local, domain) = email.split_once('@').unwrap_or((email, ""));
    let first = local.chars().next().unwrap_or('?');
    if domain.is_empty() {
        format!("{first}***")
    } else {
        format!("{first}***@{domain}")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyring
// ─────────────────────────────────────────────────────────────────────────────

fn keyring_entry() -> Result<keyring::Entry, EngineError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(map_keyring_error)
}

fn map_keyring_error(error: keyring::Error) -> EngineError {
    use keyring::Error::*;
    match error {
        NoEntry => EngineError::new("keyring_empty", "No saved connection."),
        NoStorageAccess(_) => EngineError::new(
            "keyring_locked",
            "The system keyring is locked or unavailable.",
        )
        .with_hint("Unlock GNOME Keyring or KWallet, then try again."),
        NoDefaultStore => {
            EngineError::new("keyring_unavailable", "No system keyring is available.").with_hint(
                "Sign in to a desktop session with Secret Service (GNOME Keyring or KWallet).",
            )
        }
        other => {
            // Never print the raw error: BadEncoding/BadDataFormat can carry
            // the stored blob, which includes the token.
            eprintln!("auth: keyring error (kind: {})", keyring_error_kind(&other));
            EngineError::new("keyring_error", "The system keyring could not be used.")
                .with_hint("Check that your keyring is unlocked, then retry.")
        }
    }
}

fn keyring_error_kind(error: &keyring::Error) -> &'static str {
    use keyring::Error::*;
    match error {
        PlatformFailure(_) => "platform_failure",
        BadEncoding(_) => "bad_encoding",
        BadDataFormat(..) => "bad_data_format",
        BadStoreFormat(_) => "bad_store_format",
        _ => "other",
    }
}

fn load_record() -> Result<Option<AuthRecord>, EngineError> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(secret) => {
            let mut record = serde_json::from_str::<AuthRecord>(&secret).map_err(|_| {
                EngineError::new("keyring_corrupt", "The saved connection could not be read.")
                    .with_hint("Disconnect and reconnect Google Photos.")
            })?;
            if repair_record(&mut record) {
                // Records saved before scopes were checked used the phone's
                // notifications scope, which Google refuses for uploads.
                eprintln!("auth: repaired saved sign-in scope");
                let _ = save_record(&record);
            }
            Ok(Some(record))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(map_keyring_error(error)),
    }
}

fn save_record(record: &AuthRecord) -> Result<(), EngineError> {
    let payload = serde_json::to_string(record)
        .map_err(|_| EngineError::new("keyring_error", "Could not encode the credentials."))?;
    keyring_entry()?
        .set_password(&payload)
        .map_err(map_keyring_error)
}

fn delete_record() -> Result<(), EngineError> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(map_keyring_error(error)),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────────────────────────────────────

struct CaptureHandle {
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

pub struct AuthManager {
    app: AppHandle,
    capture: Mutex<Option<CaptureHandle>>,
}

impl AuthManager {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            capture: Mutex::new(None),
        })
    }

    pub fn status(&self) -> AuthStatus {
        match load_record() {
            Ok(Some(record)) => AuthStatus {
                connected: true,
                email_masked: Some(mask_email(&record.email)),
                captured_at: Some(record.captured_at),
                expires_at: Some(record.captured_at + TOKEN_TTL_SECS),
                keyring_available: true,
                error: None,
                error_hint: None,
            },
            Ok(None) => AuthStatus::disconnected(true),
            Err(error) => AuthStatus::from_error(&error),
        }
    }

    pub fn clear(&self) -> Result<AuthStatus, EngineError> {
        delete_record()?;
        Ok(self.status())
    }

    /// Read the token for a single upload job. This is deliberately not a
    /// Tauri command: only the controller calls it, and the value is passed
    /// directly into the engine request, never to the webview.
    pub(crate) fn auth_data_for_job(&self) -> Result<String, EngineError> {
        match load_record()? {
            Some(record) => Ok(record.auth_data),
            None => Err(
                EngineError::new("auth_missing", "Connect Google Photos first.")
                    .with_hint("Open Connect Google Photos and capture a token."),
            ),
        }
    }

    pub fn device_check(&self) -> DeviceCheck {
        device_check()
    }

    /// Start a capture attempt. Returns immediately; progress arrives as
    /// `auth:status` events. The token never crosses this boundary.
    pub fn capture_start(self: &Arc<Self>) -> Result<AuthEvent, EngineError> {
        let mut guard = self.capture.lock().unwrap();
        if let Some(handle) = guard.as_ref()
            && !handle.cancel.load(Ordering::SeqCst)
        {
            return Ok(AuthEvent {
                phase: "capturing".into(),
                message: "A capture is already running.".into(),
                email_masked: None,
                error: None,
                code: None,
            });
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let child = Arc::new(Mutex::new(None));
        *guard = Some(CaptureHandle {
            cancel: cancel.clone(),
            child: child.clone(),
        });
        drop(guard);

        let manager = self.clone();
        thread::spawn(move || {
            capture_flow(manager.app.clone(), cancel, child);
            if let Ok(mut guard) = manager.capture.lock() {
                guard.take();
            }
        });

        Ok(AuthEvent {
            phase: "checking_adb".into(),
            message: "Checking adb and your phone…".into(),
            email_masked: None,
            error: None,
            code: None,
        })
    }

    pub fn capture_cancel(&self) -> AuthEvent {
        if let Ok(guard) = self.capture.lock()
            && let Some(handle) = guard.as_ref()
        {
            handle.cancel.store(true, Ordering::SeqCst);
            kill_child(&handle.child);
        }
        AuthEvent {
            phase: "cancelling".into(),
            message: "Stopping the capture…".into(),
            email_masked: None,
            error: None,
            code: None,
        }
    }
}

fn emit_status(app: &AppHandle, phase: &str, message: &str) {
    let _ = app.emit(
        "auth:status",
        AuthEvent {
            phase: phase.into(),
            message: message.into(),
            email_masked: None,
            error: None,
            code: None,
        },
    );
}

fn emit_error(app: &AppHandle, code: &str, message: &str, hint: &str) {
    let _ = app.emit(
        "auth:status",
        AuthEvent {
            phase: "error".into(),
            message: message.into(),
            email_masked: None,
            error: Some(hint.into()),
            code: Some(code.into()),
        },
    );
}

fn emit_connected(app: &AppHandle, email_masked: &str) {
    let _ = app.emit(
        "auth:status",
        AuthEvent {
            phase: "connected".into(),
            message: format!("Connected as {email_masked}."),
            email_masked: Some(email_masked.into()),
            error: None,
            code: None,
        },
    );
}

fn capture_flow(app: AppHandle, cancel: Arc<AtomicBool>, child_slot: Arc<Mutex<Option<Child>>>) {
    if !adb_available() {
        emit_error(
            &app,
            "adb_missing",
            "adb is not installed.",
            "Install android-tools-adb, then retry.",
        );
        return;
    }

    let mut last_status = String::new();
    emit_status(&app, "checking_adb", "Checking adb and your phone…");
    let deadline = Instant::now() + DEVICE_WAIT;

    loop {
        if cancel.load(Ordering::SeqCst) {
            emit_status(&app, "cancelled", "Capture cancelled.");
            return;
        }
        let (devices, message) = adb_devices();
        if devices.iter().any(|device| device.state == "device") {
            break;
        }
        let phase = if devices.iter().any(|device| device.state == "unauthorized") {
            "waiting_for_authorization"
        } else {
            "waiting_for_device"
        };
        if last_status != phase {
            emit_status(&app, phase, &message);
            last_status = phase.into();
        }
        if Instant::now() >= deadline {
            emit_error(
                &app,
                "device_not_found",
                "No authorized Android device was found.",
                "Connect the phone, enable USB debugging, and accept the USB prompt.",
            );
            return;
        }
        thread::sleep(Duration::from_secs(1));
    }

    emit_status(
        &app,
        "waiting_for_screen",
        "On your phone, open ReVanced Photos → profile/account.",
    );

    // Clear old log lines so we cannot capture a stale token.
    let _ = Command::new("adb")
        .args(["logcat", "-c"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if cancel.load(Ordering::SeqCst) {
        emit_status(&app, "cancelled", "Capture cancelled.");
        return;
    }

    let mut child = match Command::new("adb")
        .arg("logcat")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            eprintln!("auth: could not start adb logcat: {error}");
            emit_error(
                &app,
                "adb_failed",
                "Could not read the phone's log output.",
                "Reconnect the phone and try again.",
            );
            return;
        }
    };
    let stdout = child.stdout.take();
    if let Ok(mut guard) = child_slot.lock() {
        *guard = Some(child);
    }

    let timed_out = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    {
        let timed_out = timed_out.clone();
        let done = done.clone();
        let cancel = cancel.clone();
        let slot = child_slot.clone();
        thread::spawn(move || {
            let started = Instant::now();
            while started.elapsed() < CAPTURE_WAIT {
                if done.load(Ordering::SeqCst) || cancel.load(Ordering::SeqCst) {
                    return;
                }
                thread::sleep(Duration::from_millis(500));
            }
            if !done.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst) {
                timed_out.store(true, Ordering::SeqCst);
                kill_child(&slot);
            }
        });
    }

    let mut saw_candidate = false;
    let mut saw_wrong_scope = false;
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let Ok(line) = line else { break };
            let Some(candidate) = extract_auth_candidate(&line) else {
                continue;
            };
            saw_candidate = true;

            match validate_auth_data(candidate) {
                Ok(parsed) => {
                    let record = AuthRecord {
                        auth_data: parsed.auth_data,
                        email: parsed.email.clone(),
                        captured_at: now(),
                    };
                    match save_record(&record) {
                        Ok(()) => {
                            done.store(true, Ordering::SeqCst);
                            kill_child(&child_slot);
                            emit_connected(&app, &mask_email(&parsed.email));
                            return;
                        }
                        Err(error) => {
                            done.store(true, Ordering::SeqCst);
                            kill_child(&child_slot);
                            emit_error(
                                &app,
                                &error.code,
                                &error.message,
                                error
                                    .hint
                                    .as_deref()
                                    .unwrap_or("Check your keyring and retry."),
                            );
                            return;
                        }
                    }
                }
                Err(error) => {
                    // A partial or unrelated line; keep watching. Never log it.
                    if error.code == "auth_wrong_scope" {
                        saw_wrong_scope = true;
                    }
                    continue;
                }
            }
        }
    }

    done.store(true, Ordering::SeqCst);
    kill_child(&child_slot);

    if cancel.load(Ordering::SeqCst) {
        emit_status(&app, "cancelled", "Capture cancelled.");
    } else if timed_out.load(Ordering::SeqCst) {
        emit_error(
            &app,
            "capture_timeout",
            "No sign-in line appeared within two minutes.",
            "Open ReVanced Photos → profile/account while capture is running.",
        );
    } else if saw_wrong_scope {
        emit_error(
            &app,
            "auth_wrong_scope",
            "The phone shared a different Google sign-in.",
            "Keep the Photos account screen open while Photonic listens. Photonic needs the photo access line, not the notifications one.",
        );
    } else if saw_candidate {
        emit_error(
            &app,
            "auth_incomplete",
            "A sign-in line was seen, but it was incomplete.",
            "Sign in again on the phone and keep the app open until it finishes.",
        );
    } else {
        emit_error(
            &app,
            "capture_failed",
            "No sign-in line was seen.",
            "Open ReVanced Photos → profile/account while capture is running, then retry.",
        );
    }
}

fn kill_child(slot: &Mutex<Option<Child>>) {
    if let Ok(mut guard) = slot.lock()
        && let Some(mut child) = guard.take()
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn adb_available() -> bool {
    Command::new("adb")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn adb_devices() -> (Vec<AdbDevice>, String) {
    match Command::new("adb").arg("devices").output() {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stdout);
            let devices: Vec<AdbDevice> = text
                .lines()
                .skip(1)
                .filter_map(|line| {
                    let mut parts = line.split_whitespace();
                    let serial = parts.next()?;
                    let state = parts.next()?;
                    Some(AdbDevice {
                        serial: serial.to_string(),
                        state: state.to_string(),
                    })
                })
                .collect();

            let message = if devices.iter().any(|device| device.state == "device") {
                "Phone detected. Keep it unlocked."
            } else if devices.iter().any(|device| device.state == "unauthorized") {
                "Unlock your phone and tap “Allow” on the USB debugging prompt."
            } else {
                "Connect your phone with USB debugging enabled."
            };
            (devices, message.to_string())
        }
        Err(_) => (
            Vec::new(),
            "adb is not available. Install android-tools-adb.".to_string(),
        ),
    }
}

pub fn device_check() -> DeviceCheck {
    if !adb_available() {
        return DeviceCheck {
            adb_found: false,
            devices: Vec::new(),
            message: "adb is not installed. Install android-tools-adb, then retry.".into(),
        };
    }
    let (devices, message) = adb_devices();
    DeviceCheck {
        adb_found: true,
        devices,
        message,
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = "androidId=abc123&Token=secret-token&Email=me%40example.com&client_sig=x&service=oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos.native";

    #[test]
    fn accepts_valid_auth_data() {
        let parsed = validate_auth_data(VALID).expect("valid");
        assert_eq!(parsed.email, "me@example.com");
        assert_eq!(parsed.auth_data, VALID);
    }

    #[test]
    fn rejects_missing_token() {
        let error = validate_auth_data("androidId=abc&Email=me%40example.com").unwrap_err();
        assert_eq!(error.code, "auth_invalid");
    }

    #[test]
    fn rejects_notifications_scope() {
        let line = VALID.replace(
            "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos.native",
            "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fnotifications",
        );
        let error = validate_auth_data(&line).unwrap_err();
        assert_eq!(error.code, "auth_wrong_scope");
    }

    #[test]
    fn requires_a_service_scope() {
        let line = "androidId=abc&Token=x&Email=me%40example.com";
        assert_eq!(validate_auth_data(line).unwrap_err().code, "auth_invalid");
    }

    #[test]
    fn normalizes_alternate_photo_scope() {
        let line = VALID.replace(
            "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos.native",
            "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos",
        );
        let parsed = validate_auth_data(&line).expect("photo scope is accepted");
        assert!(parsed.auth_data.contains(PHOTOS_SERVICE));
        assert!(!parsed.auth_data.ends_with("auth%2Fphotos"));
        assert!(parsed.auth_data.starts_with("androidId=abc123&"));
    }

    #[test]
    fn repairs_saved_notifications_record() {
        let mut record = AuthRecord {
            auth_data: VALID.replace(
                "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos.native",
                "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fnotifications",
            ),
            email: "me@example.com".into(),
            captured_at: 1,
        };
        assert!(repair_record(&mut record));
        assert!(has_photo_scope(&record.auth_data));
        assert!(record.auth_data.contains("Email=me%40example.com"));
        // A second pass is a no-op.
        assert!(!repair_record(&mut record));
    }

    #[test]
    fn leaves_unknown_scopes_alone() {
        let mut record = AuthRecord {
            auth_data: VALID.replace(
                "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos.native",
                "oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive",
            ),
            email: "me@example.com".into(),
            captured_at: 1,
        };
        assert!(!repair_record(&mut record));
        assert!(!has_photo_scope(&record.auth_data));
    }

    #[test]
    fn rejects_whitespace_and_oversize() {
        assert_eq!(
            validate_auth_data("androidId=abc&Token=x&Email=a%40b.c\nmore")
                .unwrap_err()
                .code,
            "auth_invalid"
        );
        let huge = format!("androidId={}", "a".repeat(MAX_AUTH_LEN));
        assert_eq!(validate_auth_data(&huge).unwrap_err().code, "auth_too_long");
    }

    #[test]
    fn extracts_candidate_from_logcat_line() {
        let line = "10-24 10:00:00.000  1234  1234 I auth%2Fphotos: androidId=abc&Token=xyz&Email=a%40b.c trailing";
        assert_eq!(
            extract_auth_candidate(line),
            Some("androidId=abc&Token=xyz&Email=a%40b.c")
        );
    }

    #[test]
    fn masks_email() {
        assert_eq!(mask_email("srijan@example.com"), "s***@example.com");
        assert_eq!(mask_email("x"), "x***");
    }

    #[test]
    fn device_check_reports_adb_presence() {
        let check = device_check();
        assert!(check.adb_found, "adb should be installed on this machine");
    }

    #[test]
    #[ignore = "touches the real OS keyring"]
    fn keyring_round_trip() {
        let entry = keyring::Entry::new("app.photonic.desktop.test", "round-trip").unwrap();
        entry.set_password("not-a-real-token").unwrap();
        assert_eq!(entry.get_password().unwrap(), "not-a-real-token");
        entry.delete_credential().unwrap();
    }
}
