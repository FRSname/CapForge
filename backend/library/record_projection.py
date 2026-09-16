"""The root fields as the primary channel's post (docs/plans/multi-channel-pr2-contract.md).

**Stored** (``record.json``, schema 2), the per-video publish text lives only in
``posts``. **In memory and on the wire**, the projected root fields hold the
primary channel's post, so every reader written before posts (the package, the
validators, ``localized.py``, frames, the renderer, MCP) keeps working, and a
root write is a write to that post. This is the permanent alias for any caller
that does not name a channel, not a shim.

| root (wire)          | post field    |
|----------------------|---------------|
| ``description``      | ``description`` |
| ``short_description``| ``short_description`` |
| ``tags``             | ``tags``      |
| ``hashtags``         | ``hashtags``  |
| ``localized``        | ``localized`` |
| ``thumbnail.cover``  | ``cover``     |
| ``publish.youtube``  | ``published`` (``videoId``→``id``, ``publishedAt``→``at``) |

The one invariant: :func:`project` fills the root from a post and
:func:`unproject` moves the root back into the primary post. ``_load`` projects,
``_persist`` unprojects, and **any write that changes a post directly goes
through** :func:`with_post` / :func:`map_posts`, which fold the root in first and
re-project after, so neither a stale root nor a stale post can win.

``title`` is not projected: the root keeps the library's name, the post has its
own, :func:`bridge_title` copies a root title write into the primary post, and a
channel view (:func:`record_for_channel`) falls back to the root title.

Pure: no I/O. Records are never mutated; every result is a new model.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping, Optional

from backend.library.record_upgrade import CURRENT_SCHEMA, SCHEMA_KEY, upgrade_record
from backend.library.schemas import Post, PostPublished, VideoRecord, YouTubePublish

#: Root field (dotted for a nested key) → the post field it is. Pinned by
#: ``test_library_record_contract.py``.
PROJECTED_FIELDS: frozenset[str] = frozenset({
    "description", "short_description", "tags", "hashtags", "localized",
    "thumbnail.cover", "publish.youtube",
})
#: The root fields that share a name with their post field.
SAME_NAME_FIELDS = ("description", "short_description", "tags", "hashtags", "localized")
#: Root patch field → the post field a root write to it lands on (with
#: ``thumbnail`` / ``publish`` only when the nested key was sent).
ROOT_TO_POST = {
    **{name: name for name in SAME_NAME_FIELDS},
    "thumbnail": "cover",
    "publish": "published",
    "title": "title",
}
#: The post fields the root carries.
CARRIED_POST_FIELDS = (*SAME_NAME_FIELDS, "cover", "published")

PostsFn = Callable[[dict[str, Post]], Mapping[str, Post]]


def project(record: VideoRecord, channel_id: str) -> VideoRecord:
    """``record`` with its projected root fields taken from ``posts[channel_id]``
    (defaults when there is no such post). ``title`` is left alone."""
    post = record.posts.get(channel_id) or Post()
    published = post.published
    return record.model_copy(update={
        **{name: _copied(getattr(post, name)) for name in SAME_NAME_FIELDS},
        "thumbnail": record.thumbnail.model_copy(update={"cover": post.cover}),
        "publish": record.publish.model_copy(update={"youtube": YouTubePublish(
            videoId=published.id, url=published.url, publishedAt=published.at,
        )}),
    })


def unproject(record: VideoRecord, primary_id: str) -> VideoRecord:
    """The root moved into ``posts[primary_id]`` and stripped to defaults.

    The post is created only when a carried value is non-default, or kept when
    it already exists. A root value that differs from the post is a root write,
    and a root write un-hides a hidden primary post.
    """
    carried = _carried(record)
    existing = record.posts.get(primary_id)
    posts = dict(record.posts)
    if existing is None:
        if carried != _carried_defaults():
            posts[primary_id] = Post(**carried)
    else:
        written = any(getattr(existing, name) != value for name, value in carried.items())
        unhide = {"hidden": False} if written and existing.hidden else {}
        posts[primary_id] = existing.model_copy(update={**carried, **unhide})
    return project(record.model_copy(update={"posts": posts}), _NO_CHANNEL)


def with_post(
    record: VideoRecord, channel_id: str, post: Optional[Post], primary_id: str
) -> VideoRecord:
    """``record`` with ``posts[channel_id]`` set (``None`` removes it), re-projected."""

    def replace(posts: dict[str, Post]) -> dict[str, Post]:
        if post is None:
            return {cid: value for cid, value in posts.items() if cid != channel_id}
        return {**posts, channel_id: post}

    return map_posts(record, replace, primary_id)


def map_posts(record: VideoRecord, fn: PostsFn, primary_id: str) -> VideoRecord:
    """Fold the root into the primary post, hand every post to ``fn``, re-project."""
    stored = unproject(record, primary_id)
    return project(stored.model_copy(update={"posts": dict(fn(dict(stored.posts)))}), primary_id)


def bridge_title(record: VideoRecord, primary_id: str) -> VideoRecord:
    """A root ``title`` write, also written to the primary post (created when the
    title is non-empty, un-hidden when hidden)."""

    def bridged(posts: dict[str, Post]) -> dict[str, Post]:
        current = posts.get(primary_id)
        if current is None and not record.title:
            return posts
        base = current or Post()
        return {**posts, primary_id: base.model_copy(update={"title": record.title, "hidden": False})}

    return map_posts(record, bridged, primary_id)


def record_for_channel(record: VideoRecord, channel_id: str) -> VideoRecord:
    """The record as ``channel_id``'s post: projected from that post, with its
    title (the root title when the post's is empty). The root is assumed to be
    the stored primary projection, as every loaded record's is."""
    post = record.posts.get(channel_id) or Post()
    return project(record, channel_id).model_copy(update={"title": post.title or record.title})


# --- storage --------------------------------------------------------------------------

def stored_dict(record: VideoRecord, primary_id: str) -> dict:
    """What ``record.json`` holds: ``posts`` with the root folded in, no projected
    field at the root, ``schema: 2``."""
    data = unproject(record, primary_id).model_dump()
    for name in SAME_NAME_FIELDS:
        data.pop(name)
    data["thumbnail"].pop("cover")
    data["publish"].pop("youtube")
    data[SCHEMA_KEY] = CURRENT_SCHEMA
    return data


def loaded_record(raw: Mapping[str, Any], primary_id: str) -> VideoRecord:
    """A file's dict (any schema) as the in-memory record, projected.

    Raises pydantic's ``ValidationError`` for a malformed file, as before posts.
    """
    record = VideoRecord.model_validate(upgrade_record(raw, primary_id))
    return project(record, primary_id)


# --- helpers ----------------------------------------------------------------------------

#: A channel id no record has: projecting from it writes the defaults.
_NO_CHANNEL = ""


def _carried(record: VideoRecord) -> dict[str, Any]:
    youtube = record.publish.youtube
    return {
        **{name: _copied(getattr(record, name)) for name in SAME_NAME_FIELDS},
        "cover": record.thumbnail.cover,
        "published": PostPublished(id=youtube.videoId, url=youtube.url, at=youtube.publishedAt),
    }


def _carried_defaults() -> dict[str, Any]:
    return {name: _copied(getattr(Post(), name)) for name in CARRIED_POST_FIELDS}


def _copied(value: Any) -> Any:
    """A fresh container, so a root list and a post list are never one object."""
    if isinstance(value, list):
        return list(value)
    if isinstance(value, dict):
        return {key: item.model_copy(deep=True) if hasattr(item, "model_copy") else item
                for key, item in value.items()}
    return value
