"""Authentication helpers for the engine.

The engine receives the token per job from the Rust controller (read from the
OS keyring). It never persists it and never includes it in events or errors.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import unquote

from .protocol import EngineError

MAX_AUTH_LEN = 5000
_REQUIRED = ("androidId", "Token", "Email")
_REDACT_KEYS = ("androidId=", "Token=", "GP_AUTH_DATA=")
_VALUE_STOP = re.compile(r"[&\s\"']")


@dataclass(frozen=True, slots=True)
class ParsedAuth:
    auth_data: str
    email: str


def _field(data: str, key: str) -> str | None:
    for part in data.split("&"):
        if part.startswith(f"{key}="):
            value = part[len(key) + 1 :]
            if value:
                return value
    return None


def validate_auth_data(raw: str) -> ParsedAuth:
    """Validate the token shape before it is handed to gpmc.

    Raises ``EngineError`` with a plain-language message. The offending value is
    never included in the error.
    """
    value = (raw or "").strip()
    if not value:
        raise EngineError("auth_missing", "No Google Photos connection was provided.")
    if len(value) > MAX_AUTH_LEN:
        raise EngineError("auth_invalid", "The saved connection is unexpectedly long.")
    if any(character.isspace() for character in value):
        raise EngineError(
            "auth_invalid",
            "The saved connection contains spaces or newlines.",
            hint="Reconnect Google Photos to capture a clean token.",
        )
    if not value.startswith("androidId="):
        raise EngineError(
            "auth_invalid",
            "The saved connection does not look like a Google Photos token.",
            hint="Reconnect Google Photos.",
        )
    for key in _REQUIRED:
        if not _field(value, key):
            raise EngineError(
                "auth_invalid",
                f"The saved connection is missing the {key} field.",
                hint="Reconnect Google Photos to capture a fresh token.",
            )
    email = unquote(_field(value, "Email") or "")
    if "@" not in email:
        raise EngineError(
            "auth_invalid",
            "The saved connection has an invalid email field.",
            hint="Reconnect Google Photos.",
        )
    return ParsedAuth(auth_data=value, email=email)


def redact(text: str) -> str:
    """Remove token-shaped values from any text before it leaves the engine."""
    out: list[str] = []
    rest = text
    while True:
        matches = [(rest.find(key), key) for key in _REDACT_KEYS]
        matches = [(index, key) for index, key in matches if index >= 0]
        if not matches:
            break
        index, key = min(matches)
        out.append(rest[:index])
        out.append(key)
        out.append("<redacted>")
        after = rest[index + len(key) :]
        stop = _VALUE_STOP.search(after)
        rest = after[stop.start() :] if stop else ""
    out.append(rest)
    return "".join(out)


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    first = local[:1] or "?"
    return f"{first}***@{domain}" if domain else f"{first}***"
