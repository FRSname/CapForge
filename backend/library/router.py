"""HTTP surface for the library — mounted by ``backend/main.py``.

The auth guard is **injected** (``build_router(actor_dep)``): ``main.py`` is far
past its size ceiling and importing its dependency from here would be circular.
The dependency returns the actor (``"agent"`` / ``"user"``) so every write can
stamp *who* wrote it, which is the whole point of the history field (§2.3).

Nothing here reaches into the session: these routes answer with the app sitting
on the drop screen (``current_result is None``) — the deliverable's exit test.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response
from starlette import status as http_status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.library.errors import (
    MediaNotFound,
    RecordNotFound,
    ScratchReadOnly,
    StaleRevision,
)
from backend.library.paths import library_root, record_dir, resolve_asset
from backend.library.schemas import RecordPatch, RenderEntry, VideoRecord
from backend.library.store import LibraryStore

logger = logging.getLogger(__name__)

ROUTER_PREFIX = "/api/library"
IF_MATCH_HEADER = "If-Match"
#: Every asset rejection answers the same way, so a probe learns nothing.
ASSET_NOT_FOUND = "Asset not found"

#: One store per resolved library root. Keyed by path (not a singleton) so a
#: test that relocates CAPFORGE_HOME gets a fresh store instead of a stale one
#: pointing at the previous tmp dir.
_STORES: dict[str, LibraryStore] = {}


def get_store() -> LibraryStore:
    key = str(library_root())
    store = _STORES.get(key)
    if store is None:
        store = LibraryStore(library_root())
        _STORES[key] = store
    return store


def reset_store_cache() -> None:
    """Close and forget every cached store (tests; not used in production)."""
    for store in _STORES.values():
        store.close()
    _STORES.clear()


class CreateVideoRequest(BaseModel):
    source_path: str
    scratch: bool = False


@contextmanager
def _library_errors() -> Iterator[None]:
    """Map library failures onto status codes; nothing is swallowed."""
    try:
        yield
    except RecordNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except MediaNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ScratchReadOnly as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _view(store: LibraryStore, record: VideoRecord) -> dict:
    """The wire shape: the dossier plus its read-time derived status."""
    return {**record.model_dump(), "status": store.status_of(record)}


def _require_rev(if_match: Optional[str]) -> int:
    """``If-Match: <rev>`` is mandatory on a patch — 428 without a usable one."""
    if if_match is None:
        raise HTTPException(
            status_code=http_status.HTTP_428_PRECONDITION_REQUIRED,
            detail=f"{IF_MATCH_HEADER}: <rev> is required to patch a record",
        )
    try:
        return int(if_match.strip().strip('"'))
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_428_PRECONDITION_REQUIRED,
            detail=f"{IF_MATCH_HEADER} must be an integer rev, got {if_match!r}",
        ) from exc


def build_router(actor_dep: Callable) -> APIRouter:
    """The library router, gated by ``actor_dep`` (agent token or local token).

    Registration order matters: ``/rebuild-index`` must be declared before the
    ``/{video_id}`` routes it would otherwise be captured by.
    """
    router = APIRouter(
        prefix=ROUTER_PREFIX, tags=["library"], dependencies=[Depends(actor_dep)]
    )
    _register_collection_routes(router)
    _register_record_routes(router, actor_dep)
    _register_content_routes(router)
    return router


def _register_collection_routes(router: APIRouter) -> None:
    """Routes over the library as a whole."""

    @router.post("/rebuild-index")
    def rebuild_index() -> dict:
        """Drop the index and refill it from the folders (the DB is disposable)."""
        return {"indexed": get_store().rebuild_index()}

    @router.get("")
    def list_videos(
        status: Optional[str] = None,
        collection: Optional[str] = None,
        q: Optional[str] = None,
        include_scratch: bool = False,
    ) -> dict:
        store = get_store()
        return {
            "videos": store.list(
                status=status, collection=collection, q=q, include_scratch=include_scratch
            )
        }

    @router.post("")
    def create_video(body: CreateVideoRequest, response: Response) -> dict:
        """Create-or-return: 201 for a new record, 200 for a fingerprint hit."""
        store = get_store()
        with _library_errors():
            record, created = store.create_or_get(body.source_path, scratch=body.scratch)
        response.status_code = (
            http_status.HTTP_201_CREATED if created else http_status.HTTP_200_OK
        )
        return _view(store, record)


def _register_record_routes(router: APIRouter, actor_dep: Callable) -> None:
    """Routes over one record's dossier."""

    @router.get("/{video_id}")
    def get_video(video_id: str) -> dict:
        store = get_store()
        with _library_errors():
            return _view(store, store.get(video_id))

    @router.patch("/{video_id}")
    def patch_video(
        video_id: str,
        patch: RecordPatch,
        if_match: Optional[str] = Header(None, alias=IF_MATCH_HEADER),
        actor: str = Depends(actor_dep),
    ):
        """``actor`` is the same value the router-level guard resolved, re-declared
        here because the *body* of a write has to record who wrote it."""
        store = get_store()
        rev = _require_rev(if_match)
        with _library_errors():
            try:
                record = store.patch(video_id, patch, rev=rev, by=actor)
            except StaleRevision as exc:
                return JSONResponse(
                    status_code=http_status.HTTP_409_CONFLICT,
                    content=jsonable_encoder(
                        {"detail": str(exc), "current": _view(store, exc.current)}
                    ),
                )
        return _view(store, record)

    @router.post("/{video_id}/promote")
    def promote_video(video_id: str) -> dict:
        store = get_store()
        with _library_errors():
            return _view(store, store.promote(video_id))

    @router.post("/{video_id}/renders")
    def add_render(video_id: str, entry: RenderEntry) -> dict:
        store = get_store()
        with _library_errors():
            return _view(store, store.add_render(video_id, entry))


def _register_content_routes(router: APIRouter) -> None:
    """Routes over a record's project, transcript and assets."""

    @router.put("/{video_id}/project")
    def put_project(video_id: str, project: dict = Body(...)) -> dict:
        store = get_store()
        with _library_errors():
            try:
                record = store.put_project(video_id, project)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"rev": record.rev}

    @router.get("/{video_id}/transcript")
    def get_transcript(video_id: str, segments_only: bool = True) -> dict:
        store = get_store()
        with _library_errors():
            record = store.get(video_id)
            transcript = store.get_transcript(video_id, segments_only=segments_only)
        if transcript is None:
            raise HTTPException(
                status_code=404, detail=f"Record {video_id} has no stored transcript yet"
            )
        # `source` tells the agent whether it read the record or the live
        # session; the "session" proxy for the active record lands with #3.
        return {"rev": record.rev, "source": "record", "transcript": transcript}

    @router.get("/{video_id}/asset/{name:path}")
    def get_asset(video_id: str, name: str) -> FileResponse:
        """Fixed-name allowlist, resolved strictly under the record folder; every
        rejection is the same 404 so a probe learns nothing."""
        store = get_store()
        try:
            record = store.get(video_id)
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail=ASSET_NOT_FOUND) from exc
        folder: Path = record_dir(record.id, scratch=record.scratch, root=store.root)
        target = resolve_asset(folder, name)
        if target is None:
            raise HTTPException(status_code=404, detail=ASSET_NOT_FOUND)
        return FileResponse(target)
