#!/usr/bin/env bash
# Run the engine test suite, bootstrapping the venv if needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/engine"

if [ ! -x .venv/bin/pytest ]; then
  echo "Engine venv missing; running bootstrap…"
  "$ROOT/scripts/bootstrap-engine.sh"
fi

.venv/bin/pytest "$@"
