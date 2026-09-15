"""The rules for one channel's post (docs/plans/multi-channel-pr2-contract.md → Validation).

Every finding is addressed ``posts.<id>.<field>``. Nothing here restates a
number: the platform limits are ``platforms.py``'s table and YouTube's are
``validate.py``'s, reached by judging the channel's **view** of the record
(``record_for_channel``) with today's rules and re-addressing what they find.

| rule                         | severity          | field                          |
|------------------------------|-------------------|--------------------------------|
| today's YouTube rules        | as today          | ``posts.<id>.<field>``         |
| ``<platform>_max_chars``     | the table's       | ``posts.<id>.caption`` / ``.text`` |
| ``<platform>_hashtags``      | the table's       | ``posts.<id>.hashtags``        |
| ``<platform>_max_mentions``  | the table's       | ``posts.<id>.caption``         |
| ``instagram_caption_url``    | style             | ``posts.<id>.caption``         |
| ``field_not_on_platform``    | hard              | ``posts.<id>.<field>``         |
| ``cover_not_a_candidate``    | hard              | ``posts.<id>.cover``           |
| ``published_at_iso``         | hard              | ``posts.<id>.published.at``    |
| ``unknown_channel``          | hard              | ``posts.<id>``                 |
| ``ambiguous_post_field``     | hard              | ``posts.<primary>.<field>``    |

Non-YouTube limits are measured on the **pasted text**: the body, then a blank
line and the hashtag line (``package.hashtags`` of the channel's default
hashtags and the post's) when there are hashtags. Like every style rule, a
hashtag floor stays quiet until the post has a body.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Mapping, Optional, Sequence

from backend.library.channels import Channel, ChannelBook, brief_from_channel
from backend.library.collection_store import Collection, effective_brief
from backend.library.localized import localize_record
from backend.library.package import hashtags as merged_hashtags
from backend.library.platforms import INSTAGRAM, PLATFORM_SPECS, URL_RE, YOUTUBE, PlatformLimit, count
from backend.library.record_projection import record_for_channel
from backend.library.schemas import Post, RecordPatch, VideoRecord
from backend.library.store_posts import BODY_FIELDS, body_field
from backend.library.validate import validate_record
from backend.library.validate_localized import view_findings
from backend.library.validate_media import COVER_FIELD, cover_findings
from backend.library.violation import Violation, hard, style

POSTS = "posts"
#: Post fields every platform has.
ALWAYS_ALLOWED = ("language", "published", "hidden")
#: Post fields a platform has beyond its table row (the table lists what is metered).
EXTRA_FIELDS: Mapping[str, tuple[str, ...]] = {YOUTUBE: ("short_description",)}
#: The YouTube findings that are about the post (anything else is the record's).
YOUTUBE_POST_FIELDS = ("title", "description", "short_description", "tags", "hashtags", "localized")
COVER = "cover"
PUBLISHED_AT = "published.at"
MENTION_RE = re.compile(r"(?<!\w)@\w+")
PASTE_SEPARATOR = "\n\n"
HASHTAG_SEPARATOR = " "
TEXT_UNITS = ("chars", "bytes", "utf16", "weighted")
UNIT_WORDS = {"chars": "characters", "bytes": "bytes", "utf16": "UTF-16 units",
              "weighted": "weighted characters"}
#: Root patch field → the primary post field a root write to it lands on.
#: ``title`` is not here: a root title names the library, so sending both is fine.
AMBIGUOUS_ROOT_FIELDS = {"description": "description", "short_description": "short_description",
                         "tags": "tags", "hashtags": "hashtags", "localized": "localized"}


def post_field(channel_id: str, field: Optional[str] = None) -> str:
    return f"{POSTS}.{channel_id}" if field is None else f"{POSTS}.{channel_id}.{field}"


def spec_for(platform: str):
    return next(spec for spec in PLATFORM_SPECS if spec.id == platform)


# --- one post ----------------------------------------------------------------------------

def post_findings(
    record: VideoRecord,
    channel: Channel,
    *,
    collection: Optional[Collection],
    duration: Optional[float],
    with_style: bool,
    lang: Optional[str] = None,
) -> list[Violation]:
    """Every finding on ``record.posts[channel.id]`` (an empty post when absent).

    ``lang`` (an already resolved code, None for the source) judges a YouTube
    post's localized view, addressed as ``POST /validate`` addresses one."""
    post = record.posts.get(channel.id) or Post()
    found = [
        *fields_not_on_platform(post, channel.platform, channel.id),
        *readdress_post(channel.id, cover_findings(record.thumbnail.model_copy(update={COVER: post.cover}))),
        *_published_at_findings(post, channel.id),
    ]
    if channel.platform == YOUTUBE:
        brief = effective_brief(brief_from_channel(channel), collection) if with_style else None
        view = record_for_channel(record, channel.id)
        judged = view if lang is None else localize_record(view, lang)
        found_view = validate_record(judged, duration=duration, brief=brief)
        if lang is not None:
            found_view = view_findings(found_view, view, lang)
        found += readdress_post(channel.id, found_view)
    else:
        found += platform_limit_findings(post, channel)
    return found if with_style else [v for v in found if v.severity == "hard"]


