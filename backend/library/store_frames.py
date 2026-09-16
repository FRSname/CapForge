"""The only writers of ``thumbnail.candidates`` (publish-editors Part A, decision 1).

Mixed into :class:`~backend.library.store.LibraryStore` (at its size ceiling),
so the call sites stay ``store.add_thumbnail_candidates(...)``. Both methods are
``@writes``: they re-read the record under the store's one write lock, bump
``rev``, stamp ``history`` under ``thumbnail`` and persist — so the Publish soft
lock and any writer still holding the old ``rev`` see the change. ffmpeg and
Pillow never run here: ``frames.grab_frames`` grabs and
``frame_upload.upload_frame`` decodes first, and both append after.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional, Sequence

from backend.library.errors import FrameNotFound
from backend.library.frames import FRAME_NAME_RE, check_room, require_editable
from backend.library.locking import writes
from backend.library.schemas import HISTORY_CAP, Actor, HistoryEntry, Thumbnail, VideoRecord

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.store import LibraryStore

#: The history field both writes are stamped under (the authored field they touch).
THUMBNAIL_FIELD = "thumbnail"


def _with_thumbnail(record: VideoRecord, thumbnail: Thumbnail, by: Actor) -> VideoRecord:
    """A new record carrying ``thumbnail``, one ``rev`` on, with a history entry."""
    from backend.library.store import _now_iso  # local: avoids a cycle

    now = _now_iso()
    entry = HistoryEntry(
        field=THUMBNAIL_FIELD, prev=record.thumbnail.model_dump(), by=by, at=now
    )
    return record.model_copy(update={
        "thumbnail": thumbnail,
        "rev": record.rev + 1,
        "updatedAt": now,
        "history": [*record.history, entry][-HISTORY_CAP:],
    })


class ThumbnailStoreMixin:
    """Candidate append and removal for :class:`LibraryStore`."""

    @writes
    def add_thumbnail_candidates(
        self: "LibraryStore",
        video_id: str,
        names: Sequence[str],
        *,
        by: Actor,
        cover: Optional[str] = None,
    ) -> VideoRecord:
        """Append frame names in order. The limit is checked here, under the
        lock, against the record as it is now — another grab may have landed
        while ffmpeg ran.

        ``cover``, when given, must be one of ``names``; it becomes
        ``thumbnail.cover`` in the same write (one ``rev``, one history entry),
        which is how an uploaded image is the cover the moment it lands.
        """
        malformed = [name for name in names if not FRAME_NAME_RE.match(name)]
        if malformed:
            raise ValueError(f"Not thumbnail frame names: {malformed!r}")
        if cover is not None and cover not in names:
            raise ValueError(f"The cover {cover!r} is not one of the frames being added")
        record = self.get(video_id)
        require_editable(record)
        if not names:
            return record
        stored = record.thumbnail.candidates
        check_room(len(stored), len(names))
        update: dict = {"candidates": [*stored, *names]}
        if cover is not None:
            update["cover"] = cover
        thumbnail = record.thumbnail.model_copy(update=update)
        return self._persist(_with_thumbnail(record, thumbnail, by))

    @writes
    def remove_thumbnail_candidate(
        self: "LibraryStore", video_id: str, name: str, *, by: Actor
    ) -> VideoRecord:
        """Drop one name; a cover that was that frame is cleared with it, on the
        root and on **every** post. Both sides are cleared together, so the
        projection is unchanged and a hidden primary post stays hidden."""
        record = self.get(video_id)
        require_editable(record)
        stored = record.thumbnail.candidates
        if name not in stored:
            raise FrameNotFound(f"Record {video_id} has no thumbnail frame {name!r}")
        cover = record.thumbnail.cover
        thumbnail = record.thumbnail.model_copy(update={
            "candidates": [candidate for candidate in stored if candidate != name],
            "cover": None if cover == name else cover,
        })
        posts = {
            cid: post.model_copy(update={"cover": None}) if post.cover == name else post
            for cid, post in record.posts.items()
        }
        cleared = record.model_copy(update={"posts": posts})
        return self._persist(_with_thumbnail(cleared, thumbnail, by))
