"""Which files in a folder are media CapForge can import (v3.0 3s).

Pure and filesystem-only: folder import and the watch folder both walk through
``scan_media``, so "what counts as a recording" is decided in one place.

``MEDIA_EXTENSIONS`` is one of three copies of the same list — the renderer's
``lib/libraryView.ts`` and Electron's ``firstMediaArg`` are the other two — and
all three are pinned to ``backend/tests/fixtures/media_extensions.json``.
Change one, change all three and the fixture.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Union

logger = logging.getLogger(__name__)

#: Lower-case, no dot — equal to the shared fixture.
MEDIA_EXTENSIONS: frozenset[str] = frozenset(
    {"mp3", "wav", "m4a", "flac", "aac", "ogg", "mp4", "mkv", "webm", "mov"}
)
#: A folder import is explicit but bounded: past this many files it stops and
#: says so (``truncated``) rather than minting a thousand records by accident.
SCAN_MAX_FILES = 500
#: Directory levels below the chosen folder that are still entered.
SCAN_MAX_DEPTH = 4
#: Dot-files and dot-directories (``.DS_Store``, ``.Trashes``, app caches).
HIDDEN_PREFIX = "."


@dataclass(frozen=True)
class ScanResult:
    """Media files in walk order, and whether a cap left any out."""

    paths: tuple[Path, ...]
    truncated: bool


class _FileCapReached(Exception):
    """Internal: stop the walk the moment the file cap is exceeded."""


def is_media_name(name: str) -> bool:
    """Whether a file name carries one of ``MEDIA_EXTENSIONS`` (any case)."""
    suffix = os.path.splitext(name)[1]
    return len(suffix) > 1 and suffix[1:].lower() in MEDIA_EXTENSIONS


def scan_media(
    folder: Union[str, os.PathLike[str]],
    *,
    recursive: bool = True,
    max_files: int = SCAN_MAX_FILES,
    max_depth: int = SCAN_MAX_DEPTH,
) -> ScanResult:
    """Every media file under ``folder``, absolute, sorted per directory.

    Skips hidden entries, never follows a symlink (to a directory or a file —
    only regular files count), and enters at most ``max_depth`` directory
    levels. ``truncated`` is True when the file cap or the depth cap left
    something out. Raises ``NotADirectoryError`` when ``folder`` is not a
    directory; an unreadable *subdirectory* is logged and skipped.
    """
    root = Path(folder).expanduser()
    if not root.is_dir():
        raise NotADirectoryError(f"Not a folder: {root}")
    found: list[Path] = []
    try:
        truncated = _walk(
            root.resolve(), 0, found,
            recursive=recursive, max_files=max_files, max_depth=max_depth,
        )
    except _FileCapReached:
        truncated = True
    return ScanResult(paths=tuple(found), truncated=truncated)


def _sorted_entries(directory: Path) -> list[os.DirEntry[str]]:
    with os.scandir(directory) as entries:
        return sorted(entries, key=lambda entry: entry.name)


def _walk(
    directory: Path,
    depth: int,
    found: list[Path],
    *,
    recursive: bool,
    max_files: int,
    max_depth: int,
) -> bool:
    """Append media under ``directory`` to ``found``; True when a cap cut it."""
    truncated = False
    for entry in _sorted_entries(directory):
        if entry.name.startswith(HIDDEN_PREFIX):
            continue
        if entry.is_dir(follow_symlinks=False):
            if not recursive:
                continue
            if depth + 1 > max_depth:
                truncated = True
                continue
            try:
                truncated = _walk(
                    Path(entry.path), depth + 1, found,
                    recursive=recursive, max_files=max_files, max_depth=max_depth,
                ) or truncated
            except PermissionError as exc:
                logger.warning("Skipping an unreadable folder during a media scan: %s", exc)
        elif entry.is_file(follow_symlinks=False) and is_media_name(entry.name):
            if len(found) >= max_files:
                raise _FileCapReached()
            found.append(Path(entry.path))
    return truncated
