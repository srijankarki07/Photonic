from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from photonic_engine.gpmc_adapter import upload_file

FIXTURE = Path(__file__).parent / "fixtures" / "fake_gpmc.py"
AUTH = "androidId=abc&Token=secret&Email=me%40example.com"


def _media(tmp_path: Path) -> Path:
    target = tmp_path / "IMG_0001.jpg"
    target.write_bytes(b"x" * 100)
    return target


@pytest.fixture(autouse=True)
def fake_gpmc(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PHOTONIC_GPMC", str(FIXTURE))


def test_complete(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "completed"
    assert result.media_key == "AF1QipCOMPLETE12345"
    assert "complete" in result.phases


def test_orphan_cleanup_ignores_unrelated_processes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from photonic_engine import gpmc_adapter

    monkeypatch.setenv("PHOTONIC_DATA_DIR", str(tmp_path / "data"))
    target = "/tmp/photonic-not-a-real-file.jpg"
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)", target]
    )
    run = tmp_path / "data" / "gpmc" / "run"
    run.mkdir(parents=True)
    (run / f"{process.pid}.json").write_text(
        json.dumps({"pid": process.pid, "target": target})
    )
    try:
        assert gpmc_adapter.cleanup_orphaned_children() == 0
        assert process.poll() is None
        assert not (run / f"{process.pid}.json").exists()
    finally:
        process.terminate()
        process.wait(timeout=5)


def test_orphan_cleanup_stops_recorded_gpmc(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from photonic_engine import gpmc_adapter

    monkeypatch.setenv("PHOTONIC_DATA_DIR", str(tmp_path / "data"))
    if not Path("/proc/self/cmdline").exists():
        pytest.skip("procfs is required")
    link = tmp_path / "gpmc"
    link.symlink_to(sys.executable)
    target = "/tmp/photonic-orphan-target.jpg"
    process = subprocess.Popen(
        [str(link), "-c", "import time; time.sleep(30)", target]
    )
    run = tmp_path / "data" / "gpmc" / "run"
    run.mkdir(parents=True)
    (run / f"{process.pid}.json").write_text(
        json.dumps({"pid": process.pid, "target": target})
    )
    try:
        assert gpmc_adapter.cleanup_orphaned_children() == 1
        process.wait(timeout=5)
        assert process.returncode != 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_remote_duplicate_counts_as_backed_up(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """gpmc's `skipped` phase means the content is already in Google Photos."""
    monkeypatch.setenv("FAKE_GPMC_MODE", "skip")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "completed"
    assert result.media_key == "AF1QipSKIPKEY12345"
    assert result.code == "already_uploaded"


def test_auth_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "auth")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "failed"
    assert result.error is not None
    assert result.error.code == "auth_expired"


def test_network_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "network")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "failed"
    assert result.error is not None
    assert result.error.code == "network"
    assert result.error.recoverable is True


def test_byte_counts_are_not_mistaken_for_http_401(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """44040192 bytes contains "401"; that must not fail an uploaded file."""
    monkeypatch.setenv("FAKE_GPMC_MODE", "byte401")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "completed"
    assert result.media_key == "AF1QipDUPKEY401ABC123"


def test_error_classification_uses_standalone_status_tokens() -> None:
    from photonic_engine.gpmc_adapter import _classify_error

    assert _classify_error("401 Client Error: Unauthorized").code == "auth_expired"
    assert (
        _classify_error('{"bytes_completed":44040192}').code == "upload_failed"
    )
    assert _classify_error("403 Client Error: Forbidden").code == "upload_forbidden"
    assert _classify_error("429 Too Many Requests").code == "rate_limited"


def test_swallowed_error_phase_fails_instead_of_uncertain(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """gpmc exits 0 after a rejected file; the error phase is the real signal."""
    monkeypatch.setenv("FAKE_GPMC_MODE", "forbidden")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "failed"
    assert result.media_key is None
    assert result.error is not None
    assert result.error.code == "auth_scope"


def test_generic_403_is_forbidden_not_rate_limited(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "forbidden")
    from photonic_engine.gpmc_adapter import _classify_error

    assert _classify_error("403 Client Error: Forbidden").code == "upload_forbidden"
    assert _classify_error("429 Too Many Requests").code == "rate_limited"


def test_silent_exit_is_uncertain(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "silent")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "uncertain"


def test_cancellation(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "slow")
    cancel = threading.Event()
    box: list = []

    thread = threading.Thread(
        target=lambda: box.append(upload_file(_media(tmp_path), AUTH, cancel)),
        daemon=True,
    )
    thread.start()
    time.sleep(0.25)
    cancel.set()
    thread.join(timeout=5)

    assert box, "upload thread did not finish"
    # The fake had already emitted an uploading phase, so bytes may have landed.
    assert box[0].state == "uncertain"
    assert box[0].error is not None
    assert box[0].error.code == "uncertain"


def test_missing_gpmc(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("PHOTONIC_GPMC", raising=False)
    monkeypatch.setenv("PATH", "")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "failed"
    assert result.error is not None
    assert result.error.code == "gpmc_missing"


def test_mime_mismatch_is_skipped(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "mime")
    result = upload_file(_media(tmp_path), AUTH, threading.Event())
    assert result.state == "skipped"
    assert result.error is not None
    assert result.error.code == "unsupported_mime"
