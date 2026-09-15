"""Channel and platform routes (docs/plans/multi-channel-pr1-contract.md → Routes).

Registered by ``build_router`` **before** the ``/{video_id}`` routes, so
``/channels`` and ``/platforms`` are never read as a record id, and behind the
router's actor guard. Like collections and the brief there is no ``If-Match``:
channels are few, and the store's ``write_lock`` serialises the file writes.

Every channel in an answer carries ``primary: bool``. Refusals the UI branches
on carry a machine-readable ``reason`` at the top level beside ``detail`` (the
``router_collections`` precedent): ``channel_exists`` and ``channel_is_primary``
(409), ``primary_not_youtube`` (422). A body pydantic refuses keeps FastAPI's
normal 422.

Sync handlers on purpose: FastAPI runs them in its threadpool, so a write
waiting on the store lock never blocks the event loop.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Callable, Iterator, Union

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from starlette import status as http_status

from backend.library.channels import Channel, ChannelBook, ChannelCreate, ChannelPatch
from backend.library.errors import (
    ChannelExists,
    ChannelInUse,
    ChannelIsPrimary,
    ChannelNotFound,
    LibraryError,
    PrimaryNotYoutube,
)
from backend.library.platforms import served_platforms

PLATFORMS_PATH = "/platforms"
CHANNELS_PATH = "/channels"
CHANNEL_PATH = "/channels/{channel_id}"
PRIMARY_PATH = "/channels/{channel_id}/primary"
REASON_CHANNEL_EXISTS = "channel_exists"
REASON_CHANNEL_IS_PRIMARY = "channel_is_primary"
REASON_PRIMARY_NOT_YOUTUBE = "primary_not_youtube"
REASON_CHANNEL_IN_USE = "channel_in_use"
#: ``GET /channels/{id}?include_recent_posts=true&limit=``: the default and the bounds.
RECENT_POSTS_DEFAULT_LIMIT = 10
RECENT_POSTS_MIN_LIMIT = 1
RECENT_POSTS_MAX_LIMIT = 50
CHANNELS_UNREADABLE_STATUS = 500
#: A literal: starlette renamed its 422 constant, and CI's starlette is unpinned.
PRIMARY_NOT_YOUTUBE_STATUS = 422


def register_channel_routes(router: APIRouter, *, get_store: Callable) -> None:
    """Register ``/platforms`` and the six channel routes. Must precede ``/{video_id}``."""

    @router.get(PLATFORMS_PATH)
    def list_platforms() -> dict:
        return {"platforms": served_platforms()}

    _register_list_and_create(router, get_store)
    _register_one(router, get_store)


@contextmanager
def _channel_errors() -> Iterator[None]:
    """Map channel failures onto status codes; nothing is swallowed.

    ``ValueError`` covers ``ChannelsUnreadable`` and a corrupt ``brief.json``
    met by the first bootstrap: both are reported, never reset.
    """
    try:
        yield
    except ChannelNotFound as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=CHANNELS_UNREADABLE_STATUS, detail=str(exc)) from exc


def _refusal(status_code: int, reason: str, exc: LibraryError) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"reason": reason, "detail": str(exc)})


def channel_view(channel: Channel, primary_id: str) -> dict:
    """``Channel & {primary}``."""
    return {**channel.model_dump(mode="json"), "primary": channel.id == primary_id}


def book_view(book: ChannelBook) -> dict:
    """``{primary_id, channels: [Channel & {primary}]}`` in file order."""
    return {
        "primary_id": book.primary_id,
        "channels": [channel_view(channel, book.primary_id) for channel in book.channels],
    }


def _one_view(store: Any, channel: Channel) -> dict:
    return channel_view(channel, store.list_channels().primary_id)


def _register_list_and_create(router: APIRouter, get_store: Callable) -> None:

    @router.get(CHANNELS_PATH)
    def list_channels() -> dict:
        """Every channel, the primary flagged; the first read bootstraps from the brief."""
        with _channel_errors():
            return book_view(get_store().list_channels())

    @router.post(CHANNELS_PATH, status_code=http_status.HTTP_201_CREATED, response_model=None)
    def create_channel(body: ChannelCreate) -> Union[dict, JSONResponse]:
        store = get_store()
        with _channel_errors():
            try:
                created = store.create_channel(body)
            except ChannelExists as exc:
                return _refusal(http_status.HTTP_409_CONFLICT, REASON_CHANNEL_EXISTS, exc)
            return _one_view(store, created)


def _register_one(router: APIRouter, get_store: Callable) -> None:

    @router.get(CHANNEL_PATH)
    def get_channel(
        channel_id: str,
        include_recent_posts: bool = False,
        limit: int = Query(RECENT_POSTS_DEFAULT_LIMIT, ge=RECENT_POSTS_MIN_LIMIT,
                           le=RECENT_POSTS_MAX_LIMIT),
    ) -> dict:
        """``Channel & {primary}``, plus ``recent_posts`` only with ``include_recent_posts``."""
        store = get_store()
        with _channel_errors():
            view = _one_view(store, store.get_channel(channel_id))
            if not include_recent_posts:
                return view
            return {**view, "recent_posts": store.recent_posts(channel_id, limit=limit)}

    @router.patch(CHANNEL_PATH)
    def patch_channel(channel_id: str, patch: ChannelPatch) -> dict:
        """Scalars replace; ``context`` and ``profile`` merge per field."""
        store = get_store()
        with _channel_errors():
            return _one_view(store, store.patch_channel(channel_id, patch))

    @router.delete(CHANNEL_PATH, status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
    def delete_channel(channel_id: str) -> Union[Response, JSONResponse]:
        """204; the primary channel is refused with 409 ``channel_is_primary``, and a
        channel any record holds a post for with 409 ``channel_in_use`` (+ ``posts``)."""
        store = get_store()
        with _channel_errors():
            try:
                store.delete_channel(channel_id)
            except ChannelIsPrimary as exc:
                return _refusal(http_status.HTTP_409_CONFLICT, REASON_CHANNEL_IS_PRIMARY, exc)
            except ChannelInUse as exc:
                return JSONResponse(status_code=http_status.HTTP_409_CONFLICT, content={
                    "reason": REASON_CHANNEL_IN_USE, "detail": str(exc), "posts": exc.posts,
                })
        return Response(status_code=http_status.HTTP_204_NO_CONTENT)

    @router.post(PRIMARY_PATH, response_model=None)
    def set_primary_channel(channel_id: str) -> Union[dict, JSONResponse]:
        """The list shape; a non-YouTube channel is refused with 422 ``primary_not_youtube``."""
        store = get_store()
        with _channel_errors():
            try:
                return book_view(store.set_primary_channel(channel_id))
            except PrimaryNotYoutube as exc:
                return _refusal(PRIMARY_NOT_YOUTUBE_STATUS, REASON_PRIMARY_NOT_YOUTUBE, exc)
