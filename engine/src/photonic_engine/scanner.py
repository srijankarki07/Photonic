"""Recursive media discovery.

Scanning is intentionally independent of uploads. The UI reviews a scan, the
person confirms, and only then does a job get created.
"""

from __future__ import annotations

import os
from pathlib import Path

from .models import MediaFile, MediaType, ScanResult
from .protocol import EngineError

IMAGE_EXTENSIONS = frozenset(
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".heic",
        ".heif",
        ".avif",
        ".bmp",
        ".tif",
        ".tiff",
        ".dng",
        ".raw",
        ".cr2",
        ".cr3",
        ".nef",
        ".arw",
        ".raf",
        ".orf",
        ".rw2",
        ".jxl",
    }
)

VIDEO_EXTENSIONS = frozenset(
    {
        ".mp4",
        ".mov",
        ".m4v",
        ".mkv",
        ".avi",
        ".wmv",
        ".mpg",
        ".mpeg",
        ".3gp",
        ".3g2",
        ".mts",
        ".m2ts",
        ".ts",
        ".webm",
        ".vob",
        ".flv",
    }
)

MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

# Never descend into these. They are either enormous, generated, or metadata
# stores that masquerade as media (Synology, macOS resource forks).
IGNORED_DIR_NAMES = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        "@eaDir",
        "__MACOSX",
        ".thumbnails",
        ".Trash",
        "lost+found",
        "$RECYCLE.BIN",
        "System Volume Information",
    }
)

MAX_REPORTED_SKIPS = 200


def media_type_for(path: str | Path) -> MediaType:
    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return MediaType.IMAGE
    if suffix in VIDEO_EXTENSIONS:
        return MediaType.VIDEO
    return MediaType.OTHER


def _is_hidden(name: str) -> bool:
    return name.startswith(".")


def scan_folder(
    root: str | Path,
    *,
    include_hidden: bool = False,
    max_files: int = 50_000,
    follow_symlinks: bool = False,
) -> ScanResult:
    """Recursively find images and videos under ``root``.

    Raises ``EngineError`` only for problems that make the whole scan
    meaningless. Per-file and per-directory failures become warnings so one
    unreadable folder cannot abort a 50,000-file library.
    """
    if not isinstance(max_files, int) or max_files < 1:
        raise EngineError("bad_request", "maxFiles must be a positive integer.")

    root_path = Path(root).expanduser()
    try:
        root_path = root_path.resolve(strict=True)
    except FileNotFoundError:
        raise EngineError(
            "not_found",
            f"Folder not found: {root_path}",
            hint="Choose a folder that still exists.",
        ) from None
    except PermissionError:
        raise EngineError(
            "permission_denied",
            f"Not allowed to read: {root_path}",
            hint="Check the folder's permissions, then try again.",
        ) from None

    if not root_path.is_dir():
        raise EngineError(
            "not_a_directory",
            f"Not a folder: {root_path}",
            hint="Select a folder, not a single file.",
        )

    result = ScanResult(root=str(root_path))
    stack: list[Path] = [root_path]

    while stack:
        current = stack.pop()
        result.directory_count += 1
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    name = entry.name
                    try:
                        is_symlink = entry.is_symlink()
                    except OSError:
                        is_symlink = False

                    if is_symlink and not follow_symlinks:
                        # Avoid loops and accidental scans outside the chosen
                        # tree. Report it; it is cheap and explainable.
                        result.warnings.append(
                            {"path": str(Path(current) / name), "reason": "symlink_skipped"}
                        )
                        continue

                    try:
                        if entry.is_dir(follow_symlinks=follow_symlinks):
                            if name in IGNORED_DIR_NAMES:
                                continue
                            if not include_hidden and _is_hidden(name):
                                continue
                            stack.append(Path(entry.path))
                            continue

                        if not entry.is_file(follow_symlinks=follow_symlinks):
                            continue
                    except OSError as exc:
                        result.warnings.append(
                            {"path": entry.path, "reason": f"unreadable: {exc.strerror}"}
                        )
                        continue

                    if not include_hidden and _is_hidden(name):
                        continue

                    media_type = media_type_for(name)
                    if media_type is MediaType.OTHER:
                        result.skipped_count += 1
                        if len(result.skipped) < MAX_REPORTED_SKIPS:
                            result.skipped.append({"path": entry.path, "reason": "unsupported"})
                        continue

                    try:
                        stat = entry.stat(follow_symlinks=follow_symlinks)
                    except OSError as exc:
                        result.warnings.append(
                            {"path": entry.path, "reason": f"stat_failed: {exc.strerror}"}
                        )
                        continue

                    if stat.st_size == 0:
                        result.skipped_count += 1
                        if len(result.skipped) < MAX_REPORTED_SKIPS:
                            result.skipped.append(
                                {"path": entry.path, "reason": "empty"}
                            )
                        continue

                    relative = Path(entry.path).relative_to(root_path).as_posix()
                    result.files.append(
                        MediaFile(
                            path=relative,
                            abs_path=entry.path,
                            size=stat.st_size,
                            media_type=media_type,
                            mtime=stat.st_mtime,
                        )
                    )

                    if len(result.files) >= max_files:
                        result.partial = True
                        stack.clear()
                        break
        except PermissionError:
            result.warnings.append({"path": str(current), "reason": "permission_denied"})
            continue
        except OSError as exc:
            result.warnings.append({"path": str(current), "reason": f"unreadable: {exc.strerror}"})
            continue

    result.files.sort(key=lambda item: item.path.casefold())
    return result


