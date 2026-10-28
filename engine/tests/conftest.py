"""Shared test defaults.

Automatic retries are a runtime reliability feature; tests that want to
observe them pass explicit delays. Everywhere else they would only add
wall-clock time and nondeterminism.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def no_automatic_retry_delays(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PHOTONIC_RETRY_DELAYS", "")
    monkeypatch.setenv("PHOTONIC_RATE_LIMIT_DELAYS", "")
