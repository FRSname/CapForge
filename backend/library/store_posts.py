"""What the store derives from posts, mixed into ``LibraryStore`` (at its ceiling).

docs/plans/multi-channel-pr2-contract.md → Derived state, Channels:

* **``publishedOn``** on the list summary: the channels with a visible post that
  has a published URL or id.
* **Search text**: the root title, then every visible post's title,
  description, caption and text; tags, hashtags and the record's keywords.
* **``channel_in_use``**: how many records (scratch included) hold a post for a
  channel, so deleting it can be refused.
* **``recent_posts``**: a channel's latest visible published posts across the
  library, newest ``published.at`` first. Opt-in on ``GET /channels/{id}``.

Hidden posts count for none of these.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Iterable, Optional

from backend.library.platforms import PLATFORM_SPECS
from backend.library.schemas import Post, VideoRecord

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.store import LibraryStore

logger = logging.getLogger(__name__)

#: A recent post's ``text`` is cut to this many characters.
RECENT_POST_TEXT_MAX_CHARS = 500
#: The post fields that are a post's body, in the order they are looked for.
BODY_FIELDS = ("description", "caption", "text")
#: Recent posts with no parseable ``published.at`` sort after every dated one.
_UNDATED = datetime.min.replace(tzinfo=timezone.utc)


def visible_posts(record: VideoRecord) -> dict[str, Post]:
    return {cid: post for cid, post in record.posts.items() if not post.hidden}


def is_published(post: Post) -> bool:
    return bool(post.published.url or post.published.id)


def published_on(record: VideoRecord) -> list[str]:
    """Channel ids with a visible, published post, in the record's post order."""
    return [cid for cid, post in visible_posts(record).items() if is_published(post)]


def body_field(platform: str) -> str:
    """The field a platform's post body lives in (``platforms.py``'s field list)."""
    spec = next(spec for spec in PLATFORM_SPECS if spec.id == platform)
    return next(name for name in spec.fields if name in BODY_FIELDS)


def index_texts(record: VideoRecord) -> tuple[str, str, str]:
    """``(title, body, tags)`` for the search index."""
    posts = list(visible_posts(record).values())
    body = " ".join(
        part for post in posts
        for part in (post.title, post.description, post.caption, post.text) if part
    )
    tags = [*(t for post in posts for t in post.tags),
            *(h for post in posts for h in post.hashtags), *record.keywords]
    return record.title, body, " ".join(tags)


class PostStoreMixin:
    """Post-derived reads for :class:`LibraryStore`."""

    def channel_platforms(self: "LibraryStore") -> dict[str, str]:
        """Channel id → platform, read without bootstrapping ``channels.json``."""
        return {channel.id: channel.platform for channel in self.channel_book_readonly().channels}

    def count_posts_for_channel(self: "LibraryStore", channel_id: str) -> int:
        """Records holding a post (hidden too) for ``channel_id``, scratch included."""
        return sum(1 for record in self._iter_records() if channel_id in record.posts)

    def recent_posts(self: "LibraryStore", channel_id: str, *, limit: int) -> list[dict]:
        """``[{video_id, title, text, hashtags, url, at}]``, newest first, at most ``limit``.

        Raises ``ChannelNotFound`` for an unknown channel. Scratch records are
        agent QA runs, so they are left out.
        """
        field = body_field(self.get_channel(channel_id).platform)
        rows = [
            (_sort_key(record.id, post), _recent_row(record, post, field))
            for record in self._iter_records()
            if not record.scratch
            for post in _published_post(record, channel_id)
        ]
        rows.sort(key=lambda row: row[0], reverse=True)
        return [row for _, row in rows[:limit]]


def _published_post(record: VideoRecord, channel_id: str) -> Iterable[Post]:
    post = record.posts.get(channel_id)
    return (post,) if post is not None and not post.hidden and is_published(post) else ()


def _recent_row(record: VideoRecord, post: Post, field: str) -> dict:
    return {
        "video_id": record.id,
        "title": post.title or record.title,
        "text": getattr(post, field)[:RECENT_POST_TEXT_MAX_CHARS],
        "hashtags": list(post.hashtags),
        "url": post.published.url,
        "at": post.published.at,
    }


def _sort_key(video_id: str, post: Post) -> datetime:
    at: Optional[str] = post.published.at
    if not at:
        return _UNDATED
    try:
        parsed = datetime.fromisoformat(at)
    except ValueError:
        logger.warning("Record %s: published.at %r is not ISO-8601; listed as undated", video_id, at)
        return _UNDATED
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
