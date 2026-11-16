# Photonic

**Your photos, in motion.** A local-first Linux desktop app for backing up
photos and videos to Google Photos without living in a terminal.

Photonic turns the terminal-bound GPhotoTool and `gpmc` upload path into a
normal desktop application: native file pickers, a real review step, live
per-file progress, retries and recovery, and a guided phone sign-in. Media goes
directly from your computer to Google. There is no Photonic account, server, or
telemetry.

> **Status:** packaged and working. A `.deb` and an AppImage are produced, and
> uploads, recovery, live progress, history, and the guided sign-in have been
> tested with a real phone and a 100+ file library. Public release gates still
> open: clean-VM install test, complete third-party notices, code signing and
> update decisions, and a licensing review for Photonic's own source.

## What Photonic does

- Pick what to back up with native folder and file pickers, or drag and drop.
- Review exactly what will upload before anything leaves the machine: counts,
  sizes, skipped files, and a grid or list view.
- Upload with live progress: per-file state, overall percentage, upload speed,
  and a clear result for every file.
- Retry safely. Files Google already has are recognised remotely by content
  hash and shown as **Already in Google Photos** instead of being uploaded
  twice. Files deleted from Google Photos are uploaded again.
- Recover from interruptions. Closing the app, sleeping the laptop, losing
  Wi-Fi, or an engine crash does not lose the job. In-flight files become
  "needs checking" and every other file keeps its exact state.
- Trust the paper trail. A local SQLite history records what happened to every
  file, and logs are redacted and rotate.

Photonic is **one-way backup, not sync**. It never deletes or renames anything
in Google Photos, and never modifies or deletes your originals.

## How it works

```
Photonic window (Tauri)
  React UI  <-->  Rust controller
                    |  guided auth over adb logcat -> OS keyring
                    |  engine supervisor, NDJSON-RPC over stdio
                    v
                 Python engine (bundled)
                    |  scanner, validation, job manager
                    |  SQLite history and recovery
                    v
                 one gpmc process per file  ->  Google Photos
```

- The Rust controller reads the sign-in key from the OS keyring and passes it
  only to the engine request that starts, retries, or resumes a job. It never
  enters the UI, SQLite, settings, logs, or events.
- The Python engine scans, validates, and owns job state. It runs one `gpmc`
  process per file with a concurrency of three, which gives an unambiguous
  file-to-media-key mapping and simple cancellation.
- `gpmc` checks the remote library by content hash before uploading. If the
  content exists it returns the existing media key; if it was deleted remotely
  it uploads again. That is the duplicate guard.
- The UI receives one event stream for progress and file updates. It does not
  poll the engine.

### Sign-in lifetime

A captured sign-in is treated as valid for about 24 hours. Photonic shows a
persistent amber banner across Back up, Activity, and Settings when the
sign-in has expired or when a job fails because Google rejected it. The banner
offers **Reconnect**, and after reconnecting it offers **Open Activity** so a
stopped job can be resumed. Starting a new upload with an expired sign-in
opens Connect instead of failing.

## Screens

**Back up** starts a scan or accepts drag and drop. After a scan it shows a
compact file list, the total size, skipped files, and a Review action. A live
card follows the current or last backup.

**Review** shows a summary, skipped files with plain reasons, album options
(Timeline, one album for this backup, or one album per folder), and the files
in a thumbnail grid by default with a list toggle and search. Nothing uploads
until Upload is pressed.

**Activity** has In progress and Past tabs. It shows overall percentage, bytes
completed, upload speed, per-file state, and reasons. It offers Stop, Resume,
Retry failed, and an explicit unconfirmed retry for files whose outcome is
unknown. Technical details such as media keys and error codes are collapsed.

**Settings** covers the connection (status, masked email, expected expiry,
disconnect), a plain-language explanation of how Photonic works, and an
Advanced section with diagnostics, paths, and a way to clear finished backups.

## Requirements

Computer:

- Linux, x86_64 (Ubuntu 24.04 or a Debian-based distribution is tested).
- A desktop session with a Secret Service keyring (GNOME Keyring or KWallet).
- The `.deb` declares `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libssl3`, and
  `ca-certificates`.
- The AppImage needs FUSE 2, or run it with `APPIMAGE_EXTRACT_AND_RUN=1`.

Phone:

- Android with ReVanced Google Photos and microG, signed in.
- USB debugging enabled and the phone authorized for `adb`.
- `adb` installed on the computer.

Account:

