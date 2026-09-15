"""Schema 1 → 2: the per-video publish text moves into ``posts[<primary>]``.

docs/plans/multi-channel-pr2-contract.md → Upgrade. Pure: no I/O, the input is
never mutated, and a schema-2 dict comes back unchanged, so upgrading twice is
upgrading once. The store runs this on every read of a file (``_load``); the
file itself is rewritten only by the next write, which first keeps the original
beside it as ``record.v1.json`` (``record_io.backup_v1``).

| schema 1 (root)                                   | schema 2 (``posts[primary]``) |
|---------------------------------------------------|-------------------------------|
| ``description``, ``short_description``, ``tags``, ``hashtags``, ``localized`` | same names, **moved** |
| ``thumbnail.cover``                               | ``cover``, moved              |
| ``publish.youtube`` ``{videoId, url, publishedAt}`` | ``published`` ``{id, url, at}``, moved |
| ``title``                                         | ``title``, **copied** (the root keeps the library name) |

``shorts.caption`` stays at the root untouched. The post is created only when
a moved or copied value is non-default, so an untouched import gets no post.
"""

from __future__ import annotations

import copy
from typing import Any, Mapping

V1_SCHEMA = 1
CURRENT_SCHEMA = 2
SCHEMA_KEY = "schema"
POSTS_KEY = "posts"

#: Root keys whose value moves into the post under the same name.
MOVED_ROOT_FIELDS = ("description", "short_description", "tags", "hashtags", "localized")
TITLE = "title"
THUMBNAIL, COVER = "thumbnail", "cover"
PUBLISH, YOUTUBE, PUBLISHED = "publish", "youtube", "published"
#: ``publish.youtube`` key → ``post.published`` key.
PUBLISHED_KEYS = (("videoId", "id"), ("url", "url"), ("publishedAt", "at"))

#: What a value is when nothing was ever written to it.
_DEFAULT_VALUES: tuple[Any, ...] = (None, "", [], {})


def is_v1(raw: Mapping[str, Any]) -> bool:
    """A file with no ``schema`` key, or ``schema: 1``."""
    return raw.get(SCHEMA_KEY, V1_SCHEMA) in (None, V1_SCHEMA)


def upgrade_record(raw: Mapping[str, Any], primary_id: str) -> dict:
    """``raw`` as a schema-2 dict whose primary post holds the moved fields.

    A dict already on schema 2 (or later) is returned as an unchanged copy.
    Values are not validated here: ``VideoRecord.model_validate`` does that
    after, exactly as it did for the schema-1 file.
    """
    if not is_v1(raw):
        return copy.deepcopy(dict(raw))
    post = _post_from(raw)
    out = {key: copy.deepcopy(value) for key, value in raw.items()
           if key not in MOVED_ROOT_FIELDS}
    thumbnail = raw.get(THUMBNAIL)
    if isinstance(thumbnail, Mapping):
        out[THUMBNAIL] = {k: copy.deepcopy(v) for k, v in thumbnail.items() if k != COVER}
    publish = raw.get(PUBLISH)
    if isinstance(publish, Mapping):
        out[PUBLISH] = {k: copy.deepcopy(v) for k, v in publish.items() if k != YOUTUBE}
    posts = copy.deepcopy(dict(raw.get(POSTS_KEY) or {}))
    if _has_content(post):
        posts[primary_id] = post
    out[POSTS_KEY] = posts
    out[SCHEMA_KEY] = CURRENT_SCHEMA
    return out


def _post_from(raw: Mapping[str, Any]) -> dict:
    """The post the schema-1 root describes; keys only for values it carries."""
    post = {name: copy.deepcopy(raw[name]) for name in MOVED_ROOT_FIELDS if name in raw}
    if TITLE in raw:
        post[TITLE] = raw[TITLE]
    thumbnail = raw.get(THUMBNAIL)
    if isinstance(thumbnail, Mapping) and COVER in thumbnail:
        post[COVER] = thumbnail[COVER]
    publish = raw.get(PUBLISH)
    youtube = publish.get(YOUTUBE) if isinstance(publish, Mapping) else None
    if isinstance(youtube, Mapping):
        post[PUBLISHED] = {new: youtube.get(old) for old, new in PUBLISHED_KEYS}
    return post


def _has_content(post: Mapping[str, Any]) -> bool:
    for name, value in post.items():
        if name == PUBLISHED:
            if any(item not in _DEFAULT_VALUES for item in value.values()):
                return True
        elif value not in _DEFAULT_VALUES:
            return True
    return False
