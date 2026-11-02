"""Newline-delimited JSON-RPC dispatch loop."""

from __future__ import annotations

import json
import logging
import sys
import threading
from typing import Any, Callable, TextIO

from .binaries import engine_info
from .gpmc_adapter import cleanup_orphaned_children
from .jobs import JobManager, NOOP_EMIT
from .logging_setup import configure_logging
from .store import JobStore
from .protocol import EngineError, error, event, ok, parse_request
from .scanner import scan_folder, scan_selection

log = logging.getLogger("photonic_engine")

Emit = Callable[[str, dict], None]

JOBS = JobManager()

PLANNED_METHODS = frozenset(
    {
        "get_settings",
        "set_settings",
    }
)


def _ping(_params: dict[str, Any], _emit: Emit) -> dict[str, Any]:
    return {"pong": True}


def _scan(params: dict[str, Any], _emit: Emit) -> dict[str, Any]:
    path = params.get("path")
    if not isinstance(path, str) or not path.strip():
        raise EngineError("bad_request", "scan_folder requires a string 'path'.")
    include_hidden = params.get("includeHidden", False)
    max_files = params.get("maxFiles", 50_000)
    if not isinstance(include_hidden, bool):
        raise EngineError("bad_request", "'includeHidden' must be a boolean.")
    if isinstance(max_files, bool) or not isinstance(max_files, int):
        raise EngineError("bad_request", "'maxFiles' must be an integer.")
    return scan_folder(
        path,
        include_hidden=include_hidden,
        max_files=max_files,
    ).to_dict()


def _scan_selection(params: dict[str, Any], _emit: Emit) -> dict[str, Any]:
    paths = params.get("paths")
    if (
        not isinstance(paths, list)
        or not paths
        or not all(isinstance(item, str) and item.strip() for item in paths)
    ):
        raise EngineError(
            "bad_request",
            "scan_selection requires a non-empty list of string 'paths'.",
        )
    include_hidden = params.get("includeHidden", False)
    max_files = params.get("maxFiles", 50_000)
    if not isinstance(include_hidden, bool):
        raise EngineError("bad_request", "'includeHidden' must be a boolean.")
    if isinstance(max_files, bool) or not isinstance(max_files, int):
        raise EngineError("bad_request", "'maxFiles' must be an integer.")
    return scan_selection(
        paths,
        include_hidden=include_hidden,
        max_files=max_files,
    ).to_dict()


def _start_upload(params: dict[str, Any], emit: Emit) -> dict[str, Any]:
    path = params.get("path")
    paths = params.get("paths")
    auth_data = params.get("authData")
    files = params.get("files")
    if files is not None and (
        not isinstance(files, list)
        or not all(isinstance(item, dict) for item in files)
    ):
        raise EngineError(
            "bad_request", "'files' must be a list of reviewed file objects."
        )
    if paths:
        if (
            not isinstance(paths, list)
            or not paths
            or not all(isinstance(item, str) and item.strip() for item in paths)
        ):
            raise EngineError(
                "bad_request",
                "start_upload 'paths' must be a non-empty list of strings.",
            )
    elif not files and (not isinstance(path, str) or not path.strip()):
        raise EngineError(
            "bad_request",
            "start_upload requires 'paths', 'files', or a string 'path'.",
        )
    if not isinstance(auth_data, str) or not auth_data:
        raise EngineError(
            "auth_missing",
            "No Google Photos connection was provided.",
            hint="Connect Google Photos, then try again.",
        )
    album_policy = params.get("albumPolicy", "timeline")
    if not isinstance(album_policy, str):
        raise EngineError("bad_request", "'albumPolicy' must be a string.")
    album_name = params.get("albumName")
    if album_name is not None and not isinstance(album_name, str):
        raise EngineError("bad_request", "'albumName' must be a string or null.")
    include_hidden = params.get("includeHidden", False)
    if not isinstance(include_hidden, bool):
        raise EngineError("bad_request", "'includeHidden' must be a boolean.")
    max_files = params.get("maxFiles", 50_000)
    if isinstance(max_files, bool) or not isinstance(max_files, int):
        raise EngineError("bad_request", "'maxFiles' must be an integer.")

    return JOBS.start_upload(
        root=path if isinstance(path, str) and path.strip() else None,
        paths=paths if isinstance(paths, list) else None,
        files=files if isinstance(files, list) else None,
        auth_data=auth_data,
        album_policy=album_policy,
        album_name=album_name,
        include_hidden=include_hidden,
        max_files=max_files,
        emit=emit,
    )


def _get_job(params: dict[str, Any], _emit: Emit) -> dict[str, Any]:
    job_id = params.get("jobId")
    if not isinstance(job_id, str) or not job_id:
        raise EngineError("bad_request", "get_job requires a string 'jobId'.")
    return JOBS.get_job(job_id)


def _cancel_job(params: dict[str, Any], _emit: Emit) -> dict[str, Any]:
    job_id = params.get("jobId")
    if not isinstance(job_id, str) or not job_id:
        raise EngineError("bad_request", "cancel_job requires a string 'jobId'.")
    return JOBS.cancel(job_id)


