"""Per-file gpmc adapter.

One process per file gives an unambiguous file -> media key mapping and simple
cancellation. The token is passed only through the child environment.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .auth import redact
from .paths import gpmc_work_dir
from .protocol import EngineError

logger = logging.getLogger(__name__)

_MEDIA_KEY = re.compile(r"AF1Qip[A-Za-z0-9_-]{8,}")
_TERMINAL_PHASES = {"complete", "skipped", "error"}
# Bare "401"/"403"/"429" also occur inside byte counts (44040192) and media
# keys. Only a standalone status token counts as an HTTP failure.
_STATUS_401 = re.compile(r"\b401\b")
_STATUS_403 = re.compile(r"\b403\b")
_STATUS_429 = re.compile(r"\b429\b")
_AUTH_MARKERS = ("unauthorized", "unauthenticated", "invalid credentials")
_SCOPE_MARKERS = (
    "insufficient authentication scopes",
    "access_token_scope_insufficient",
    "insufficient_scope",
    "insufficient permissions",
)
_FORBIDDEN_MARKERS = ("forbidden",)
_RATE_MARKERS = (
    "rate limit",
    "ratelimit",
    "too many requests",
    "quota",
)
_NETWORK_MARKERS = (
    "connection reset",
    "connection aborted",
    "timed out",
    "timeout",
    "temporary failure",
    "name or service not known",
    "network is unreachable",
    "broken pipe",
    "ssl",
)
_FILE_MARKERS = ("no such file", "not found", "file not found")
_UNSUPPORTED_MARKERS = (
    "mime type does not match",
    "does not match image or video",
    "unsupported media type",
    "unsupported mime",
    "invalid mime",
)


@dataclass(slots=True)
class UploadResult:
    state: str  # completed | skipped | uncertain | failed | cancelled
    media_key: str | None = None
    error: EngineError | None = None
    phases: list[str] = field(default_factory=list)
    exit_code: int | None = None
    code: str | None = None  # informational, e.g. already_uploaded


ProgressCallback = Callable[[str, int, int], None]


def _gpmc_prefix() -> list[str]:
    override = os.environ.get("PHOTONIC_GPMC")
    candidate = override if override and Path(override).is_file() else shutil.which("gpmc")
    if not candidate:
        raise EngineError(
            "gpmc_missing",
            "The upload helper gpmc was not found.",
            hint="Install gpmc or set PHOTONIC_GPMC to its path.",
        )
    if candidate.endswith(".py"):
        return [sys.executable, candidate]
    return [candidate]


def _diagnostic_text(combined: str) -> str:
    """Only human-readable gpmc log lines.

    NDJSON progress events and the final stdout mapping carry byte counts and
    media keys; scanning them for "401"/"403" misreads an uploaded file as an
    auth failure (for example ``bytes_completed: 44040192``).
    """
    return "\n".join(
        line for line in combined.splitlines() if not line.lstrip().startswith("{")
    )


def _has_auth_failure(diagnostic: str) -> bool:
    return _STATUS_401.search(diagnostic) is not None or any(
        marker in diagnostic for marker in _AUTH_MARKERS
    )


def _error_detail(combined: str) -> str:
    """The most useful redacted line from gpmc's output, for the log only."""
    for line in reversed(combined.splitlines()):
        cleaned = redact(line).strip()
        if cleaned and not cleaned.startswith("{"):
            return cleaned[:300]
    return ""