- A Google account. Use a test or secondary account first. The upload path is
  unofficial and an account can be rate-limited or restricted.

The packaged builds bundle the Python engine and `gpmc`. No system Python, pip,
or `gpmc` installation is needed.

## Install

Debian or Ubuntu package:

```bash
sudo apt install ./Photonic_0.1.0_amd64.deb
```

Then launch Photonic from the applications menu.

AppImage:

```bash
chmod +x Photonic_0.1.0_amd64.AppImage
./Photonic_0.1.0_amd64.AppImage
```

An AppImage is not installed by running it, so GNOME may show a generic gear
in the dock because it has no application entry to associate. Either install
the `.deb`, or register the AppImage once from the repository checkout:

```bash
scripts/install-appimage-desktop.sh "$PWD/Photonic_0.1.0_amd64.AppImage"
```

That writes a per-user desktop entry and hicolor icons. Launch Photonic from
the applications menu afterwards. Remove it later with
`rm ~/.local/share/applications/photonic.desktop`.

Uninstalling the `.deb` does not delete backup history. Data lives in
`~/.local/share/photonic/`.

## First run

1. Read the plain-language consent and transparency notice, then tick the box.
2. Connect: plug in the phone, open ReVanced Photos and its account screen, and
   let Photonic capture the sign-in line over `adb logcat`. This can be done
   later.
3. Choose folders or individual photos and videos.
4. Review the list and the album choice.
5. Upload and follow it in Activity. You can close the app; the backup is saved
   locally and resumes explicitly.

## Reliability

Every file has an explicit state:

| State | Meaning | Retry |
|---|---|---|
| `validating` | Being checked for type, size, readability, stability | automatic |
| `uploading` | Being sent to Google | not applicable |
| `completed` | Google returned a media key | not needed |
| `completed` with `already_uploaded` | Google already had this content; shown as Already in Google Photos | not needed |
| `skipped` | Unsupported, empty, or a duplicate selection; reason shown | not applicable |
| `failed` | Terminal failure such as auth, permission, or missing file | yes, once fixed |
| `retryable` | Temporary failure | yes |
| `uncertain` | Google may have received it but no key was observed | explicit confirmation only |
| `cancelled` | Stopped before finishing | resume or retry |

Behaviour:

- A file is only completed with a media key. If bytes may have been accepted
  without a key, it becomes uncertain and is never retried automatically.
- Temporary network failures retry twice (after 2 s and 8 s) and rate limits
  retry once (after 30 s), cancellable. Auth failures, refusals, and uncertain
  outcomes are never auto-retried.
- On restart, in-flight files become uncertain, pending and failed work is
  preserved, and jobs become interrupted until resumed.
- If a hard crash leaves a `gpmc` child behind, the next engine start stops
  only processes whose recorded pid and target match.
- The SQLite database uses WAL and is readable only by your user account.

## Performance and resources

Measured on Linux with the packaged release, using PSS from
`/proc/<pid>/smaps_rollup` and CPU from `/proc/<pid>/stat` over 20-second
windows.

Idle:

| Process | PSS |
|---|---:|
| Photonic (Rust and webview host) | 108 MB |
| WebKit web process | 161 MB |
| WebKit network process | 18 MB |
| Python engine | 27 MB |
| **Total** | **about 314 MB** |

Idle CPU is about **0.1% of one core**. Startup and first paint can briefly use
around 10% of a core for a few seconds. A development build with Vite serving
unminified modules measures around 581 MB; that is not representative of the
packaged app.

During uploads:

- One `gpmc` worker on a 59 MB video used about 43 MB peak RSS and 0.26 s of
  CPU over a 1.2 s hash and duplicate check. Work is I/O and network bound.
- Three workers can run at once, so expect a peak near 450 to 500 MB while
  three files hash or upload.
- Progress events are emitted at most every 0.25 s per file. The UI updates live
  without polling.

Battery: idle CPU is effectively zero and there are no timers polling the
engine, so an open but idle Photonic has negligible battery impact. Uploads are
bursty: short CPU spikes for hashing and TLS, then network wait. The test
machine exposes no power sensor, so drain was assessed by CPU time.

Disk:

| Item | Size or behaviour |
|---|---|
| SQLite history | 0.5 MB for 13 jobs and 583 files; grows with history |
| Engine log | rotates at 2 MB x 3, mode 0600 |
| `gpmc` working files | under `~/.local/share/photonic/gpmc/` |
| `.deb` | 31 MB, 63 MB installed |
| AppImage | 99 MB |

