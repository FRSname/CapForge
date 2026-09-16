"""The publish routes' channel half (docs/plans/multi-channel-pr2-contract.md).

Kept out of ``router_publish.py`` for its size ceiling, and never imports it:
the route computes the collection, duration and speakers and passes them in.

* **``GET /{id}/package?channel=``** (:func:`channel_package`): a YouTube channel
  renders today's layout from its view of the record (``record_for_channel``)
  and its own brief view; any other platform answers the pasted post
  ``{channel, platform, text, violations, description: null}``. An unknown
  channel is a 404, a channel the video has no post for a 404 ``no_post``.
  Findings on post fields are addressed ``posts.<id>.<field>``.
* **``POST /validate`` with ``channel``** (:func:`channel_validation`): the
  body's ``fields`` are that post's draft, merged over the stored post.
* **The record-wide validate** (:func:`record_wide_post_findings`) adds every
  visible non-primary post's findings; the primary's are the root's.
* **The ``PATCH`` refusal** (:func:`posts_refusal_findings`): unknown channels,
  ambiguous fields and the hard rules of every post the patch writes, judged
  on the record ``apply_patch`` would leave.

``record_duration``, ``diarized_speakers`` and ``language_findings`` moved here
from ``router_publish`` (which re-imports them) so both modules can share them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Mapping, Optional, Sequence, Union

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from backend.library.brief import Brief
from backend.library.channels import Channel, ChannelBook, brief_from_channel
from backend.library.collection_store import Collection, effective_brief
from backend.library.errors import ChannelNotFound
from backend.library.localized import (
    UnknownLanguage,
    draft_record,
    localize_record,
    localized_notes,
    resolve_language,
)
from backend.library.package import assemble_description, render_youtube_package
from backend.library.paths import record_dir
from backend.library.platforms import YOUTUBE
from backend.library.post_merge import merge_post
from backend.library.record_patching import apply_patch
from backend.library.record_projection import record_for_channel, with_post
from backend.library.schemas import PostPatch, RecordPatch, VideoRecord
from backend.library.validate import (
    Violation,
    assembled_violations,
    validate_fields,
    validate_record,
)
from backend.library.validate_localized import view_findings
from backend.library.validate_posts import (
    pasted_text,
    patch_post_findings,
    post_findings,
    readdress_post,
)

REASON_NO_POST = "no_post"
NO_POST_STATUS = 404
CHANNELS_UNREADABLE_STATUS = 500
NO_POST_DETAIL = (
    "Record {video_id} has no post for channel {channel_id!r}; write one with "
    "posts.{channel_id} first"
)
CHANNEL_NEEDS_RECORD = "'channel' judges a video's post for that channel; pass a video_id with it"
BAD_POST_FIELDS = "Not a set of post fields: {error}"
LANG_NEEDS_RECORD = "'lang' validates a record's localized view; pass a video_id with it"
POSTS = "posts"

Speakers = Callable[[], Sequence[str]]


def language_or_404(record: VideoRecord, lang: Optional[str]) -> Optional[str]:
    """The language to localize into (None for the source), or a 404."""
    try:
        return resolve_language(record, lang)
    except UnknownLanguage as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def record_duration(store: Any, record: VideoRecord) -> Optional[float]:
    """The video's length: the record's own value, else the transcript's."""
    if record.duration is not None:
        return record.duration
    transcript = store.get_transcript(record.id, segments_only=True)
    return transcript.get("duration") if transcript else None


def diarized_speakers(store: Any, record: VideoRecord) -> list[str]:
    """Distinct speaker ids in the stored transcript, in order of first appearance."""
    transcript = store.get_transcript(record.id, segments_only=True)
    seen: list[str] = []
    for segment in (transcript or {}).get("segments", []):
        speaker = segment.get("speaker")
        if isinstance(speaker, str) and speaker and speaker not in seen:
            seen.append(speaker)
    return seen


def language_findings(
    record: Optional[VideoRecord], fields: dict, lang: str, *,
    duration: Optional[float], brief: Brief,
) -> list[Violation]:
    """``/validate`` with ``lang``: the draft laid over the record, localized."""
    if record is None:
        raise HTTPException(status_code=422, detail=LANG_NEEDS_RECORD)
    draft = draft_record(record, fields)
    code = language_or_404(draft, lang)
    if code is None:
        return validate_fields(fields, duration=duration, brief=brief,
                               source_language=record.language)
    view = localize_record(draft, code)
    return view_findings(validate_record(view, duration=duration, brief=brief), draft, code)


def require_channel(store: Any, channel_id: str) -> Channel:
    """The channel, a 404 for an unknown id, a 500 for an unreadable file."""
    try:
        return store.get_channel(channel_id)
    except ChannelNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=CHANNELS_UNREADABLE_STATUS, detail=str(exc)) from exc


