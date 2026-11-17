#!/usr/bin/env python3
"""Deterministic fake Photonic engine for UI development.

Speaks the same NDJSON protocol as the real engine. No filesystem access, no
network, no credentials.

    PHOTONIC_ENGINE_BIN=scripts/fake-engine.py pnpm dev

Environment:
    FAKE_SCAN_COUNT      number of synthetic media files (default 428)
    FAKE_SCAN_DELAY_MS   artificial scan latency (default 0)
    FAKE_SCAN_FAIL       "1" to return a structured scan error
"""

from __future__ import annotations

import json
import os
import sys
import time

VERSION = "0.1.0"
PROTOCOL = 1


def write(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def ok(request_id: str, result: dict) -> None:
    write({"v": PROTOCOL, "id": request_id, "ok": True, "result": result})


def fail(request_id: str, code: str, message: str, hint: str | None = None) -> None:
    error = {"code": code, "message": message, "recoverable": False}
    if hint:
        error["hint"] = hint
    write({"v": PROTOCOL, "id": request_id, "ok": False, "error": error})


def engine_info() -> dict:
    gpmc = os.environ.get("PHOTONIC_GPMC", "/opt/photonic/bin/gpmc")
    gpd = os.environ.get("PHOTONIC_GPD", "/opt/photonic/bin/gpd")
    return {
        "engine": "photonic-engine (fake)",
        "version": VERSION,
        "protocolVersion": PROTOCOL,
        "python": sys.version.split()[0],
        "platform": "Linux (fake engine)",
        "binaries": {
            "gpmc": {"name": "gpmc", "path": gpmc, "version": "0.9.0", "found": True},
            "gpd": {"name": "gpd", "path": gpd, "version": "0.1.0", "found": True},
        },
        "ffmpeg": {"path": "/usr/bin/ffmpeg", "found": True},
        "ready": True,
        "capabilities": ["engine_info", "ping", "scan_folder"],
        "requiredCapabilities": ["engine_info", "ping", "scan_folder"],
    }


def scan(params: dict) -> dict:
    if os.environ.get("FAKE_SCAN_FAIL") == "1":
        return {
            "_error": (
                "not_a_directory",
                "That path is not a folder.",
                "Select a folder, not a single file.",
            )
        }

    count = max(0, int(os.environ.get("FAKE_SCAN_COUNT", "428")))
    delay_ms = max(0, int(os.environ.get("FAKE_SCAN_DELAY_MS", "0")))
    root = str(params.get("path") or "/home/user/Pictures")

    if delay_ms:
        time.sleep(delay_ms / 1000)

    files = []
    total = 0
    for index in range(count):
        is_video = index % 9 == 0
        suffix = ".MOV" if is_video else (".HEIC" if index % 5 == 0 else ".jpg")
        folder = f"Trip {index // 40 + 1}"
        if index % 7 == 0:
            folder += "/Day 2"
        size = 120_000 + (index * 7919) % 8_000_000
        total += size
        files.append(
            {
                "path": f"{folder}/IMG_{index:05d}{suffix}",
                "absPath": f"{root}/{folder}/IMG_{index:05d}{suffix}",
                "size": size,
                "mediaType": "video" if is_video else "image",
                "mtime": 1_760_000_000 + index * 60,
                "state": "pending",
                "remoteId": None,
                "lastError": None,
            }
        )

    files.sort(key=lambda item: item["path"].casefold())
    skipped = [
        {"path": f"{root}/notes.txt", "reason": "unsupported"},
        {"path": f"{root}/manifest.json", "reason": "unsupported"},
        {"path": f"{root}/.cache/preview.tmp", "reason": "unsupported"},
    ][: max(0, min(3, count // 50))]

    return {
        "root": root,
        "mediaCount": len(files),
        "totalBytes": total,
        "directoryCount": max(1, count // 40),
        "partial": False,
        "skippedCount": len(skipped),
        "skipped": skipped,
        "warnings": [
            {"path": f"{root}/shortcuts/latest.jpg", "reason": "symlink_skipped"}
        ]
        if count
        else [],
        "files": files,
    }


def main() -> int:
    write(
        {
            "v": PROTOCOL,
            "event": "engine.log",
            "seq": 1,
            "data": {"level": "info", "message": "fake engine ready"},
        }
    )
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        request_id = request.get("id", "")
        method = request.get("method", "")
        params = request.get("params") or {}

        if method == "ping":
            ok(request_id, {"pong": True})
        elif method == "engine_info":
            ok(request_id, engine_info())
        elif method == "scan_folder":
            result = scan(params)
            if "_error" in result:
                code, message, hint = result["_error"]
                fail(request_id, code, message, hint)
            else:
                ok(request_id, result)
        else:
            fail(request_id, "method_not_found", f"Unknown method: {method}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
