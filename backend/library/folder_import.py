"""Folder import — every media file in a folder becomes a record (v3.0 3s).

Dedupe is the store's content fingerprint; nothing is transcribed. The one rule
that is more than "create or get": a fingerprint hit on a record whose media is
**missing** is a relink, so importing the folder a drive was moved to heals every
card in it. A hit whose media still exists elsewhere is a duplicate file and is
reported ``existing``, never repointed.

A single unreadable file never aborts the pass — it lands in ``failed`` with
the reason and the next path is tried.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Iterable, Literal, Union

from backend.library.errors import LibraryError
from backend.library.media_scan import SCAN_MAX_FILES, is_media_name, scan_media
from backend.library.schemas import Actor

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.store import LibraryStore

logger = logging.getLogger(__name__)

#: Who a relink made by an import is stamped as when the caller names nobody.
DEFAULT_IMPORT_ACTOR: Actor = "user"
#: Machine-readable ``failed[].reason`` codes for a dropped path refused before
#: import (a failure *during* import carries the library's sentence instead).
REASON_MEDIA_NOT_FOUND = "media_not_found"
REASON_NOT_MEDIA = "not_media"

Outcome = Literal["created", "existing", "relinked"]
PathInput = Union[str, Path]


@dataclass(frozen=True)
class FolderImport:
    """Record ids by outcome, the paths that failed with why, and the scan cap."""

    created: tuple[str, ...] = ()
    existing: tuple[str, ...] = ()
    relinked: tuple[str, ...] = ()
    failed: tuple[tuple[str, str], ...] = ()
    truncated: bool = False

    def to_wire(self) -> dict:
        """The ``POST /api/library/import-folder`` body."""
        return {
            "created": list(self.created),
            "existing": list(self.existing),
            "relinked": list(self.relinked),
            "failed": [{"path": path, "reason": reason} for path, reason in self.failed],
            "truncated": self.truncated,
        }


def require_import_folder(raw: str) -> Path:
    """The folder a client asked to import, or ``ValueError`` saying why not.

    A relative path would resolve against the backend's working directory,
    which no client means, so it is refused rather than guessed at.
    """
    folder = Path(raw).expanduser()
    if not raw.strip() or not folder.is_absolute():
        raise ValueError(f"The folder path must be absolute: {raw!r}")
    if not folder.is_dir():
        raise ValueError(f"Not an existing folder: {folder}")
    return folder


def import_folder(
    store: "LibraryStore",
    folder: PathInput,
    *,
    recursive: bool = True,
    by: Actor = DEFAULT_IMPORT_ACTOR,
) -> FolderImport:
    """Scan ``folder`` and import every media file found (bounded by the scan cap).

    Raises ``NotADirectoryError`` when ``folder`` is not a directory.
    """
    scan = scan_media(Path(folder), recursive=recursive, max_files=SCAN_MAX_FILES)
    result = import_paths(store, scan.paths, by=by)
    return replace(result, truncated=scan.truncated)


def import_paths(
    store: "LibraryStore", paths: Iterable[PathInput], *, by: Actor
) -> FolderImport:
    """The per-path step for an explicit list (the watcher, a multi-file drop)."""
    outcomes: dict[Outcome, list[str]] = {"created": [], "existing": [], "relinked": []}
    failed: list[tuple[str, str]] = []
    for path in paths:
        try:
            outcome, video_id = _import_one(store, Path(path), by=by)
        except (LibraryError, OSError, ValueError) as exc:
            reason = _reason(exc)
            logger.warning("Could not import %s: %s", path, reason)
            failed.append((str(path), reason))
            continue
        outcomes[outcome].append(video_id)
    return FolderImport(
        created=tuple(outcomes["created"]),
        existing=tuple(outcomes["existing"]),
        relinked=tuple(outcomes["relinked"]),
        failed=tuple(failed),
    )


def import_dropped_paths(
    store: "LibraryStore", paths: Iterable[str], *, by: Actor
) -> FolderImport:
    """A multi-file drop: refuse what cannot be media, import the rest.

    Each raw path is checked in order — not an absolute regular file is
    ``media_not_found``, a suffix outside ``MEDIA_EXTENSIONS`` is ``not_media``
    — and those refusals (keyed by the path exactly as sent) come first in
    ``failed``, ahead of any failure from the import itself.
    """
    refused: list[tuple[str, str]] = []
    importable: list[Path] = []
    for raw in paths:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute() or not candidate.is_file():
            refused.append((raw, REASON_MEDIA_NOT_FOUND))
        elif not is_media_name(candidate.name):
            refused.append((raw, REASON_NOT_MEDIA))
        else:
            importable.append(candidate)
    result = import_paths(store, importable, by=by)
    return replace(result, failed=(*refused, *result.failed))


def _import_one(store: "LibraryStore", path: Path, *, by: Actor) -> tuple[Outcome, str]:
    """Create, relink or match one file. A scratch hit is promoted by the store.

    The relink re-checks ``missing_media`` under the store's write lock, so a
    record another writer healed in between is reported ``existing``.
    """
    record, minted = store.create_or_get(path)
    if minted:
        return "created", record.id
    if record.missing_media:
        healed = store.heal_missing(record.id, path, by=by)
        if healed is not None:
            return "relinked", healed.id
    return "existing", record.id


def _reason(exc: BaseException) -> str:
    """One line for the UI: the library's sentence plus the OS's, when there is one."""
    cause = exc.__cause__
    message = str(exc) or type(exc).__name__
    if isinstance(cause, OSError) and cause.strerror:
        return f"{message} ({cause.strerror})"
    return message
