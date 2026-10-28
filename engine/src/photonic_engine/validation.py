"""Pre-upload validation: content type, readability, size, and stability.

Extension-only scanning is fast but lets mislabeled files reach gpmc, which then
fails the file with a MIME error. This module checks the first bytes, the MIME
guess, and whether a file is still being written before any upload starts.
"""

from __future__ import annotations

import mimetypes
import time
from dataclasses import dataclass
from pathlib import Path

from .models import MediaType

# Containers use an ISO base media file format brand at bytes 4..12.
_HEIF_BRANDS = {
    b"heic",
    b"heix",
    b"hevc",
    b"hevx",
    b"heim",
    b"heis",
    b"mif1",
    b"msf1",
}
_AVIF_BRANDS = {b"avif", b"avis"}
_CR3_BRANDS = {b"crx "}
_MP4_BRANDS = {
    b"isom",
    b"iso2",
    b"iso3",
    b"iso4",
    b"iso5",
    b"iso6",
    b"mp41",
    b"mp42",
    b"avc1",
    b"dash",
    b"qt  ",
    b"M4V ",
    b"3gp4",
    b"3gp5",
    b"3g2a",
    b"3g2b",
    b"f4v ",
}

# Content that is definitely not a photo/video. A known media extension with
# one of these headers is skipped instead of being sent to gpmc.
_NON_MEDIA_PREFIXES = (
    b"PK\x03\x04",  # zip / docx / apk
    b"%PDF",
    b"Rar!",
    b"7z\xbc\xaf\x27\x1c",
    b"\x7fELF",
    b"MZ",  # Windows executable
    b"\xd0\xcf\x11\xe0",  # legacy Office / OLE
    b"SQLite format 3\x00",
)


@dataclass(frozen=True, slots=True)
class Sniff:
    media_type: MediaType | None
    format: str | None


@dataclass(frozen=True, slots=True)
class ValidationResult:
    ok: bool
    state: str = "ok"  # ok | skipped | failed
    code: str | None = None
    message: str | None = None
    hint: str | None = None
    media_type: MediaType | None = None
    format: str | None = None
    warning: str | None = None


def _read_header(path: Path, size: int = 512) -> bytes:
    with path.open("rb") as handle:
        return handle.read(size)


def _looks_like_text(header: bytes) -> bool:
    if not header or b"\x00" in header:
        return False
    printable = sum(
        1
        for byte in header
        if 32 <= byte <= 126 or byte in (9, 10, 13)
    )
    return printable / len(header) > 0.9


def _ftyp_brand(header: bytes) -> bytes | None:
    if len(header) >= 12 and header[4:8] == b"ftyp":
        return header[8:12]
    return None


def _is_mpeg_ts(header: bytes) -> bool:
    if not header:
        return False
    # Plain MPEG-TS: 188-byte packets starting with 0x47.
    if header[0] == 0x47 and (len(header) < 189 or header[188] == 0x47):
        return True
    # M2TS: 4-byte timestamp before each 192-byte packet.
    if (
        len(header) > 196
        and header[4] == 0x47
        and header[196] == 0x47
    ):
        return True
    return False


