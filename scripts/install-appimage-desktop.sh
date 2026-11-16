#!/usr/bin/env bash
# Add a desktop entry and icons for a Photonic AppImage.
#
# AppImages are not "installed" by running them, so GNOME cannot associate the
# window with an application and may show a generic icon in the dock. This
# writes a per-user .desktop file and hicolor icons; no root is needed.
#
#   scripts/install-appimage-desktop.sh ~/Applications/Photonic_0.1.0_amd64.AppImage
#
# Remove later with: rm ~/.local/share/applications/photonic.desktop
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 /path/to/Photonic_*.AppImage" >&2
  exit 2
fi

appimage="$(realpath "$1")"
if [[ ! -f "$appimage" ]]; then
  echo "not found: $appimage" >&2
  exit 2
fi

data="${XDG_DATA_HOME:-$HOME/.local/share}"
apps="$data/applications"
icons="$data/icons/hicolor"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
(cd "$work" && "$appimage" --appimage-extract >/dev/null)
root="$work/squashfs-root"
if [[ ! -d "$root" ]]; then
  echo "could not unpack $appimage" >&2
  exit 1
fi

install_icon() {
  local source="$1" size="$2"
  if [[ -f "$source" ]]; then
    mkdir -p "$icons/${size}x${size}/apps"
    cp "$source" "$icons/${size}x${size}/apps/photonic.png"
  fi
}

install_icon "$root/usr/share/icons/hicolor/32x32/apps/photonic.png" 32
install_icon "$root/usr/share/icons/hicolor/128x128/apps/photonic.png" 128
install_icon "$root/Photonic.png" 256
install_icon "$root/Photonic.png" 512

mkdir -p "$apps"
cat > "$apps/photonic.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Photonic
Comment=Back up photos and videos to Google Photos
Exec="$appimage" %U
Icon=photonic
Terminal=false
Categories=Graphics;Photography;Utility;
StartupWMClass=photonic
EOF
chmod 644 "$apps/photonic.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$apps" >/dev/null 2>&1 || true
fi

echo "Installed Photonic in the applications menu:"
echo "  $apps/photonic.desktop"
echo "Launch it from the menu; the dock will use the Photonic icon."
echo "Remove it later with: rm \"$apps/photonic.desktop\""
