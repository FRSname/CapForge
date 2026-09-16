"""Collection routes: an event's brief overrides and template slots.

docs/plans/library-collections.md (Backend → Routes). Registered by
``build_router`` **before** the ``/{video_id}`` routes, so ``/collections`` is
never read as a record id, and behind the router's actor guard. Like the brief,
there is no ``If-Match``: there are few collections and one editor at a time;
the store's ``write_lock`` serialises the file writes.

Refusals the UI branches on carry a machine-readable ``reason`` at the top level
beside ``detail`` (the relink precedent): ``collection_exists``,
``collection_in_use`` with ``members`` and ``collection_has_children`` with
``children`` (409), and the nesting refusals ``unknown_parent``,
``collection_cycle`` and ``collection_too_deep`` with ``max_depth`` (422). A body
pydantic refuses keeps FastAPI's normal 422, with no ``reason``.

Nesting (docs/plans/library-finder.md §2.4): the list stays **flat**, and every
collection answer carries ``parent_id``, ``path`` (names, top level first, itself
last) and ``total_members`` (itself plus every descendant). The detail's
``effective_brief`` is rendered from the resolved chain, while its own ``slots``
and ``overrides`` stay the collection's own, because they are what an editor edits.

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
    resolved_collection,
)
from backend.library.collection_tree import collection_path, total_members
from backend.library.errors import (
    CollectionCycle,
    CollectionExists,
    CollectionHasChildren,
    CollectionInUse,
    CollectionNestingRefused,
    CollectionNotFound,
    CollectionsUnreadable,
    CollectionTooDeep,
    LibraryError,
    UnknownParent,
)
from backend.library.router_publish import COLLECTIONS_UNREADABLE_STATUS, read_brief

COLLECTIONS_PATH = "/collections"
COLLECTION_PATH = "/collections/{collection_id}"
REASON_COLLECTION_EXISTS = "collection_exists"
REASON_COLLECTION_IN_USE = "collection_in_use"
REASON_COLLECTION_HAS_CHILDREN = "collection_has_children"
REASON_UNKNOWN_PARENT = "unknown_parent"
REASON_COLLECTION_CYCLE = "collection_cycle"
REASON_COLLECTION_TOO_DEEP = "collection_too_deep"
#: A literal: starlette renamed its 422 constant, and CI's starlette is unpinned.
NESTING_REFUSED_STATUS = 422


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


def _refusal(
    reason: str, exc: LibraryError, *, status_code: int = http_status.HTTP_409_CONFLICT,
    **extra: Any,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"reason": reason, "detail": str(exc), **extra},
    )


def _nesting_refusal(exc: CollectionNestingRefused) -> JSONResponse:
    """The 422 for a ``parent_id`` the tree cannot take."""
    if isinstance(exc, UnknownParent):
        return _refusal(REASON_UNKNOWN_PARENT, exc, status_code=NESTING_REFUSED_STATUS)
    if isinstance(exc, CollectionCycle):
        return _refusal(REASON_COLLECTION_CYCLE, exc, status_code=NESTING_REFUSED_STATUS)
    if isinstance(exc, CollectionTooDeep):
        return _refusal(REASON_COLLECTION_TOO_DEEP, exc, status_code=NESTING_REFUSED_STATUS,
                        max_depth=exc.max_depth)
    raise exc  # a refusal this router has no reason for is a bug, never a quiet 422


def _summary(
    collection: Collection, collections: list[Collection], counts: dict[str, int]
) -> dict:
    """``Collection & {members, total_members, path}`` — the list and create shape."""
    return {
        **collection.model_dump(mode="json"),
        "members": counts.get(collection.id, 0),
        "total_members": total_members(collections, counts, collection.id),
        "path": collection_path(collections, collection.id),
    }


def _one_summary(store: Any, collection: Collection) -> dict:
    return _summary(collection, store.list_collections(), store.member_counts())


def _detail(store: Any, collection: Collection) -> dict:
    """The summary plus ``effective_brief`` under the resolved chain — the get and
    patch shape."""
    collections = store.list_collections()
    resolved = resolved_collection(collections, collection.id)
    brief = effective_brief(read_brief(store), resolved)
    return {
        **_summary(collection, collections, store.member_counts()),
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
            "collections": [_summary(c, collections, counts) for c in collections],
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
            except CollectionNestingRefused as exc:
                return _nesting_refusal(exc)
            return _one_summary(store, created)


def _register_one(router: APIRouter, get_store: Callable) -> None:

    @router.get(COLLECTION_PATH)
    def get_collection(collection_id: str) -> dict:
        store = get_store()
        with _collection_errors():
            return _detail(store, store.get_collection(collection_id))

    @router.patch(COLLECTION_PATH, response_model=None)
    def patch_collection(
        collection_id: str, patch: CollectionPatch
    ) -> Union[dict, JSONResponse]:
        """Top-level fields replace; ``overrides`` merges per field (``null`` inherits).
        ``parent_id: null`` moves to the top level; a refused move writes nothing."""
        store = get_store()
        with _collection_errors():
            try:
                updated = store.patch_collection(collection_id, patch)
            except CollectionNestingRefused as exc:
                return _nesting_refusal(exc)
            return _detail(store, updated)

    @router.delete(
        COLLECTION_PATH, status_code=http_status.HTTP_204_NO_CONTENT, response_model=None
    )
    def delete_collection(collection_id: str) -> Union[Response, JSONResponse]:
        """204; refused with 409 while any video still names the collection, then
        while any subfolder sits inside it (members are checked first)."""
        store = get_store()
        with _collection_errors():
            try:
                store.delete_collection(collection_id)
            except CollectionInUse as exc:
                return _refusal(REASON_COLLECTION_IN_USE, exc, members=exc.members)
            except CollectionHasChildren as exc:
                return _refusal(REASON_COLLECTION_HAS_CHILDREN, exc, children=exc.children)
        return Response(status_code=http_status.HTTP_204_NO_CONTENT)
