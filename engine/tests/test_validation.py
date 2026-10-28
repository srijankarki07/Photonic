from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import pytest

from photonic_engine.models import MediaType
from photonic_engine.validation import sniff_media, validate_media, wait_for_stable

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 64
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
MOV = b"\x00\x00\x00\x14ftypqt  " + b"\x00" * 64
HEIC = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 64


def _write(path: Path, payload: bytes) -> Path:
    path.write_bytes(payload)
    return path


@pytest.mark.parametrize(
    ("name", "payload", "media_type", "fmt"),
    [
        ("a.jpg", JPEG, MediaType.IMAGE, "jpeg"),
        ("a.png", PNG, MediaType.IMAGE, "png"),
        ("a.gif", GIF, MediaType.IMAGE, "gif"),
        ("a.webp", WEBP, MediaType.IMAGE, "webp"),
        ("a.mp4", MP4, MediaType.VIDEO, "mp4"),
        ("a.mov", MOV, MediaType.VIDEO, "mp4"),
        ("a.heic", HEIC, MediaType.IMAGE, "heif"),
    ],
)
def test_recognizes_real_headers(
    tmp_path: Path, name: str, payload: bytes, media_type: MediaType, fmt: str
) -> None:
    path = _write(tmp_path / name, payload)
    sniffed = sniff_media(path)
    assert sniffed.media_type == media_type
    assert sniffed.format == fmt
    result = validate_media(path, media_type, wait_seconds=0)
    assert result.ok is True
    assert result.media_type == media_type


def test_text_with_image_extension_is_skipped(tmp_path: Path) -> None:
    path = _write(tmp_path / "not-really.jpg", b"this is a text file, not a photo\n" * 4)
    result = validate_media(path, MediaType.IMAGE, wait_seconds=0)
    assert result.ok is False
    assert result.state == "skipped"
    assert result.code == "unsupported_mime"


def test_mismatched_magic_is_skipped(tmp_path: Path) -> None:
    path = _write(tmp_path / "actually-video.jpg", MP4)
    result = validate_media(path, MediaType.IMAGE, wait_seconds=0)
    assert result.ok is False
    assert result.code == "mime_mismatch"


def test_image_named_video_is_skipped(tmp_path: Path) -> None:
    path = _write(tmp_path / "actually-jpeg.mp4", JPEG)
    result = validate_media(path, MediaType.VIDEO, wait_seconds=0)
    assert result.ok is False
    assert result.code == "mime_mismatch"


def test_empty_is_skipped(tmp_path: Path) -> None:
    path = _write(tmp_path / "empty.jpg", b"")
    result = validate_media(path, MediaType.IMAGE, wait_seconds=0)
    assert result.ok is False
    assert result.code == "file_empty"


def test_missing_is_failed(tmp_path: Path) -> None:
    result = validate_media(tmp_path / "gone.jpg", MediaType.IMAGE, wait_seconds=0)
    assert result.ok is False
    assert result.state == "failed"
    assert result.code == "file_missing"


def test_unreadable_is_failed(tmp_path: Path) -> None:
    path = _write(tmp_path / "a.jpg", JPEG)
    os.chmod(path, 0)
    try:
        result = validate_media(path, MediaType.IMAGE, wait_seconds=0)
    finally:
        os.chmod(path, 0o644)
    assert result.ok is False
    assert result.state == "failed"
    assert result.code == "file_unreadable"


def test_unknown_binary_is_allowed_with_warning(tmp_path: Path) -> None:
    # Deliberately not a known signature; do not over-skip exotic formats.
    path = _write(tmp_path / "exotic.jpg", b"\x00\x01\x02\x03" * 64)
    result = validate_media(path, MediaType.IMAGE, wait_seconds=0)
    assert result.ok is True
    assert result.warning == "mime_unknown"


def test_archive_with_image_extension_is_skipped(tmp_path: Path) -> None:
    path = _write(tmp_path / "archive.jpg", b"PK\x03\x04" + b"\x00" * 64)
    result = validate_media(path, MediaType.IMAGE, wait_seconds=0)
    assert result.ok is False
    assert result.code == "unsupported_mime"


def test_old_files_skip_the_stability_window(tmp_path: Path) -> None:
    path = _write(tmp_path / "old.jpg", JPEG)
    old = time.time() - 3600
    os.utime(path, (old, old))

    started = time.monotonic()
    assert wait_for_stable(path, quiet=0.5, timeout=5.0) is True
    assert time.monotonic() - started < 0.2


def test_unstable_file_times_out_then_becomes_stable(tmp_path: Path) -> None:
    path = _write(tmp_path / "growing.jpg", JPEG)
    stop = threading.Event()

    def writer() -> None:
        while not stop.is_set():
            with path.open("ab") as handle:
                handle.write(b"x")
            time.sleep(0.1)

    thread = threading.Thread(target=writer, daemon=True)
    thread.start()
    try:
        while_ = validate_media(path, MediaType.IMAGE, wait_seconds=0.4)
        assert while_.ok is False
        assert while_.code == "file_unstable"
    finally:
        stop.set()
        thread.join(timeout=2)

    time.sleep(0.3)
    stable = validate_media(path, MediaType.IMAGE, wait_seconds=2.0)
    assert stable.ok is True
    assert wait_for_stable(path, timeout=1.0) is True
