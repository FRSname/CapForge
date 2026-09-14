"""Collection routes: an event's brief overrides and template slots.

docs/plans/library-collections.md (Backend → Routes). Registered by
``build_router`` **before** the ``/{video_id}`` routes, so ``/collections`` is
never read as a record id, and behind the router's actor guard. Like the brief,
there is no ``If-Match``: there are few collections and one editor at a time;
the store's ``write_lock`` serialises the file writes.

Refusals the UI branches on carry a machine-readable ``reason`` at the top level
beside ``detail`` (the relink precedent): ``collection_exists``, and
``collection_in_use`` with ``members``.

Sync handlers on purpose: FastAPI runs them in its threadpool, so a delete that
counts members under the write lock never blocks the event loop.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Callable, Iterator, Union

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse
from starlette import status as http_status

from backend.library.collection_store import (
    Collection,
    CollectionCreate,
    CollectionPatch,
    effective_brief,
    orphans_from,
)
from backend.library.errors import (
    CollectionExists,
    CollectionInUse,
    CollectionNotFound,
    CollectionsUnreadable,
    LibraryError,
)
from backend.library.router_publish import COLLECTIONS_UNREADABLE_STATUS, read_brief

COLLECTIONS_PATH = "/collections"
COLLECTION_PATH = "/collections/{collection_id}"
REASON_COLLECTION_EXISTS = "collection_exists"
REASON_COLLECTION_IN_USE = "collection_in_use"


def register_collection_routes(router: APIRouter, *, get_store: Callable) -> None:
    """Register the five collection routes. Must precede ``/{video_id}``."""
    _register_list_and_create(router, get_store)
    _register_one(router, get_store)


@contextmanager
def _collection_errors() -> Iterator[None]:
    """Map collection failures onto status codes; nothing is swallowed."""
    try:
        yield
    except CollectionNotFound as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CollectionsUnreadable as exc:
        raise HTTPException(status_code=COLLECTIONS_UNREADABLE_STATUS, detail=str(exc)) from exc


def _refusal(reason: str, exc: LibraryError, **extra: Any) -> JSONResponse:
    return JSONResponse(
        status_code=http_status.HTTP_409_CONFLICT,
        content={"reason": reason, "detail": str(exc), **extra},
    )


def _summary(collection: Collection, members: int) -> dict:
    """``Collection & {members}`` — the list and create shape."""
    return {**collection.model_dump(mode="json"), "members": members}


def _detail(store: Any, collection: Collection) -> dict:
    """``Collection & {members, effective_brief}`` — the get and patch shape."""
    brief = effective_brief(read_brief(store), collection)
    return {
        **_summary(collection, store.members_of(collection.id)),
        "effective_brief": brief.model_dump(mode="json"),
    }


def _register_list_and_create(router: APIRouter, get_store: Callable) -> None:

    @router.get(COLLECTIONS_PATH)
    def list_collections() -> dict:
        """Every collection with its member count, plus ids no collection defines."""
        store = get_store()
        with _collection_errors():
            collections = store.list_collections()
        counts = store.member_counts()
        return {
            "collections": [_summary(c, counts.get(c.id, 0)) for c in collections],
            "orphans": orphans_from(collections, counts),
        }

    @router.post(
        COLLECTIONS_PATH, status_code=http_status.HTTP_201_CREATED, response_model=None
    )
    def create_collection(body: CollectionCreate) -> Union[dict, JSONResponse]:
        """201 with the new collection; creating an orphan's id adopts its videos."""
        store = get_store()
        with _collection_errors():
            try:
                created = store.create_collection(body)
            except CollectionExists as exc:
                return _refusal(REASON_COLLECTION_EXISTS, exc)
        return _summary(created, store.members_of(created.id))


def _register_one(router: APIRouter, get_store: Callable) -> None:

    @router.get(COLLECTION_PATH)
    def get_collection(collection_id: str) -> dict:
        store = get_store()
        with _collection_errors():
            return _detail(store, store.get_collection(collection_id))

    @router.patch(COLLECTION_PATH)
    def patch_collection(collection_id: str, patch: CollectionPatch) -> dict:
        """Top-level fields replace; ``overrides`` merges per field (``null`` inherits)."""
        store = get_store()
        with _collection_errors():
            return _detail(store, store.patch_collection(collection_id, patch))

    @router.delete(
        COLLECTION_PATH, status_code=http_status.HTTP_204_NO_CONTENT, response_model=None
    )
    def delete_collection(collection_id: str) -> Union[Response, JSONResponse]:
        """204; refused with 409 while any video still names the collection."""
        store = get_store()
        with _collection_errors():
            try:
                store.delete_collection(collection_id)
            except CollectionInUse as exc:
                return _refusal(REASON_COLLECTION_IN_USE, exc, members=exc.members)
        return Response(status_code=http_status.HTTP_204_NO_CONTENT)
