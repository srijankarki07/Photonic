"""Engine-owned SQLite persistence.

One writer (the engine), short transactions, and WAL. Jobs, per-file state, and
the upload ledger survive sleep, app closure, or a sidecar restart. The token is
never written here.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .paths import database_path

if TYPE_CHECKING:  # avoid a runtime import cycle with jobs.py
    from .jobs import FileJob, Job

log = logging.getLogger("photonic_engine.store")

TERMINAL_JOB_STATES = {
    "completed",
    "completed_with_failures",
    "cancelled",
    "failed",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    root TEXT NOT NULL,
    selection_json TEXT NOT NULL DEFAULT '[]',
    album_policy TEXT NOT NULL,
    album_name TEXT,
    status TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    finished_at REAL,
    last_error TEXT,
    needs_auth INTEGER NOT NULL DEFAULT 0,
    auth_event_emitted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_files (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    abs_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mtime REAL NOT NULL,
    media_type TEXT NOT NULL,
    fingerprint TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    remote_id TEXT,
    error TEXT,
    code TEXT,
    hint TEXT,
    phase TEXT,
    bytes_completed INTEGER NOT NULL DEFAULT 0,
    bytes_total INTEGER NOT NULL DEFAULT 0,
    processing_hint TEXT,
    updated_at REAL NOT NULL,
    UNIQUE (job_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created
    ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_files_job_state
    ON job_files(job_id, state);
CREATE INDEX IF NOT EXISTS idx_job_files_abs_path
    ON job_files(abs_path);

CREATE TABLE IF NOT EXISTS upload_ledger (
    fingerprint TEXT PRIMARY KEY,
    abs_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mtime REAL NOT NULL,
    remote_id TEXT,
    status TEXT NOT NULL,
    first_seen_at REAL NOT NULL,
    uploaded_at REAL,
    job_id TEXT
);
"""


class JobStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or database_path()
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None
        try:
            self._connect()
        except sqlite3.DatabaseError as error:
            message = str(error).lower()
            if "not a database" in message or "malformed" in message:
                self._recover_corrupt(error)
            else:
                # A lock or transient failure must not rotate real history.
                log.error("database unavailable; continuing in memory (%s)", error)
                self._conn = None
        except OSError as error:
            log.error("database unavailable; continuing in memory (%s)", error)
            self._conn = None

    @property
    def available(self) -> bool:
        return self._conn is not None

    def _connect(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(
            self.path,
            check_same_thread=False,
            timeout=5,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA busy_timeout=5000")
        self._conn = connection
        with self._lock:
            connection.executescript(SCHEMA)
            connection.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)",
                (time.time(),),
            )
            connection.commit()
        # History contains local paths and media keys. Keep it readable only by
        # the account that runs Photonic. Done after the first write so the WAL
        # and shared-memory files exist too.
        for suffix in ("", "-wal", "-shm"):
            try:
                os.chmod(f"{self.path}{suffix}", 0o600)
            except OSError:
                pass

    def _recover_corrupt(self, error: Exception) -> None:
        log.warning("database could not be opened (%s); rotating it", error)
        if self._conn is not None:
            try:
                self._conn.close()
            except sqlite3.Error:
                pass
        self._conn = None
        stamp = int(time.time())
        for suffix in ("", "-wal", "-shm"):
            source = Path(f"{self.path}{suffix}")
            if source.exists():
                try:
                    source.rename(Path(f"{self.path}.corrupt-{stamp}{suffix}"))
                except OSError:
                    pass
        try:
            self._connect()
        except Exception as exc:  # noqa: BLE001 - persistence must not crash the app
            log.error("database unavailable; continuing in memory (%s)", exc)
            self._conn = None

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except sqlite3.Error:
                    pass
                self._conn = None

    # ── jobs ────────────────────────────────────────────────────────────────

    def create_job(self, job: Job) -> None:
        if self._conn is None:
            return
        with self._lock:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO jobs(
                    id, root, selection_json, album_policy, album_name, status,
                    created_at, updated_at, finished_at, last_error,
                    needs_auth, auth_event_emitted
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job.id,
                    job.root,
                    json.dumps(job.selection),
                    job.album_policy,
                    job.album_name,
                    job.status,
                    job.created_at,
                    job.updated_at,
                    job.finished_at,
                    job.last_error,
                    int(job.needs_auth),
                    int(job.auth_event_emitted),
                ),
            )
            self._conn.execute("DELETE FROM job_files WHERE job_id = ?", (job.id,))
            for item in job.files:
                self._insert_file(job.id, item)
            self._conn.commit()

    def save_job(self, job: Job) -> None:
        if self._conn is None:
            return
        with self._lock:
            self._conn.execute(
                """
                UPDATE jobs SET status = ?, updated_at = ?, finished_at = ?,
                    last_error = ?, needs_auth = ?, auth_event_emitted = ?
                WHERE id = ?
                """,
                (
                    job.status,
                    job.updated_at,
                    job.finished_at,
                    job.last_error,
                    int(job.needs_auth),
                    int(job.auth_event_emitted),
                    job.id,
                ),
            )
            self._conn.commit()

    def save_file(self, job_id: str, item: FileJob) -> None:
        if self._conn is None:
            return
        with self._lock:
            self._upsert_file(job_id, item)
            self._conn.commit()

    def _insert_file(self, job_id: str, item: FileJob) -> None:
        assert self._conn is not None
        file_id = item.file_id or item.abs_path
        self._conn.execute(
            """
            INSERT OR REPLACE INTO job_files(
                id, job_id, file_id, rel_path, abs_path, size_bytes, mtime,
                media_type, fingerprint, state, attempts, remote_id, error,
                code, hint, phase, bytes_completed, bytes_total,
                processing_hint, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{job_id}:{file_id}",
                job_id,
                file_id,
                item.path,
                item.abs_path,
                item.size,
                item.mtime,
                item.media_type,
                item.fingerprint,
                item.state,
                item.attempts,
                item.remote_id,
                item.error,
                item.code,
                item.hint,
                item.phase,
                item.bytes_completed,
                item.bytes_total,
                item.processing_hint,
                item.updated_at,
            ),
        )

    def _upsert_file(self, job_id: str, item: FileJob) -> None:
        self._insert_file(job_id, item)

    def load_job(self, job_id: str) -> Job | None:
        if self._conn is None:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row is None:
                return None
            file_rows = self._conn.execute(
                "SELECT * FROM job_files WHERE job_id = ? ORDER BY rel_path",
                (job_id,),
            ).fetchall()
        return self._job_from_rows(row, file_rows)

    def load_open_jobs(self) -> list[Job]:
        if self._conn is None:
            return []
        placeholders = ", ".join("?" for _ in TERMINAL_JOB_STATES)
        with self._lock:
            rows = self._conn.execute(
                f"SELECT * FROM jobs WHERE status NOT IN ({placeholders}) "
                "ORDER BY created_at DESC",
                tuple(TERMINAL_JOB_STATES),
            ).fetchall()
            jobs: list[Job] = []
            for row in rows:
                file_rows = self._conn.execute(
                    "SELECT * FROM job_files WHERE job_id = ? ORDER BY rel_path",
                    (row["id"],),
                ).fetchall()
                jobs.append(self._job_from_rows(row, file_rows))
            return jobs

    def list_jobs(self, limit: int = 100) -> list[Job]:
        if self._conn is None:
            return []
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            jobs: list[Job] = []
            for row in rows:
                file_rows = self._conn.execute(
                    "SELECT * FROM job_files WHERE job_id = ? ORDER BY rel_path",
                    (row["id"],),
                ).fetchall()
                jobs.append(self._job_from_rows(row, file_rows))
            return jobs

    def clear_history(self) -> int:
        """Delete every finished job (and its file rows). Returns the count."""
        if self._conn is None:
            return 0
        with self._lock:
            rows = self._conn.execute(
                "SELECT id FROM jobs WHERE finished_at IS NOT NULL"
            ).fetchall()
            ids = [row["id"] for row in rows]
            if not ids:
                return 0
            self._conn.executemany(
                "DELETE FROM jobs WHERE id = ?", [(job_id,) for job_id in ids]
            )
            self._conn.commit()
        return len(ids)

    def list_job_summaries(self, limit: int = 100) -> list[dict]:
        """Aggregate job counts without loading per-file rows."""
        if self._conn is None:
            return []
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT j.*,
                    COUNT(f.id) AS total_files,
                    COALESCE(SUM(f.size_bytes), 0) AS total_bytes,
                    COALESCE(SUM(CASE WHEN f.state = 'completed' THEN 1 ELSE 0 END), 0)
                        AS completed_files,
                    COALESCE(SUM(CASE WHEN f.state = 'failed' THEN 1 ELSE 0 END), 0)
                        AS failed_files,
                    COALESCE(SUM(CASE WHEN f.state = 'uncertain' THEN 1 ELSE 0 END), 0)
                        AS uncertain_files,
                    COALESCE(SUM(CASE WHEN f.state = 'skipped' THEN 1 ELSE 0 END), 0)
                        AS skipped_files,
                    COALESCE(SUM(CASE WHEN f.state = 'retryable' THEN 1 ELSE 0 END), 0)
                        AS retryable_files,
                    COALESCE(SUM(CASE WHEN f.state = 'uploading' THEN 1 ELSE 0 END), 0)
                        AS uploading_files,
                    COALESCE(SUM(CASE WHEN f.state IN ('pending', 'validating', 'cancelled')
                        THEN 1 ELSE 0 END), 0) AS pending_files,
                    COALESCE(SUM(CASE WHEN f.state = 'completed'
                        AND f.processing_hint IS NOT NULL THEN 1 ELSE 0 END), 0)
                        AS processing_videos,
                    COALESCE(SUM(CASE WHEN f.bytes_completed < f.size_bytes
                        THEN f.bytes_completed ELSE f.size_bytes END), 0)
                        AS bytes_completed
                FROM jobs j
                LEFT JOIN job_files f ON f.job_id = j.id
                GROUP BY j.id
                ORDER BY j.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        summaries: list[dict] = []
        for row in rows:
            total_bytes = int(row["total_bytes"] or 0)
            bytes_completed = int(row["bytes_completed"] or 0)
            summaries.append(
                {
                    "id": row["id"],
                    "root": row["root"],
                    "albumPolicy": row["album_policy"],
                    "albumName": row["album_name"],
                    "status": row["status"],
                    "createdAt": row["created_at"],
                    "updatedAt": row["updated_at"],
                    "finishedAt": row["finished_at"],
                    "lastError": row["last_error"],
                    "selection": json.loads(row["selection_json"] or "[]"),
                    "totalFiles": int(row["total_files"] or 0),
                    "completedFiles": int(row["completed_files"] or 0),
                    "failedFiles": int(row["failed_files"] or 0),
                    "uncertainFiles": int(row["uncertain_files"] or 0),
                    "skippedFiles": int(row["skipped_files"] or 0),
                    "retryableFiles": int(row["retryable_files"] or 0),
                    "processingVideos": int(row["processing_videos"] or 0),
                    "uploadingFiles": int(row["uploading_files"] or 0),
                    "pendingFiles": int(row["pending_files"] or 0),
                    "totalBytes": total_bytes,
                    "bytesCompleted": bytes_completed,
                    "percent": (
                        min(round(100 * bytes_completed / total_bytes, 1), 100.0)
                        if total_bytes
                        else 0.0
                    ),
                }
            )
        return summaries

    @staticmethod
    def _job_from_rows(row: sqlite3.Row, file_rows: list[sqlite3.Row]) -> Job:
        from .jobs import FileJob, Job

        files = [
            FileJob(
                path=file_row["rel_path"],
                abs_path=file_row["abs_path"],
                size=file_row["size_bytes"],
                media_type=file_row["media_type"],
                mtime=file_row["mtime"],
                file_id=file_row["file_id"],
                fingerprint=file_row["fingerprint"],
                state=file_row["state"],
                attempts=file_row["attempts"],
                remote_id=file_row["remote_id"],
                error=file_row["error"],
                code=file_row["code"],
                hint=file_row["hint"],
                phase=file_row["phase"],
                bytes_completed=file_row["bytes_completed"],
                bytes_total=file_row["bytes_total"],
                processing_hint=file_row["processing_hint"],
                updated_at=file_row["updated_at"],
            )
            for file_row in file_rows
        ]
        return Job(
            id=row["id"],
            root=row["root"],
            album_policy=row["album_policy"],
            album_name=row["album_name"],
            files=files,
            selection=json.loads(row["selection_json"] or "[]"),
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            finished_at=row["finished_at"],
            needs_auth=bool(row["needs_auth"]),
            auth_event_emitted=bool(row["auth_event_emitted"]),
            last_error=row["last_error"],
        )

    # ── ledger ──────────────────────────────────────────────────────────────

    def lookup_ledger(self, fingerprint: str) -> dict[str, Any] | None:
        if self._conn is None:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM upload_ledger WHERE fingerprint = ?",
                (fingerprint,),
            ).fetchone()
            return dict(row) if row is not None else None

    def record_ledger(
        self,
        *,
        fingerprint: str,
        abs_path: str,
        size: int,
        mtime: float,
        remote_id: str | None,
        status: str,
        job_id: str,
    ) -> None:
        if self._conn is None:
            return
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO upload_ledger(
                    fingerprint, abs_path, size_bytes, mtime, remote_id, status,
                    first_seen_at, uploaded_at, job_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(fingerprint) DO UPDATE SET
                    abs_path = excluded.abs_path,
                    size_bytes = excluded.size_bytes,
                    mtime = excluded.mtime,
                    remote_id = excluded.remote_id,
                    status = excluded.status,
                    uploaded_at = excluded.uploaded_at,
                    job_id = excluded.job_id
                """,
                (
                    fingerprint,
                    abs_path,
                    size,
                    mtime,
                    remote_id,
                    status,
                    now,
                    now if status == "completed" else None,
                    job_id,
                ),
            )
            self._conn.commit()
