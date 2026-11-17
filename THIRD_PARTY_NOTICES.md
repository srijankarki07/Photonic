# Third-party notices and licensing status

**Status:** released. Photonic is MIT licensed (see `LICENSE`). The full
generated notices bundle is in `NOTICES`, which is produced by
`packaging/generate_notices.py` and ships with the `.deb` and the AppImage.
**Audit date:** 2026-10-24 · **Notices generated:** 2026-11-17

Photonic's own source is MIT licensed.

## Runtime components

| Component | Version | License | Distributed with Photonic? | Obligations |
|---|---|---|---|---|
| `gpmc` | 0.9.0 | MIT (© 2024 xob0t) | **Yes** (bundled sidecar) | Include copyright + permission notice |
| Python runtime | 3.14 | PSF-2.0 | **Yes** (inside PyInstaller bundle) | Include PSF license |
| PyInstaller bootloader | 6.22 | GPL-2.0+ with bundling exception | **Yes** (inside sidecars) | The exception permits distribution of non-GPL bundled apps; include notice |
| `requests` | 2.x | Apache-2.0 | Yes (gpmc dependency) | Include notice |
| `urllib3` | 2.x | MIT | Yes | Include notice |
| `certifi` | 2026.x | MPL-2.0 | Yes (CA bundle) | Include notice; MPL file-level terms |
| `charset-normalizer` | 3.x | MIT | Yes | Include notice |
| `idna` | 3.x | BSD-3-Clause | Yes | Include notice |
| `rich` | 14.x | MIT | Yes | Include notice |
| `Pygments` | 2.x | BSD-2-Clause | Yes | Include notice |
| `markdown-it-py` | 4.x | MIT | Yes | Include notice |
| `mdurl` | 0.1.x | MIT | Yes | Include notice |
| `bbpb` (blackboxprotobuf) | 1.4 | MIT | Yes | Include notice |
| `six` | 1.x | MIT | Yes | Include notice |
| `gphototool` | 0.1.1 | **None declared** | **No** | Do not copy or redistribute |
| `gp_disguise` (`gpd`) | 0.1.0 | **None declared** | **No** | Obtain written permission first |
| `ffmpeg` / `ffprobe` | system | LGPL/GPL depending on build | Not bundled | Not required by the packaged app |
| Tauri | 2.x | MIT / Apache-2.0 | Yes (framework) | Include notices |
| React / React DOM | 19.x | MIT | Yes | Include notices |
| Tailwind CSS | 4.x | MIT | Build-time | Include notices if required |
| lucide-react | 1.x | ISC | Yes | Include notice |
| Inter / Fraunces | 4.x variable | SIL OFL-1.1 | Yes (fonts) | Include OFL notice |

## Development-only components

| Component | License | Notes |
|---|---|---|
| Rust toolchain | MIT / Apache-2.0 | Not distributed |
| pnpm / Vite / TypeScript | MIT / Apache-2.0 | Not distributed |
| pytest | MIT | Not distributed |
| PyInstaller (build tool) | GPL-2.0+ with exception | Build-time; bootloader ships inside sidecars |
| Agent skills in `.claude/skills/` | Varies by source | Development tooling; not shipped |

## What this means

1. The packaged app ships `gpmc` (MIT) and its Python dependency tree, but not
   `gphototool` or `gp_disguise`.
2. Arbitrary-file disguise remains out of scope until licensed or
   independently implemented.
3. The generated `NOTICES` file carries the full MIT/ISC/Apache/BSD/MPL/OFL/PSF
   texts for every bundled component. Regenerate it with
   `python3 packaging/generate_notices.py` after any dependency change.
4. PyInstaller's exception covers bundling this non-GPL application.

## Verification tasks before public release

- [x] Read `gpmc`'s LICENSE and record the copyright line (MIT, © 2024 xob0t).
- [x] Confirm `gphototool` and `gp_disguise` are excluded from the bundle.
- [x] Confirm PyInstaller's exception for a non-GPL application.
- [x] Generate the full `NOTICES` text bundle and install it with the app.
      The `.deb` puts it at `/usr/share/doc/photonic/copyright`; the AppImage
      carries it in its resource directory.
- [x] Decide whether `ffmpeg` is a system dependency (currently not used).
- [ ] Re-audit after every dependency upgrade by rerunning
      `python3 packaging/generate_notices.py` and reviewing the diff.

This file is a record of the audit, not legal advice.
