"""PyInstaller entry point for the bundled gpmc uploader."""

from __future__ import annotations

import sys

from gpmc.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
