#!/usr/bin/env python3
"""Deterministic gpmc stand-in for engine tests.

    FAKE_GPMC_MODE=complete|skip|auth|network|silent|slow
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def emit(phase: str, completed: int, total: int, path: str, filename: str) -> None:
    print(
        json.dumps(
            {
                "version": 1,
                "type": "progress",
                "operation": "upload",
                "phase": phase,
                "path": path,
                "filename": filename,
                "bytes_completed": completed,
                "bytes_total": total,
            }
        ),
        file=sys.stderr,
        flush=True,
    )


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "file.jpg"
    absolute = str(Path(path).absolute())
    name = Path(path).name
    mode = os.environ.get("FAKE_GPMC_MODE", "complete")
    total = 1000

    if mode == "auth":
        emit("error", 0, total, absolute, name)
        print("401 Unauthorized", file=sys.stderr, flush=True)
        return 1
    if mode == "mime":
        emit("error", 0, total, absolute, name)
        print(
            "ValueError: File's mime type does not match image or video mime type.",
            file=sys.stderr,
            flush=True,
        )
        return 1
    if mode == "network":
        emit("error", 0, total, absolute, name)
        print("Connection reset by peer", file=sys.stderr, flush=True)
        return 1
    if mode == "silent":
        emit("uploading", 500, total, absolute, name)
        return 0
    if mode == "byte401":
        # A byte count that contains "401" used to be misread as HTTP 401.
        emit("hashing", 44040192, 59402776, absolute, name)
        emit("checking", 0, 59402776, absolute, name)
        emit("skipped", 59402776, 59402776, absolute, name)
        print(json.dumps({absolute: "AF1QipDUPKEY401ABC123"}), flush=True)
        return 0
    if mode == "flaky":
        counter = Path(os.environ.get("FAKE_GPMC_COUNTER", "/tmp/fake-gpmc-counter"))
        attempts = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(attempts + 1))
        if attempts == 0:
            emit("error", 0, total, absolute, name)
            print("Connection reset by peer", file=sys.stderr, flush=True)
            return 1
        # Second invocation succeeds via the normal path below.
    if mode == "forbidden":
        emit("checking", 0, total, absolute, name)
        emit("error", 0, total, absolute, name)
        print(
            "ERROR Error uploading file: 403 Client Error: Forbidden for url: "
            "https://photosdata-pa.googleapis.com/1/2 "
            "Request had insufficient authentication scopes.",
            file=sys.stderr,
            flush=True,
        )
        # Real gpmc swallows per-file errors and still exits 0.
        return 0
    if mode == "partial" and "bad" in name.lower():
        emit("error", 0, total, absolute, name)
        print("Connection reset by peer", file=sys.stderr, flush=True)
        return 1
    if mode == "slow":
        for step in range(1, 11):
            emit("uploading", step * 100, total, absolute, name)
            time.sleep(0.1)
        emit("complete", total, total, absolute, name)
        print(json.dumps({absolute: "AF1QipSLOWKEY12345"}), flush=True)
        return 0
    if mode == "skip":
        emit("checking", 0, total, absolute, name)
        emit("skipped", total, total, absolute, name)
        print(json.dumps({absolute: "AF1QipSKIPKEY12345"}), flush=True)
        return 0

    emit("hashing", 0, total, absolute, name)
    emit("checking", 0, total, absolute, name)
    emit("uploading", total // 2, total, absolute, name)
    emit("finalizing", total, total, absolute, name)
    emit("complete", total, total, absolute, name)
    print(json.dumps({absolute: "AF1QipCOMPLETE12345"}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
