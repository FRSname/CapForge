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
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, ContextManager, Optional

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from backend.library.brief import Brief, BriefPatch, load_brief, save_brief
from backend.library.collection_store import Collection, effective_brief
from backend.library.errors import CollectionNotFound, CollectionsUnreadable
from backend.library.package import assemble_description, render_youtube_package
from backend.library.paths import record_dir
from backend.library.schemas import RecordPatch, VideoRecord
from backend.library.validate import (
    Violation,
    assembled_violations,
    authored_fields,
    hard_violations,
    unknown_collection_violation,
    validate_fields,
    validate_record,
)
from backend.library.validate_media import (
    candidates_findings,
    cover_findings,
    inherit_thumbnail,
    merge_thumbnail_fields,
)

#: The only package format v3.0 renders; anything else is a 400, never a guess.
YOUTUBE = "youtube"
UNSUPPORTED_PLATFORM = (
    "Unsupported platform {platform!r}; CapForge renders 'youtube' packages"
)
#: The ``detail`` a refused write answers with; the findings ride beside it.
VIOLATION_DETAIL = "{count} rule(s) violated"
BRIEF_UNREADABLE_STATUS = 500
COLLECTIONS_UNREADABLE_STATUS = 500


class ValidateRequest(BaseModel):
    """``{fields?, duration?, video_id?, collection_id?}`` — with a ``video_id``,
    the missing halves are read from the record and its transcript.

    ``collection_id`` is the panel's unsaved choice: a present ``null`` means
    "no collection", and leaving it out uses the record's own.
    """

    model_config = ConfigDict(extra="forbid")

    fields: Optional[dict[str, Any]] = None
    duration: Optional[float] = None
    video_id: Optional[str] = None
    collection_id: Optional[str] = None


def register_publish_routes(
    router: APIRouter,
    *,
    get_store: Callable,
    library_errors: Callable[[], ContextManager[None]],
) -> None:
    """Register ``/brief``, ``/validate`` and ``/{video_id}/package``."""
    _register_brief_routes(router, get_store)
    _register_validate_route(router, get_store, library_errors)
    _register_package_route(router, get_store, library_errors)


# --- shared helpers ----------------------------------------------------------

def read_brief(store: Any) -> Brief:
    """The stored brief. A corrupt file is reported, never quietly replaced."""
    try:
        return load_brief(store.root)
    except ValueError as exc:
        raise HTTPException(status_code=BRIEF_UNREADABLE_STATUS, detail=str(exc)) from exc


def read_collection(store: Any, collection_id: Optional[str]) -> Optional[Collection]:
    """The named collection, or None for no id or an orphan id.

    A corrupt ``collections.json`` is a 500 with the parse message, never "none".
    """
    if collection_id is None:
        return None
    try:
        return store.find_collection(collection_id)
    except CollectionsUnreadable as exc:
        raise HTTPException(
            status_code=COLLECTIONS_UNREADABLE_STATUS, detail=str(exc)
        ) from exc


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


def violation_refusal(
    store: Any, record: VideoRecord, patch: RecordPatch
) -> Optional[JSONResponse]:
    """The 422 for a patch whose *merged* result breaks a hard rule, or None.

    Merged, not patched: a record is refused on the state it would end up in,
    so a violation can never hide behind a write that did not repeat it. An
    unknown ``collection_id`` rides in the same ``violations`` list. A partial
    ``thumbnail`` object is first completed from ``record`` (an omitted key means
    unchanged), so it is never judged against empty defaults.
    """
    completed = inherit_thumbnail(record.thumbnail, patch)
    merged = {**authored_fields(record), **completed.model_dump(exclude_unset=True)}
    found = [
        *hard_violations(merged, duration=record_duration(store, record)),
        *candidates_findings(record.thumbnail.candidates, patch),
        *_collection_findings(store, record, patch),
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
    Part A). Returns the refusal, or ``None`` and the patch to write — its
    thumbnail completed from that fresh read.
    """
    fresh = store.get(current.id)
    completed = inherit_thumbnail(fresh.thumbnail, patch)
    found = [
        *_collection_findings(store, current, patch),
        *candidates_findings(fresh.thumbnail.candidates, patch),
    ]
    if "thumbnail" in patch.model_fields_set:
        found += cover_findings(completed.thumbnail)
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
        return store.get_collection(body.collection_id)
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
        """Merge and store. An unknown field is a 422 from ``extra="forbid"``."""
        store = get_store()
        try:
            return save_brief(store.root, patch).model_dump(mode="json")
        except ValueError as exc:
            raise HTTPException(
                status_code=BRIEF_UNREADABLE_STATUS, detail=str(exc)
            ) from exc


def _register_validate_route(
    router: APIRouter, get_store: Callable, library_errors: Callable
) -> None:

    @router.post("/validate")
    def validate(body: ValidateRequest) -> dict:
        """Run the rules over a draft, a stored record, or a mix of the two."""
        store = get_store()
        fields, duration = body.fields, body.duration
        record: Optional[VideoRecord] = None
        if body.video_id is not None:
            with library_errors():
                record = store.get(body.video_id)
            if fields is None:
                fields = authored_fields(record)
            else:
                fields = merge_thumbnail_fields(record.thumbnail, fields)
            if duration is None:
                duration = record_duration(store, record)
        brief = effective_brief(
            read_brief(store), _requested_collection(store, body, record)
        )
        try:
            found = validate_fields(fields or {}, duration=duration, brief=brief)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"violations": _dump(found)}


def _register_package_route(
    router: APIRouter, get_store: Callable, library_errors: Callable
) -> None:

    @router.get("/{video_id}/package")
    def get_package(video_id: str, platform: str = YOUTUBE) -> dict:
        """The pasteable text plus whatever is still open on the record.

        The package is rendered *even with* violations — the user is mid-edit
        and hiding the text would be worse than showing the findings beside it.
        ``violations`` holds the record's own findings (under the effective
        brief) followed by the assembled description's (``package.description``).
        ``description`` is that assembled DESCRIPTION body on its own (no header,
        no rule lines) — exactly the text those ``package.description`` rules
        measured, so a preview never scrapes it out of ``text``.
        """
        if platform != YOUTUBE:
            raise HTTPException(
                status_code=400,
                detail=UNSUPPORTED_PLATFORM.format(platform=platform),
            )
        store = get_store()
        with library_errors():
            record = store.get(video_id)
        brief = read_brief(store)
        collection = read_collection(store, record.collection_id)
        duration = record_duration(store, record)
        speakers = diarized_speakers(store, record)
        text = render_youtube_package(
            record, brief, duration=duration,
            source_name=Path(record.sourcePath).name,
            diarized_ids=speakers, collection=collection,
            record_folder=record_dir(record.id, scratch=record.scratch, root=store.root).absolute(),
        )
        assembled = assemble_description(
            record, brief, collection=collection, diarized_ids=speakers
        )
        violations = [
            *validate_record(
                record, duration=duration, brief=effective_brief(brief, collection)
            ),
            *assembled_violations(assembled),
        ]
        return {
            "platform": platform,
            "text": text,
            "violations": _dump(violations),
            "description": assembled.body,
        }
