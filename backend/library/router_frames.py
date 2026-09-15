"""Thumbnail frame routes: grab or upload frames into a record, delete one (publish-editors Part A).

Split out of ``router.py`` for its size ceiling. Like the other route modules it
imports nothing back from ``router``: ``get_store``, the error mapping, the actor
guard and ``on_record_changed`` are passed in by ``build_router``.

* ``POST /{video_id}/frames {times}`` → ``200 {frames: [{time_s, name}],
  failed: [{time_s, reason}], rev}``; 404 unknown record, 409 scratch, 422 bad
  times or no room (``detail`` is a sentence).
* ``POST /{video_id}/frames/upload`` (the raw image as the body, JPEG/PNG/WEBP)
  → ``200 {frame: {name}, rev}``; the frame is appended **and** made the cover.
  404 unknown record, 409 scratch, 422 too large, not an image, or no room.
* ``DELETE /{video_id}/frames/{name}`` → ``200 {rev}``; 404 unknown record or name.

ffmpeg and Pillow run in the threadpool (neither ``frames.grab_frames`` nor
``frame_upload.upload_frame`` holds the store's write lock while they do), and a
write is announced through ``on_record_changed`` so the open Publish panel adopts
the new ``rev``.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Awaitable, Callable, ContextManager, Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from starlette import status as http_status
from starlette.concurrency import run_in_threadpool

from backend.library import frame_upload, frames
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


def _declared_length(request: Request) -> Optional[int]:
    """The ``Content-Length`` header as a number; absent or unreadable is None
    (the body's own length is still checked once it has arrived)."""
    raw = request.headers.get("content-length")
    try:
        return int(raw) if raw is not None else None
    except ValueError:
        return None


async def _read_capped(request: Request) -> bytes:
    """The body, streamed and refused (``FramesRefused``) the moment it passes
    ``UPLOAD_MAX_BYTES`` — a chunked upload with no ``Content-Length`` is never
    buffered whole before the size check."""
    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        frame_upload.check_upload_size(received)
        chunks.append(chunk)
    return b"".join(chunks)


def register_frame_routes(
    router: APIRouter,
    *,
    get_store: Callable,
    library_errors: Callable[[], ContextManager[None]],
    actor_dep: Callable,
    on_record_changed: Optional[RecordChanged] = None,
) -> None:
    """Register ``POST /{video_id}/frames``, ``POST /{video_id}/frames/upload``
    and ``DELETE /{video_id}/frames/{name}``."""

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

    @router.post("/{video_id}/frames/upload")
    async def upload_frame(
        video_id: str, request: Request, actor: str = Depends(actor_dep)
    ) -> dict:
        """The body is the image itself (no multipart). An oversize upload is
        refused from its header before the body is read, and from the bytes
        that actually arrived before anything is decoded."""
        store = get_store()
        with library_errors(), _frame_errors():
            declared = _declared_length(request)
            if declared is not None:
                frame_upload.check_upload_size(declared)
            data = await _read_capped(request)
            record = await run_in_threadpool(
                frame_upload.upload_frame, store, video_id, data, by=actor
            )
        await announce(record, actor)
        return {"frame": {"name": record.thumbnail.cover}, "rev": record.rev}

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
