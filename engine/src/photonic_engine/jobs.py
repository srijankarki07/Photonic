"""In-memory job manager for Phase 2.

One job = a folder upload. Files run with a concurrency cap; every state change
is emitted as an event. Persistence (SQLite) arrives in Phase 3.

The auth token is passed to the job thread and never stored on the Job object,
so snapshots and events cannot leak it.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .auth import validate_auth_data
from .fingerprint import file_fingerprint
from .gpmc_adapter import UploadResult, upload_file
from .models import MediaType
from .protocol import EngineError
from .scanner import scan_folder, scan_selection
from .store import JobStore
from .validation import validate_media

log = logging.getLogger("photonic_engine.jobs")

Emit = Callable[[str, dict], None]
NOOP_EMIT: Emit = lambda _name, _data: None

ALBUM_POLICIES = {"timeline", "per_job", "per_folder"}
CONCURRENCY = 3
# Capped automatic retries for failures that are plausibly temporary. Auth,
# uncertain outcomes and refusals are never retried here.
RETRY_DELAYS: tuple[float, ...] = (2.0, 8.0)
RATE_LIMIT_DELAYS: tuple[float, ...] = (30.0,)
# Bounds the size of a job snapshot sent to the UI. Counts always cover every
# file; the list shows the first N and says so. Virtualized pagination is a
# later milestone for very large libraries.
SNAPSHOT_FILE_LIMIT = 2000


def _delays_from_env(name: str, default: tuple[float, ...]) -> tuple[float, ...]:
    """Allow tests and advanced users to tune/disable automatic retries."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return tuple(float(part) for part in raw.split(",") if part.strip())
    except ValueError:
        return default


def _now() -> float:
    return time.time()


def _file_id(abs_path: str) -> str:
    return hashlib.sha256(abs_path.encode("utf-8")).hexdigest()[:24]


def _selection_root(selection: list[str]) -> str:
    """The same display root scan_selection would pick."""
    resolved: list[Path] = []
    for raw in selection:
        candidate = Path(raw).expanduser()
        try:
            resolved.append(candidate.resolve(strict=True))
        except OSError:
            resolved.append(candidate)
    if not resolved:
        return ""
    if len(resolved) == 1:
        target = resolved[0]
        try:
            return str(target if target.is_dir() else target.parent)
        except OSError:
            return str(target.parent)
    parents = [str(item.parent) for item in resolved]
    try:
        return os.path.commonpath(parents)
    except ValueError:
        return parents[0]


def _file_jobs_from_payload(payload: list, max_files: int) -> list["FileJob"]:
    """Build job files from the list the person already reviewed.

    Re-enumerating the folder here would repeat a potentially expensive scan
    and could upload files that were not shown in Review. Sizes and mtimes are
    refreshed from disk; validation still re-checks every file.
    """
    jobs: list[FileJob] = []
    seen: set[str] = set()
    for entry in payload[:max_files]:
        if not isinstance(entry, dict):
            raise EngineError(
                "bad_request", "Each reviewed file must be an object."
            )
        abs_path = entry.get("absPath")
        if not isinstance(abs_path, str) or not abs_path.strip():
            raise EngineError(
                "bad_request", "Each reviewed file needs a non-empty absPath."
            )
        candidate = Path(abs_path).expanduser()
        try:
            target = candidate.resolve(strict=True)
        except OSError:
            target = candidate
        key = str(target)
        if key in seen:
            continue
        seen.add(key)
        media = entry.get("mediaType")
        if media not in ("image", "video"):
            media = "image"
        try:
            stat = target.stat()
            size = stat.st_size
            mtime = stat.st_mtime
        except OSError:
            size = int(entry.get("size") or 0)
            mtime = float(entry.get("mtime") or 0.0)
        display = entry.get("path")
        if not isinstance(display, str) or not display:
            display = target.name
        jobs.append(
            FileJob(
                file_id=_file_id(key),
                path=display,
                abs_path=key,
                size=size,
                media_type=media,
                mtime=mtime,
            )
        )
    return jobs


