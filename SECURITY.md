# Security policy

Photonic handles Google account credentials and local metadata, so security
reports are taken seriously even for an early release.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository:

1. Open the [Security tab](https://github.com/srijankarki07/Photonic/security).
2. Choose **Report a vulnerability**.
3. Describe the issue, the affected version, and how to reproduce it.

Do not open a public issue for anything that involves a token, credential
handling, the keyring, log redaction, or remote code execution.

If private reporting is unavailable, open a minimal public issue that says a
security report is available and asks for a private channel. Do not include
details, tokens, or logs in it.

Expect an acknowledgement in a few days. There is no bounty program.

## Supported versions

Only the latest release receives fixes. Version 0.1.0 is an early pre-release.

## If you think a sign-in key has leaked

A Photonic sign-in grants broad access to the connected Google account. Treat
a suspected leak as urgent.

1. Stop running uploads and close Photonic.
2. Revoke sessions for the account at
   [myaccount.google.com/security](https://myaccount.google.com/security), and
   remove the account from the ReVanced Photos app on the phone.
3. Remove the keyring entry: sign out in Photonic, or delete the `google-photos`
   entry under the `app.photonic.desktop` service in your keyring manager.
4. Check `~/.local/share/photonic/` for stray copies and delete the log:
   `~/.local/share/photonic/logs/engine.log`. The database stores file paths
   and media keys, not tokens.
5. Assume the old key is valid until it is revoked. Capture a fresh one after
   the phone is clean.
6. If you published diagnostics anywhere, delete them.

## What is in scope

- Token or credential disclosure through logs, diagnostics, errors, the
  database, settings, or the webview.
- Keyring bypass or a plaintext fallback.
- Remote code execution through scanned media, the engine, or the update path.
- Cross-site scripting in the webview, or a broken Content Security Policy.
- Process or file permission problems that expose history to other local users.
- Path traversal or scope escapes in the asset protocol.

## What is out of scope

- Google rate limiting, account restriction, or suspension caused by using an
  unofficial client. That risk is documented in the README.
- An attacker who already has your user account or root on the machine.
- Bugs in `gpmc`, Python, WebKitGTK, or Tauri that are not made worse by
  Photonic. Report those upstream, and tell us if Photonic needs a mitigation.
- Missing code signing or reproducible builds. Both are known gaps, tracked in
  the README's limitations.

## Design commitments

Changes must preserve these, and reviewers will push back if they do not:

- Tokens live only in the OS keyring, plus the child process environment for
  the duration of a job. Never in SQLite, JSON settings, logs, diagnostics, or
  the webview.
- No hosted backend, telemetry, or remote logging.
- The engine opens no network listener and speaks NDJSON-RPC over stdio.
- A file is never marked complete without a remote media key or an explicit
  skip.
