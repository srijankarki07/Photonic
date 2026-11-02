//! Tauri commands exposed to the webview.
//!
//! The frontend can only call an allowlisted method through `engine_call`; it
//! cannot choose a binary path, shell command, or environment variable.

use crate::auth::{AuthEvent, AuthManager, AuthStatus, DeviceCheck};
use crate::engine::{EngineError, EngineManager, EngineStatus};
use crate::media_scope;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn engine_status(
    manager: State<'_, Arc<EngineManager>>,
) -> Result<EngineStatus, EngineError> {
    Ok(manager.status())
}

#[tauri::command]
pub async fn engine_start(
    manager: State<'_, Arc<EngineManager>>,
) -> Result<EngineStatus, EngineError> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.start())
        .await
        .map_err(|error| {
            EngineError::new(
                "internal_error",
                format!("The engine start task failed: {error}"),
            )
        })?
}

#[tauri::command]
pub async fn engine_stop(
    manager: State<'_, Arc<EngineManager>>,
) -> Result<EngineStatus, EngineError> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.stop())
        .await
        .map_err(|error| {
            EngineError::new(
                "internal_error",
                format!("The engine stop task failed: {error}"),
            )
        })
}

#[tauri::command]
pub async fn engine_call(
    app: tauri::AppHandle,
    manager: State<'_, Arc<EngineManager>>,
    method: String,
    params: Option<Value>,
) -> Result<Value, EngineError> {
    // Keep the reachable surface small and explicit.
    const ALLOWED: &[&str] = &[
        "ping",
        "engine_info",
        "scan_folder",
        "scan_selection",
        "get_job",
        "cancel_job",
        "list_jobs",
        "clear_history",
    ];
    if !ALLOWED.contains(&method.as_str()) {
        return Err(EngineError::new(
            "method_not_allowed",
            format!("'{method}' is not exposed to the interface."),
        ));
    }

    #[cfg(debug_assertions)]
    eprintln!("engine: call {method}");

    let manager = manager.inner().clone();
    let params = params.unwrap_or_else(|| json!({}));
    let result = tauri::async_runtime::spawn_blocking(move || manager.call(&method, params))
        .await
        .map_err(|error| {
            EngineError::new(
                "internal_error",
                format!("The engine call task failed: {error}"),
            )
        })??;
    media_scope::allow_paths_from_value(&app, &result);
    Ok(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload jobs
// ─────────────────────────────────────────────────────────────────────────────

fn default_album_policy() -> String {
    "timeline".into()
}

fn default_max_files() -> u32 {
    50_000
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub files: Vec<serde_json::Value>,
    #[serde(default = "default_album_policy")]
    pub album_policy: String,
    #[serde(default)]
    pub album_name: Option<String>,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default = "default_max_files")]
    pub max_files: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryRequest {
    pub job_id: String,
    #[serde(default)]
    pub include_uncertain: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeRequest {
    pub job_id: String,
}

/// Start an upload. The token is read from the keyring here and placed only in
/// the engine request; the webview never sees it.
#[tauri::command]
pub async fn upload_start(
    app: tauri::AppHandle,
    engine: State<'_, Arc<EngineManager>>,
    auth: State<'_, Arc<AuthManager>>,
    request: UploadRequest,
) -> Result<Value, EngineError> {
    #[cfg(debug_assertions)]
    eprintln!("upload: start");

    let engine = engine.inner().clone();
    let auth = auth.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Keyring I/O stays off the async runtime thread.
        let auth_data = auth.auth_data_for_job()?;
        let params = json!({
            "path": request.path,
            "paths": request.paths,
            "files": request.files,
            "authData": auth_data,
            "albumPolicy": request.album_policy,
            "albumName": request.album_name,
            "includeHidden": request.include_hidden,
            "maxFiles": request.max_files,
        });
        engine.call("start_upload", params)
    })
    .await
    .map_err(|error| {
        EngineError::new(
            "internal_error",
            format!("The upload start task failed: {error}"),
        )
    })??;
    media_scope::allow_paths_from_value(&app, &result);
    Ok(result)
}