@dataclass(slots=True)
class FileJob:
    path: str
    abs_path: str
    size: int
    media_type: str
    mtime: float = 0.0
    file_id: str = ""
    fingerprint: str = ""
    force: bool = False
    state: str = "pending"
    attempts: int = 0
    remote_id: str | None = None
    error: str | None = None
    code: str | None = None
    hint: str | None = None
    phase: str | None = None
    processing_hint: str | None = None
    bytes_completed: int = 0
    bytes_total: int = 0
    updated_at: float = field(default_factory=_now)

    def to_dict(self) -> dict:
        return {
            "fileId": self.file_id,
            "path": self.path,
            "absPath": self.abs_path,
            "size": self.size,
            "mediaType": self.media_type,
            "state": self.state,
            "attempts": self.attempts,
            "remoteId": self.remote_id,
            "error": self.error,
            "code": self.code,
            "hint": self.hint,
            "phase": self.phase,
            "processingHint": self.processing_hint,
            "bytesCompleted": self.bytes_completed,
            "bytesTotal": self.bytes_total or self.size,
            "updatedAt": self.updated_at,
        }


@dataclass(slots=True)
class Job:
    id: str
    root: str
    album_policy: str
    album_name: str | None
    files: list[FileJob]
    selection: list[str] = field(default_factory=list)
    status: str = "uploading"
    created_at: float = field(default_factory=_now)
    updated_at: float = field(default_factory=_now)
    finished_at: float | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    needs_auth: bool = False
    auth_event_emitted: bool = False
    last_error: str | None = None
    speed_bps: float = 0.0
    speed_at: float | None = None
    speed_bytes: int = 0

    def counts(self) -> dict:
        completed = failed = uncertain = 0
        skipped = retryable = uploading = pending = 0
        total_bytes = 0
        bytes_completed = 0
        processing_videos = 0
        for item in self.files:
            state = item.state
            if state == "completed":
                completed += 1
                if item.processing_hint:
                    processing_videos += 1
            elif state == "failed":
                failed += 1
            elif state == "uncertain":
                uncertain += 1
            elif state == "skipped":
                skipped += 1
            elif state == "retryable":
                retryable += 1
            elif state == "uploading":
                uploading += 1
            elif state in ("pending", "validating", "cancelled"):
                pending += 1
            total_bytes += item.size
            bytes_completed += min(item.bytes_completed, item.size)
        percent = round(100 * bytes_completed / total_bytes, 1) if total_bytes else 0.0
        return {
            "totalFiles": len(self.files),
            "completedFiles": completed,
            "failedFiles": failed,
            "uncertainFiles": uncertain,
            "skippedFiles": skipped,
            "retryableFiles": retryable,
            "processingVideos": processing_videos,
            "uploadingFiles": uploading,
            "pendingFiles": pending,
            "totalBytes": total_bytes,
            "bytesCompleted": bytes_completed,
            "percent": min(percent, 100.0),
        }

    def snapshot(self) -> dict:
        truncated = len(self.files) > SNAPSHOT_FILE_LIMIT
        return {
            "id": self.id,
            "root": self.root,
            "albumPolicy": self.album_policy,
            "albumName": self.album_name,
            "status": self.status,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "finishedAt": self.finished_at,
            "lastError": self.last_error,
            "selection": self.selection,
            **self.counts(),
            "filesTruncated": truncated,
            "files": [item.to_dict() for item in self.files[:SNAPSHOT_FILE_LIMIT]],
        }

    def summary(self) -> dict:
        """Counts only, without the file list. Used by list_jobs."""
        return {
            "id": self.id,
            "root": self.root,
            "albumPolicy": self.album_policy,
            "albumName": self.album_name,
            "status": self.status,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "finishedAt": self.finished_at,
            "lastError": self.last_error,
            "selection": self.selection,
            **self.counts(),
        }


