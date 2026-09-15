"""What a ``RecordPatch`` makes of a record, before ``rev`` and history. Pure.

Shared by ``LibraryStore.patch`` (which stamps history and persists it) and the
``PATCH`` refusal (which judges the posts a patch would leave), so the two can
never disagree about the merged result.

Order, and why: the root fields apply first (a root ``title`` is bridged into
the primary post), the root is folded into the primary post, the ``posts`` patch
merges over that, and the result is re-projected. So ``{description, posts:
{<primary>: {tags}}}`` keeps both, and a root ``title`` sent beside
``posts.<primary>.title`` names the library while the post keeps its own. A
projected field sent both ways is refused before this runs
(``ambiguous_post_field``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Mapping, Optional

from backend.library.post_merge import merge_posts
from backend.library.record_projection import bridge_title, map_posts, unproject
from backend.library.schemas import Post, RecordPatch, VideoRecord

logger = logging.getLogger(__name__)

POSTS = "posts"
#: Every patchable field that is not ``posts``, compared and replaced whole.
ROOT_PATCH_FIELDS = tuple(name for name in RecordPatch.model_fields if name != POSTS)


@dataclass(frozen=True)
class PatchOutcome:
    """The merged record, what changed, and the ``publishedAt`` to stamp (or None)."""

    record: VideoRecord
    root_changed: tuple[str, ...] = ()
    posts_changed: tuple[str, ...] = ()
    previous_posts: Mapping[str, Optional[Post]] = field(default_factory=dict)
    published_at: Optional[str] = None

    @property
    def changed(self) -> bool:
        return bool(self.root_changed or self.posts_changed)


def apply_patch(
    record: VideoRecord,
    patch: RecordPatch,
    *,
    primary_id: str,
    platforms: Mapping[str, str],
) -> PatchOutcome:
    """``record`` (a loaded, projected record) with ``patch`` applied.

    ``platforms`` maps channel ids to platforms, for the YouTube id derivation.
    A field or post sent with the value it already holds is not a change.
    """
    previous, sent = record.model_dump(), patch.model_dump()
    root_changed = tuple(
        name for name in ROOT_PATCH_FIELDS
        if name in patch.model_fields_set and sent[name] != previous[name]
    )
    candidate = record.model_copy(update={name: getattr(patch, name) for name in root_changed})
    if "title" in root_changed:
        candidate = bridge_title(candidate, primary_id)
    base_posts = unproject(candidate, primary_id).posts
    wanted = patch.posts if POSTS in patch.model_fields_set and patch.posts else {}
    merged = map_posts(
        candidate, lambda posts: merge_posts(posts, wanted, platforms=platforms), primary_id
    )
    posts_changed = tuple(
        cid for cid in wanted if _dump(merged.posts.get(cid)) != _dump(base_posts.get(cid))
    )
    return PatchOutcome(
        record=merged,
        root_changed=root_changed,
        posts_changed=posts_changed,
        previous_posts={cid: base_posts.get(cid) for cid in posts_changed},
        published_at=_published_at(patch, merged, posts_changed),
    )


def earliest_published_at(posts: Mapping[str, Post]) -> Optional[str]:
    """The earliest ``published.at`` over visible posts, as written.

    A stamp that is not ISO-8601 (one a pre-posts root write let through) is
    logged and left out; a ``posts`` write refuses one (``validate_posts``).
    """
    stamps: list[tuple[datetime, str]] = []
    for cid, post in posts.items():
        at = post.published.at
        if post.hidden or not at:
            continue
        try:
            stamps.append((_as_utc(at), at))
        except ValueError:
            logger.warning("Post %s has a published.at that is not ISO-8601: %r", cid, at)
    return min(stamps)[1] if stamps else None


def _published_at(patch: RecordPatch, merged: VideoRecord, posts_changed: tuple[str, ...]) -> Optional[str]:
    if posts_changed:
        earliest = earliest_published_at(merged.posts)
        if earliest is not None:
            return earliest
    if patch.publish is not None and patch.publish.youtube.publishedAt:
        return patch.publish.youtube.publishedAt  # the pre-posts rule
    return None


def _as_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _dump(post: Optional[Post]) -> Optional[dict]:
    return None if post is None else post.model_dump()
