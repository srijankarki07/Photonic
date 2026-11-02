from __future__ import annotations

from pathlib import Path

from photonic_engine import rpc

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
from photonic_engine.protocol import EngineError


def _request(method: str, params: dict | None = None, request_id: str = "t1") -> dict:
    return {"v": 1, "id": request_id, "method": method, "params": params or {}}


def test_ping_returns_pong() -> None:
    response = rpc.handle_request(_request("ping"))
    assert response["ok"] is True
    assert response["id"] == "t1"
    assert response["result"] == {"pong": True}


def test_engine_info_reports_capabilities() -> None:
    response = rpc.handle_request(_request("engine_info"))
    info = response["result"]
    assert response["ok"] is True
    assert info["engine"] == "photonic-engine"
    assert "scan_folder" in info["capabilities"]
    assert "gpmc" in info["binaries"]


def test_scan_folder_returns_media(tmp_path: Path) -> None:
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "a.jpg").write_bytes(b"1234")

    response = rpc.handle_request(
        _request("scan_folder", {"path": str(tmp_path)})
    )

    assert response["ok"] is True
    assert response["result"]["mediaCount"] == 1
    assert response["result"]["totalBytes"] == 4


def test_unknown_method_is_structured_error() -> None:
    response = rpc.handle_request(_request("does_not_exist"))
    assert response["ok"] is False
    assert response["error"]["code"] == "method_not_found"


def test_planned_method_says_not_implemented() -> None:
    response = rpc.handle_request(_request("get_settings"))
    assert response["ok"] is False
    assert response["error"]["code"] == "not_implemented"
    assert response["error"]["hint"]


def test_start_upload_requires_auth(tmp_path) -> None:
    response = rpc.handle_request(
        _request("start_upload", {"path": str(tmp_path)})
    )
    assert response["ok"] is False
    assert response["error"]["code"] == "auth_missing"


def test_get_job_not_found() -> None:
    response = rpc.handle_request(_request("get_job", {"jobId": "missing"}))
    assert response["ok"] is False
    assert response["error"]["code"] == "job_not_found"


def test_list_jobs_returns_a_list() -> None:
    response = rpc.handle_request(_request("list_jobs"))
    assert response["ok"] is True
    assert isinstance(response["result"]["jobs"], list)


def test_missing_path_is_rejected() -> None:
    response = rpc.handle_request(_request("scan_folder", {}))
    assert response["ok"] is False
    assert response["error"]["code"] == "bad_request"


def test_bad_json_keeps_channel_alive() -> None:
    response = rpc.handle_line("{nope")
    assert response["ok"] is False
    assert response["error"]["code"] == "bad_json"


def test_protocol_version_mismatch() -> None:
    request = _request("ping")
    request["v"] = 99
    response = rpc.handle_request(request)
    assert response["error"]["code"] == "protocol_mismatch"


def test_unexpected_exception_does_not_escape(monkeypatch) -> None:
    def boom(_params, _emit):
        raise RuntimeError("secret details")

    monkeypatch.setitem(rpc.METHODS, "ping", boom)
    response = rpc.handle_request(_request("ping"))

    assert response["ok"] is False
    assert response["error"]["code"] == "internal_error"
    assert response["error"]["details"] == {"type": "RuntimeError"}
    assert "secret details" not in str(response)


def test_scan_selection_returns_files(tmp_path) -> None:
    (tmp_path / "a.jpg").write_bytes(JPEG)
    (tmp_path / "b.jpg").write_bytes(JPEG)
    response = rpc.handle_request(
        _request("scan_selection", {"paths": [str(tmp_path)]})
    )
    assert response["ok"] is True
    assert response["result"]["mediaCount"] == 2
    assert response["result"]["root"] == str(tmp_path)


def test_retry_and_resume_require_auth() -> None:
    retry = rpc.handle_request(_request("retry_failed", {"jobId": "x"}))
    resume = rpc.handle_request(_request("resume_job", {"jobId": "x"}))
    assert retry["error"]["code"] == "auth_missing"
    assert resume["error"]["code"] == "auth_missing"
