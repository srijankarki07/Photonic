//! Integration test for the sidecar transport. Uses the real dev engine when
//! the venv exists, and skips otherwise (so CI without Python still passes).

use photonic_lib::engine::{EngineProcess, development_launch};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

#[test]
fn engine_ping_and_scan_round_trip() {
    let Ok(launch) = development_launch() else {
        eprintln!("skipping: no development engine; run scripts/bootstrap-engine.sh");
        return;
    };

    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink_events = events.clone();
    let on_event: Arc<dyn Fn(serde_json::Value) + Send + Sync> = Arc::new(move |value| {
        sink_events.lock().unwrap().push(value);
    });
    let on_exit: Arc<dyn Fn(u32) + Send + Sync> = Arc::new(|_pid| {});

    let process = EngineProcess::spawn(&launch, on_event, on_exit).expect("spawn engine");

    let pong = process
        .call_with_timeout("ping", json!({}), Duration::from_secs(5))
        .expect("ping");
    assert_eq!(pong["pong"], true);

    let dir = std::env::temp_dir().join(format!("photonic-engine-smoke-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.jpg"), b"1234").unwrap();
    std::fs::write(dir.join("nested.mov"), b"12345").unwrap();
    std::fs::write(dir.join("notes.txt"), b"not media").unwrap();

    let scan = process
        .call_with_timeout(
            "scan_folder",
            json!({ "path": dir }),
            Duration::from_secs(10),
        )
        .expect("scan");
    assert_eq!(scan["mediaCount"], 2);
    assert_eq!(scan["totalBytes"], 9);
    assert_eq!(scan["skippedCount"], 1);
    assert_eq!(scan["files"][0]["path"], "a.jpg");
    assert_eq!(scan["files"][1]["path"], "nested.mov");

    std::fs::remove_dir_all(&dir).ok();
    process.kill();
}