def sniff_media(path: str | Path) -> Sniff:
    """Identify the real media type from the file header."""
    target = Path(path)
    try:
        header = _read_header(target)
    except OSError:
        return Sniff(None, None)
    if not header:
        return Sniff(None, None)

    image = MediaType.IMAGE
    video = MediaType.VIDEO

    if header.startswith(b"\xff\xd8\xff"):
        return Sniff(image, "jpeg")
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return Sniff(image, "png")
    if header.startswith((b"GIF87a", b"GIF89a")):
        return Sniff(image, "gif")
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return Sniff(image, "webp")
    if header.startswith(b"BM"):
        return Sniff(image, "bmp")
    if header.startswith((b"II*\x00", b"MM\x00*")):
        return Sniff(image, "tiff")
    if header.startswith(b"FUJIFILM"):
        return Sniff(image, "raf")
    if header.startswith((b"IIRO", b"MMOR")):
        return Sniff(image, "orf")
    if header.startswith(b"IIU\x00"):
        return Sniff(image, "rw2")
    if header.startswith(b"\x00\x00\x00\x0cJXL \r\n\x87\n"):
        return Sniff(image, "jxl")
    if header.startswith(b"\xff\x0a"):
        return Sniff(image, "jxl")

    if header.startswith(b"RIFF") and header[8:12] == b"AVI ":
        return Sniff(video, "avi")
    if header.startswith(b"\x1aE\xdf\xa3"):
        return Sniff(video, "matroska")
    if header.startswith(b"FLV"):
        return Sniff(video, "flv")
    if header.startswith((b"\x00\x00\x01\xba", b"\x00\x00\x01\xb3")):
        return Sniff(video, "mpeg")
    if header.startswith(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11"):
        return Sniff(video, "asf")
    if header.startswith(b"OggS"):
        return Sniff(video, "ogg")
    if _is_mpeg_ts(header):
        return Sniff(video, "mpegts")

    brand = _ftyp_brand(header)
    if brand:
        if brand in _HEIF_BRANDS:
            return Sniff(image, "heif")
        if brand in _AVIF_BRANDS:
            return Sniff(image, "avif")
        if brand in _CR3_BRANDS:
            return Sniff(image, "cr3")
        if brand in _MP4_BRANDS or brand not in {b"", b"\x00\x00\x00\x00"}:
            # Unknown ftyp brands are overwhelmingly video containers.
            return Sniff(video, "mp4")
        return Sniff(video, "mp4")

    return Sniff(None, None)


def wait_for_stable(
    path: str | Path,
    *,
    quiet: float = 0.5,
    timeout: float = 5.0,
) -> bool:
    """Return True once size and mtime have been unchanged for ``quiet`` seconds."""
    target = Path(path)
    try:
        stat = target.stat()
    except OSError:
        return False

    # Photos copied days ago cannot still be growing. Skipping the observation
    # window for old files removes most of the per-file delay on a normal
    # library while keeping the guard for files that are being written now.
    if stat.st_size > 0 and time.time() - stat.st_mtime >= max(5.0, quiet * 2):
        return True

    deadline = time.monotonic() + max(0.0, timeout)
    last: tuple[int, int] | None = None
    stable_since: float | None = None

    while time.monotonic() < deadline:
        try:
            stat = target.stat()
        except OSError:
            return False
        signature = (stat.st_size, stat.st_mtime_ns)
        now = time.monotonic()
        if signature == last:
            if stable_since is None:
                stable_since = now
            elif now - stable_since >= quiet:
                return True
        else:
            last = signature
            stable_since = now
        time.sleep(0.15)

    return False


def _skip(code: str, message: str, hint: str | None = None) -> ValidationResult:
    return ValidationResult(
        ok=False, state="skipped", code=code, message=message, hint=hint
    )


def _fail(code: str, message: str, hint: str | None = None) -> ValidationResult:
    return ValidationResult(
        ok=False, state="failed", code=code, message=message, hint=hint
    )


def validate_media(
    path: str | Path,
    declared_type: MediaType,
    *,
    wait_seconds: float = 5.0,
) -> ValidationResult:
    """Validate one file before it is handed to gpmc.

    Returns a structured result. Invalid files are skipped (not failed) with a
    reason a person can act on, so the rest of the batch continues.
    """
    target = Path(path)
    try:
        stat = target.stat()
    except FileNotFoundError:
        return _fail(
            "file_missing",
            "The file disappeared before it could be checked.",
            "Locate it or remove it from the job.",
        )
    except OSError as error:
        return _fail("file_unreadable", "The file could not be read.", str(error))

    if not target.is_file():
        return _skip("not_a_file", "This path is not a regular file.")
    if stat.st_size == 0:
        return _skip(
            "file_empty",
            "This file is empty.",
            "Remove it or replace it with the real media file.",
        )

    try:
        with target.open("rb") as handle:
            handle.read(1)
    except OSError as error:
        return _fail(
            "file_unreadable",
            "The file could not be opened for reading.",
            str(error),
        )

    if wait_seconds > 0 and not wait_for_stable(target, timeout=wait_seconds):
        return _skip(
            "file_unstable",
            "This file is still being copied or written.",
            "Wait for the copy to finish, then retry the file.",
        )

    sniffed = sniff_media(target)
    if sniffed.media_type is None:
        try:
            header = _read_header(target, 256)
        except OSError:
            header = b""
        if header.startswith(_NON_MEDIA_PREFIXES):
            return _skip(
                "unsupported_mime",
                "This file is not a photo or video (it looks like a document or archive).",
                "Remove it from the selection; the rest of the batch continues.",
            )
        if _looks_like_text(header):
            return _skip(
                "unsupported_mime",
                "This file contains text, not photo or video data.",
                "Check the file extension or remove it from the selection.",
            )
        # Unknown binary signature: do not over-skip exotic RAW/codec variants.
        # Let gpmc decide; if it rejects the MIME, the adapter marks it skipped.
        return ValidationResult(
            ok=True,
            media_type=declared_type,
            format=None,
            warning="mime_unknown",
        )

    if sniffed.media_type != declared_type:
        return _skip(
            "mime_mismatch",
            f"The file's contents look like a {sniffed.media_type.value}, "
            f"not a {declared_type.value}.",
            "Rename it to its real extension or remove it from the job.",
        )

    guessed, _ = mimetypes.guess_type(str(target))
    if guessed and guessed not in {"application/octet-stream"}:
        guessed_kind = guessed.split("/", 1)[0]
        if guessed_kind in {"image", "video"} and guessed_kind != sniffed.media_type.value:
            return _skip(
                "mime_mismatch",
                "The file's extension and contents disagree.",
                "Rename it to its real extension or remove it from the job.",
            )
        if guessed_kind not in {"image", "video"}:
            return _skip(
                "unsupported_mime",
                "The file's type is not supported as a photo or video.",
                "Remove it, or convert it to a supported format.",
            )

    return ValidationResult(
        ok=True,
        media_type=sniffed.media_type,
        format=sniffed.format,
    )
