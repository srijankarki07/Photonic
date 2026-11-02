//! Grant the webview's asset protocol access to exactly the media paths the
//! engine reports. Never a broad `$HOME/**` scope.

use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn allow_paths_from_value(app: &AppHandle, value: &Value) {
    let scope = app.asset_protocol_scope();
    for raw in extract_abs_paths(value) {
        let path = Path::new(&raw);
        let _ = scope.allow_file(path);
        if let Ok(canonical) = std::fs::canonicalize(path) {
            let _ = scope.allow_file(canonical);
        }
    }
}

/// Collect every `absPath` string from a scan/job payload, recursively.
pub fn extract_abs_paths(value: &Value) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    walk(value, &mut seen, &mut out);
    out
}

fn walk(value: &Value, seen: &mut HashSet<String>, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(path)) = map.get("absPath")
                && seen.insert(path.clone())
            {
                out.push(path.clone());
            }
            for child in map.values() {
                walk(child, seen, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                walk(child, seen, out);
            }
        }
        _ => {}
    }
}

#[allow(dead_code)]
fn _pathbuf_marker(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_nested_abs_paths_in_order() {
        let value = json!({
            "root": "/home/u/Pictures",
            "files": [
                {"path": "a.jpg", "absPath": "/home/u/Pictures/a.jpg"},
                {"path": "b.mov", "absPath": "/home/u/Pictures/b.mov"}
            ],
            "status": "done"
        });
        assert_eq!(
            extract_abs_paths(&value),
            vec![
                "/home/u/Pictures/a.jpg".to_string(),
                "/home/u/Pictures/b.mov".to_string()
            ]
        );
    }

    #[test]
    fn ignores_other_paths_and_deduplicates() {
        let value = json!({
            "path": "/not/this",
            "files": [
                {"absPath": "/a.jpg"},
                {"absPath": "/a.jpg"},
                {"absPath": "/b.jpg"}
            ]
        });
        assert_eq!(
            extract_abs_paths(&value),
            vec!["/a.jpg".to_string(), "/b.jpg".to_string()]
        );
    }
}
