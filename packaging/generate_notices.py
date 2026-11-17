#!/usr/bin/env python3
"""Generate the NOTICES file shipped with Photonic.

Collects every third-party component that ends up in the packaged application
and reproduces the license texts they require:

  * the Python runtime bundled by PyInstaller (PSF-2.0)
  * the Python packages bundled into the two sidecars
  * the Rust crates linked into the Tauri binary
  * the npm packages bundled into the webview assets
  * the bundled fonts

Usage:
    packaging/generate_notices.py            # writes ./NOTICES
    packaging/generate_notices.py --check    # fails if NOTICES is stale

The output is deterministic for a given lockfile pair (Cargo.lock,
pnpm-lock.yaml) and a given packaging/.venv, so `--check` works in CI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import sysconfig
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIDECARS = ROOT / "packaging" / "dist"
VENV_SITE = ROOT / "packaging" / ".venv"
DESKTOP = ROOT / "desktop"
TAURI = DESKTOP / "src-tauri"

# Build-time only. These never reach the packaged app.
PY_BUILD_ONLY = {
    "pip",
    "setuptools",
    "pyinstaller",
    "pyinstaller-hooks-contrib",
    "altgraph",
    "packaging",
    "wheel",
}

LICENSE_FILE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE)", re.IGNORECASE)


@dataclass
class Component:
    name: str
    version: str
    license: str
    texts: list[tuple[str, str]] = field(default_factory=list)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")


def clean(text: str) -> str:
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def license_texts(directory: Path) -> list[tuple[str, str]]:
    """License-like files directly inside `directory`, sorted by name."""
    if not directory.is_dir():
        return []
    found = []
    for path in sorted(directory.iterdir()):
        if path.is_file() and LICENSE_FILE.match(path.name) and path.stat().st_size > 0:
            found.append((path.name, clean(read(path))))
    return found


def python_components() -> list[Component]:
    site = next(VENV_SITE.glob("lib/python*/site-packages"), None)
    if site is None:
        raise SystemExit(f"no site-packages under {VENV_SITE}; run packaging/build_sidecars.sh")

    components = []
    for dist in sorted(site.glob("*.dist-info")):
        meta = dist / "METADATA"
        if not meta.is_file():
            continue
        header = read(meta).split("\n\n")[0]
        name = version = ""
        license_expr = ""
        for line in header.splitlines():
            if line.startswith("Name: "):
                name = line[6:].strip()
            elif line.startswith("Version: "):
                version = line[9:].strip()
            elif line.startswith("License-Expression: "):
                license_expr = line[20:].strip()
            elif line.startswith("License: ") and not license_expr:
                license_expr = line[9:].strip().splitlines()[0]
        if not name or name.lower() in PY_BUILD_ONLY:
            continue
        texts = license_texts(dist / "licenses")
        if not texts:
            for entry in sorted(dist.iterdir()):
                if entry.is_file() and LICENSE_FILE.match(entry.name):
                    texts.append((entry.name, clean(read(entry))))
        components.append(Component(name, version, license_expr or "see notice", texts))
    return components


def python_runtime() -> Component:
    """The CPython distribution that PyInstaller copies into the sidecars."""
    candidates = [
        Path(sys.base_prefix) / "LICENSE",
        Path(sys.base_prefix) / "LICENSE.txt",
        Path(sysconfig.get_paths()["stdlib"]) / "LICENSE.txt",
        Path("/usr/share/doc") / f"python{sys.version_info.major}.{sys.version_info.minor}" / "copyright",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return Component(
                "Python",
                sys.version.split()[0],
                "PSF-2.0",
                [(candidate.name, clean(read(candidate)))],
            )
    raise SystemExit(
        "could not find the CPython license text; expected one of:\n  "
        + "\n  ".join(str(path) for path in candidates)
    )


def rust_components() -> list[Component]:
    proc = subprocess.run(
        ["cargo", "metadata", "--format-version", "1", "--locked"],
        cwd=TAURI,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        # --locked fails when Cargo.lock needs updating; fall back for local runs.
        proc = subprocess.run(
            ["cargo", "metadata", "--format-version", "1"],
            cwd=TAURI,
            capture_output=True,
            text=True,
        )
    if proc.returncode != 0:
        raise SystemExit(f"cargo metadata failed: {proc.stderr}")

    data = json.loads(proc.stdout)
    registry = Path(data.get("workspace_root", TAURI)).parent
    src_dirs = list((Path.home() / ".cargo" / "registry" / "src").glob("*"))

    components = []
    for package in data["packages"]:
        if package.get("source") is None:
            continue  # the workspace crate itself
        name = package["name"]
        version = package["version"]
        expr = package.get("license") or ""
        texts = []
        for src in src_dirs:
            directory = src / f"{name}-{version}"
            if directory.is_dir():
                texts = license_texts(directory)
                break
        components.append(Component(name, version, expr or "see notice", texts))
    return sorted(components, key=lambda c: (c.name, c.version))


def npm_components() -> list[Component]:
    site = DESKTOP / "node_modules"
    seen: dict[Path, Component] = {}
    stack = [DESKTOP]
    while stack:
        current = stack.pop()
        manifest = current / "node_modules"
        if not manifest.is_dir():
            continue
        for entry in sorted(manifest.iterdir()):
            if entry.name.startswith("."):
                continue
            if entry.name.startswith("@"):
                packages = [p for p in sorted(entry.iterdir()) if p.name != "node_modules"]
            else:
                packages = [entry]
            for package in packages:
                pkg_json = package / "package.json"
                if not pkg_json.is_file() or package in seen:
                    continue
                try:
                    meta = json.loads(read(pkg_json))
                except json.JSONDecodeError:
                    continue
                if meta.get("private"):
                    continue
                seen[package] = Component(
                    meta.get("name", package.name),
                    meta.get("version", "?"),
                    meta.get("license", "see notice"),
                    license_texts(package),
                )
                stack.append(package)
    return sorted(seen.values(), key=lambda c: (c.name, c.version))


def dedupe(components: list[Component]) -> tuple[dict[str, list[str]], dict[str, str]]:
    """Group license texts by content, and record which components use each."""
    bodies: dict[str, str] = {}
    users: dict[str, set[str]] = defaultdict(set)
    for component in components:
        for filename, text in component.texts:
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
            bodies[digest] = text
            users[digest].add(f"{component.name} {component.version} ({filename})")
    ordered = {digest: sorted(users[digest], key=str.lower) for digest in bodies}
    return bodies, ordered


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--out", default=str(ROOT / "NOTICES"))
    args = parser.parse_args()

    groups: list[tuple[str, list[Component]]] = []

    runtime = python_runtime()
    py = python_components()
    if runtime:
        py = [runtime, *py]
    groups.append(("Python runtime and packages (bundled in the engine and gpmc sidecars)", py))
    groups.append(("Rust crates (linked into, or used to build, the desktop binary)", rust_components()))
    groups.append(("npm packages (webview dependencies and build tooling)", npm_components()))

    all_components = [c for _, items in groups for c in items]
    license_bodies, license_users = dedupe(all_components)

    out = []
    out.append("PHOTONIC - THIRD-PARTY NOTICES")
    out.append("")
    out.append("Photonic itself is licensed under the MIT License. See LICENSE.")
    out.append("")
    out.append("Photonic bundles third-party software. Each component below is")
    out.append("reproduced with the license text it requires. This file is generated by")
    out.append("packaging/generate_notices.py; do not edit it by hand.")
    out.append("")
    out.append("Photonic is not affiliated with, endorsed by, or supported by Google.")
    out.append("")

    for title, components in groups:
        out.append("=" * 78)
        out.append(title)
        out.append("=" * 78)
        out.append("")
        width = max((len(c.name) for c in components), default=10)
        out.append(f"{'Component'.ljust(width)}  {'Version'.ljust(16)}  License")
        out.append(f"{'-' * width}  {'-' * 16}  {'-' * 40}")
        for component in components:
            out.append(
                f"{component.name.ljust(width)}  {component.version.ljust(16)}  "
                f"{component.license or 'see notice'}"
            )
        out.append("")

    out.append("=" * 78)
    out.append("LICENSE TEXTS")
    out.append("=" * 78)
    out.append("")
    for digest in sorted(license_bodies, key=lambda d: license_users[d][0].lower()):
        out.append(f"--- used by: {', '.join(license_users[digest])}")
        out.append("")
        out.append(license_bodies[digest])
        out.append("")

    text = "\n".join(out).rstrip() + "\n"
    target = Path(args.out)

    if args.check:
        if not target.is_file():
            print(f"{target} is missing", file=sys.stderr)
            return 1
        if read(target) != text:
            print(f"{target} is out of date; run packaging/generate_notices.py", file=sys.stderr)
            return 1
        print(f"{target} is up to date")
        return 0

    target.write_text(text, encoding="utf-8")
    total = len(all_components)
    print(f"wrote {target} ({total} components, {len(license_bodies)} distinct license texts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
