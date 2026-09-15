"""``LibraryStore`` — the only writer of ``record.json`` and its siblings.

Folders are the truth, the DB is a cache, every durable write is atomic, and a
record is **never mutated in place**: each write builds a new ``VideoRecord``
with ``model_copy(update=...)`` and hands it to :meth:`LibraryStore._persist`,
the single seam that writes the file and re-indexes it.

Every read-modify-write holds the store's one ``write_lock`` (``locking.py``);
the watch-folder thread and the request threads share this store.

See docs/plans/backend-library.md and creator-hub-vision.md §2.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Optional, Sequence, Union
from uuid import uuid4

from backend.library import fs, posters
from backend.library.channel_store import ChannelStoreMixin
from backend.library.collection_store import CollectionStoreMixin
from backend.library.errors import (  # re-exported: callers import them from here
    LibraryError,
    MediaNotFound,
    RecordNotFound,
    ScratchReadOnly,
    StaleRevision,
    UnknownChannel,
)
from backend.library.index import SearchIndex, open_index
from backend.library.locking import writes
from backend.library.paths import (
    INDEX_DB_NAME,
    PROJECT_FILE,
    RECORD_FILE,
    SCRATCH_DIR_NAME,
    THUMBNAILS_DIR,
    TRANSCRIPT_FILE,
    record_dir,
)
from backend.library.record_io import backup_v1
from backend.library.record_projection import loaded_record, project, stored_dict, unproject
from backend.library.record_upgrade import CURRENT_SCHEMA
from backend.library.schemas import (
    HISTORY_PREV_MAX_CHARS,
    Post,
    RenderEntry,
    Status,
    VideoRecord,
    derive_status,
)
from backend.library.store_admin import StoreAdminMixin
from backend.library.store_frames import ThumbnailStoreMixin
from backend.library.store_localized import LocalizedStoreMixin
from backend.library.store_patch import PatchStoreMixin
from backend.library.store_posts import PostStoreMixin, index_texts, published_on
from backend.library.transcript import derive_transcript, plain_text
from backend.library.transcript import segments_only as strip_word_arrays

__all__ = [
    "LibraryStore",
    "LibraryError",
    "MediaNotFound",
    "RecordNotFound",
    "ScratchReadOnly",
    "StaleRevision",
    "SCRATCH_LIFESPAN_DAYS",
]

logger = logging.getLogger(__name__)

#: Scratch records older than this (by ``updatedAt``) are pruned at startup.
SCRATCH_LIFESPAN_DAYS = 14

#: A record id is a ``uuid4().hex``; the lookup refuses anything else before it
#: touches the filesystem, so an id can never double as a path segment.
VIDEO_ID_RE = re.compile(r"^[0-9a-f]{32}$")

#: The list shape — deliberately small; a card needs no dossier body.
SUMMARY_FIELDS = (
    "id", "title", "sourcePath", "duration", "language", "status",
    "collection_id", "scratch", "createdAt", "updatedAt", "missing_media",
)

PathLike = Union[str, os.PathLike]


def _now_iso() -> str:
    """UTC, second precision, ``Z`` suffix — the one timestamp format on disk."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _as_utc(value: str) -> datetime:
    """Parse an ISO-8601 stamp; a naive one is read as UTC rather than rejected."""
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _truncate(value: Any) -> Any:
    """History keeps long strings short (a 5000-byte description is not history)."""
    if isinstance(value, str) and len(value) > HISTORY_PREV_MAX_CHARS:
        return value[:HISTORY_PREV_MAX_CHARS]
    return value


