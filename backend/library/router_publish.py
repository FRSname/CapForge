"""Publish routes: the channel brief, the validators and the upload package.

Split out of ``router.py`` for its size ceiling and registered **before** the
``/{video_id}`` routes, so ``/brief`` and ``/validate`` can never be read as a
record id.

This module is also where ``PATCH /api/library/{id}`` gets its refusal:
:func:`violation_refusal` runs the hard rules over the *merged* authored fields
(the stored record plus the patch) and answers a 422 before anything is written.
A record on disk therefore never carries a title YouTube would reject.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, ContextManager, Optional

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from backend.library.brief import Brief, BriefPatch, load_brief, save_brief
from backend.library.package import render_youtube_package
from backend.library.schemas import RecordPatch, VideoRecord
from backend.library.validate import (
    Violation,
    authored_fields,
    hard_violations,
    validate_fields,
    validate_record,
)

#: The only package format v3.0 renders; anything else is a 400, never a guess.
YOUTUBE = "youtube"
UNSUPPORTED_PLATFORM = (
    "Unsupported platform {platform!r}; CapForge renders 'youtube' packages"
)
#: The ``detail`` a refused write answers with; the findings ride beside it.
VIOLATION_DETAIL = "{count} rule(s) violated"
BRIEF_UNREADABLE_STATUS = 500


class ValidateRequest(BaseModel):
    """``{fields?, duration?, video_id?}`` — with a ``video_id``, the missing
    halves are read from the record and its transcript."""

    model_config = ConfigDict(extra="forbid")

    fields: Optional[dict[str, Any]] = None
    duration: Optional[float] = None
    video_id: Optional[str] = None


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
    so a violation can never hide behind a write that did not repeat it.
    """
    merged = {**authored_fields(record), **patch.model_dump(exclude_unset=True)}
    found = hard_violations(merged, duration=record_duration(store, record))
    if not found:
        return None
    return _violations_response(found)


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
        if body.video_id is not None:
            with library_errors():
                record = store.get(body.video_id)
            if fields is None:
                fields = authored_fields(record)
            if duration is None:
                duration = record_duration(store, record)
        brief = read_brief(store)
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
        duration = record_duration(store, record)
        text = render_youtube_package(
            record, brief, duration=duration,
            source_name=Path(record.sourcePath).name,
            diarized_ids=diarized_speakers(store, record),
        )
        violations = validate_record(record, duration=duration, brief=brief)
        return {"platform": platform, "text": text, "violations": _dump(violations)}
