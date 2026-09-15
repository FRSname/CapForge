"""Thumbnail frame routes: grab frames into a record, delete one (publish-editors Part A).

Split out of ``router.py`` for its size ceiling. Like the other route modules it
imports nothing back from ``router``: ``get_store``, the error mapping, the actor
guard and ``on_record_changed`` are passed in by ``build_router``.

* ``POST /{video_id}/frames {times}`` → ``200 {frames: [{time_s, name}],
  failed: [{time_s, reason}], rev}``; 404 unknown record, 409 scratch, 422 bad
  times or no room (``detail`` is a sentence).
* ``DELETE /{video_id}/frames/{name}`` → ``200 {rev}``; 404 unknown record or name.

ffmpeg runs in the threadpool (``frames.grab_frames`` never holds the store's
write lock while it does), and a write is announced through ``on_record_changed``
so the open Publish panel adopts the new ``rev``.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Awaitable, Callable, ContextManager, Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from starlette import status as http_status
from starlette.concurrency import run_in_threadpool

from backend.library import frames
from backend.library.errors import FrameNotFound, FramesRefused
from backend.library.schemas import VideoRecord

RecordChanged = Callable[[str, int, str], Awaitable[None]]


class FramesRequest(BaseModel):
    """``{times}`` — seconds; the count and the values are checked in ``frames``
    so a refusal is one sentence rather than a pydantic error list."""

    model_config = ConfigDict(extra="forbid")

    times: list[float]


@contextmanager
def _frame_errors() -> Iterator[None]:
    """The two frame failures; everything else goes to the library mapping."""
    try:
        yield
    except FrameNotFound as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except FramesRefused as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


def _result_body(result: frames.FramesResult) -> dict:
    return {
        "frames": [{"time_s": frame.time_s, "name": frame.name} for frame in result.frames],
        "failed": [{"time_s": fail.time_s, "reason": fail.reason} for fail in result.failed],
        "rev": result.record.rev,
    }


def register_frame_routes(
    router: APIRouter,
    *,
    get_store: Callable,
    library_errors: Callable[[], ContextManager[None]],
    actor_dep: Callable,
    on_record_changed: Optional[RecordChanged] = None,
) -> None:
    """Register ``POST /{video_id}/frames`` and ``DELETE /{video_id}/frames/{name}``."""

    async def announce(record: VideoRecord, actor: str) -> None:
        if on_record_changed is not None:
            await on_record_changed(record.id, record.rev, actor)

    @router.post("/{video_id}/frames")
    async def grab_frames(
        video_id: str, body: FramesRequest, actor: str = Depends(actor_dep)
    ) -> dict:
        store = get_store()
        with library_errors(), _frame_errors():
            result = await run_in_threadpool(
                frames.grab_frames, store, video_id, body.times, by=actor
            )
        if result.frames:
            await announce(result.record, actor)
        return _result_body(result)

    @router.delete("/{video_id}/frames/{name}")
    async def delete_frame(
        video_id: str, name: str, actor: str = Depends(actor_dep)
    ) -> dict:
        store = get_store()
        with library_errors(), _frame_errors():
            record = await run_in_threadpool(
                frames.delete_frame, store, video_id, name, by=actor
            )
        await announce(record, actor)
        return {"rev": record.rev}