def readdress_post(
    channel_id: str, found: Sequence[Violation], *, keep_others: bool = False
) -> list[Violation]:
    """Findings about post fields, moved under ``posts.<id>``. Any other finding
    (chapters, Shorts, title options, the assembled description) is the
    record's: dropped, or kept as addressed with ``keep_others``."""
    moved = []
    for violation in found:
        if violation.field == COVER_FIELD:
            target = COVER
        elif any(violation.field == name or violation.field.startswith(f"{name}.")
                 for name in YOUTUBE_POST_FIELDS):
            target = violation.field
        else:
            if keep_others:
                moved.append(violation)
            continue
        moved.append(Violation(**{**violation.model_dump(), "field": post_field(channel_id, target)}))
    return moved


def pasted_text(post: Post, channel: Channel) -> str:
    """The body, then the hashtag line when there is one."""
    body = getattr(post, body_field(channel.platform))
    tags = merged_hashtags(channel.profile.default_hashtags, post.hashtags)
    return PASTE_SEPARATOR.join(part for part in (body, HASHTAG_SEPARATOR.join(tags)) if part)


def platform_limit_findings(post: Post, channel: Channel) -> list[Violation]:
    """The table's limits for a TikTok, Instagram, LinkedIn or X post."""
    field = body_field(channel.platform)
    body = getattr(post, field)
    text = pasted_text(post, channel)
    tags = merged_hashtags(channel.profile.default_hashtags, post.hashtags)
    found: list[Violation] = []
    for limit in spec_for(channel.platform).limits:
        if limit.unit in TEXT_UNITS and limit.field in BODY_FIELDS:
            found += _text_limit(channel, limit, count(limit.unit, text))
        elif limit.field == "hashtags":
            found += _hashtag_limit(channel, limit, len(tags), has_body=bool(body.strip()))
        elif limit.field == "mentions":
            found += _mention_limit(channel, limit, len(MENTION_RE.findall(text)), field)
    if channel.platform == INSTAGRAM and URL_RE.search(body):
        found.append(style(post_field(channel.id, field), "instagram_caption_url",
                           "Instagram captions don't link; say \"link in bio\" instead of a URL"))
    return found


def fields_not_on_platform(post: Post, platform: str, channel_id: str) -> list[Violation]:
    allowed = {*spec_for(platform).fields, *EXTRA_FIELDS.get(platform, ()), *ALWAYS_ALLOWED}
    default = Post()
    return [
        hard(post_field(channel_id, name), "field_not_on_platform",
             f"A {spec_for(platform).label} post has no {name}; clear it or write it "
             "on a channel that has one")
        for name in Post.model_fields
        if name not in allowed and _filled(getattr(post, name), getattr(default, name))
    ]


# --- a patch ------------------------------------------------------------------------------

