"""Stable local identity for a media file, used by the upload ledger."""

from __future__ import annotations

import hashlib
from pathlib import Path

_CHUNK = 64 * 1024


def file_fingerprint(path: str | Path) -> str:
    """Hash path + size + mtime + the first/last 64 KiB of content.

    This is a fast identity, not a proof of remote existence. It is computed at
    upload preparation, never during a large scan.
    """
    target = Path(path)
    stat = target.stat()
    digest = hashlib.sha256()
    digest.update(str(target.resolve()).encode("utf-8"))
    digest.update(b"|")
    digest.update(str(stat.st_size).encode("ascii"))
    digest.update(b"|")
    digest.update(str(stat.st_mtime_ns).encode("ascii"))
    digest.update(b"|")

    with target.open("rb") as handle:
        digest.update(handle.read(_CHUNK))
        if stat.st_size > _CHUNK:
            handle.seek(max(0, stat.st_size - _CHUNK))
            digest.update(handle.read(_CHUNK))
    return digest.hexdigest()