def _classify_error(combined: str) -> EngineError:
    lowered = redact(_diagnostic_text(combined)).lower()
    if any(marker in lowered for marker in _SCOPE_MARKERS):
        return EngineError(
            "auth_scope",
            "Google rejected this sign-in for photo access.",
            hint="Reconnect Google Photos, then retry the failed files.",
        )
    if _has_auth_failure(lowered):
        return EngineError(
            "auth_expired",
            "Google rejected the saved connection.",
            hint="Reconnect Google Photos, then retry the failed files.",
        )
    if _STATUS_403.search(lowered) or any(
        marker in lowered for marker in _FORBIDDEN_MARKERS
    ):
        return EngineError(
            "upload_forbidden",
            "Google refused this upload for the signed-in account.",
            hint="Reconnect, then retry. If it keeps happening, wait a few hours or use a different account.",
        )
    if _STATUS_429.search(lowered) or any(
        marker in lowered for marker in _RATE_MARKERS
    ):
        return EngineError(
            "rate_limited",
            "Google is limiting this account right now.",
            hint="Wait a few hours, then reconnect and retry. Repeated limits can affect the account.",
        )
    if any(marker in lowered for marker in _FILE_MARKERS):
        return EngineError(
            "file_missing",
            "The file disappeared before it could be uploaded.",
            hint="Locate the file or remove it from the job.",
        )
    if any(marker in lowered for marker in _NETWORK_MARKERS):
        return EngineError(
            "network",
            "The upload lost its network connection.",
            hint="Check your connection and retry the failed files.",
            recoverable=True,
        )
    return EngineError(
        "upload_failed",
        "The upload did not complete.",
        hint="Retry this file. If it keeps failing, export diagnostics.",
    )


def _album_args(album: str | None) -> list[str]:
    if not album:
        return []
    return ["--album", album]


def _pid_dir() -> Path:
    return gpmc_work_dir() / "run"


def _record_pid(pid: int, target: Path) -> Path | None:
    """Remember a child so a crashed session can clean it up next start."""
    try:
        directory = _pid_dir()
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{pid}.json"
        path.write_text(
            json.dumps({"pid": pid, "target": str(target)}), encoding="utf-8"
        )
        return path
    except OSError:
        return None


def cleanup_orphaned_children() -> int:
    """Kill gpmc children left behind by a hard crash.

    Only a process whose command line contains both ``gpmc`` and the exact
    target recorded in the pid file is signalled, so a reused PID is safe.
    """
    directory = _pid_dir()
    if not directory.is_dir():
        return 0
    killed = 0
    for entry in directory.glob("*.json"):
        try:
            data = json.loads(entry.read_text(encoding="utf-8"))
            pid = int(data["pid"])
            target = str(data["target"])
        except (OSError, ValueError, KeyError, TypeError):
            entry.unlink(missing_ok=True)
            continue
        try:
            cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().decode(
                "utf-8", "ignore"
            )
        except OSError:
            # Already gone (or no procfs).
            entry.unlink(missing_ok=True)
            continue
        if "gpmc" in cmdline and target in cmdline:
            try:
                os.kill(pid, signal.SIGTERM)
                killed += 1
            except OSError:
                pass
        entry.unlink(missing_ok=True)
    return killed