def patch_post_findings(
    merged: VideoRecord,
    patch: RecordPatch,
    *,
    book: ChannelBook,
    stored_posts: Mapping[str, Post],
    collection: Optional[Collection],
) -> list[Violation]:
    """The hard findings that refuse a ``PATCH`` carrying ``posts``.

    ``merged`` is the record the patch would leave (``apply_patch``). Every post
    the patch writes is judged, hidden or not.
    """
    if POSTS not in patch.model_fields_set or not patch.posts:
        return []
    found = [*unknown_channel_findings(patch, book, stored_posts),
             *ambiguous_findings(patch, book.primary_id)]
    for cid, value in patch.posts.items():
        channel = book.find(cid)
        if value is not None and channel is not None:
            found += post_findings(merged, channel, collection=collection, duration=None,
                                   with_style=False)
    return found


def unknown_channel_findings(
    patch: RecordPatch, book: ChannelBook, stored_posts: Mapping[str, Post]
) -> list[Violation]:
    """A channel id that names no channel. Removing a stored post is always allowed."""
    return [
        hard(post_field(cid), "unknown_channel",
             f"No channel has the id {cid!r}; create it first (set_channel) or pick one "
             "list_channels names")
        for cid, value in (patch.posts or {}).items()
        if book.find(cid) is None and not (value is None and cid in stored_posts)
    ]


def ambiguous_findings(patch: RecordPatch, primary_id: str) -> list[Violation]:
    """A projected field sent at the root *and* under ``posts.<primary>``."""
    post = (patch.posts or {}).get(primary_id)
    if post is None:
        return []
    return [
        hard(post_field(primary_id, field), "ambiguous_post_field",
             f"{field} was sent both at the root and under posts.{primary_id}; the root "
             f"fields are the primary channel's post, so send it once")
        for field in _root_written_post_fields(patch)
        if field in post.model_fields_set
    ]


# --- helpers ----------------------------------------------------------------------------------

def _root_written_post_fields(patch: RecordPatch) -> list[str]:
    sent = patch.model_fields_set
    fields = [post for root, post in AMBIGUOUS_ROOT_FIELDS.items() if root in sent]
    if "thumbnail" in sent and (patch.thumbnail is None or COVER in patch.thumbnail.model_fields_set):
        fields.append(COVER)
    if "publish" in sent and (patch.publish is None or "youtube" in patch.publish.model_fields_set):
        fields.append("published")
    return fields


def _text_limit(channel: Channel, limit: PlatformLimit, length: int) -> list[Violation]:
    if length <= limit.max:
        return []
    return [Violation(
        field=post_field(channel.id, limit.field), rule=f"{channel.platform}_max_chars",
        severity=limit.severity,
        message=f"The post as pasted is {length} {UNIT_WORDS[limit.unit]}; "
                f"{spec_for(channel.platform).label} allows {limit.max}",
    )]


def _hashtag_limit(channel: Channel, limit: PlatformLimit, tags: int, *, has_body: bool) -> list[Violation]:
    label = spec_for(channel.platform).label
    if tags > limit.max:
        message = f"The post has {tags} hashtags; {label} allows {limit.max}"
    elif limit.min is not None and has_body and tags < limit.min:
        message = f"The post has {tags} hashtag(s); {label} posts do best with {limit.min} to {limit.max}"
    else:
        return []
    return [Violation(field=post_field(channel.id, "hashtags"), rule=f"{channel.platform}_hashtags",
                      severity=limit.severity, message=message)]


def _mention_limit(channel: Channel, limit: PlatformLimit, mentions: int, field: str) -> list[Violation]:
    if mentions <= limit.max:
        return []
    return [Violation(field=post_field(channel.id, field), rule=f"{channel.platform}_max_mentions",
                      severity=limit.severity,
                      message=f"The post mentions {mentions} accounts; "
                              f"{spec_for(channel.platform).label} allows {limit.max}")]


def _published_at_findings(post: Post, channel_id: str) -> list[Violation]:
    at = post.published.at
    if not at:
        return []
    try:
        datetime.fromisoformat(at)
    except ValueError:
        return [hard(post_field(channel_id, PUBLISHED_AT), "published_at_iso",
                     f"published.at must be an ISO-8601 timestamp like 2026-09-01T10:00:00Z, not {at!r}")]
    return []


def _filled(value: Any, default: Any) -> bool:
    return value != default and value not in (None, "", [], {})