#[tauri::command]
pub async fn upload_retry(
    app: tauri::AppHandle,
    engine: State<'_, Arc<EngineManager>>,
    auth: State<'_, Arc<AuthManager>>,
    request: RetryRequest,
) -> Result<Value, EngineError> {
    #[cfg(debug_assertions)]
    eprintln!("upload: retry");
    let engine = engine.inner().clone();
    let auth = auth.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let auth_data = auth.auth_data_for_job()?;
        let params = json!({
            "jobId": request.job_id,
            "authData": auth_data,
            "includeUncertain": request.include_uncertain,
        });
        engine.call("retry_failed", params)
    })
    .await
    .map_err(|error| {
        EngineError::new("internal_error", format!("The retry task failed: {error}"))
    })??;
    media_scope::allow_paths_from_value(&app, &result);
    Ok(result)
}

#[tauri::command]
pub async fn upload_resume(
    app: tauri::AppHandle,
    engine: State<'_, Arc<EngineManager>>,
    auth: State<'_, Arc<AuthManager>>,
    request: ResumeRequest,
) -> Result<Value, EngineError> {
    #[cfg(debug_assertions)]
    eprintln!("upload: resume");
    let engine = engine.inner().clone();
    let auth = auth.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let auth_data = auth.auth_data_for_job()?;
        let params = json!({
            "jobId": request.job_id,
            "authData": auth_data,
        });
        engine.call("resume_job", params)
    })
    .await
    .map_err(|error| {
        EngineError::new("internal_error", format!("The resume task failed: {error}"))
    })??;
    media_scope::allow_paths_from_value(&app, &result);
    Ok(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn auth_status(auth: State<'_, Arc<AuthManager>>) -> Result<AuthStatus, EngineError> {
    #[cfg(debug_assertions)]
    eprintln!("auth: status");
    let auth = auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || auth.status())
        .await
        .map_err(|error| {
            EngineError::new(
                "internal_error",
                format!("The auth status task failed: {error}"),
            )
        })
}

#[tauri::command]
pub async fn auth_device_check(
    auth: State<'_, Arc<AuthManager>>,
) -> Result<DeviceCheck, EngineError> {
    #[cfg(debug_assertions)]
    eprintln!("auth: device_check");
    let auth = auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || auth.device_check())
        .await
        .map_err(|error| {
            EngineError::new(
                "internal_error",
                format!("The device check task failed: {error}"),
            )
        })
}

#[tauri::command]
pub async fn auth_capture_start(
    auth: State<'_, Arc<AuthManager>>,
) -> Result<AuthEvent, EngineError> {
    #[cfg(debug_assertions)]
    eprintln!("auth: capture_start");
    let auth = auth.inner().clone();
    auth.capture_start()
}

#[tauri::command]
pub async fn auth_capture_cancel(
    auth: State<'_, Arc<AuthManager>>,
) -> Result<AuthEvent, EngineError> {
    #[cfg(debug_assertions)]
    eprintln!("auth: capture_cancel");
    Ok(auth.capture_cancel())
}

#[tauri::command]
pub async fn auth_clear(auth: State<'_, Arc<AuthManager>>) -> Result<AuthStatus, EngineError> {
    let auth = auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || auth.clear())
        .await
        .map_err(|error| {
            EngineError::new(
                "internal_error",
                format!("The auth clear task failed: {error}"),
            )
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_request_accepts_paths() {
        let request: UploadRequest = serde_json::from_value(json!({
            "paths": ["/home/user/a.jpg", "/home/user/Pictures"],
            "albumPolicy": "per_folder"
        }))
        .expect("deserialize");
        assert_eq!(request.paths.len(), 2);
        assert!(request.path.is_none());
        assert_eq!(request.album_policy, "per_folder");
    }

    #[test]
    fn upload_request_accepts_legacy_path() {
        let request: UploadRequest = serde_json::from_value(json!({
            "path": "/home/user/Pictures"
        }))
        .expect("deserialize");
        assert_eq!(request.path.as_deref(), Some("/home/user/Pictures"));
        assert!(request.paths.is_empty());
    }

    #[test]
    fn upload_request_has_no_auth_field() {
        let request = UploadRequest {
            path: None,
            paths: vec!["/a".into()],
            files: Vec::new(),
            album_policy: "timeline".into(),
            album_name: None,
            include_hidden: false,
            max_files: 50_000,
        };
        let json = serde_json::to_value(request).expect("serialize");
        assert!(json.get("authData").is_none());
        assert!(json.get("auth_data").is_none());
    }
}
