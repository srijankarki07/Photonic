#!/usr/bin/env bash
# Photonic environment check - read-only, no sudo.
set -uo pipefail

ok=0
warn=0
fail=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok + 1)); }
warn_() { printf '  \033[33m!\033[0m %s\n' "$1"; warn=$((warn + 1)); }
fail_() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }

has() { command -v "$1" >/dev/null 2>&1; }

echo "Photonic environment"
echo "────────────────────"

if has node; then pass "Node $(node --version)"; else fail_ "Node.js not found (need ≥20)"; fi
if has pnpm; then pass "pnpm $(pnpm --version)"; else fail_ "pnpm not found (npm i -g pnpm)"; fi
if has python3; then pass "Python $(python3 --version 2>&1 | awk '{print $2}')"; else fail_ "python3 not found (need ≥3.11)"; fi

if has rustc && has cargo; then
  pass "Rust $(rustc --version | awk '{print $2}')"
elif [ -x "$HOME/.cargo/bin/rustc" ]; then
  pass "Rust $("$HOME/.cargo/bin/rustc" --version | awk '{print $2}') (not on PATH)"
  warn_ "Run: source \"\$HOME/.cargo/env\" in this shell"
else
  fail_ "Rust not found - install from https://rustup.rs"
fi

if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  pass "webkit2gtk-4.1 $(pkg-config --modversion webkit2gtk-4.1)"
else
  fail_ "webkit2gtk-4.1 dev headers missing - run scripts/install-linux-deps.sh --apply"
fi

if pkg-config --exists gtk+-3.0 2>/dev/null; then
  pass "GTK 3 $(pkg-config --modversion gtk+-3.0)"
else
  fail_ "GTK 3 dev headers missing - run scripts/install-linux-deps.sh --apply"
fi

if pkg-config --exists dbus-1 2>/dev/null; then
  pass "dbus-1 $(pkg-config --modversion dbus-1)"
else
  fail_ "dbus-1 dev headers missing (notifications) - run scripts/install-linux-deps.sh --apply"
fi

for pair in "ffmpeg:ffmpeg" "ffprobe:ffmpeg" "adb:android-tools-adb"; do
  tool=${pair%%:*}
  if has "$tool"; then pass "$tool"; else warn_ "$tool not found (needed for disguise / auth capture)"; fi
done

gpmc_path="${PHOTONIC_GPMC:-$(command -v gpmc || true)}"
gpd_path="${PHOTONIC_GPD:-$(command -v gpd || true)}"
# Known local install from the exploratory setup.
if [ -z "$gpmc_path" ] && [ -x "$HOME/VM/gphototool/.venv/bin/gpmc" ]; then
  gpmc_path="$HOME/VM/gphototool/.venv/bin/gpmc"
fi
if [ -z "$gpd_path" ] && [ -x "$HOME/VM/gphototool/.venv/bin/gpd" ]; then
  gpd_path="$HOME/VM/gphototool/.venv/bin/gpd"
fi
if [ -n "$gpmc_path" ] && [ -x "$gpmc_path" ]; then
  pass "gpmc: $gpmc_path"
else
  warn_ "gpmc not found - set PHOTONIC_GPMC to the gphototool venv binary"
fi
if [ -n "$gpd_path" ] && [ -x "$gpd_path" ]; then
  pass "gpd: $gpd_path (optional)"
else
  warn_ "gpd not found - only needed for arbitrary-file disguise"
fi

if [ -d "$(dirname "$0")/../engine/.venv" ]; then
  pass "engine venv present"
else
  warn_ "engine venv missing - run scripts/bootstrap-engine.sh"
fi

echo "────────────────────"
printf 'Result: %d ok, %d warnings, %d failures\n' "$ok" "$warn" "$fail"
[ "$fail" -eq 0 ]
