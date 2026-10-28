//! Photonic desktop controller.
//!
//! Rust owns the window, native integration, and the Python engine sidecar.
//! Product logic lives in `commands` modules as the IPC layer is built out.

pub mod auth;
mod commands;
pub mod engine;
mod media_scope;

use auth::AuthManager;
use engine::EngineManager;
use tauri::Manager;

/// Returns build and runtime information shown on the About/Settings screen.
#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Photonic",
        "version": env!("CARGO_PKG_VERSION"),
        "stage": "prototype",
        "localOnly": true,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Linux window managers (and the GNOME dock) read the icon from
            // the window itself, not from a desktop entry in dev builds.
            if let Some(icon) = app.default_window_icon().cloned()
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.set_icon(icon);
            }
            let manager = EngineManager::new(app.handle().clone());
            app.manage(manager.clone());
            app.manage(AuthManager::new(app.handle().clone()));
            // Boot off the UI thread: spawn + handshake can take a moment.
            std::thread::spawn(move || {
                if let Err(error) = manager.start() {
                    eprintln!("engine: initial start failed: {error}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::engine_status,
            commands::engine_start,
            commands::engine_stop,
            commands::engine_call,
            commands::upload_start,
            commands::upload_retry,
            commands::upload_resume,
            commands::auth_status,
            commands::auth_device_check,
            commands::auth_capture_start,
            commands::auth_capture_cancel,
            commands::auth_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Photonic");
}
