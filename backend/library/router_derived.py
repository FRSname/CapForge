"""Routes over what the backend *derived* from a stored snapshot.

Split out of ``router.py`` for its size ceiling, and kept together because both
routes answer from the same file: ``transcript.json``. The one exception is the
**session proxy** — when the window has the record open, its unsaved transcript
is newer than anything on disk, so the transcript route answers from the live
session instead and says so in ``source``.

``live_session`` is injected exactly like the auth guard: this package must not
import ``backend.main``.
"""

from __future__ import annotations

from typing import Callable, ContextManager, Optional

from fastapi import APIRouter, HTTPException

from backend.engine.moments import find_semantic_moments, find_transcript_moments
from backend.library.transcript import segments_only as strip_word_arrays
from backend.models.schemas import TranscriptionResult

NO_TRANSCRIPT_DETAIL = "Record {id} has no stored transcript yet"
#: The 400 for a moments call that asked for both detectors, or for neither.
MOMENTS_ARG_DETAIL = (
    "Pass exactly one of 'query' (literal text) or 'kind' (a semantic category)"
)

#: ``live_session()`` → ``(active_video_id, current_result)``.
LiveSession = Callable[[], tuple[Optional[str], Optional[TranscriptionResult]]]


def register_derived_routes(
    router: APIRouter,
    *,
    get_store: Callable,
    library_errors: Callable[[], ContextManager[None]],
    live_session: Optional[LiveSession] = None,
) -> None:
    _register_moments_route(router, get_store, library_errors)
    _register_transcript_route(router, get_store, library_errors, live_session)


def _register_moments_route(
    router: APIRouter, get_store: Callable, library_errors: Callable
) -> None:

    @router.get("/{video_id}/moments")
    def get_moments(
        video_id: str, query: Optional[str] = None, kind: Optional[str] = None
    ) -> dict:
        """Find moments in the *stored* transcript — no session required.

        Exactly one of `query` (literal text) or `kind` (a semantic category) —
        the two detectors answer different questions and mixing them would hide
        which one produced a match.
        """
        # Blank is absent: `?query=` is a caller that meant to send nothing.
        wanted_query = query.strip() if query else ""
        wanted_kind = kind.strip() if kind else ""
        if bool(wanted_query) == bool(wanted_kind):
            raise HTTPException(status_code=400, detail=MOMENTS_ARG_DETAIL)
        store = get_store()
        with library_errors():
            # Words are the unit of a moment, so this read is never segments-only.
            transcript = store.get_transcript(video_id, segments_only=False)
        if transcript is None:
            raise HTTPException(
                status_code=404, detail=NO_TRANSCRIPT_DETAIL.format(id=video_id)
            )
        result = TranscriptionResult.model_validate(transcript)
        if wanted_query:
            return {"matches": find_transcript_moments(result, wanted_query)}
        try:
            return {"matches": find_semantic_moments(result, wanted_kind)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


def _register_transcript_route(
    router: APIRouter,
    get_store: Callable,
    library_errors: Callable,
    live_session: Optional[LiveSession],
) -> None:

    @router.get("/{video_id}/transcript")
    def get_transcript(video_id: str, segments_only: bool = True) -> dict:
        """The transcript for a record, from the live session when it is open.

        ``source`` tells the agent which one it read. ``rev`` is always the
        *record's* rev — a session has no rev of its own, and the agent polls
        that number to notice a write.
        """
        store = get_store()
        with library_errors():
            record = store.get(video_id)
            live = _session_transcript(live_session, video_id, segments_only)
            transcript = live if live is not None else store.get_transcript(
                video_id, segments_only=segments_only
            )
        if transcript is None:
            raise HTTPException(
                status_code=404, detail=NO_TRANSCRIPT_DETAIL.format(id=video_id)
            )
        source = "session" if live is not None else "record"
        return {"rev": record.rev, "source": source, "transcript": transcript}


def _session_transcript(
    live_session: Optional[LiveSession], video_id: str, segments_only: bool
) -> Optional[dict]:
    """The open window's transcript when it belongs to ``video_id``, else None."""
    if live_session is None:
        return None
    active_id, result = live_session()
    if active_id != video_id or result is None:
        return None
    dumped = result.model_dump()
    return strip_word_arrays(dumped) if segments_only else dumped
