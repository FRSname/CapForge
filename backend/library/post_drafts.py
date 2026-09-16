""""Start from…": one tab's text as another tab's draft (multi-channel PR 4 Part A).

``POST /{video_id}/posts/{channel_id}/draft?from=<channel>`` renders adapted text
and **never stores it** — no write, no ``rev`` bump, no history entry. The user
edits it or the panel's debounced save lands it, exactly like anything they typed,
and ``POST /validate`` judges it once it does; findings are not returned here.

**The source** is a channel's view of the record (``record_for_channel``), which
supplies what the renderers read: ``title``, ``description``, ``short_description``,
``hashtags``, ``chapters`` and the video URL. A non-YouTube post has none of those
fields, so its body (``caption``/``text``) is mapped onto ``description`` first.

**The target decides the shape:**

* a platform with a post layout (LinkedIn, X, Instagram) is rendered by
  ``platform_posts.render_platform_post``, then split: the trailing hashtag line
  becomes ``hashtags`` and everything above it is the body;
* a platform without one (TikTok) takes the source body as it is, so a tab
  CapForge has no layout for still starts from something;
* YouTube is never packaged — ``description`` is the source body and
  ``short_description`` the source's. ``title`` is never copied: a tab's title is
  its own, and the primary tab's is the library name.

The target's ``profile.default_hashtags`` are kept out of **both** halves:
``validate_posts.pasted_text`` adds them when the post is copied, and a draft
carrying them would paste them twice.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, ContextManager, Optional, Sequence, Union

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from backend.library.channels import Channel, brief_from_channel
from backend.library.collection_store import Collection
from backend.library.platform_posts import PLATFORMS, render_platform_post
from backend.library.platforms import YOUTUBE
from backend.library.publish_channels import (
    NO_POST_DETAIL,
    NO_POST_STATUS,
    REASON_NO_POST,
    require_channel,
)
from backend.library.record_projection import record_for_channel
from backend.library.schemas import Post, VideoRecord
from backend.library.store_posts import body_field

logger = logging.getLogger(__name__)

#: ``from`` is a keyword, so the query parameter is aliased.
FROM_PARAM = "from"
SELF_DRAFT_STATUS = 422
SELF_DRAFT_DETAIL = (
    "A tab cannot start from itself: 'from' names {channel_id!r} too. Pick another "
    "channel's post to start this one from"
)
DESCRIPTION = "description"
SHORT_DESCRIPTION = "short_description"
HASHTAGS = "hashtags"
#: What the platform renderers put between a post's blocks.
BLOCK_SEPARATOR = "\n\n"
HASHTAG_PREFIX = "#"


# --- the draft ---------------------------------------------------------------------

def draft_fields(
    record: VideoRecord,
    target: Channel,
    source: Channel,
    *,
    collection: Optional[Collection],
) -> dict[str, Any]:
    """``target``'s writable body fields plus ``hashtags``, started from ``source``.

    Pure: ``record`` is read, never written, and no store is touched.
    """
    view = source_view(record, source)
    if target.platform == YOUTUBE:
        return {
            DESCRIPTION: view.description,
            SHORT_DESCRIPTION: view.short_description,
            HASHTAGS: _without_defaults(view.hashtags, target),
        }
    field = body_field(target.platform)
    if target.platform not in PLATFORMS:
        return {field: view.description, HASHTAGS: _without_defaults(view.hashtags, target)}
    rendered = render_platform_post(
        view, brief_from_channel(target), target.platform, collection=collection
    )
    body, tags = split_hashtag_line(rendered.text)
    return {field: body, HASHTAGS: _without_defaults(tags, target)}


def source_view(record: VideoRecord, source: Channel) -> VideoRecord:
    """``record`` as ``source``'s post, with a non-YouTube body on ``description``."""
    view = record_for_channel(record, source.id)
    if source.platform == YOUTUBE:
        return view
    post = record.posts.get(source.id) or Post()
    return view.model_copy(update={
        DESCRIPTION: getattr(post, body_field(source.platform)),
        SHORT_DESCRIPTION: "",
    })


def split_hashtag_line(text: str) -> tuple[str, list[str]]:
    """``(body, hashtags)``. A rendered post ends with a hashtag block when it has
    any, so a trailing block of nothing but ``#tags`` is that line."""
    body, separator, tail = text.rpartition(BLOCK_SEPARATOR)
    tokens = tail.split()
    if not separator or not tokens or not all(t.startswith(HASHTAG_PREFIX) for t in tokens):
        return text, []
    return body, [_bare(token) for token in tokens]


def _without_defaults(tags: Sequence[str], target: Channel) -> list[str]:
    """``tags`` bare and deduped, minus the target's own default hashtags — those
    are the channel's boilerplate and are added again when the post is pasted."""
    defaults = {_bare(tag).casefold() for tag in target.profile.default_hashtags}
    kept: list[str] = []
    seen: set[str] = set()
    for raw in tags:
        tag = _bare(raw)
        key = tag.casefold()
        if not tag or key in seen or key in defaults:
            continue
        seen.add(key)
        kept.append(tag)
    return kept


def _bare(tag: str) -> str:
    return tag.strip().lstrip(HASHTAG_PREFIX).strip()


def _no_post_refusal(record: VideoRecord, channel_id: str) -> Optional[JSONResponse]:
    """The same 404 ``no_post`` the package route answers, or None."""
    if channel_id in record.posts:
        return None
    return JSONResponse(status_code=NO_POST_STATUS, content={
        "reason": REASON_NO_POST,
        "detail": NO_POST_DETAIL.format(video_id=record.id, channel_id=channel_id),
    })


# --- the route ---------------------------------------------------------------------

def register_draft_route(
    router: APIRouter,
    *,
    get_store: Callable,
    library_errors: Callable[[], ContextManager[None]],
    read_collection: Callable[[Any, Optional[str]], Optional[Collection]],
) -> None:
    """Register ``POST /{video_id}/posts/{channel_id}/draft``.

    ``read_collection`` is injected rather than imported: ``router_publish``
    registers this route, so importing it back would close a cycle.
    """

    @router.post("/{video_id}/posts/{channel_id}/draft", response_model=None)
    def draft_post(
        video_id: str,
        channel_id: str,
        source_id: str = Query(..., alias=FROM_PARAM),
    ) -> Union[dict, JSONResponse]:
        """``{channel, from, platform, fields}`` — adapted text, stored nowhere.

        404 for an unknown record or channel, 404 ``no_post`` when either side
        has no post (a tab always has one, so both are checked), and 422 when a
        tab is asked to start from itself.
        """
        store = get_store()
        with library_errors():
            record = store.get(video_id)
        target = require_channel(store, channel_id)
        source = require_channel(store, source_id)
        if source_id == channel_id:
            raise HTTPException(
                status_code=SELF_DRAFT_STATUS,
                detail=SELF_DRAFT_DETAIL.format(channel_id=channel_id),
            )
        for channel in (source, target):
            refusal = _no_post_refusal(record, channel.id)
            if refusal is not None:
                return refusal
        fields = draft_fields(
            record, target, source,
            collection=read_collection(store, record.collection_id),
        )
        logger.debug(
            "Drafted a %s post for record %s from channel %s", target.platform, video_id, source_id
        )
        return {
            "channel": channel_id,
            "from": source_id,
            "platform": target.platform,
            "fields": fields,
        }