def _list_jobs(_params: dict[str, Any], _emit: Emit) -> dict[str, Any]:
    return {"jobs": JOBS.list_jobs()}


def _clear_history(_params: dict[str, Any], _emit: Emit) -> dict[str, Any]:
    return JOBS.clear_history()


def _retry_failed(params: dict[str, Any], emit: Emit) -> dict[str, Any]:
    job_id = params.get("jobId")
    auth_data = params.get("authData")
    include_uncertain = params.get("includeUncertain", False)
    if not isinstance(job_id, str) or not job_id:
        raise EngineError("bad_request", "retry_failed requires a string 'jobId'.")
    if not isinstance(auth_data, str) or not auth_data:
        raise EngineError(
            "auth_missing",
            "No Google Photos connection was provided.",
            hint="Reconnect Google Photos, then retry.",
        )
    if not isinstance(include_uncertain, bool):
        raise EngineError(
            "bad_request", "'includeUncertain' must be a boolean."
        )
    return JOBS.retry_failed(
        job_id,
        auth_data,
        include_uncertain=include_uncertain,
        emit=emit,
    )


def _resume_job(params: dict[str, Any], emit: Emit) -> dict[str, Any]:
    job_id = params.get("jobId")
    auth_data = params.get("authData")
    if not isinstance(job_id, str) or not job_id:
        raise EngineError("bad_request", "resume_job requires a string 'jobId'.")
    if not isinstance(auth_data, str) or not auth_data:
        raise EngineError(
            "auth_missing",
            "No Google Photos connection was provided.",
            hint="Reconnect Google Photos, then resume.",
        )
    return JOBS.resume_job(job_id, auth_data, emit=emit)


METHODS = {
    "ping": _ping,
    "engine_info": lambda _params, _emit: engine_info(),
    "scan_folder": _scan,
    "scan_selection": _scan_selection,
    "start_upload": _start_upload,
    "get_job": _get_job,
    "cancel_job": _cancel_job,
    "list_jobs": _list_jobs,
    "clear_history": _clear_history,
    "retry_failed": _retry_failed,
    "resume_job": _resume_job,
}


def handle_request(raw: Any, emit: Emit = NOOP_EMIT) -> dict[str, Any]:
    """Dispatch one decoded request. Never raises."""
    request_id = ""
    try:
        if not isinstance(raw, dict):
            raise EngineError("bad_request", "Request must be a JSON object.")
        request_id, method, params = parse_request(raw)
        handler = METHODS.get(method)
        if handler is None:
            if method in PLANNED_METHODS:
                raise EngineError(
                    "not_implemented",
                    f"'{method}' is not implemented in this engine build.",
                    recoverable=False,
                    hint="This capability arrives in a later Photonic milestone.",
                )
            raise EngineError("method_not_found", f"Unknown method: {method}")
        return ok(request_id, handler(params, emit))
    except EngineError as exc:
        return error(request_id, exc)
    except Exception as exc:  # defensive: keep the channel alive
        log.exception("unhandled engine error")
        return error(
            request_id,
            EngineError(
                "internal_error",
                "The engine hit an unexpected error.",
                recoverable=True,
                details={"type": type(exc).__name__},
            ),
        )


def handle_line(line: str, emit: Emit = NOOP_EMIT) -> dict[str, Any]:
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return error(
            "",
            EngineError(
                "bad_json",
                "Line is not valid JSON.",
                hint="Send one JSON object per line.",
            ),
        )
    return handle_request(raw, emit)


def serve(stdin: TextIO | None = None, stdout: TextIO | None = None) -> None:
    """Run until stdin closes. stdout is protocol-only; logs go to stderr."""
    global JOBS
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    configure_logging()

    try:
        orphans = cleanup_orphaned_children()
        if orphans:
            log.info("stopped %d orphaned gpmc process(es)", orphans)
    except Exception:  # noqa: BLE001 - cleanup is best effort
        log.exception("could not clean up orphaned upload processes")

    store: JobStore | None = None
    try:
        store = JobStore()
        JOBS = JobManager(store=store)
        log.info("job history: %s", store.path)
    except Exception:
        log.exception("persistent storage unavailable; using in-memory jobs")
        JOBS = JobManager()
    log.info("photonic-engine ready (protocol v1)")

    write_lock = threading.Lock()
    sequence = [0]

    def write(payload: dict[str, Any]) -> None:
        try:
            with write_lock:
                stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
                stdout.flush()
        except (BrokenPipeError, OSError):
            # The controller closed the channel; the process is going away.
            pass

    def emit(name: str, data: dict) -> None:
        with write_lock:
            sequence[0] += 1
            seq = sequence[0]
        write({"v": 1, "event": name, "seq": seq, "data": data})

    try:
        for line in stdin:
            if not line.strip():
                continue
            response = handle_line(line, emit)
            write(response)
    finally:
        if store is not None:
            store.close()


__all__ = [
    "JOBS",
    "METHODS",
    "event",
    "handle_line",
    "handle_request",
    "serve",
]
