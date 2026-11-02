from __future__ import annotations

import time
from pathlib import Path

import pytest

from photonic_engine.jobs import FileJob, Job, JobManager
from photonic_engine.protocol import EngineError
from photonic_engine.store import JobStore

FIXTURE = Path(__file__).parent / "fixtures" / "fake_gpmc.py"
AUTH = "androidId=abc&Token=secret&Email=me%40example.com"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
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


def _jpeg(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(JPEG)
    return path


def _wait(manager: JobManager, job_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        snapshot = manager.get_job(job_id)
        if snapshot["status"] in TERMINAL:
            return snapshot
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish")


def test_completed_job_survives_reopen(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    db_path = tmp_path / "photonic.db"
    store = JobStore(db_path)
    manager = JobManager(store=store, validation_wait=0)
    root = tmp_path / "root"
    _jpeg(root / "a.jpg")

    snapshot = manager.start_upload(
        root=str(root), auth_data=AUTH, emit=lambda _name, _data: None
    )
    final = _wait(manager, snapshot["id"])
    assert final["status"] == "completed"
    store.close()

    reopened = JobStore(db_path)
    second = JobManager(store=reopened, validation_wait=0)
    jobs = second.list_jobs()
    summary = next(job for job in jobs if job["id"] == snapshot["id"])
    assert "files" not in summary
    assert summary["totalFiles"] >= 1
    assert summary["completedFiles"] == summary["totalFiles"]
    restored = second.get_job(snapshot["id"])
    assert restored["status"] == "completed"
    assert restored["files"][0]["state"] == "completed"
    reopened.close()


def test_recovery_marks_uploading_uncertain_and_resumes_pending(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "photonic.db"
    store = JobStore(db_path)
    root = tmp_path / "root"
    uploading = _jpeg(root / "uploading.jpg")
    pending = _jpeg(root / "pending.jpg")
    now = time.time()

    job = Job(
        id="recover-1",
        root=str(root),
        album_policy="timeline",
        album_name=None,
        selection=[str(root)],
        status="uploading",
        created_at=now,
        updated_at=now,
        files=[
            FileJob(
                path="uploading.jpg",
                abs_path=str(uploading),
                size=uploading.stat().st_size,
                media_type="image",
                mtime=uploading.stat().st_mtime,
                file_id="file-uploading",
                state="uploading",
            ),
            FileJob(
                path="pending.jpg",
                abs_path=str(pending),
                size=pending.stat().st_size,
                media_type="image",
                mtime=pending.stat().st_mtime,
                file_id="file-pending",
                state="pending",
            ),
        ],
    )
    store.create_job(job)

    manager = JobManager(store=store, validation_wait=0)
    recovered = manager.get_job("recover-1")
    assert recovered["status"] == "interrupted"
    by_path = {item["path"]: item for item in recovered["files"]}
    assert by_path["uploading.jpg"]["state"] == "uncertain"
    assert by_path["uploading.jpg"]["code"] == "interrupted"
    assert by_path["pending.jpg"]["state"] == "pending"

    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    manager.resume_job("recover-1", AUTH)
    final = _wait(manager, "recover-1")
    by_path = {item["path"]: item for item in final["files"]}
    assert by_path["pending.jpg"]["state"] == "completed"
    assert by_path["uploading.jpg"]["state"] == "uncertain"
    assert final["status"] == "completed_with_failures"
    store.close()


def test_second_job_rechecks_remote_instead_of_trusting_ledger(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A file deleted from Google Photos must be offered to gpmc again."""
    db_path = tmp_path / "photonic.db"
    store = JobStore(db_path)
    manager = JobManager(store=store, validation_wait=0)
    root = tmp_path / "root"
    _jpeg(root / "a.jpg")

    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    first = manager.start_upload(
        paths=[str(root / "a.jpg")],
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    first_final = _wait(manager, first["id"])
    assert first_final["files"][0]["remoteId"]

    # The ledger has a completed row, but the remote copy may be gone. The
    # engine must not skip locally: the fake rejects auth, proving gpmc ran.
    monkeypatch.setenv("FAKE_GPMC_MODE", "auth")
    second = manager.start_upload(
        paths=[str(root / "a.jpg")],
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    second_final = _wait(manager, second["id"])
    item = second_final["files"][0]
    assert item["state"] == "failed"
    assert item["code"] == "auth_expired"
    assert item["attempts"] == 1
    store.close()


def test_clear_history_removes_only_finished_jobs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "photonic.db"
    store = JobStore(db_path)
    manager = JobManager(store=store, validation_wait=0)
    root = tmp_path / "root"
    _jpeg(root / "a.jpg")

    monkeypatch.setenv("FAKE_GPMC_MODE", "complete")
    finished = manager.start_upload(
        paths=[str(root / "a.jpg")],
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    _wait(manager, finished["id"])

    monkeypatch.setenv("FAKE_GPMC_MODE", "slow")
    running = manager.start_upload(
        paths=[str(root / "a.jpg")],
        auth_data=AUTH,
        emit=lambda _name, _data: None,
    )
    with pytest.raises(EngineError) as error:
        manager.clear_history()
    assert error.value.code == "job_busy"

    manager.cancel(running["id"])
    _wait(manager, running["id"])
    # The terminal status is set just before the job row is persisted.
    time.sleep(0.2)

    assert manager.clear_history() == {"removed": 2}
    assert manager.list_jobs() == []
    store.close()


def test_corrupt_database_is_rotated(tmp_path: Path) -> None:
    db_path = tmp_path / "photonic.db"
    db_path.write_bytes(b"this is not a sqlite database")

    store = JobStore(db_path)
    try:
        assert store.available is True
        assert store.list_jobs() == []
        assert list(tmp_path.glob("photonic.db.corrupt-*"))
    finally:
        store.close()