def youtube_package(
    store: Any,
    record: VideoRecord,
    brief: Brief,
    *,
    lang_code: Optional[str],
    collection: Optional[Collection],
    duration: Optional[float],
    speakers: Speakers,
    readdress_to: Optional[str] = None,
) -> dict:
    """``{platform, text, violations, description}`` for ``record`` (a record or a
    channel's view of one) under ``brief``. ``readdress_to`` moves post-field
    findings under ``posts.<id>``."""
    view = record if lang_code is None else localize_record(record, lang_code)
    effective = effective_brief(brief, collection)
    diarized = speakers()
    text = render_youtube_package(
        view, brief, duration=duration,
        source_name=Path(record.sourcePath).name,
        diarized_ids=diarized, collection=collection,
        record_folder=record_dir(record.id, scratch=record.scratch, root=store.root).absolute(),
        extra_notes=() if lang_code is None else localized_notes(
            record, lang_code, footer=effective.footer
        ),
    )
    assembled = assemble_description(view, brief, collection=collection, diarized_ids=diarized)
    violations = [
        *validate_record(view, duration=duration, brief=effective),
        *assembled_violations(assembled),
    ]
    if lang_code is not None:
        violations = view_findings(violations, record, lang_code)
    if readdress_to is not None:
        violations = readdress_post(readdress_to, violations, keep_others=True)
    return {
        "platform": YOUTUBE,
        "text": text,
        "violations": _dump(violations),
        "description": assembled.body,
    }


def channel_package(
    store: Any,
    record: VideoRecord,
    channel_id: str,
    *,
    lang: Optional[str],
    collection: Optional[Collection],
    duration: Optional[float],
    speakers: Speakers,
) -> Union[dict, JSONResponse]:
    """The package for one channel's post (see the module docstring)."""
    channel = require_channel(store, channel_id)
    if channel_id not in record.posts:
        return JSONResponse(status_code=NO_POST_STATUS, content={
            "reason": REASON_NO_POST,
            "detail": NO_POST_DETAIL.format(video_id=record.id, channel_id=channel_id),
        })
    view = record_for_channel(record, channel_id)
    code = language_or_404(view, lang)
    if channel.platform == YOUTUBE:
        body = youtube_package(
            store, view, brief_from_channel(channel), lang_code=code, collection=collection,
            duration=duration, speakers=speakers, readdress_to=channel_id,
        )
        return {"channel": channel_id, **body}
    found = post_findings(record, channel, collection=collection, duration=duration,
                          with_style=True, lang=code)
    return {
        "channel": channel_id,
        "platform": channel.platform,
        "text": pasted_text(record.posts[channel_id], channel),
        "violations": _dump(found),
        "description": None,
    }


def channel_validation(
    store: Any,
    record: VideoRecord,
    channel_id: str,
    fields: Mapping[str, Any],
    *,
    lang: Optional[str],
    collection: Optional[Collection],
    duration: Optional[float],
) -> list[Violation]:
    """Every finding on ``channel_id``'s post with the draft ``fields`` merged in.

    Raises ``ValueError`` when ``fields`` is not a set of post fields.
    """
    channel = require_channel(store, channel_id)
    try:
        draft = PostPatch.model_validate(dict(fields))
    except ValidationError as exc:
        raise ValueError(BAD_POST_FIELDS.format(error=exc)) from exc
    post = merge_post(record.posts.get(channel_id), draft, platform=channel.platform)
    merged = with_post(record, channel_id, post, store.record_primary_id())
    code = language_or_404(record_for_channel(merged, channel_id), lang)
    return post_findings(merged, channel, collection=collection, duration=duration,
                         with_style=True, lang=code)


def record_wide_post_findings(
    store: Any,
    record: VideoRecord,
    *,
    collection: Optional[Collection],
    duration: Optional[float],
) -> list[Violation]:
    """Findings on every visible post except the primary's (the root's already are)."""
    others = {cid: post for cid, post in record.posts.items() if not post.hidden}
    if not others:
        return []
    book = _book(store)
    found: list[Violation] = []
    for cid in others:
        channel = book.find(cid)
        if channel is None or cid == book.primary_id:
            continue
        found += post_findings(record, channel, collection=collection, duration=duration,
                               with_style=True)
    return found


def posts_refusal_findings(
    store: Any, record: VideoRecord, patch: RecordPatch, completed: RecordPatch
) -> list[Violation]:
    """The hard post findings for a ``PATCH``. ``patch`` is what was sent (for
    ambiguity); ``completed`` has its thumbnail and ``localized`` inherited."""
    if POSTS not in patch.model_fields_set or not patch.posts:
        return []
    book = _book(store)
    platforms = {channel.id: channel.platform for channel in book.channels}
    merged = apply_patch(record, completed, primary_id=book.primary_id, platforms=platforms).record
    return patch_post_findings(merged, patch, book=book, stored_posts=record.posts,
                               collection=None)


def _book(store: Any) -> ChannelBook:
    try:
        return store.channel_book_readonly()
    except ValueError as exc:
        raise HTTPException(status_code=CHANNELS_UNREADABLE_STATUS, detail=str(exc)) from exc


def _dump(found: Sequence[Violation]) -> list[dict]:
    return [violation.model_dump() for violation in found]
