"""Library housekeeping: relocation, relink, project import, first-launch migration,
and the import-time duration probe's write.

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
import math
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from backend.library import fs
from backend.library.errors import MediaInUse, MediaMismatch, MediaNotFound, RecordNotFound
from backend.library.locking import writes
from backend.library.paths import (
    PROJECT_FILE,
    REMOVED_DIR_NAME,
    STUDIO_DIR_NAME,
    TRANSCRIPT_FILE,
    TRASH_DIR_NAME,
    capforge_home,
)
from backend.library.schemas import HISTORY_CAP, Actor, HistoryEntry, VideoRecord

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.store import LibraryStore, PathLike

logger = logging.getLogger(__name__)

#: A project file arrives from outside the app, so it is validated at the
#: boundary. 64 MB is ~10x the largest real session snapshot (a 60-minute
#: transcript with word arrays) — big enough to never reject a genuine file,
#: small enough that a mistyped path can't be read into memory.
PROJECT_IMPORT_MAX_BYTES = 64 * 1024 * 1024
PROJECT_IMPORT_SUFFIX = ".capforge"
#: The history field a relink is stamped under (``sourcePath`` stays a system
#: field — ``PATCH`` refuses it; relink is the one way to change it).
RELINK_HISTORY_FIELD = "sourcePath"
#: The stored files whose media paths a relink rewrites (decision 4).
RELINK_REWRITTEN_FILES = (PROJECT_FILE, TRANSCRIPT_FILE)

__all__ = [
    "StoreAdminMixin",
    "has_project_file",
    "PROJECT_IMPORT_MAX_BYTES",
    "PROJECT_IMPORT_SUFFIX",
    "REMOVED_DIR_NAME",
    "TRASH_DIR_NAME",
    "read_project_file",
    "replace_path_strings",
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


def _usable_duration(seconds: Any) -> bool:
    """A real, finite, positive number of seconds (``bool`` is not a number here)."""
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)):
        return False
    return math.isfinite(seconds) and seconds > 0


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

    @writes
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

    @writes
    def set_probed_duration(self: "LibraryStore", video_id: str, seconds: Any) -> bool:
        """Fill an unknown ``duration`` with ffprobe's answer (``media_probe``).

        True only when it wrote. It writes only while the record's duration is
        still ``None`` and the value is a finite number > 0, so a transcript's
        duration (``put_project``) always wins, whichever lands first. Duration
        is a system field: no ``rev`` bump (that would 409 an agent's pending
        ``If-Match`` patch), no history entry, and ``updatedAt`` is untouched so
        a startup backfill does not reorder the library. A missing record is
        ``False`` — the pool task can outlive a Remove.
        """
        if not _usable_duration(seconds):
            return False
        try:
            record = self.get(video_id)
        except RecordNotFound:
            return False
        if record.duration is not None:
            return False
        self._persist(record.model_copy(update={"duration": float(seconds)}))
        return True

    def relink(
        self: "LibraryStore",
        video_id: str,
        path: "PathLike",
        *,
        by: Actor,
        force: bool = False,
    ) -> VideoRecord:
        """Point a record at its media's new location ("Locate…", folder import).

        Same media (fingerprint equal) relinks; different media raises
        ``MediaMismatch`` unless ``force`` (then the new fingerprint is adopted);
        a file another record — library or scratch — owns raises ``MediaInUse``
        even with ``force``. The stored snapshot's paths are rewritten **before**
        the record, so a crash in between leaves a record that is still missing
        its media and a relink that can simply run again. The current path is a
        no-op, like a no-op patch.

        The new file is fingerprinted before the write lock is taken (it may sit
        on a slow drive); everything from the re-read of the record on is locked.
        """
        self.get(video_id)  # an unknown record is a 404 before the file is looked at
        target = _require_media_file(path)
        new_fingerprint = _fingerprint_of(target)
        with self.write_lock:
            return self._relink_locked(video_id, target, new_fingerprint, by=by, force=force)

    def heal_missing(
        self: "LibraryStore", video_id: str, path: "PathLike", *, by: Actor
    ) -> Optional[VideoRecord]:
        """Folder import's relink: same media only, and only while the record's
        media is **still** missing when the lock is held. ``None`` when another
        writer healed it first — a healthy record is never repointed at a copy.
        """
        target = _require_media_file(path)
        new_fingerprint = _fingerprint_of(target)
        with self.write_lock:
            if not self.get(video_id).missing_media:
                return None
            return self._relink_locked(video_id, target, new_fingerprint, by=by, force=False)

    def _relink_locked(
        self: "LibraryStore",
        video_id: str,
        target: Path,
        new_fingerprint: str,
        *,
        by: Actor,
        force: bool,
    ) -> VideoRecord:
        """``relink``'s read-modify-write; the caller holds ``write_lock``."""
        from backend.library.store import _now_iso, _truncate  # local: avoids a cycle

        record = self.get(video_id)
        new_path = str(target)
        if new_path == record.sourcePath:
            return record
        owner = self._owner_of(new_fingerprint, new_path, excluding=video_id)
        if owner is not None:
            raise MediaInUse(owner)
        if new_fingerprint != record.fingerprint and not force:
            raise MediaMismatch(
                f"{target.name} is different media from the file record {video_id} was made from"
            )

        _rewrite_snapshot(self._locate(video_id), record.sourcePath, new_path)
        now = _now_iso()
        entry = HistoryEntry(
            field=RELINK_HISTORY_FIELD, prev=_truncate(record.sourcePath), by=by, at=now
        )
        logger.info("Relinked record %s: %s -> %s", video_id, record.sourcePath, new_path)
        return self._persist(record.model_copy(update={
            "sourcePath": new_path,
            "sourceTag": fs.source_tag(new_path),
            "fingerprint": new_fingerprint,
            "missing_media": False,
            "rev": record.rev + 1,
            "updatedAt": now,
            "history": [*record.history, entry][-HISTORY_CAP:],
        }))

    def _owner_of(
        self: "LibraryStore", fingerprint: str, source_path: str, *, excluding: str
    ) -> Optional[str]:
        """The id of another record holding this media (by content or by path)."""
        for other in self._iter_records():
            if other.id == excluding:
                continue
            if other.fingerprint == fingerprint or other.sourcePath == source_path:
                return other.id
        return None

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
        record would be unable to open. Creating the record and storing the
        snapshot are one locked sequence; ``on_created`` is told after it.
        """
        data = read_project_file(path)
        source = data["selectedFilePath"]
        media_fingerprint = self._media_fingerprint(source)
        with self.write_lock:
            record, created = self._create_or_get_locked(source, media_fingerprint)
            stored = self.put_project(record.id, data)
        if created:
            self._announce_created(record)
        return stored, created

    def migrate_studio_workspaces(self: "LibraryStore") -> dict:
        """Adopt every pre-v3 studio workspace whose co-author marker still names
        existing media. Idempotent: a second run matches the same records.

        A failure on one workspace lands in ``skipped`` and the scan continues —
        the only place this module swallows an error, because first launch must
        not be blocked by one stale folder.

        Deliberately **not** ``@writes`` as a whole: its only write is
        ``create_or_get``, which locks itself, and holding the lock across the
        loop would put every ``on_created`` hook (the poster grab) under it.
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


