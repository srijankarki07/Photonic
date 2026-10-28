from __future__ import annotations

import os
from pathlib import Path

import pytest

from photonic_engine.models import MediaType
from photonic_engine.protocol import EngineError
from photonic_engine.scanner import scan_folder


def _write(path: Path, payload: bytes = b"media") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def test_scans_nested_media_and_skips_noise(tmp_path: Path) -> None:
    root = tmp_path / "Vacation"
    _write(root / "Nepal" / "Kathmandu.JPG", b"a" * 10)
    _write(root / "Nepal" / "Pokhara" / "lake.jpg", b"b" * 20)
    _write(root / "Nepal" / "Pokhara" / "video.MOV", b"c" * 30)
    _write(root / "notes.txt", b"not media")
    _write(root / ".hidden" / "secret.jpg", b"hidden")
    _write(root / ".hiddenfile.jpg", b"hidden")
    _write(root / "node_modules" / "pkg" / "icon.png", b"noise")

    result = scan_folder(root)

    assert result.media_count == 3
    assert result.total_bytes == 60
    assert [item.path for item in result.files] == [
        "Nepal/Kathmandu.JPG",
        "Nepal/Pokhara/lake.jpg",
        "Nepal/Pokhara/video.MOV",
    ]
    assert [item.media_type for item in result.files] == [
        MediaType.IMAGE,
        MediaType.IMAGE,
        MediaType.VIDEO,
    ]
    assert result.skipped_count == 1
    assert result.skipped[0]["reason"] == "unsupported"
    assert result.directory_count >= 3
    assert result.partial is False


def test_include_hidden(tmp_path: Path) -> None:
    _write(tmp_path / ".hidden" / "secret.jpg")
    _write(tmp_path / "normal.jpg")

    assert scan_folder(tmp_path).media_count == 1
    assert scan_folder(tmp_path, include_hidden=True).media_count == 2


def test_missing_folder_raises_actionable_error(tmp_path: Path) -> None:
    with pytest.raises(EngineError) as exc:
        scan_folder(tmp_path / "nope")
    assert exc.value.code == "not_found"
    assert exc.value.hint


def test_file_instead_of_folder(tmp_path: Path) -> None:
    target = _write(tmp_path / "one.jpg")
    with pytest.raises(EngineError) as exc:
        scan_folder(target)
    assert exc.value.code == "not_a_directory"


def test_symlinks_are_reported_not_followed(tmp_path: Path) -> None:
    target = _write(tmp_path / "real.jpg")
    link = tmp_path / "link.jpg"
    os.symlink(target, link)

    result = scan_folder(tmp_path)

    assert [item.path for item in result.files] == ["real.jpg"]
    assert {"path": str(link), "reason": "symlink_skipped"} in result.warnings


def test_max_files_marks_partial(tmp_path: Path) -> None:
    for index in range(5):
        _write(tmp_path / f"img{index}.jpg")

    result = scan_folder(tmp_path, max_files=3)

    assert result.media_count == 3
    assert result.partial is True


def test_zero_byte_and_svg_are_not_media(tmp_path: Path) -> None:
    _write(tmp_path / "empty.jpg", b"")
    _write(tmp_path / "icon.svg", b"<svg></svg>")
    _write(tmp_path / "real.jpg", b"\xff\xd8\xff")

    result = scan_folder(tmp_path)
    assert [item.path for item in result.files] == ["real.jpg"]
    reasons = {item["reason"] for item in result.skipped}
    assert reasons == {"empty", "unsupported"}