Efficiency choices behind these numbers:

- A single event stream carries progress, so the UI does not poll.
- History list requests use SQL aggregates, not every file row. Files load only
  when a job is opened.
- Starting a backup uses the exact reviewed file list, avoiding a second scan
  of the folder.
- Snapshots stop at 2,000 file rows; counts still cover every file.
- Files older than a few seconds skip the stability wait; files still being
  written keep the guard.
- Rows are memoized and the file list sorts only when the file set changes.

## Security and privacy

- The sign-in key lives in the OS keyring. The webview never receives it. It is
  passed to the engine per job and then to `gpmc` through the child
  environment.
- Tokens never enter SQLite, JSON settings, logs, crash output, or diagnostics.
  An audit of the engine log and SQLite files for `aas_et/`, `androidId=`,
  `Token=`, and `Email=` returned zero hits.
- Local history contains file paths and media keys and is mode 0600.
- A restrictive Content Security Policy is applied in production. Script
  execution is limited to bundled code, and images and fonts use local or
  asset-protocol sources.
- The webview's asset protocol is granted exact scanned paths, never a broad
  home-directory scope.
- There is no telemetry, no remote logging, and no hosted backend. Media moves
  only between the machine and Google.
- Originals are never modified or deleted. Photonic writes only its database,
  logs, and `gpmc` caches.
- The upload path is unofficial. Use a test account, keep independent backups,
  and expect that Google may rate-limit, restrict, or suspend accounts.
  Photonic does not promise unlimited storage or continued API availability.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Amber banner says the sign-in expired or needs reconnecting | Click Reconnect and complete the phone capture. Sign-ins last about 24 hours. |
| A job stopped with `needs_auth` | Reconnect, then open Activity and Resume. The banner offers Open Activity after reconnecting. |
| `adb` not found | Install `android-tools-adb`. The Connect screen reports it. |
| Phone not found or unauthorized | Unlock the phone, enable USB debugging, accept the USB prompt, and reconnect the cable. |
| Capture sees the wrong Google sign-in | Keep the Photos account screen open and retry. Photonic accepts only photo-access lines. |
| Uploads fail with a permission or scope error | Reconnect to replace a sign-in captured by an older build. |
| A file says Already in Google Photos | Google already has that content. Nothing was re-uploaded. |
| A deleted photo is not re-uploaded | Empty Google Photos' Bin first. While an item is in the Bin, Google may still report it as present. |
| A file is still being copied | Wait for the copy to finish, then retry. |
| HEIC, RAW, or video tiles show a placeholder | The webview cannot decode those formats. The file still uploads normally. |
| The AppImage prints a GStreamer appsink warning | Harmless. Photonic does not play media. |
| The dock shows a gear icon for the AppImage | Register the AppImage with the desktop using the command in Install, or use the `.deb`. |
| Something failed | Open Activity for per-file reasons, then use Settings, Advanced, Copy troubleshooting info. The output is redacted. |

Logs and data:

```
~/.local/share/photonic/photonic.db      backup history (0600)
~/.local/share/photonic/logs/engine.log  redacted, rotating, 0600
~/.local/share/photonic/gpmc/            gpmc working files
```

## Known limitations

- Automatic watched-folder backup, tray integration, notifications, and launch
  at login are not implemented yet.
- The sign-in must come from ReVanced Photos and microG. A safe desktop-only
  token path is unproven.
- HEIC, RAW, and video thumbnails are placeholders in the webview.
- Very large libraries are not fully virtualized. Snapshots cap at 2,000 file
  rows while counts cover every file.
- Two-way sync, cloud deletion, and rename propagation are intentionally out of
  scope.
- Code signing, signed updates, a clean-VM install test, and the full
  third-party notices text bundle remain before a public release.
- Photonic's own source is currently unlicensed. Do not publish binaries until
  the licensing review is complete.

## Risk notice

Photonic uses an unofficial, reverse-engineered mobile API and a Pixel device
profile. It is not affiliated with, endorsed by, or supported by Google or the
ReVanced project, and it may violate Google's Terms of Service. Accounts can be
rate-limited, restricted, or suspended. Use a test or secondary account first,
keep independent backups of anything important, and use the app at your own
risk.

Photonic does not promise unlimited Google Photos storage or continued
availability of the underlying API.

## License

Photonic's own source is currently unlicensed and pending review. Bundled
third-party components have their own licenses; the uploader `gpmc` is MIT.
`gphototool` and `gp_disguise` are not bundled.