class LibraryStore(
    StoreAdminMixin, CollectionStoreMixin, ChannelStoreMixin, ThumbnailStoreMixin,
    LocalizedStoreMixin, PatchStoreMixin, PostStoreMixin,
):
    """Every record under ``root`` (``$CAPFORGE_HOME/library`` in production).

    Housekeeping (remove/detach/import/migrate) lives in ``store_admin``'s
    mixin, collections in ``collection_store``'s, thumbnail candidates in
    ``store_frames``'s, ``patch`` in ``store_patch``'s and post-derived reads in
    ``store_posts``'s — this file is at its ceiling.

    **Posts** (multi-channel PR 2): the file holds per-channel text in ``posts``
    (schema 2); a loaded record's projected root fields are the primary
    channel's post (``record_projection.py``). ``_load`` upgrades a schema-1 file
    in memory and projects, ``_persist`` unprojects and keeps a schema-1 file as
    ``record.v1.json`` before its first overwrite.
    """

    def __init__(
        self,
        root: PathLike,
        *,
        on_created: Optional[Callable[["LibraryStore", VideoRecord], None]] = None,
    ) -> None:
        self.root = Path(root)
        # Told once per record *minted* (never on a fingerprint hit) — how the
        # poster grab reaches every creation path; a failing observer never
        # fails the write.
        self._on_created = on_created
        # One per store, re-entrant: writers call writers (create_or_get → promote).
        self._write_lock = threading.RLock()
        self._index: Optional[SearchIndex] = None
        # transcript path -> ((mtime_ns, size), has_segments); see _has_segments.
        self._segments_cache: dict[str, tuple[tuple[int, int], bool]] = {}

    @property
    def write_lock(self) -> "threading.RLock":
        """Held by every read-modify-write; see ``backend/library/locking.py``."""
        return self._write_lock

    # --- index ---------------------------------------------------------------

    @property
    def index(self) -> SearchIndex:
        if self._index is None:
            self._index = open_index(self.root / INDEX_DB_NAME)
        return self._index

    def ensure_index(self) -> None:
        """Rebuild when the DB is missing, fresh or on a different schema."""
        if self.index.needs_rebuild():
            self.rebuild_index()

    @writes
    def rebuild_index(self) -> int:
        """Drop the index and refill it from the folders; returns the count."""
        self.index.reset()
        count = 0
        for record in self._iter_records():
            self._index_record(record)
            count += 1
        return count

    def close(self) -> None:
        if self._index is not None:
            self._index.close()
            self._index = None

    def _index_record(self, record: VideoRecord) -> None:
        transcript = self._read_json(record, TRANSCRIPT_FILE) or {}
        title, body, tags_text = index_texts(record)
        self.index.upsert(record.id, title, body, tags_text, plain_text(transcript))

    # --- reading -------------------------------------------------------------

    def _folder(self, video_id: str, *, scratch: bool) -> Path:
        return record_dir(video_id, scratch=scratch, root=self.root)

    def _locate(self, video_id: str) -> Path:
        """The folder holding this record, library first then ``.scratch``."""
        if not VIDEO_ID_RE.match(video_id):
            raise RecordNotFound(f"No library record with id {video_id!r}")
        for scratch in (False, True):
            folder = self._folder(video_id, scratch=scratch)
            if (folder / RECORD_FILE).is_file():
                return folder
        raise RecordNotFound(f"No library record with id {video_id!r}")

    def get(self, video_id: str) -> VideoRecord:
        return self._load(self._locate(video_id) / RECORD_FILE)

    def _load(self, path: Path, primary_id: Optional[str] = None) -> VideoRecord:
        """The file upgraded (in memory only) and projected onto ``primary_id``,
        resolved here when the caller has not already."""
        primary = primary_id if primary_id is not None else self.record_primary_id()
        record = loaded_record(fs.read_json(path), primary)
        # missing_media is derived at read time — the file it describes can
        # disappear between two reads.
        return record.model_copy(
            update={"missing_media": not Path(record.sourcePath).exists()}
        )

    def _iter_records(self) -> Iterator[VideoRecord]:
        """Every record on disk, library folders first, then scratch.

        The primary channel is read once for the whole pass."""
        primary = self.record_primary_id()
        for base in (self.root, self.root / SCRATCH_DIR_NAME):
            if not base.is_dir():
                continue
            for folder in sorted(base.iterdir()):
                if folder.name == SCRATCH_DIR_NAME or not (folder / RECORD_FILE).is_file():
                    continue
                yield self._load(folder / RECORD_FILE, primary)

    def find_by_path(self, path: PathLike) -> Optional[VideoRecord]:
        target = str(Path(path).expanduser().resolve())
        for record in self._iter_records():
            if record.sourcePath == target:
                return record
        return None

    def _find_by_fingerprint(self, value: str) -> Optional[VideoRecord]:
        for record in self._iter_records():
            if record.fingerprint == value:
                return record
        return None

    def list(
        self,
        *,
        status: Optional[str] = None,
        collection: Optional[str] = None,
        q: Optional[str] = None,
        include_scratch: bool = False,
    ) -> list[dict]:
        matched = set(self.index.search(q)) if q and q.strip() else None
        summaries: list[dict] = []
        for record in self._iter_records():
            if record.scratch and not include_scratch:
                continue
            if matched is not None and record.id not in matched:
                continue
            if collection is not None and record.collection_id != collection:
                continue
            record_status = self.status_of(record)
            if status is not None and record_status != status:
                continue
            summaries.append(self._summary(record, record_status))
        return summaries

    def _summary(self, record: VideoRecord, status: str) -> dict:
        dumped = {**record.model_dump(), "status": status}
        summary = {name: dumped[name] for name in SUMMARY_FIELDS}
        return {  # all derived at read time, never stored
            **summary,
            "hasProject": self.has_project(record),
            "poster": self.has_poster(record),
            "cover": self.cover_of(record),
            "publishedOn": published_on(record),
        }

    def has_poster(self, record: VideoRecord) -> bool:
        """A ``poster.jpg`` sits in the record folder (``posters.py`` grabs it)."""
        return posters.has_poster(self._folder(record.id, scratch=record.scratch))

    def cover_of(self, record: VideoRecord) -> Optional[str]:
        """The cover frame's name when its file is in the record folder, else None.

        The list is a summary without ``thumbnail``, so the card reads this; a
        cover whose file is gone draws the poster rather than a broken image."""
        cover = record.thumbnail.cover
        if not cover:
            return None
        folder = self._folder(record.id, scratch=record.scratch)
        return cover if (folder / THUMBNAILS_DIR / cover).is_file() else None

    # --- writing -------------------------------------------------------------

    def _persist(self, record: VideoRecord) -> VideoRecord:
        """The ONE record write: atomic file, then index.

        Returns the record as a read would: the root folded into the primary
        post and projected back, so ``posts`` and the root agree."""
        primary = self.record_primary_id()
        synced = project(unproject(record, primary), primary).model_copy(
            update={"schema": CURRENT_SCHEMA}
        )
        path = self._folder(record.id, scratch=record.scratch) / RECORD_FILE
        backup_v1(path)
        fs.write_json_atomic(path, stored_dict(synced, primary))
        self._index_record(synced)
        return synced

    def create(
        self, source_path: PathLike, *, scratch: bool = False, channels: Sequence[str] = ()
    ) -> VideoRecord:
        return self.create_or_get(source_path, scratch=scratch, channels=channels)[0]

    def create_or_get(
        self, source_path: PathLike, *, scratch: bool = False, channels: Sequence[str] = ()
    ) -> tuple[VideoRecord, bool]:
        """Create a record, or return the one already holding this media.

        The bool is True only when a record was minted — the route answers 201
        for that and 200 for a hit. A scratch request on a known real record
        returns the real one; a real request on a known scratch record promotes
        it (§2.3). The media is read before the lock and ``on_created`` is told
        after it is released. ``channels`` gives a *minted* record an empty post
        per id; an unknown id raises ``UnknownChannel`` before anything is written.
        """
        media_fingerprint = self._media_fingerprint(source_path)
        with self._write_lock:
            record, minted = self._create_or_get_locked(
                source_path, media_fingerprint, scratch=scratch, channels=channels
            )
        if minted:
            self._announce_created(record)
        return record, minted

    def _media_fingerprint(self, source_path: PathLike) -> str:
        try:
            return fs.fingerprint(source_path)
        except OSError as exc:
            raise MediaNotFound(f"Media file not found: {source_path}") from exc

    def _create_or_get_locked(
        self,
        source_path: PathLike,
        media_fingerprint: str,
        *,
        scratch: bool = False,
        channels: Sequence[str] = (),
    ) -> tuple[VideoRecord, bool]:
        """``create_or_get``'s body; the caller holds the lock and announces."""
        wanted = list(dict.fromkeys(channels))
        unknown = [cid for cid in wanted if cid not in self.channel_platforms()] if wanted else []
        if unknown:
            raise UnknownChannel(unknown)
        existing = self._find_by_fingerprint(media_fingerprint)
        if existing is not None:
            if existing.scratch and not scratch:
                return self.promote(existing.id), False
            return existing, False

        now = _now_iso()
        record = VideoRecord(
            id=uuid4().hex,
            rev=1,
            fingerprint=media_fingerprint,
            sourceTag=fs.source_tag(source_path),
            sourcePath=str(Path(source_path).expanduser().resolve()),
            createdAt=now,
            updatedAt=now,
            scratch=scratch,
            posts={cid: Post() for cid in wanted},
        )
        return self._persist(record), True

    def _announce_created(self, record: VideoRecord) -> None:
        if self._on_created is None:
            return
        try:
            self._on_created(self, record)
        except Exception:
            logger.warning("on_created hook failed for record %s", record.id, exc_info=True)

    @writes
    def promote(self, video_id: str) -> VideoRecord:
        """Move ``.scratch/<id>`` into the library and clear the flag."""
        record = self.get(video_id)
        if not record.scratch:
            return record
        source = self._folder(video_id, scratch=True)
        target = self._folder(video_id, scratch=False)
        if target.exists():
            raise LibraryError(f"Cannot promote {video_id}: {target} already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        fs.replace_with_retry(source, target)
        promoted = record.model_copy(
            update={"scratch": False, "rev": record.rev + 1, "updatedAt": _now_iso()}
        )
        return self._persist(promoted)

    @writes
    def add_render(self, video_id: str, entry: RenderEntry) -> VideoRecord:
        """Append a produced output — this is what "captioned" is derived from."""
        record = self.get(video_id)
        return self._persist(record.model_copy(update={
            "renders": [*record.renders, entry],
            "rev": record.rev + 1,
            "updatedAt": _now_iso(),
        }))

    # --- project + transcript ------------------------------------------------

    @writes
    def put_project(self, video_id: str, project: dict) -> VideoRecord:
        """Store the renderer's session snapshot and derive ``transcript.json``.

        The derivation runs **before** either write, so a malformed project
        leaves the previous pair untouched; its ``ValueError`` propagates.
        """
        record = self.get(video_id)
        transcript = derive_transcript(project)
        folder = self._locate(video_id)
        fs.write_json_atomic(folder / PROJECT_FILE, project)
        fs.write_json_atomic(folder / TRANSCRIPT_FILE, transcript)

        duration = transcript.get("duration")
        language = transcript.get("language")
        return self._persist(record.model_copy(update={
            "rev": record.rev + 1,
            "updatedAt": _now_iso(),
            "duration": record.duration if duration is None else duration,
            "language": language or record.language,
        }))

    def _read_json(self, record: VideoRecord, name: str) -> Optional[dict]:
        path = self._folder(record.id, scratch=record.scratch) / name
        return fs.read_json(path) if path.is_file() else None

    def get_transcript(self, video_id: str, *, segments_only: bool = True) -> Optional[dict]:
        """The derived transcript, or None when no project was PUT yet."""
        transcript = self._read_json(self.get(video_id), TRANSCRIPT_FILE)
        if transcript is None:
            return None
        # The parameter keeps the plan's name, so the import is aliased.
        return strip_word_arrays(transcript) if segments_only else transcript

    def get_project(self, video_id: str) -> Optional[dict]:
        return self._read_json(self.get(video_id), PROJECT_FILE)

    # --- derived state / housekeeping ---------------------------------------

    def status_of(self, record: VideoRecord) -> Status:
        return derive_status(
            record, has_segments=self._has_segments(record), posts=record.posts
        )

    def _has_segments(self, record: VideoRecord) -> bool:
        """Whether the stored transcript holds any segment, cached by mtime+size.

        ``list`` asks this for every record and a 60-minute transcript is ~3 MB
        of JSON, so re-parsing all of them on every request would make the
        library screen scale with total transcript size rather than record count.
        """
        path = self._folder(record.id, scratch=record.scratch) / TRANSCRIPT_FILE
        if not path.is_file():
            return False
        stat = path.stat()
        key = (stat.st_mtime_ns, stat.st_size)
        cached = self._segments_cache.get(str(path))
        if cached is not None and cached[0] == key:
            return cached[1]
        has_segments = bool((fs.read_json(path) or {}).get("segments"))
        self._segments_cache = {**self._segments_cache, str(path): (key, has_segments)}
        return has_segments

    @writes
    def prune_scratch(self, *, max_age_days: int = SCRATCH_LIFESPAN_DAYS) -> int:
        """Drop scratch records untouched for ``max_age_days``; returns the count."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        removed = 0
        for record in self._iter_records():
            if not record.scratch:
                continue
            if _as_utc(record.updatedAt or record.createdAt) >= cutoff:
                continue
            shutil.rmtree(self._folder(record.id, scratch=True))
            self.index.delete(record.id)
            removed += 1
            logger.info("Pruned scratch record %s", record.id)
        return removed
