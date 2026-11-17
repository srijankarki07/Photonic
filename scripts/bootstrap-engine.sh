#!/usr/bin/env bash
# Create the engine venv, install it in editable mode, and run tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/engine"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --quiet --upgrade pip setuptools
.venv/bin/python -m pip install --quiet -e ".[dev]"

echo "Engine ready at $ROOT/engine/.venv"
echo
.venv/bin/pytest
echo
echo "Try:"
echo "  source engine/.venv/bin/activate"
echo "  photonic-engine info --pretty"
echo "  photonic-engine scan ~/Pictures --pretty"
