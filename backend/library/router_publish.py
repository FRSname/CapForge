"""Publish routes: the channel brief, the validators and the upload package.

Split out of ``router.py`` for its size ceiling and registered **before** the
``/{video_id}`` routes, so ``/brief`` and ``/validate`` can never be read as a
record id.

This module is also where ``PATCH /api/library/{id}`` gets its refusal:
:func:`violation_refusal` runs the hard rules over the *merged* authored fields
(the stored record plus the patch), and refuses a ``collection_id`` that names
no collection, answering a 422 before anything is written. A record on disk
therefore never carries a title YouTube would reject.

Collections (docs/plans/library-collections.md): the package and the validators
use the **effective** brief — the channel brief under the record's collection.
A record whose ``collection_id`` names no collection (an orphan) simply renders
with the channel brief.

Channels (docs/plans/multi-channel-pr1-contract.md): the channel brief is now
the **primary channel's brief view** (``channels.brief_from_channel``), so
:func:`read_brief` is the one seam every brief reader goes through, and
``PATCH /brief`` writes to the primary channel. ``brief.json`` is only the
bootstrap source; see ``channels.py`` for the accepted ``{{channel}}`` delta.

Posts (docs/plans/multi-channel-pr2-contract.md): the ``PATCH`` refusal also
covers ``posts``, and ``/validate`` and the package take ``channel``; that glue,
and the helpers it shares with this module, are ``publish_channels.py``.
"""

from __future__ import annotations

from typing import Any, Callable, ContextManager, Optional, Union

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from backend.library.brief import Brief, BriefPatch
from backend.library.channels import brief_from_channel, channel_patch_from_brief
from backend.library.collection_store import Collection, effective_brief
from backend.library.errors import CollectionNotFound, CollectionsUnreadable
from backend.library.localized import inherit_localized, merge_localized_fields
from backend.library.post_drafts import register_draft_route
from backend.library.publish_channels import (  # the first three are re-exported
    diarized_speakers,
    language_or_404,
    record_duration,
    CHANNEL_NEEDS_RECORD,
    channel_package,
    channel_validation,
    language_findings,
    posts_refusal_findings,
    record_wide_post_findings,
    youtube_package,
)
from backend.library.schemas import RecordPatch, VideoRecord
from backend.library.validate import (
    Violation,
    authored_fields,
    hard_violations,
    unknown_collection_violation,
    validate_fields,
)
from backend.library.validate_media import (
    candidates_findings,
    cover_findings,
    inherit_thumbnail,
    merge_thumbnail_fields,
)

#: The ``detail`` a refused write answers with; the findings ride beside it.
VIOLATION_DETAIL = "{count} rule(s) violated"
BRIEF_UNREADABLE_STATUS = 500
COLLECTIONS_UNREADABLE_STATUS = 500


class ValidateRequest(BaseModel):
    """``{fields?, duration?, video_id?, collection_id?}`` — with a ``video_id``,
    the missing halves are read from the record and its transcript.

    ``collection_id`` is the panel's unsaved choice: a present ``null`` means
    "no collection", and leaving it out uses the record's own. ``lang`` judges
    that language's localized view (Part B, decision 5) and needs a ``video_id``.
    """

    model_config = ConfigDict(extra="forbid")

    fields: Optional[dict[str, Any]] = None
    duration: Optional[float] = None
    video_id: Optional[str] = None
    collection_id: Optional[str] = None
    lang: Optional[str] = None
    #: Judge this channel's post; ``fields`` are then that post's draft fields.
    channel: Optional[str] = None


def register_publish_routes(
    router: APIRouter,
    *,
    get_store: Callable,
    library_errors: Callable[[], ContextManager[None]],
) -> None:
    """Register ``/brief``, ``/validate``, ``/{video_id}/package`` and the
    ``/{video_id}/posts/{channel_id}/draft`` renderer (PR 4 Part A)."""
    _register_brief_routes(router, get_store)
    _register_validate_route(router, get_store, library_errors)
    _register_package_route(router, get_store, library_errors)
    register_draft_route(
        router, get_store=get_store, library_errors=library_errors,
        read_collection=read_collection,
    )


# --- shared helpers ----------------------------------------------------------

def read_brief(store: Any) -> Brief:
    """The primary channel's brief view.

    A corrupt ``channels.json``, or a corrupt ``brief.json`` met by the first
    bootstrap, is reported (500), never quietly replaced.
    """
    try:
        return brief_from_channel(store.primary_channel())
    except ValueError as exc:
        raise HTTPException(status_code=BRIEF_UNREADABLE_STATUS, detail=str(exc)) from exc


