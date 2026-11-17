"""PyInstaller entry point for the bundled engine."""

from __future__ import annotations

import sys

from photonic_engine.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
