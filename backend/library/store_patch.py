"""``LibraryStore.patch`` — the dossier write, moved out of ``store.py`` (at its ceiling).

The merge itself is ``record_patching.apply_patch`` (pure, and shared with the
``PATCH`` refusal); this mixin adds what only a write has: the scratch and
``If-Match`` checks, ``rev``, ``updatedAt``, ``publishedAt`` and history.

History: one entry per changed root field (named as before posts), then one per
changed channel, ``field: "posts.<id>"``, whose ``prev`` is that post before the
write (``None`` for a new post) with long strings truncated like any ``prev``.
A root write that lands on the primary post is recorded under its root name only.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from backend.library.errors import ScratchReadOnly, StaleRevision
from backend.library.locking import writes
from backend.library.record_patching import apply_patch
from backend.library.schemas import HISTORY_CAP, HistoryEntry, Post, RecordPatch, VideoRecord

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.store import LibraryStore

POST_HISTORY_FIELD = "posts.{channel_id}"


class PatchStoreMixin:
    """``patch``, on :class:`LibraryStore`."""

    @writes
    def patch(
        self: "LibraryStore", video_id: str, patch: RecordPatch, *, rev: int, by: str
    ) -> VideoRecord:
        """Apply the fields the patch set; stamp history; bump rev.

        A root field is replaced whole; ``posts`` merge per channel and field.
        A field sent back with the value it already holds is not an edit (no rev
        bump, no history entry): the debounced writer coalesces an
        insert-then-remove into exactly such a patch.
        """
        from backend.library.store import _now_iso, _truncate  # local: avoids a cycle

        record = self.get(video_id)
        if record.scratch:
            raise ScratchReadOnly(
                f"Record {video_id} is scratch; promote it before editing its dossier"
            )
        if rev != record.rev:
            raise StaleRevision(record)
        platforms = self.channel_platforms() if patch.posts else {}
        outcome = apply_patch(
            record, patch, primary_id=self.record_primary_id(), platforms=platforms
        )
        if not outcome.changed:
            return record

        now = _now_iso()
        previous = record.model_dump()
        entries = [
            HistoryEntry(field=name, prev=_truncate(previous[name]), by=by, at=now)
            for name in outcome.root_changed
        ] + [
            HistoryEntry(field=POST_HISTORY_FIELD.format(channel_id=cid),
                         prev=_post_prev(outcome.previous_posts[cid], _truncate), by=by, at=now)
            for cid in outcome.posts_changed
        ]
        update: dict[str, Any] = {
            "rev": record.rev + 1,
            "updatedAt": now,
            "history": [*record.history, *entries][-HISTORY_CAP:],
        }
        if outcome.published_at:
            update["publishedAt"] = outcome.published_at
        return self._persist(outcome.record.model_copy(update=update))


def _post_prev(post: Optional[Post], truncate: Any) -> Optional[dict]:
    if post is None:
        return None
    return {name: truncate(value) for name, value in post.model_dump().items()}