class JobManager:
    def __init__(
        self,
        store: JobStore | None = None,
        validation_wait: float = 5.0,
        retry_delays: tuple[float, ...] | None = None,
        rate_limit_delays: tuple[float, ...] | None = None,
    ) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.RLock()
        self._validation_wait = validation_wait
        self._retry_delays = (
            _delays_from_env("PHOTONIC_RETRY_DELAYS", RETRY_DELAYS)
            if retry_delays is None
            else retry_delays
        )
        self._rate_limit_delays = (
            _delays_from_env("PHOTONIC_RATE_LIMIT_DELAYS", RATE_LIMIT_DELAYS)
            if rate_limit_delays is None
            else rate_limit_delays
        )
        self._store = store
        if store is not None and store.available:
            self._recover(store)

    def _recover(self, store: JobStore) -> None:
        try:
            recovered = store.load_open_jobs()
        except Exception:  # defensive: never block startup on a bad DB
            log.exception("could not load recovered jobs")
            return
        for job in recovered:
            changed = False
            for item in job.files:
                if item.state == "uploading":
                    item.state = "uncertain"
                    item.code = "interrupted"
                    item.error = (
                        "The app stopped while this file was uploading. "
                        "It may already be in Google Photos."
                    )
                    item.hint = "Reconcile before retrying, or it may create a duplicate."
                    item.updated_at = _now()
                    changed = True
                elif item.state == "validating":
                    item.state = "pending"
                    item.updated_at = _now()
                    changed = True
            if job.status in ("uploading", "queued", "scanning", "cancelling"):
                job.status = "interrupted"
                job.updated_at = _now()
                changed = True

            counts = job.counts()
            remaining = any(
                item.state in ("pending", "validating", "failed", "retryable")
                for item in job.files
            )
            if job.status == "interrupted" and not remaining:
                job.finished_at = _now()
                job.updated_at = job.finished_at
                job.status = (
                    "completed_with_failures"
                    if counts["uncertainFiles"] or counts["failedFiles"]
                    else "completed"
                )
                changed = True

            if changed:
                try:
                    store.save_job(job)
                    for item in job.files:
                        store.save_file(job.id, item)
                except Exception:
                    log.exception("could not persist recovery for job %s", job.id)
            self._jobs[job.id] = job
        if recovered:
            log.info("recovered %d job(s) from the local database", len(recovered))

    def _persist_file(self, job: Job, item: FileJob) -> None:
        if self._store is None:
            return
        try:
            self._store.save_file(job.id, item)
        except Exception:
            log.exception("could not persist file %s", item.path)

    def _persist_job(self, job: Job) -> None:
        if self._store is None:
            return
        try:
            self._store.save_job(job)
        except Exception:
            log.exception("could not persist job %s", job.id)

    def start_upload(
        self,
        *,
        root: str | None = None,
        paths: list[str] | None = None,
        files: list[dict] | None = None,
        auth_data: str,
        album_policy: str = "timeline",
        album_name: str | None = None,
        include_hidden: bool = False,
        max_files: int = 50_000,
        emit: Emit = NOOP_EMIT,
    ) -> dict:
        if album_policy not in ALBUM_POLICIES:
            raise EngineError(
                "bad_request",
                f"Unknown album policy: {album_policy}",
                hint="Use timeline, per_job, or per_folder.",
            )
        validate_auth_data(auth_data)
        if files:
            file_jobs = _file_jobs_from_payload(files, max_files)
            if not file_jobs:
                raise EngineError(
                    "no_media",
                    "No photos or videos were found in that selection.",
                    hint="Choose a folder that contains images or videos.",
                )
            selection = (
                list(paths)
                if paths
                else [str(Path(file_jobs[0].abs_path).parent)]
            )
            root = _selection_root(selection) or str(
                Path(file_jobs[0].abs_path).parent
            )
        elif paths:
            if not isinstance(paths, list) or not all(
                isinstance(item, str) and item.strip() for item in paths
            ):
                raise EngineError(
                    "bad_request", "paths must be a non-empty list of strings."
                )
            selection = list(paths)
            scan = scan_selection(
                paths,
                include_hidden=include_hidden,
                max_files=max_files,
            )
            root = scan.root
            file_jobs = [
                FileJob(
                    file_id=_file_id(item.abs_path),
                    path=item.path,
                    abs_path=item.abs_path,
                    size=item.size,
                    media_type=item.media_type.value,
                    mtime=item.mtime,
                )
                for item in scan.files
            ]
        elif root:
            selection = [root]
            scan = scan_folder(
                root, include_hidden=include_hidden, max_files=max_files
            )
            root = scan.root
            file_jobs = [
                FileJob(
                    file_id=_file_id(item.abs_path),
                    path=item.path,
                    abs_path=item.abs_path,
                    size=item.size,
                    media_type=item.media_type.value,
                    mtime=item.mtime,
                )
                for item in scan.files
            ]
        else:
            raise EngineError(
                "bad_request", "start_upload requires 'paths', 'files', or 'root'."
            )
        if not file_jobs:
            raise EngineError(
                "no_media",
                "No photos or videos were found in that folder.",
                hint="Choose a folder that contains images or videos.",
            )

        name = (album_name or "").strip()[:120] or None
        job = Job(
            id=uuid.uuid4().hex[:12],
            root=root,
            album_policy=album_policy,
            album_name=name,
            selection=selection,
            files=file_jobs,
        )
        with self._lock:
            self._jobs[job.id] = job
            snapshot = job.snapshot()

        if self._store is not None:
            try:
                self._store.create_job(job)
            except Exception:
                log.exception("could not persist new job %s", job.id)

        log.info("job %s created: %d files from %s", job.id, len(job.files), job.root)
        emit(
            "job.created",
            {
                "jobId": job.id,
                "root": job.root,
                "totalFiles": snapshot["totalFiles"],
                "totalBytes": snapshot["totalBytes"],
                "albumPolicy": job.album_policy,
                "selection": job.selection,
            },
        )
        # The token lives only in the job thread closure; never on the Job.
        thread = threading.Thread(
            target=self._run_job,
            args=(job, auth_data, emit),
            daemon=True,
            name=f"photonic-job-{job.id}",
        )
        thread.start()
        return snapshot

    def _run_job(
        self,
        job: Job,
        auth_data: str,
        emit: Emit,
        targets: list[FileJob] | None = None,
    ) -> None:
        try:
            selected = job.files if targets is None else targets
            with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
                futures = {
                    pool.submit(self._upload_one, job, item, auth_data, emit): item
                    for item in selected
                }
                for future in as_completed(futures):
                    item = futures[future]
                    try:
                        future.result()
                    except Exception as error:  # defensive: one file must not kill the job
                        with self._lock:
                            job.last_error = str(error)[:300]
                            if item.state in ("pending", "uploading"):
                                item.state = "failed"
                                item.code = "internal_error"
                                item.error = "The upload worker hit an internal error."
                                item.updated_at = _now()
                            file_event = self._file_event(job, item)
                            progress_event = self._progress_event(job)
                        self._persist_file(job, item)
                        emit("file.updated", file_event)
                        emit("job.progress", progress_event)
            with self._lock:
                job.finished_at = _now()
                job.updated_at = job.finished_at
                job.speed_bps = 0.0
                counts = job.counts()
                if job.cancel_event.is_set():
                    job.status = "cancelled"
                elif job.needs_auth:
                    job.status = "needs_auth"
                elif (
                    counts["failedFiles"]
                    or counts["retryableFiles"]
                    or counts["uncertainFiles"]
                ):
                    job.status = "completed_with_failures"
                else:
                    job.status = "completed"
                snapshot = job.snapshot()
            self._persist_job(job)
            emit(
                "job.completed",
                {
                    "jobId": job.id,
                    "status": snapshot["status"],
                    "completedFiles": snapshot["completedFiles"],
                    "failedFiles": snapshot["failedFiles"],
                    "retryableFiles": snapshot["retryableFiles"],
                    "uncertainFiles": snapshot["uncertainFiles"],
                    "processingVideos": snapshot["processingVideos"],
                    "skippedFiles": snapshot["skippedFiles"],
                    "totalFiles": snapshot["totalFiles"],
                    "duration": round((job.finished_at or _now()) - job.created_at, 1),
                },
            )
        except Exception as error:  # pragma: no cover - last-resort guard
            with self._lock:
                job.status = "failed"
                job.last_error = str(error)[:300]
                job.finished_at = _now()
            self._persist_job(job)
            emit(
                "job.failed",
                {"jobId": job.id, "error": job.last_error, "status": "failed"},
            )

    def _upload_one(
        self,
        job: Job,
        item: FileJob,
        auth_data: str,
        emit: Emit,
    ) -> None:
        with self._lock:
            if job.cancel_event.is_set():
                item.state = "cancelled"
                item.updated_at = _now()
            elif job.needs_auth:
                item.state = "failed"
                item.code = "auth_expired"
                item.error = "Not attempted because the connection expired."
                item.updated_at = _now()
            else:
                item.state = "validating"
                item.phase = "validating"
                item.code = None
                item.error = None
                item.hint = None
                item.updated_at = _now()
            event = self._file_event(job, item)
            progress = self._progress_event(job)

        self._persist_file(job, item)
        emit("file.updated", event)
        if item.state != "validating":
            emit("job.progress", progress)
            return

        validation = validate_media(
            Path(item.abs_path),
            MediaType(item.media_type),
            wait_seconds=self._validation_wait,
        )
        if not validation.ok:
            with self._lock:
                item.state = validation.state
                item.code = validation.code
                item.error = validation.message
                item.hint = validation.hint
                item.phase = "skipped" if validation.state == "skipped" else "failed"
                item.updated_at = _now()
                event = self._file_event(job, item)
                progress = self._progress_event(job)
            log.info(
                "job %s file %s skipped (%s): %s",
                job.id,
                Path(item.abs_path).name,
                item.code,
                item.error,
            )
            self._persist_file(job, item)
            emit("file.updated", event)
            emit("job.progress", progress)
            return

        try:
            item.fingerprint = file_fingerprint(item.abs_path)
        except OSError as error:
            with self._lock:
                item.state = "failed"
                item.code = "file_missing"
                item.error = "The file disappeared before it could be uploaded."
                item.hint = str(error)
                item.phase = "failed"
                item.updated_at = _now()
                event = self._file_event(job, item)
                progress = self._progress_event(job)
            self._persist_file(job, item)
            emit("file.updated", event)
            emit("job.progress", progress)
            return

        # Every file is offered to gpmc in every job. gpmc checks the remote
        # library by content hash first: still-present files come back as
        # "already there" with their media key, and files deleted from Google
        # Photos are uploaded again. A local "once uploaded, never again" skip
        # would make deleted photos impossible to restore through Photonic.
        with self._lock:
            item.media_type = (validation.media_type or MediaType(item.media_type)).value
            item.state = "uploading"
            item.phase = "uploading"
            item.attempts += 1
            item.updated_at = _now()
            event = self._file_event(job, item)
            progress = self._progress_event(job)
        self._persist_file(job, item)
        emit("file.updated", event)
        emit("job.progress", progress)

        album = self._album_for(job, item)
        last_emit = 0.0

        def on_progress(phase: str, completed: int, total: int) -> None:
            nonlocal last_emit
            now = _now()
            with self._lock:
                item.phase = phase
                # Only bytes actually sent to Google count as progress.
                # Hashing reads the file, and gpmc reports 0 while checking
                # for a remote duplicate; counting either makes the overall
                # percentage jump backwards.
                if phase in ("uploading", "finalizing", "complete", "skipped"):
                    limit = item.size or total
                    item.bytes_completed = max(
                        item.bytes_completed, min(completed, limit)
                    )
                item.bytes_total = total or item.size
                item.updated_at = now
                self._update_speed(job)
                event = self._file_event(job, item)
                progress = self._progress_event(job)
            emit_this = now - last_emit >= 0.25 or phase in ("complete", "skipped", "error")
            if emit_this:
                last_emit = now
                emit("file.updated", event)
                emit("job.progress", progress)

        def run_once() -> UploadResult:
            return upload_file(
                Path(item.abs_path),
                auth_data,
                job.cancel_event,
                album=album,
                on_progress=on_progress,
            )

        result = run_once()
        retry_index = 0
        while (
            result.state == "failed"
            and result.error is not None
            and (result.error.recoverable or result.error.code == "rate_limited")
            and not job.cancel_event.is_set()
        ):
            delays = (
                self._rate_limit_delays
                if result.error.code == "rate_limited"
                else self._retry_delays
            )
            if retry_index >= len(delays):
                break
            delay = delays[retry_index]
            retry_index += 1
            with self._lock:
                item.state = "retryable"
                item.phase = "retrying"
                item.code = result.error.code
                item.error = result.error.message
                item.hint = f"Temporary failure. Retrying in {int(delay)}s."
                item.updated_at = _now()
                event = self._file_event(job, item)
                progress = self._progress_event(job)
            self._persist_file(job, item)
            emit("file.updated", event)
            emit("job.progress", progress)
            if not self._retry_wait(job, delay):
                result = UploadResult(state="cancelled")
                break
            with self._lock:
                item.state = "uploading"
                item.phase = "uploading"
                item.code = None
                item.error = None
                item.hint = None
                item.attempts += 1
                item.updated_at = _now()
                event = self._file_event(job, item)
                progress = self._progress_event(job)
            self._persist_file(job, item)
            emit("file.updated", event)
            emit("job.progress", progress)
            result = run_once()

        emit_auth_required = False
        with self._lock:
            final_state = result.state
            if (
                final_state == "failed"
                and result.error is not None
                and result.error.recoverable
            ):
                final_state = "retryable"
            item.state = final_state
            item.remote_id = result.media_key
            item.error = result.error.message if result.error else None
            item.code = result.error.code if result.error else result.code
            item.hint = result.error.hint if result.error else None
            item.updated_at = _now()
            if final_state in ("completed", "skipped"):
                item.bytes_completed = item.size
                item.phase = "complete" if final_state == "completed" else "skipped"
            if final_state == "completed" and item.media_type == "video":
                item.processing_hint = "remote_processing_possible"
            else:
                item.processing_hint = None
            if result.error and result.error.code in ("auth_expired", "auth_scope"):
                job.needs_auth = True
                if not job.auth_event_emitted:
                    job.auth_event_emitted = True
                    emit_auth_required = True
            job.updated_at = item.updated_at
            file_event = self._file_event(job, item)
            progress_event = self._progress_event(job)
        log.info(
            "job %s file %s -> %s%s",
            job.id,
            Path(item.abs_path).name,
            item.state,
            f" ({item.code})" if item.code else "",
        )
        self._persist_file(job, item)
        self._record_ledger(job, item)
        emit("file.updated", file_event)
        emit("job.progress", progress_event)
        if emit_auth_required:
            emit("auth.required", {"jobId": job.id, "reason": "expired"})

    def _record_ledger(self, job: Job, item: FileJob) -> None:
        if self._store is None or not item.fingerprint:
            return
        if item.state == "completed" or (
            item.state == "skipped" and item.code is None
        ):
            status = "completed"
        elif item.state == "uncertain":
            status = "uncertain"
        else:
            return
        try:
            self._store.record_ledger(
                fingerprint=item.fingerprint,
                abs_path=item.abs_path,
                size=item.size,
                mtime=item.mtime,
                remote_id=item.remote_id,
                status=status,
                job_id=job.id,
            )
        except Exception:
            log.exception("could not record ledger for %s", item.path)

    @staticmethod
    def _album_for(job: Job, item: FileJob) -> str | None:
        if job.album_policy == "per_job":
            return job.album_name or Path(job.root).name
        if job.album_policy == "per_folder":
            return "AUTO"
        return None

    @staticmethod
    def _file_event(job: Job, item: FileJob) -> dict:
        return {
            "jobId": job.id,
            "path": item.path,
            **item.to_dict(),
        }

    @staticmethod
    def _retry_wait(job: Job, seconds: float) -> bool:
        """Sleep between retries, returning False if the job is cancelled."""
        deadline = time.monotonic() + max(0.0, seconds)
        while True:
            if job.cancel_event.is_set():
                return False
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return True
            time.sleep(min(0.2, remaining))

    @staticmethod
    def _update_speed(job: Job) -> None:
        """Smoothed upload rate, updated from progress callbacks.

        Uses wall-clock deltas over at least 0.25 s so a burst of tiny files
        cannot produce a meaningless spike.
        """
        now = time.monotonic()
        if job.speed_at is not None and now - job.speed_at < 0.25:
            return
        done = sum(min(item.bytes_completed, item.size) for item in job.files)
        if job.speed_at is None:
            job.speed_at = now
            job.speed_bytes = done
            return
        elapsed = now - job.speed_at
        delta = done - job.speed_bytes
        if delta >= 0:
            instant = delta / elapsed
            job.speed_bps = (
                instant if job.speed_bps <= 0 else job.speed_bps * 0.7 + instant * 0.3
            )
        job.speed_at = now
        job.speed_bytes = done

    @staticmethod
    def _progress_event(job: Job) -> dict:
        return {
            "jobId": job.id,
            "status": job.status,
            "bytesPerSecond": round(job.speed_bps, 1),
            **job.counts(),
        }

    def retry_failed(
        self,
        job_id: str,
        auth_data: str,
        *,
        include_uncertain: bool = False,
        emit: Emit = NOOP_EMIT,
    ) -> dict:
        validate_auth_data(auth_data)
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise EngineError("job_not_found", f"No job with id {job_id}.")
            if job.finished_at is None and job.status in ("uploading", "cancelling"):
                raise EngineError(
                    "job_busy",
                    "This job is still running.",
                    hint="Wait for it to finish, then retry the failed files.",
                )
            targets = [
                item
                for item in job.files
                if item.state in ("failed", "retryable")
                or (include_uncertain and item.state == "uncertain")
            ]
            if not targets:
                raise EngineError(
                    "no_failed_files",
                    "There are no failed files to retry.",
                    hint="All files either completed, were skipped, or need reconciliation.",
                )
            for item in targets:
                item.force = item.state == "uncertain"
                item.state = "pending"
                item.error = None
                item.code = None
                item.hint = None
                item.phase = None
                item.processing_hint = None
                item.bytes_completed = 0
                item.updated_at = _now()
            job.status = "uploading"
            job.needs_auth = False
            job.auth_event_emitted = False
            job.finished_at = None
            job.last_error = None
            job.speed_bps = 0.0
            job.speed_at = None
            job.speed_bytes = 0
            job.updated_at = _now()
            snapshot = job.snapshot()
            progress = self._progress_event(job)
        for item in targets:
            self._persist_file(job, item)
        self._persist_job(job)
        emit("job.progress", progress)
        thread = threading.Thread(
            target=self._run_job,
            args=(job, auth_data, emit, targets),
            daemon=True,
            name=f"photonic-retry-{job.id}",
        )
        thread.start()
        return snapshot

    def resume_job(
        self,
        job_id: str,
        auth_data: str,
        *,
        emit: Emit = NOOP_EMIT,
    ) -> dict:
        validate_auth_data(auth_data)
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise EngineError("job_not_found", f"No job with id {job_id}.")
            if job.finished_at is None and job.status in ("uploading", "cancelling"):
                raise EngineError(
                    "job_busy",
                    "This job is still running.",
                    hint="Wait for it to finish, then resume.",
                )
            targets = [
                item
                for item in job.files
                if item.state in ("pending", "validating", "failed", "retryable")
            ]
            if not targets:
                raise EngineError(
                    "no_work",
                    "There is no remaining work to resume.",
                    hint="Retry uncertain files explicitly if needed.",
                )
            for item in targets:
                item.state = "pending"
                item.error = None
                item.code = None
                item.hint = None
                item.phase = None
                item.processing_hint = None
                item.bytes_completed = 0
                item.updated_at = _now()
            job.status = "uploading"
            job.needs_auth = False
            job.auth_event_emitted = False
            job.finished_at = None
            job.last_error = None
            job.speed_bps = 0.0
            job.speed_at = None
            job.speed_bytes = 0
            job.updated_at = _now()
            snapshot = job.snapshot()
            progress = self._progress_event(job)
        for item in targets:
            self._persist_file(job, item)
        self._persist_job(job)
        emit("job.progress", progress)
        thread = threading.Thread(
            target=self._run_job,
            args=(job, auth_data, emit, targets),
            daemon=True,
            name=f"photonic-resume-{job.id}",
        )
        thread.start()
        return snapshot

    def cancel(self, job_id: str) -> dict:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise EngineError("job_not_found", f"No job with id {job_id}.")
            job.cancel_event.set()
            if job.status in ("uploading", "queued"):
                job.status = "cancelling"
            elif job.status in ("interrupted", "needs_auth", "paused"):
                job.status = "cancelled"
                job.finished_at = job.finished_at or _now()
            job.updated_at = _now()
            for item in job.files:
                if item.state in ("pending", "validating"):
                    item.state = "cancelled"
                    item.updated_at = _now()
            snapshot = job.snapshot()
        self._persist_job(job)
        for item in job.files:
            if item.state == "cancelled":
                self._persist_file(job, item)
        return snapshot

    def get_job(self, job_id: str) -> dict:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None and self._store is not None:
            job = self._store.load_job(job_id)
            if job is not None:
                with self._lock:
                    self._jobs[job_id] = job
        if job is None:
            raise EngineError(
                "job_not_found",
                f"No job with id {job_id}.",
                hint="The job may belong to a previous app session.",
            )
        with self._lock:
            return job.snapshot()

    def clear_history(self) -> dict:
        """Remove finished jobs. Refuses while a backup is running."""
        with self._lock:
            if any(job.finished_at is None for job in self._jobs.values()):
                raise EngineError(
                    "job_busy",
                    "A backup is still running.",
                    hint="Wait for it to finish, then clear history.",
                )
        removed = 0
        if self._store is not None:
            try:
                removed = self._store.clear_history()
            except Exception:
                log.exception("could not clear job history")
                raise EngineError(
                    "history_error", "The backup history could not be cleared."
                )
        with self._lock:
            for job_id in [
                job_id
                for job_id, job in self._jobs.items()
                if job.finished_at is not None
            ]:
                self._jobs.pop(job_id, None)
        log.info("cleared %d finished job(s)", removed)
        return {"removed": removed}

    def list_jobs(self) -> list[dict]:
        """Job summaries for the Activity list, newest first.

        Historical jobs are aggregated in SQL; their file rows are not
        deserialized. Use ``get_job`` when a specific job is opened.
        """
        with self._lock:
            memory = {job_id: job.summary() for job_id, job in self._jobs.items()}
        stored: dict[str, dict] = {}
        if self._store is not None:
            try:
                stored = {
                    item["id"]: item for item in self._store.list_job_summaries()
                }
            except Exception:
                log.exception("could not load job history")
        stored.update(memory)
        return sorted(
            stored.values(), key=lambda item: item["createdAt"], reverse=True
        )
