# Photonic engine

The engine is the local execution core: it scans folders, creates durable
jobs, drives `gpmc`/`gpd`, and reports structured progress. It has no UI and
opens no network ports.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

pytest
photonic-engine info --pretty
photonic-engine scan ~/Pictures --pretty
photonic-engine serve      # NDJSON RPC on stdio
```

Protocol: one JSON object per line. See `src/photonic_engine/protocol.py`.
Uploads are intentionally not implemented in this milestone; `start_upload`
returns a structured `not_implemented` error until Phase 2.
