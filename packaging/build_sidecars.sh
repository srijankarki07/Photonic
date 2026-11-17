#!/usr/bin/env bash
# Build the two Python sidecars Photonic ships with, as one-dir bundles.
#
#   packaging/.venv            build-only virtualenv (PyInstaller + gpmc)
#   packaging/dist/            PyInstaller output
#   desktop/src-tauri/binaries photonic-engine/, gpmc/  (Tauri resources)
#
# The `.venv` is disposable; PyInstaller output contains the gpmc dependency
# tree, so the packaged app never needs a system Python or pip.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root/packaging"

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet --upgrade pip pyinstaller "gpmc==0.9.0"

.venv/bin/pyinstaller --noconfirm --clean --onedir \
  --name photonic-engine --paths "$root/engine/src" engine_entry.py
.venv/bin/pyinstaller --noconfirm --clean --onedir \
  --name gpmc gpmc_entry.py

dest="$root/desktop/src-tauri/binaries"
rm -rf "$dest/photonic-engine" "$dest/gpmc"
mkdir -p "$dest"
cp -a dist/photonic-engine dist/gpmc "$dest/"

"$dest/photonic-engine/photonic-engine" info >/dev/null
"$dest/gpmc/gpmc" --help >/dev/null
echo "sidecars ready in $dest"
du -sh "$dest/photonic-engine" "$dest/gpmc"

# Stage the licence and the generated third-party notices as bundle resources.
# The .deb also installs them into /usr/share/doc/photonic via tauri.conf.json.
cd "$root"
packaging/.venv/bin/python packaging/generate_notices.py
resources="$root/desktop/src-tauri/resources"
mkdir -p "$resources"
cp -f NOTICES LICENSE "$resources/"
echo "licence files staged in $resources"
