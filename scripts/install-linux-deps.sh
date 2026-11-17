#!/usr/bin/env bash
# Install Tauri 2 Linux build dependencies. Prints the command unless --apply.
set -euo pipefail

PACKAGES=(
  libwebkit2gtk-4.1-dev
  build-essential
  curl
  wget
  file
  libxdo-dev
  libssl-dev
  libdbus-1-dev
  libayatana-appindicator3-dev
  librsvg2-dev
)

if [ "${1:-}" = "--apply" ]; then
  echo "Installing: ${PACKAGES[*]}"
  sudo apt-get update
  sudo apt-get install -y "${PACKAGES[@]}"
  echo "Done. Re-run scripts/check-env.sh to verify."
else
  echo "Photonic needs these Tauri Linux packages:"
  printf '  %s\n' "${PACKAGES[@]}"
  echo
  echo "Run with sudo:"
  echo "  sudo apt-get update && sudo apt-get install -y ${PACKAGES[*]}"
  echo
  echo "Or re-run this script with --apply."
fi