def scan_selection(
    paths: list[str],
    *,
    include_hidden: bool = False,
    max_files: int = 50_000,
    follow_symlinks: bool = False,
) -> ScanResult:
    """Scan an explicit selection of files and/or folders into one review.

    The review root is the selected folder itself when exactly one folder is
    chosen; otherwise it is the common parent of the selection. Files are keyed
    by absolute path for deduplication, while ``path`` is display-only.
    """
    if not isinstance(paths, list) or not paths:
        raise EngineError(
            "bad_request",
            "scan_selection requires a non-empty list of paths.",
        )
    if not all(isinstance(item, str) and item.strip() for item in paths):
        raise EngineError(
            "bad_request",
            "Every selection path must be a non-empty string.",
        )
    if isinstance(max_files, bool) or not isinstance(max_files, int) or max_files < 1:
        raise EngineError("bad_request", "maxFiles must be a positive integer.")

    resolved: list[Path] = []
    warnings: list[dict[str, str]] = []
    seen_paths: set[str] = set()

    for raw in paths:
        candidate = Path(raw).expanduser()
        try:
            target = candidate.resolve(strict=True)
        except FileNotFoundError:
            warnings.append({"path": str(candidate), "reason": "selection_missing"})
            continue
        except PermissionError:
            warnings.append({"path": str(candidate), "reason": "permission_denied"})
            continue
        except OSError as error:
            warnings.append(
                {"path": str(candidate), "reason": f"unreadable: {error.strerror}"}
            )
            continue

        key = str(target)
        if key in seen_paths:
            warnings.append({"path": key, "reason": "duplicate_selection"})
            continue
        seen_paths.add(key)
        resolved.append(target)

    if not resolved:
        return ScanResult(root="", warnings=warnings[:MAX_REPORTED_SKIPS])

    if len(resolved) == 1:
        root = resolved[0] if resolved[0].is_dir() else resolved[0].parent
    else:
        parents = [str(item.parent) for item in resolved]
        try:
            root = Path(os.path.commonpath(parents))
        except ValueError:
            root = Path("/")

    result = ScanResult(root=str(root))
    files_by_abs: dict[str, MediaFile] = {}

    def add_skip(path: str, reason: str) -> None:
        result.skipped_count += 1
        if len(result.skipped) < MAX_REPORTED_SKIPS:
            result.skipped.append({"path": path, "reason": reason})

    def relative(path: Path) -> str:
        try:
            return path.relative_to(root).as_posix()
        except ValueError:
            return path.as_posix()

    for target in resolved:
        if len(files_by_abs) >= max_files:
            result.partial = True
            break

        if target.is_dir():
            sub = scan_folder(
                target,
                include_hidden=include_hidden,
                max_files=max_files,
                follow_symlinks=follow_symlinks,
            )
            result.directory_count += sub.directory_count
            result.skipped_count += sub.skipped_count
            result.skipped.extend(sub.skipped)
            result.warnings.extend(sub.warnings)
            result.partial = result.partial or sub.partial

            for item in sub.files:
                absolute = Path(item.abs_path)
                key = str(absolute)
                if key in files_by_abs:
                    if len(result.warnings) < MAX_REPORTED_SKIPS:
                        result.warnings.append(
                            {"path": key, "reason": "duplicate_selection"}
                        )
                    continue
                files_by_abs[key] = MediaFile(
                    path=relative(absolute),
                    abs_path=key,
                    size=item.size,
                    media_type=item.media_type,
                    mtime=item.mtime,
                )
            continue

        if not target.is_file():
            warnings.append({"path": str(target), "reason": "not_a_file"})
            continue

        media_type = media_type_for(target)
        if media_type is MediaType.OTHER:
            add_skip(str(target), "unsupported")
            continue
        try:
            stat = target.stat()
        except OSError as error:
            warnings.append(
                {"path": str(target), "reason": f"stat_failed: {error.strerror}"}
            )
            continue
        if stat.st_size == 0:
            add_skip(str(target), "empty")
            continue
        key = str(target)
        if key in files_by_abs:
            if len(result.warnings) < MAX_REPORTED_SKIPS:
                result.warnings.append({"path": key, "reason": "duplicate_selection"})
            continue
        files_by_abs[key] = MediaFile(
            path=relative(target),
            abs_path=key,
            size=stat.st_size,
            media_type=media_type,
            mtime=stat.st_mtime,
        )

    result.files = sorted(files_by_abs.values(), key=lambda item: item.path.casefold())
    if len(result.files) > max_files:
        result.files = result.files[:max_files]
        result.partial = True
    result.skipped = result.skipped[:MAX_REPORTED_SKIPS]
    result.warnings.extend(warnings)
    result.warnings = result.warnings[:MAX_REPORTED_SKIPS]
    return result
