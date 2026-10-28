"""Per-user data locations shared by the engine and future phases."""

from __future__ import annotations

import os
from pathlib import Path

APP_DIR_NAME = "photonic"


def default_data_dir() -> Path:
    override = os.environ.get("PHOTONIC_DATA_DIR")
    if override:
        return Path(override).expanduser()
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg).expanduser() if xdg else Path.home() / ".local" / "share"
    return base / APP_DIR_NAME


def logs_dir() -> Path:
    return default_data_dir() / "logs"


def database_path() -> Path:
    return default_data_dir() / "photonic.db"


def gpmc_work_dir() -> Path:
    """Working directory for gpmc children.

    gpmc writes ``failed_skipped_files.log`` relative to the current
    directory. Never let that land in the install directory (read-only when
    packaged) or the source tree.
    """
    return default_data_dir() / "gpmc"