def read_collection(store: Any, collection_id: Optional[str]) -> Optional[Collection]:
    """The named collection resolved through its ancestors, or None for no id or
    an orphan id.

    Every brief reader (the package, the validators, platform drafts) gets its
    collection here, so a nested collection always arrives with its parents'
    slots and overrides folded in (``resolved_collection``); a top-level one is
    itself. A corrupt ``collections.json`` is a 500 with the parse message,
    never "none".
    """
    if collection_id is None:
        return None
    try:
        return store.resolve_collection(collection_id)
    except CollectionsUnreadable as exc:
        raise HTTPException(
            status_code=COLLECTIONS_UNREADABLE_STATUS, detail=str(exc)
        ) from exc


def violation_refusal(
    store: Any, record: VideoRecord, patch: RecordPatch
) -> Optional[JSONResponse]:
    """The 422 for a patch whose *merged* result breaks a hard rule, or None.

    Merged, not patched: a record is refused on the state it would end up in,
    so a violation can never hide behind a write that did not repeat it. An
    unknown ``collection_id`` rides in the same ``violations`` list. A partial
    ``thumbnail`` object is first completed from ``record`` (an omitted key means
    unchanged), so it is never judged against empty defaults, and ``localized``
    is merged per language, so one language is never judged as the whole dict.
    """
    completed = inherit_localized(record.localized, inherit_thumbnail(record.thumbnail, patch))
    merged = {**authored_fields(record), **completed.model_dump(exclude_unset=True)}
    found = [
        *hard_violations(
            merged, duration=record_duration(store, record), source_language=record.language
        ),
        *candidates_findings(record.thumbnail.candidates, patch),
        *_collection_findings(store, record, patch),
        *posts_refusal_findings(store, record, patch, completed),
    ]
    if not found:
        return None
    return _violations_response(found)


def locked_refusal(
    store: Any, current: VideoRecord, patch: RecordPatch
) -> tuple[Optional[JSONResponse], RecordPatch]:
    """The checks the PATCH route repeats under the store's write lock.

    The record is re-read here, so a frame grabbed or deleted after
    :func:`violation_refusal` is what a partial ``thumbnail`` inherits and what
    ``candidates_managed`` and ``cover_not_a_candidate`` judge (publish-editors
    Part A), and a ``localized`` patch merges over the languages stored now and
    is judged merged (Part B). Returns the refusal, or ``None`` and the patch to
    write — its thumbnail and ``localized`` completed from that fresh read.
    """
    fresh = store.get(current.id)
    completed = inherit_localized(fresh.localized, inherit_thumbnail(fresh.thumbnail, patch))
    found = [
        *_collection_findings(store, current, patch),
        *candidates_findings(fresh.thumbnail.candidates, patch),
    ]
    if "thumbnail" in patch.model_fields_set:
        found += cover_findings(completed.thumbnail)
    if "localized" in patch.model_fields_set:
        found += hard_violations({"localized": completed.localized}, duration=None,
                                 source_language=fresh.language)
    found += posts_refusal_findings(store, fresh, patch, completed)
    return (_violations_response(found) if found else None), completed


def _collection_findings(
    store: Any, record: VideoRecord, patch: RecordPatch
) -> list[Violation]:
    """Joining a collection that does not exist. ``null`` is always allowed, and
    re-sending the id the record already holds is a no-op, not a join."""
    if "collection_id" not in patch.model_fields_set:
        return []
    wanted = patch.collection_id
    if wanted is None or wanted == record.collection_id:
        return []
    if read_collection(store, wanted) is not None:
        return []
    return [unknown_collection_violation(wanted)]


def _violations_response(found: list[Violation]) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder({
            "detail": VIOLATION_DETAIL.format(count=len(found)),
            "violations": _dump(found),
        }),
    )


def _dump(found: list[Violation]) -> list[dict]:
    return [violation.model_dump() for violation in found]


def _requested_collection(
    store: Any, body: ValidateRequest, record: Optional[VideoRecord]
) -> Optional[Collection]:
    """The collection a validation runs under: the body's, else the record's.

    A ``collection_id`` the body names explicitly must exist (404); the record's
    own may be an orphan, which is simply no collection.
    """
    if "collection_id" not in body.model_fields_set:
        return read_collection(store, record.collection_id if record else None)
    if body.collection_id is None:
        return None
    try:
        store.get_collection(body.collection_id)  # an explicit unknown id is a 404
        return store.resolve_collection(body.collection_id)
    except CollectionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CollectionsUnreadable as exc:
        raise HTTPException(
            status_code=COLLECTIONS_UNREADABLE_STATUS, detail=str(exc)
        ) from exc


