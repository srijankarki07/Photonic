"""Durable, redacted engine logging.

The log file lives under the per-user data directory and rotates at 2 MB with
three backups. Every formatted line is passed through ``auth.redact`` so a
token can never reach disk even if an upstream error includes one.
"""

from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .auth import redact
from .paths import logs_dir


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def log_file_path() -> Path:
    return logs_dir() / "engine.log"


def configure_logging() -> Path:
    """Install stderr + rotating file handlers once and return the log path."""
    root = logging.getLogger()
    path = log_file_path()
    if any(isinstance(handler, RotatingFileHandler) for handler in root.handlers):
        return path

    root.setLevel(logging.INFO)
    formatter = RedactingFormatter(
        "%(asctime)s %(levelname)s %(name)s: %(message)s"
    )

    stream = logging.StreamHandler()
    stream.setFormatter(formatter)
    root.addHandler(stream)

    path.parent.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        path,
        maxBytes=2 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path
