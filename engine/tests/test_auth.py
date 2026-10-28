from __future__ import annotations

import pytest

from photonic_engine.auth import mask_email, redact, validate_auth_data
from photonic_engine.protocol import EngineError

VALID = "androidId=abc&Token=secret-token&Email=me%40example.com&client_sig=x"


def test_accepts_valid_auth_data() -> None:
    parsed = validate_auth_data(VALID)
    assert parsed.auth_data == VALID
    assert parsed.email == "me@example.com"


def test_rejects_missing_token() -> None:
    with pytest.raises(EngineError) as caught:
        validate_auth_data("androidId=abc&Email=me%40example.com")
    assert caught.value.code == "auth_invalid"


def test_rejects_whitespace_and_oversize() -> None:
    with pytest.raises(EngineError) as caught:
        validate_auth_data("androidId=abc&Token=x&Email=a%40b.c\nmore")
    assert caught.value.code == "auth_invalid"

    with pytest.raises(EngineError) as caught:
        validate_auth_data("androidId=" + "a" * 6000)
    assert caught.value.code == "auth_invalid"


def test_rejects_empty() -> None:
    with pytest.raises(EngineError) as caught:
        validate_auth_data("")
    assert caught.value.code == "auth_missing"


def test_redacts_token_values() -> None:
    output = redact("androidId=abc&Token=secret&Email=me%40example.com")
    assert "abc" not in output
    assert "secret" not in output
    assert "androidId=<redacted>" in output
    assert "Token=<redacted>" in output
    assert "Email=" in output


def test_masks_email() -> None:
    assert mask_email("srijan@example.com") == "s***@example.com"
    assert mask_email("x") == "x***"
