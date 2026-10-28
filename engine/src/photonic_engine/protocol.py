"""Versioned protocol types shared by the engine and the desktop controller.

Transport: newline-delimited JSON over stdin/stdout. One object per line.
Diagnostics go to stderr so stdout stays a clean protocol channel.

Request   {"v":1,"id":"<uuid>","method":"scan_folder","params":{...}}
Response  {"v":1,"id":"<uuid>","ok":true,"result":{...}}
Error     {"v":1,"id":"<uuid>","ok":false,"error":{"code":...,...}}
Event     {"v":1,"event":"job.progress","seq":1,"data":{...}}
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import PROTOCOL_VERSION

ErrorCode = str


@dataclass(slots=True)
class EngineError(Exception):
    """A failure the controller can present to a person.

    ``recoverable`` tells the UI whether retrying could plausibly succeed.
    ``hint`` is a short, actionable next step (never a stack trace).
    """

    code: str
    message: str
    recoverable: bool = False
    hint: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.code}: {self.message}"

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "recoverable": self.recoverable,
        }
        if self.hint:
            payload["hint"] = self.hint
        if self.details:
            payload["details"] = self.details
        return payload


def ok(request_id: str, result: Any) -> dict[str, Any]:
    return {"v": PROTOCOL_VERSION, "id": request_id, "ok": True, "result": result}


def error(request_id: str, err: EngineError) -> dict[str, Any]:
    return {"v": PROTOCOL_VERSION, "id": request_id, "ok": False, "error": err.to_dict()}


def event(name: str, seq: int, data: dict[str, Any]) -> dict[str, Any]:
    return {"v": PROTOCOL_VERSION, "event": name, "seq": seq, "data": data}


def parse_request(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    """Validate the envelope and return (id, method, params)."""
    request_id = raw.get("id")
    if not isinstance(request_id, str) or not request_id:
        raise EngineError("bad_request", "Request is missing a string 'id'.")
    version = raw.get("v", PROTOCOL_VERSION)
    if version != PROTOCOL_VERSION:
        raise EngineError(
            "protocol_mismatch",
            f"Engine speaks protocol v{PROTOCOL_VERSION}, got v{version}.",
            hint="Update Photonic and the bundled engine together.",
        )
    method = raw.get("method")
    if not isinstance(method, str) or not method:
        raise EngineError("bad_request", "Request is missing a string 'method'.")
    params = raw.get("params") or {}
    if not isinstance(params, dict):
        raise EngineError("bad_request", "'params' must be an object.")
    return request_id, method, params
