"""Locate and describe the external upload/conversion binaries.

Photonic does not ship a spoofing implementation of its own; it orchestrates
``gpmc`` (uploads) and, for arbitrary-file backup, ``gpd`` (disguise).
Both are resolved from the environment first, then from PATH.
"""

from __future__ import annotations

import importlib.metadata
import os
import platform
import shutil
import sys
from typing import Any

from . import PROTOCOL_VERSION, __version__
from .paths import database_path, default_data_dir, logs_dir

# env override -> (binary name, distribution name for a version lookup)
_BINARIES = {
    "gpmc": ("PHOTONIC_GPMC", "gpmc"),
    "gpd": ("PHOTONIC_GPD", "gp_disguise"),
}


def resolve_binary(name: str) -> str | None:
    env_var = _BINARIES[name][0]
    override = os.environ.get(env_var)
    if override:
        return override if os.path.isfile(override) and os.access(override, os.X_OK) else None
    return shutil.which(name)


def _version_for(distribution: str) -> str | None:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


def _binary_info(name: str) -> dict[str, Any]:
    path = resolve_binary(name)
    distribution = _BINARIES[name][1]
    return {
        "name": name,
        "path": path,
        "version": _version_for(distribution),
        "found": path is not None,
    }


def engine_info() -> dict[str, Any]:
    binaries = {name: _binary_info(name) for name in _BINARIES}
    ffmpeg = shutil.which("ffmpeg")
    return {
        "engine": "photonic-engine",
        "version": __version__,
        "protocolVersion": PROTOCOL_VERSION,
        "python": sys.version.split()[0],
        "platform": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "binaries": binaries,
        "ffmpeg": {"path": ffmpeg, "found": ffmpeg is not None},
        "ready": binaries["gpmc"]["found"],
        "dataDir": str(default_data_dir()),
        "databasePath": str(database_path()),
        "logFile": str(logs_dir() / "engine.log"),
        "capabilities": [
            "engine_info",
            "ping",
            "scan_folder",
            "scan_selection",
            "start_upload",
            "get_job",
            "cancel_job",
            "list_jobs",
            "retry_failed",
            "resume_job",
        ],
        "requiredCapabilities": [
            "engine_info",
            "ping",
            "scan_folder",
            "scan_selection",
            "start_upload",
            "get_job",
            "cancel_job",
        ],
    }