# --- routes ------------------------------------------------------------------

def _register_brief_routes(router: APIRouter, get_store: Callable) -> None:
    """The channel brief — one small file, so no ``If-Match`` (plan §Contracts)."""

    @router.get("/brief")
    def get_brief() -> dict:
        return read_brief(get_store()).model_dump(mode="json")

    @router.patch("/brief")
    def patch_brief(patch: BriefPatch) -> dict:
        """Merge into the primary channel and answer its brief view.

        An unknown field is a 422 from ``extra="forbid"``, and so is a field
        sent as ``null``; an unreadable channels or brief file is a 500.
        """
        store = get_store()
        try:
            channel_patch = channel_patch_from_brief(patch)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        try:
            return brief_from_channel(store.patch_primary_channel(channel_patch)).model_dump(mode="json")
        except ValueError as exc:
            raise HTTPException(
                status_code=BRIEF_UNREADABLE_STATUS, detail=str(exc)
            ) from exc


def _register_validate_route(
    router: APIRouter, get_store: Callable, library_errors: Callable
) -> None:

    @router.post("/validate")
    def validate(body: ValidateRequest) -> dict:
        """Run the rules over a draft, a stored record, or a mix of the two.

        With ``channel`` the answer is that channel's post (``_channel_findings``).
        A stored record judged whole (a ``video_id``, no ``fields``, no ``lang``)
        is followed by its visible non-primary posts' findings.
        """
        store = get_store()
        if body.channel is not None:
            return {"violations": _dump(_channel_findings(store, body, library_errors))}
        fields, duration = body.fields, body.duration
        record: Optional[VideoRecord] = None
        if body.video_id is not None:
            with library_errors():
                record = store.get(body.video_id)
            if fields is None:
                fields = authored_fields(record)
            else:
                fields = merge_localized_fields(
                    record.localized, merge_thumbnail_fields(record.thumbnail, fields)
                )
            if duration is None:
                duration = record_duration(store, record)
        collection = _requested_collection(store, body, record)
        brief = effective_brief(read_brief(store), collection)
        source = record.language if record is not None else None
        try:
            if body.lang is not None:
                found = language_findings(
                    record, fields or {}, body.lang, duration=duration, brief=brief
                )
            else:
                found = validate_fields(
                    fields or {}, duration=duration, brief=brief, source_language=source
                )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if record is not None and body.fields is None and body.lang is None:
            found += record_wide_post_findings(
                store, record, collection=collection, duration=duration
            )
        return {"violations": _dump(found)}


def _channel_findings(
    store: Any, body: ValidateRequest, library_errors: Callable
) -> list[Violation]:
    """``/validate`` with ``channel``: the post draft laid over the stored post."""
    if body.video_id is None:
        raise HTTPException(status_code=422, detail=CHANNEL_NEEDS_RECORD)
    with library_errors():
        record = store.get(body.video_id)
    duration = body.duration if body.duration is not None else record_duration(store, record)
    try:
        return channel_validation(
            store, record, body.channel, body.fields or {}, lang=body.lang,
            collection=_requested_collection(store, body, record), duration=duration,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _register_package_route(
    router: APIRouter, get_store: Callable, library_errors: Callable
) -> None:

    @router.get("/{video_id}/package", response_model=None)
    def get_package(
        video_id: str,
        lang: Optional[str] = None,
        channel: Optional[str] = None,
    ) -> Union[dict, JSONResponse]:
        """The pasteable text plus whatever is still open on the record.

        Rendered *even with* violations (the user is mid-edit): the record's own
        findings under the effective brief, then ``package.description``'s, and
        ``description`` is the assembled DESCRIPTION body those rules measured.
        ``lang`` renders the localized view (an unknown one is a 404).
        ``channel`` renders that channel's post
        (``publish_channels.channel_package``); without it this is the primary
        channel's package.

        There is no ``platform`` any more (PR 4 Part B): a tab's text is its own
        post, and ``…/posts/{channel_id}/draft`` starts one from another tab.
        """
        store = get_store()
        with library_errors():
            record = store.get(video_id)

        def speakers() -> list[str]:
            return diarized_speakers(store, record)
        if channel is not None:
            return channel_package(
                store, record, channel, lang=lang, speakers=speakers,
                collection=read_collection(store, record.collection_id),
                duration=record_duration(store, record),
            )
        code = language_or_404(record, lang)
        return youtube_package(
            store, record, read_brief(store), lang_code=code,
            collection=read_collection(store, record.collection_id),
            duration=record_duration(store, record), speakers=speakers,
        )