def upload_file(
    path: Path,
    auth_data: str,
    cancel_event: threading.Event,
    album: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> UploadResult:
    """Upload one file with gpmc and return its true outcome.

    ``uncertain`` means the process ended without a terminal phase or a media
    key; the remote may already have accepted the bytes, so callers must not
    auto-retry it.
    """
    try:
        prefix = _gpmc_prefix()
    except EngineError as error:
        return UploadResult(state="failed", error=error)

    command = [
        *prefix,
        str(path),
        "--json-progress",
        "--timeout",
        "86400",
        "--log-level",
        "WARNING",
        *_album_args(album),
    ]
    env = {**os.environ, "GP_AUTH_DATA": auth_data, "PYTHONUNBUFFERED": "1"}
    try:
        workdir = gpmc_work_dir()
        workdir.mkdir(parents=True, exist_ok=True)
    except OSError:
        workdir = None

    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
            cwd=workdir,
            start_new_session=True,
        )
    except OSError as error:
        return UploadResult(
            state="failed",
            error=EngineError(
                "gpmc_failed",
                "The upload helper could not be started.",
                hint=str(error),
            ),
        )

    pidfile = _record_pid(process.pid, path)

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    phases: list[str] = []
    cancelled = False

    def pump_stdout() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            stdout_lines.append(line)

    def pump_stderr() -> None:
        assert process.stderr is not None
        for line in process.stderr:
            stderr_lines.append(line)
            stripped = line.strip()
            if not stripped.startswith("{"):
                continue
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if event.get("type") != "progress":
                continue
            phase = str(event.get("phase") or "uploading")
            phases.append(phase)
            if on_progress:
                completed = int(event.get("bytes_completed") or 0)
                total = int(event.get("bytes_total") or 0)
                try:
                    on_progress(phase, completed, total)
                except Exception:
                    pass

    reader_out = threading.Thread(target=pump_stdout, daemon=True)
    reader_err = threading.Thread(target=pump_stderr, daemon=True)
    reader_out.start()
    reader_err.start()

    while process.poll() is None:
        if cancel_event.is_set():
            cancelled = True
            _terminate(process)
            break
        time.sleep(0.1)

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    reader_out.join(timeout=2)
    reader_err.join(timeout=2)
    if pidfile is not None:
        try:
            pidfile.unlink()
        except OSError:
            pass

    stdout_text = "".join(stdout_lines)
    stderr_text = "".join(stderr_lines)
    combined = stdout_text + stderr_text
    exit_code = process.returncode

    keys = _MEDIA_KEY.findall(combined)
    media_key = keys[-1] if keys else None

    if cancelled:
        if "complete" in phases and media_key:
            return UploadResult("completed", media_key, None, phases, exit_code)
        if any(phase in ("uploading", "finalizing") for phase in phases):
            return UploadResult(
                state="uncertain",
                media_key=media_key,
                error=EngineError(
                    "uncertain",
                    "The upload was cancelled after it had started.",
                    hint="Google may have received this file. Reconcile before retrying.",
                ),
                phases=phases,
                exit_code=exit_code,
            )
        return UploadResult(
            state="cancelled",
            media_key=media_key,
            phases=phases,
            exit_code=exit_code,
        )

    diagnostic = redact(_diagnostic_text(combined)).lower()

    if any(marker in diagnostic for marker in _UNSUPPORTED_MARKERS):
        return UploadResult(
            state="skipped",
            media_key=media_key,
            error=EngineError(
                "unsupported_mime",
                "Google Photos rejected this file's media type.",
                hint="It is not a supported image or video; it was skipped and the rest of the batch continues.",
            ),
            phases=phases,
            exit_code=exit_code,
        )

    # A media key plus a terminal success phase is authoritative: gpmc found
    # the file already in the library or finished committing it. Nothing in
    # the log can turn that into a failure.
    if "complete" in phases:
        if media_key:
            return UploadResult("completed", media_key, None, phases, exit_code)
        return UploadResult(
            state="uncertain",
            error=EngineError(
                "uncertain",
                "Google accepted the upload but did not return a media key.",
                hint="Reconcile before retrying, or it may create a duplicate.",
            ),
            phases=phases,
            exit_code=exit_code,
        )

    if "skipped" in phases:
        if media_key:
            # gpmc found the same content already in the remote library. That
            # is a backed-up file, not a file we refused to send.
            return UploadResult(
                "completed", media_key, None, phases, exit_code, "already_uploaded"
            )
        return UploadResult("skipped", None, None, phases, exit_code)

    if _has_auth_failure(diagnostic):
        return UploadResult(
            state="failed",
            media_key=media_key,
            error=_classify_error(combined),
            phases=phases,
            exit_code=exit_code,
        )

    # gpmc swallows per-file exceptions and still exits 0, but it does emit a
    # terminal `error` phase. Without this branch a rejected file would look
    # like an unconfirmed upload forever.
    if "error" in phases and media_key is None:
        detail = _error_detail(combined)
        if detail:
            logger.warning("gpmc rejected %s: %s", path.name, detail)
        return UploadResult(
            state="failed",
            media_key=None,
            error=_classify_error(combined),
            phases=phases,
            exit_code=exit_code,
        )

    if exit_code not in (None, 0):
        return UploadResult(
            state="failed",
            media_key=media_key,
            error=_classify_error(combined),
            phases=phases,
            exit_code=exit_code,
        )

    # Exit 0 without a terminal phase: the remote may have accepted the bytes.
    return UploadResult(
        state="uncertain",
        media_key=media_key,
        error=EngineError(
            "uncertain",
            "The upload ended without a final status.",
            hint="Reconcile before retrying, or it may create a duplicate.",
        ),
        phases=phases,
        exit_code=exit_code,
    )


def _terminate(process: subprocess.Popen) -> None:
    try:
        process.terminate()
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)
    except OSError:
        pass
