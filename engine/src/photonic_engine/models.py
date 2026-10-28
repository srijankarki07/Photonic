"""Stable domain types.

These names are the contract between the engine, SQLite rows, and the UI.
Keep them user-meaningful: the frontend should never need to understand
gpmc/gpd internals or raw subprocess exit codes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class MediaType(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    OTHER = "other"


class JobState(StrEnum):
    QUEUED = "queued"
    SCANNING = "scanning"
    UPLOADING = "uploading"
    PAUSED = "paused"
    COMPLETED = "completed"
    COMPLETED_WITH_FAILURES = "completed_with_failures"
    FAILED = "failed"
    CANCELLED = "cancelled"
    CANCELLING = "cancelling"
    NEEDS_AUTH = "needs_auth"
    # Recovered after the app/sidecar stopped; resume explicitly.
    INTERRUPTED = "interrupted"


class FileState(StrEnum):
    PENDING = "pending"
    VALIDATING = "validating"
    UPLOADING = "uploading"
    COMPLETED = "completed"
    RETRYABLE = "retryable"
    FAILED = "failed"
    # Remote may have accepted the bytes but we never saw a media key.
    # Never auto-retry these; reconcile first.
    UNCERTAIN = "uncertain"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


@dataclass(slots=True)
class MediaFile:
    """One uploadable item discovered on disk."""

    path: str  # path relative to the scan root, POSIX separators
    abs_path: str
    size: int
    media_type: MediaType
    mtime: float
    state: FileState = FileState.PENDING
    remote_id: str | None = None
    last_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "absPath": self.abs_path,
            "size": self.size,
            "mediaType": self.media_type.value,
            "mtime": self.mtime,
            "state": self.state.value,
            "remoteId": self.remote_id,
            "lastError": self.last_error,
        }


@dataclass(slots=True)
class ScanResult:
    root: str
    files: list[MediaFile] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)
    warnings: list[dict[str, str]] = field(default_factory=list)
    directory_count: int = 0
    skipped_count: int = 0
    partial: bool = False

    @property
    def total_bytes(self) -> int:
        return sum(item.size for item in self.files)

    @property
    def media_count(self) -> int:
        return len(self.files)

    def to_dict(self) -> dict[str, Any]:
        return {
            "root": self.root,
            "mediaCount": self.media_count,
            "totalBytes": self.total_bytes,
            "directoryCount": self.directory_count,
            "partial": self.partial,
            "skippedCount": self.skipped_count,
            "skipped": self.skipped,
            "warnings": self.warnings,
            "files": [item.to_dict() for item in self.files],
        }