def _require_media_file(path: "PathLike") -> Path:
    """The resolved relink target, or ``MediaNotFound`` (absolute regular file only)."""
    target = Path(path).expanduser()
    if not target.is_absolute():
        raise MediaNotFound(f"Media path must be absolute: {path}")
    if not target.is_file():
        raise MediaNotFound(f"Media file not found: {target}")
    return target.resolve()


def _fingerprint_of(target: Path) -> str:
    try:
        return fs.fingerprint(target)
    except OSError as exc:
        raise MediaNotFound(f"Media file not readable: {target}") from exc


def _names_path(value: str, old: str) -> bool:
    """``value`` is ``old``: byte-equal, or an absolute spelling of it through a
    symlinked parent (``/var/…`` for ``/private/var/…``) — never a substring."""
    if value == old:
        return True
    return os.path.isabs(value) and os.path.realpath(value) == old


def replace_path_strings(value: Any, old: str, new: str) -> Any:
    """A copy of ``value`` with every string that names ``old`` replaced by ``new``.

    Deep over dicts and lists (values, not keys); the input is never mutated.
    """
    if isinstance(value, str):
        return new if _names_path(value, old) else value
    if isinstance(value, dict):
        return {key: replace_path_strings(item, old, new) for key, item in value.items()}
    if isinstance(value, list):
        return [replace_path_strings(item, old, new) for item in value]
    return value


def _rewrite_snapshot(folder: Path, old: str, new: str) -> None:
    """Repoint the stored snapshot: ``projectRestore`` opens the media named in
    ``project.capforge``, not the record, so repointing only ``sourcePath``
    would still open the missing file. Each file is written atomically, and
    only when something changed."""
    for name in RELINK_REWRITTEN_FILES:
        path = folder / name
        if not path.is_file():
            continue
        data = fs.read_json(path)
        rewritten = replace_path_strings(data, old, new)
        if rewritten != data:
            fs.write_json_atomic(path, rewritten)


def has_project_file(folder: Path) -> bool:
    """Whether a record folder holds a session snapshot (derived, never stored)."""
    return (folder / PROJECT_FILE).is_file()
