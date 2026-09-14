"""Library housekeeping: relocation, project import, first-launch migration.

Mixed into :class:`~backend.library.store.LibraryStore` (which is already at its
size ceiling) rather than imported by it as free functions, so the call sites
stay ``store.remove(id)``.

The one rule every operation here obeys — vision §9.1 — is that **the backend
never deletes a user file**: ``remove`` moves a record folder under
``.removed/`` and ``detach`` moves it under ``.trash/`` and hands the path back
so Electron can put it in the system Trash. Both leave every byte on disk.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from backend.library.errors import MediaNotFound
from backend.library.paths import (
    PROJECT_FILE,
    REMOVED_DIR_NAME,
    STUDIO_DIR_NAME,
    TRASH_DIR_NAME,
    capforge_home,
)
from backend.library.schemas import VideoRecord

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.store import LibraryStore, PathLike

logger = logging.getLogger(__name__)

#: A project file arrives from outside the app, so it is validated at the
#: boundary. 64 MB is ~10x the largest real session snapshot (a 60-minute
#: transcript with word arrays) — big enough to never reject a genuine file,
#: small enough that a mistyped path can't be read into memory.
PROJECT_IMPORT_MAX_BYTES = 64 * 1024 * 1024
PROJECT_IMPORT_SUFFIX = ".capforge"

__all__ = [
    "StoreAdminMixin",
    "has_project_file",
    "PROJECT_IMPORT_MAX_BYTES",
    "PROJECT_IMPORT_SUFFIX",
    "REMOVED_DIR_NAME",
    "TRASH_DIR_NAME",
    "read_project_file",
]


def read_project_file(path: "PathLike") -> dict:
    """Parse an outside ``.capforge`` file, or raise ``ValueError`` saying why.

    Every rejection is one sentence a UI can show verbatim; nothing here is
    logged-and-ignored, because an import the user asked for must either land
    or explain itself.
    """
    target = Path(path).expanduser()
    if not target.is_absolute():
        raise ValueError(f"Project path must be absolute: {path}")
    if target.suffix.lower() != PROJECT_IMPORT_SUFFIX:
        raise ValueError(f"Not a {PROJECT_IMPORT_SUFFIX} project file: {target.name}")
    try:
        size = target.stat().st_size
    except OSError as exc:
        raise ValueError(f"Project file not found: {target}") from exc
    if size > PROJECT_IMPORT_MAX_BYTES:
        raise ValueError(
            f"Project file is too large: {size} bytes, the limit is "
            f"{PROJECT_IMPORT_MAX_BYTES} bytes ({target})"
        )
    return _validate_project_body(_parse_project_json(target), target)


def _parse_project_json(target: Path) -> Any:
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"Project file is not readable JSON: {target} ({exc})") from exc


def _validate_project_body(data: Any, target: Path) -> dict:
    """The two keys a session snapshot must carry for a record to be built."""
    if not isinstance(data, dict):
        raise ValueError(f"Project file must be a JSON object: {target}")
    if not isinstance(data.get("transcriptionResult"), dict):
        raise ValueError(
            f"Project file has no transcriptionResult object: {target}"
        )
    source = data.get("selectedFilePath")
    if not isinstance(source, str) or not source.strip():
        raise ValueError(f"Project file has no selectedFilePath: {target}")
    return data


def _stamped_target(base: Path, video_id: str, stamp: str) -> Path:
    """``base/<id>``, or ``base/<id>-<stamp>`` when that name is taken.

    Colons are stripped from the stamp: an ISO timestamp is not a legal
    Windows filename, and this folder has to survive on both platforms.
    """
    target = base / video_id
    if not target.exists():
        return target
    return base / f"{video_id}-{stamp.replace(':', '-')}"


class StoreAdminMixin:
    """Relocation, import and migration for :class:`LibraryStore`."""

    def _relocate(
        self: "LibraryStore", video_id: str, bucket: str
    ) -> tuple[VideoRecord, Path]:
        """Move a record's folder into ``<root>/<bucket>/`` and de-index it.

        ``RecordNotFound`` propagates from ``get``; an ``OSError`` from the move
        propagates too — a half-moved record must never be reported as gone.
        """
        from backend.library.store import _now_iso  # local: avoids a cycle

        record = self.get(video_id)
        source = self._locate(video_id)
        target = _stamped_target(self.root / bucket, video_id, _now_iso())
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, target)
        self.index.delete(video_id)
        logger.info("Moved record %s to %s", video_id, target)
        return record, target

    def has_project(self: "LibraryStore", record: VideoRecord) -> bool:
        """Whether a session snapshot was ever PUT for this record.

        Derived at read time like ``status`` (the file can appear between two
        reads), so it is a view/summary key and never a ``VideoRecord`` field.
        """
        return has_project_file(self._folder(record.id, scratch=record.scratch))

    def remove(self: "LibraryStore", video_id: str) -> VideoRecord:
        """Hide a record from the library, keeping every file under ``.removed``."""
        record, _ = self._relocate(video_id, REMOVED_DIR_NAME)
        return record

    def detach(self: "LibraryStore", video_id: str) -> Path:
        """De-index a record and return its folder under ``.trash`` for Electron
        to move to the system Trash. The backend itself deletes nothing."""
        _, target = self._relocate(video_id, TRASH_DIR_NAME)
        return target

    def import_project_file(
        self: "LibraryStore", path: "PathLike"
    ) -> tuple[VideoRecord, bool]:
        """Adopt an outside ``.capforge`` file as a record + stored snapshot.

        The bool is ``create_or_get``'s: True when this media was new. A missing
        media file raises ``MediaNotFound`` — the project describes a video the
        record would be unable to open.
        """
        data = read_project_file(path)
        record, created = self.create_or_get(data["selectedFilePath"])
        return self.put_project(record.id, data), created

    def migrate_studio_workspaces(self: "LibraryStore") -> dict:
        """Adopt every pre-v3 studio workspace whose co-author marker still names
        existing media. Idempotent: a second run matches the same records.

        A failure on one workspace lands in ``skipped`` and the scan continues —
        the only place this module swallows an error, because first launch must
        not be blocked by one stale folder.
        """
        base = capforge_home() / STUDIO_DIR_NAME
        imported: list[str] = []
        skipped: list[dict] = []
        if not base.is_dir():
            return {"imported": imported, "skipped": skipped}
        for folder in sorted(base.iterdir()):
            if not folder.is_dir():
                continue  # a stray file is not a workspace
            video_id, reason = _adopt_workspace(self, folder)
            if video_id is None:
                skipped.append({"folder": folder.name, "reason": reason})
            else:
                imported.append(video_id)
        return {"imported": imported, "skipped": skipped}


def _adopt_workspace(
    store: "LibraryStore", folder: Path
) -> tuple[Optional[str], Optional[str]]:
    """``(video_id, None)`` when the workspace became a record, else
    ``(None, reason)`` — the text the migration report shows for it."""
    # Imported lazily: ``hyperframes_project`` drags in the Pillow render stack,
    # and the library store must stay cheap to import.
    from backend.exporters.hyperframes_project import read_coauthor_marker

    marker = read_coauthor_marker(folder)
    if not marker:
        return None, "no co-author marker"
    source = marker.get("source")
    if not isinstance(source, str) or not source.strip():
        return None, "the co-author marker names no source"
    if not Path(source).expanduser().is_file():
        return None, f"the source media is gone: {source}"
    try:
        record, _ = store.create_or_get(source)
    except (MediaNotFound, OSError) as exc:
        logger.warning("Studio workspace %s was not imported: %s", folder.name, exc)
        return None, str(exc)
    return record.id, None


def has_project_file(folder: Path) -> bool:
    """Whether a record folder holds a session snapshot (derived, never stored)."""
    return (folder / PROJECT_FILE).is_file()
