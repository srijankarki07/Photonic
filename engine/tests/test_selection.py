from __future__ import annotations

from pathlib import Path

import pytest

from photonic_engine.scanner import scan_selection

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64


def _jpeg(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(JPEG)
    return path


def test_single_folder_root_is_the_folder(tmp_path: Path) -> None:
    _jpeg(tmp_path / "a.jpg")
    _jpeg(tmp_path / "nested" / "b.jpg")

    result = scan_selection([str(tmp_path)])

    assert result.root == str(tmp_path)
    assert [item.path for item in result.files] == ["a.jpg", "nested/b.jpg"]
    assert result.media_count == 2


def test_files_from_two_folders_share_a_common_root(tmp_path: Path) -> None:
    _jpeg(tmp_path / "one" / "IMG.jpg")
    _jpeg(tmp_path / "two" / "IMG.jpg")

    result = scan_selection(
        [str(tmp_path / "one" / "IMG.jpg"), str(tmp_path / "two" / "IMG.jpg")]
    )

    assert result.root == str(tmp_path)
    assert [item.path for item in result.files] == ["one/IMG.jpg", "two/IMG.jpg"]


def test_folder_and_file_duplicates_are_deduplicated(tmp_path: Path) -> None:
    file_path = _jpeg(tmp_path / "a.jpg")

    result = scan_selection([str(tmp_path), str(file_path)])

    assert result.media_count == 1
    assert any(item["reason"] == "duplicate_selection" for item in result.warnings)


def test_missing_selection_is_a_warning(tmp_path: Path) -> None:
    result = scan_selection([str(tmp_path / "missing")])

    assert result.media_count == 0
    assert result.root == ""
    assert result.warnings[0]["reason"] == "selection_missing"


def test_unsupported_and_empty_files_are_skipped(tmp_path: Path) -> None:
    _jpeg(tmp_path / "good.jpg")
    (tmp_path / "notes.txt").write_text("not media")
    (tmp_path / "empty.jpg").write_bytes(b"")

    result = scan_selection([str(tmp_path)])

    assert result.media_count == 1
    reasons = {item["reason"] for item in result.skipped}
    assert reasons == {"unsupported", "empty"}


def test_max_files_is_respected(tmp_path: Path) -> None:
    for index in range(4):
        _jpeg(tmp_path / f"{index}.jpg")

    result = scan_selection([str(tmp_path)], max_files=2)

    assert result.media_count == 2
    assert result.partial is True


def test_empty_selection_is_rejected() -> None:
    from photonic_engine.protocol import EngineError

    with pytest.raises(EngineError) as caught:
        scan_selection([])
    assert caught.value.code == "bad_request"
