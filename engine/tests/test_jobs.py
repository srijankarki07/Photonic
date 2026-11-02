from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import pytest

from photonic_engine.jobs import JobManager
from photonic_engine.protocol import EngineError

FIXTURE = Path(__file__).parent / "fixtures" / "fake_gpmc.py"
AUTH = "androidId=abc&Token=secret&Email=me%40example.com"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
TERMINAL = {
    "completed",
    "completed_with_failures",
    "needs_auth",
    "cancelled",
    "failed",
}


@pytest.fixture(autouse=True)
def fake_gpmc(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PHOTONIC_GPMC", str(FIXTURE))


def _folder(tmp_path: Path, count: int = 3) -> Path:
    for index in range(count):
        (tmp_path / f"IMG_{index}.jpg").write_bytes(JPEG + bytes([index]))
    return tmp_path


def _wait(manager: JobManager, job_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        snapshot = manager.get_job(job_id)
        if snapshot["status"] in TERMINAL:
            return snapshot
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish; last={manager.get_job(job_id)}")


def test_snapshot_caps_the_file_list() -> None:
    from photonic_engine.jobs import (
        SNAPSHOT_FILE_LIMIT,
        FileJob,
        Job,
    )

    files = [
        FileJob(
            file_id=str(index),
            path=f"f{index}.jpg",
            abs_path=f"/tmp/f{index}.jpg",
            size=1,
            media_type="image",
        )
        for index in range(SNAPSHOT_FILE_LIMIT + 5)
    ]
    job = Job(
        id="cap",
        root="/tmp",
        album_policy="timeline",
        album_name=None,
        files=files,
    )
    snapshot = job.snapshot()
    assert len(snapshot["files"]) == SNAPSHOT_FILE_LIMIT
    assert snapshot["filesTruncated"] is True
    assert snapshot["totalFiles"] == SNAPSHOT_FILE_LIMIT + 5
    assert "files" not in job.summary()


def test_progress_reports_upload_speed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "slow")
    target = tmp_path / "video.jpg"
    target.write_bytes(JPEG + b"x" * 4096)
    events: list[tuple[str, dict]] = []
    manager = JobManager(validation_wait=0)

    snapshot = manager.start_upload(
        paths=[str(target)],
        auth_data=AUTH,
        emit=lambda name, data: events.append((name, data)),
    )
    _wait(manager, snapshot["id"])

    speeds = [
        data.get("bytesPerSecond", 0)
        for name, data in events
        if name == "job.progress"
    ]
    assert speeds, "no progress events"
    assert max(speeds) > 0, "upload speed was never reported"


def test_temporary_network_failure_is_retried(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "flaky")
    monkeypatch.setenv("FAKE_GPMC_COUNTER", str(tmp_path / "attempts"))
    target = tmp_path / "IMG_0001.jpg"
    target.write_bytes(JPEG)
    manager = JobManager(
        validation_wait=0, retry_delays=(0.0,), rate_limit_delays=()
    )

    snapshot = manager.start_upload(
        paths=[str(target)],
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    final = _wait(manager, snapshot["id"])

    item = final["files"][0]
    assert item["state"] == "completed"
    assert item["attempts"] == 2


def test_start_upload_uses_reviewed_files_without_rescanning(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    folder = tmp_path / "folder"
    folder.mkdir()
    keep = folder / "keep.jpg"
    keep.write_bytes(JPEG)
    other = folder / "other.jpg"
    other.write_bytes(JPEG + b"x")
    manager = JobManager(validation_wait=0)

    snapshot = manager.start_upload(
        paths=[str(folder)],
        files=[
            {
                "absPath": str(keep),
                "path": "keep.jpg",
                "size": keep.stat().st_size,
                "mediaType": "image",
                "mtime": keep.stat().st_mtime,
            }
        ],
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    final = _wait(manager, snapshot["id"])

    assert [item["path"] for item in final["files"]] == ["keep.jpg"]
    assert final["files"][0]["state"] == "completed"


def test_job_completes_with_events(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    events: list[tuple[str, dict]] = []
    manager = JobManager(validation_wait=0)

    snapshot = manager.start_upload(
        root=str(_folder(tmp_path)),
        auth_data=AUTH,
        emit=lambda name, data: events.append((name, data)),
    )
    final = _wait(manager, snapshot["id"])

    assert final["status"] == "completed"
    assert final["completedFiles"] == 3
    assert final["failedFiles"] == 0
    assert all(
        item["state"] == "completed" and item["remoteId"] for item in final["files"]
    )
    names = [name for name, _ in events]
    assert "job.created" in names
    assert "job.progress" in names
    assert "file.updated" in names
    assert "job.completed" in names
    assert "Token=" not in json.dumps(final)
    assert "authData" not in json.dumps(final)


def test_auth_failure_sets_needs_auth(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "auth")
    events: list[tuple[str, dict]] = []
    manager = JobManager(validation_wait=0)

    snapshot = manager.start_upload(
        root=str(_folder(tmp_path)),
        auth_data=AUTH,
        emit=lambda name, data: events.append((name, data)),
    )
    final = _wait(manager, snapshot["id"])

    assert final["status"] == "needs_auth"
    assert any(item["code"] == "auth_expired" for item in final["files"])
    assert any(name == "auth.required" for name, _ in events)


def test_cancellation(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "slow")
    manager = JobManager(validation_wait=0)

    snapshot = manager.start_upload(
        root=str(_folder(tmp_path, 4)),
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    time.sleep(0.2)
    manager.cancel(snapshot["id"])
    final = _wait(manager, snapshot["id"])

    assert final["status"] == "cancelled"
    assert any(item["state"] == "cancelled" for item in final["files"])


def test_no_media(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("nope")
    manager = JobManager(validation_wait=0)
    with pytest.raises(EngineError) as caught:
        manager.start_upload(root=str(tmp_path), auth_data=AUTH)
    assert caught.value.code == "no_media"


def test_invalid_auth(tmp_path: Path) -> None:
    manager = JobManager(validation_wait=0)
    with pytest.raises(EngineError) as caught:
        manager.start_upload(root=str(_folder(tmp_path)), auth_data="nope")
    assert caught.value.code == "auth_invalid"


def test_invalid_album_policy(tmp_path: Path) -> None:
    manager = JobManager(validation_wait=0)
    with pytest.raises(EngineError) as caught:
        manager.start_upload(
            root=str(_folder(tmp_path)),
            auth_data=AUTH,
            album_policy="mirror",
        )
    assert caught.value.code == "bad_request"


def test_unknown_job() -> None:
    manager = JobManager(validation_wait=0)
    with pytest.raises(EngineError) as caught:
        manager.get_job("missing")
    assert caught.value.code == "job_not_found"


def test_mime_mismatch_is_skipped_not_failed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    manager = JobManager(validation_wait=0)
    _folder(tmp_path, 1)
    (tmp_path / "bad.jpg").write_text("this is not an image")

    snapshot = manager.start_upload(
        root=str(tmp_path), auth_data=AUTH, emit=lambda _name, _data: None
    )
    final = _wait(manager, snapshot["id"])
    by_path = {item["path"]: item for item in final["files"]}

    assert by_path["IMG_0.jpg"]["state"] == "completed"
    assert by_path["bad.jpg"]["state"] == "skipped"
    assert by_path["bad.jpg"]["code"] == "unsupported_mime"
    assert final["failedFiles"] == 0


def test_multi_root_same_basename_gets_stable_file_ids(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    manager = JobManager(validation_wait=0)
    first = tmp_path / "one" / "IMG.jpg"
    second = tmp_path / "two" / "IMG.jpg"
    first.parent.mkdir()
    second.parent.mkdir()
    first.write_bytes(JPEG)
    second.write_bytes(JPEG)

    snapshot = manager.start_upload(
        paths=[str(first), str(second)],
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    final = _wait(manager, snapshot["id"])

    assert final["completedFiles"] == 2
    assert len({item["fileId"] for item in final["files"]}) == 2
    assert sorted(item["path"] for item in final["files"]) == [
        "one/IMG.jpg",
        "two/IMG.jpg",
    ]
    assert sorted(final["selection"]) == sorted([str(first), str(second)])


def test_retry_failed_retries_only_failures(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    manager = JobManager(validation_wait=0)
    (tmp_path / "good.jpg").write_bytes(JPEG)
    (tmp_path / "bad.jpg").write_bytes(JPEG)
    monkeypatch.setenv("FAKE_GPMC_MODE", "partial")

    snapshot = manager.start_upload(
        root=str(tmp_path), auth_data=AUTH, emit=lambda _name, _data: None
    )
    first = _wait(manager, snapshot["id"])
    by_path = {item["path"]: item for item in first["files"]}
    assert first["status"] == "completed_with_failures"
    assert by_path["good.jpg"]["state"] == "completed"
    assert by_path["bad.jpg"]["state"] == "retryable"
    good_key = by_path["good.jpg"]["remoteId"]

    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    manager.retry_failed(snapshot["id"], AUTH)
    second = _wait(manager, snapshot["id"])
    by_path = {item["path"]: item for item in second["files"]}
    assert second["status"] == "completed"
    assert by_path["good.jpg"]["remoteId"] == good_key
    assert by_path["bad.jpg"]["state"] == "completed"


def test_retry_uncertain_requires_explicit_flag(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    manager = JobManager(validation_wait=0)
    (tmp_path / "a.jpg").write_bytes(JPEG)
    monkeypatch.setenv("FAKE_GPMC_MODE", "silent")

    snapshot = manager.start_upload(
        root=str(tmp_path), auth_data=AUTH, emit=lambda _name, _data: None
    )
    first = _wait(manager, snapshot["id"])
    assert first["status"] == "completed_with_failures"
    assert first["files"][0]["state"] == "uncertain"

    with pytest.raises(EngineError) as caught:
        manager.retry_failed(snapshot["id"], AUTH)
    assert caught.value.code == "no_failed_files"

    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    manager.retry_failed(snapshot["id"], AUTH, include_uncertain=True)
    second = _wait(manager, snapshot["id"])
    assert second["status"] == "completed"
    assert second["files"][0]["state"] == "completed"


def test_resume_after_auth_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    manager = JobManager(validation_wait=0)
    (tmp_path / "a.jpg").write_bytes(JPEG)
    monkeypatch.setenv("FAKE_GPMC_MODE", "auth")

    snapshot = manager.start_upload(
        root=str(tmp_path), auth_data=AUTH, emit=lambda _name, _data: None
    )
    first = _wait(manager, snapshot["id"])
    assert first["status"] == "needs_auth"

    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    manager.resume_job(snapshot["id"], AUTH)
    second = _wait(manager, snapshot["id"])
    assert second["status"] == "completed"
    assert second["files"][0]["state"] == "completed"


def test_video_completion_has_processing_hint(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    manager = JobManager(validation_wait=0)
    (tmp_path / "video.mp4").write_bytes(MP4)
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")

    snapshot = manager.start_upload(
        root=str(tmp_path), auth_data=AUTH, emit=lambda _name, _data: None
    )
    final = _wait(manager, snapshot["id"])
    assert final["status"] == "completed"
    assert final["processingVideos"] == 1
    assert final["files"][0]["processingHint"] == "remote_processing_possible"


def test_source_files_are_untouched(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "original.jpg"
    path.write_bytes(JPEG)
    before_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    before_stat = path.stat()
    before_entries = sorted(item.name for item in tmp_path.iterdir())

    manager = JobManager(validation_wait=0)
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    snapshot = manager.start_upload(
        root=str(tmp_path), auth_data=AUTH, emit=lambda _name, _data: None
    )
    _wait(manager, snapshot["id"])

    after_stat = path.stat()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before_hash
    assert after_stat.st_size == before_stat.st_size
    assert after_stat.st_mtime_ns == before_stat.st_mtime_ns
    assert sorted(item.name for item in tmp_path.iterdir()) == before_entries
