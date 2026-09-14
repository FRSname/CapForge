"""HTTP surface for the library — mounted by ``backend/main.py``.

The auth guard is **injected** (``build_router(actor_dep)``): ``main.py`` is far
past its size ceiling and importing its dependency from here would be circular.
The dependency returns the actor (``"agent"`` / ``"user"``) so every write can
stamp *who* wrote it, which is the whole point of the history field (§2.3).

Nothing here *imports* the session, and every route still answers with the app
sitting on the drop screen (``current_result is None``) — #1's exit test. The
two places the session does show through are injected the same way the guard is:
``live_session`` (the open window's transcript, read by ``router_derived``) and
``on_record_changed`` (awaited after each successful write).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Awaitable, Callable, Iterator, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response
from starlette import status as http_status
from starlette.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.library import posters
from backend.library.errors import (
    MediaNotFound,
    RecordNotFound,
    ScratchReadOnly,
    StaleRevision,
)
from backend.library.paths import library_root, record_dir, resolve_asset
from backend.library.router_admin import register_admin_routes
from backend.library.router_collections import register_collection_routes
from backend.library.router_derived import LiveSession, register_derived_routes
from backend.library.router_import import register_import_routes
from backend.library.router_publish import (
    collection_refusal,
    register_publish_routes,
    violation_refusal,
)
from backend.library.schemas import RecordPatch, RenderEntry, VideoRecord
from backend.library.store import LibraryStore

logger = logging.getLogger(__name__)

#: ``on_record_changed(video_id, rev, by)`` — awaited after every successful
#: record write so the open window can refresh the dossier it is showing.
RecordChanged = Callable[[str, int, str], Awaitable[None]]

ROUTER_PREFIX = "/api/library"
IF_MATCH_HEADER = "If-Match"
#: Every asset rejection answers the same way, so a probe learns nothing.
ASSET_NOT_FOUND = "Asset not found"
#: 404 copy for the two routes that read what a saved session left behind.
NO_PROJECT_DETAIL = "Record {id} has no stored project yet"
#: What `open_video` answers for a record the window has nothing to restore from.
NO_SNAPSHOT_DETAIL = (
    "Record {id} has no session snapshot yet — open it in CapForge once "
    "(autosave lands with the library screen)"
)
#: One store per resolved library root. Keyed by path (not a singleton) so a
#: test that relocates CAPFORGE_HOME gets a fresh store instead of a stale one
#: pointing at the previous tmp dir.
_STORES: dict[str, LibraryStore] = {}


def get_store() -> LibraryStore:
    key = str(library_root())
    store = _STORES.get(key)
    if store is None:
        store = LibraryStore(library_root(), on_created=posters.start_grab)
        _STORES[key] = store
    return store


def reset_store_cache() -> None:
    """Close and forget every cached store (tests; not used in production)."""
    for store in _STORES.values():
        store.close()
    _STORES.clear()


def require_openable_record(video_id: str) -> None:
    """404/409 unless ``video_id`` names a record with a stored session snapshot.

    The ``open_video`` agent command asks this before broadcasting: the window
    restores the snapshot, so "no such record" and "never saved" have to fail at
    the agent's own call. It lives here rather than in ``main.py`` (far past its
    size ceiling) because both answers are the library's to give.
    """
    store = get_store()
    with _library_errors():
        store.get(video_id)
        project = store.get_project(video_id)
    if project is None:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=NO_SNAPSHOT_DETAIL.format(id=video_id),
        )


def record_id_for_media(path: str) -> Optional[str]:
    """The record id for a just-loaded media file, or None when indexing failed.

    Log-and-continue is deliberate and is one of exactly two such spots: the
    caller (``load_video``) is loading a video into the app, and the index must
    never block that. The cost of a failure is the missing id in the response;
    the next load creates the record again.
    """
    try:
        record, _ = get_store().create_or_get(path)
        return record.id
    except Exception:
        logger.error("Could not create a library record for %s", path, exc_info=True)
        return None


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
    """The wire shape: the dossier plus its read-time derived status.

    ``hasProject`` rides along for the same reason ``status`` does — the card
    needs it and neither is ever stored on the record.
    """
    return {
        **record.model_dump(),
        "status": store.status_of(record),
        "hasProject": store.has_project(record),
        "poster": store.has_poster(record),
    }


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


async def _announce(
    on_record_changed: Optional[RecordChanged],
    record: VideoRecord,
    by: str,
    *,
    unchanged_rev: Optional[int] = None,
) -> None:
    """Report a successful write. ``unchanged_rev`` suppresses a no-op patch."""
    if on_record_changed is None or record.rev == unchanged_rev:
        return
    await on_record_changed(record.id, record.rev, by)


def build_router(
    actor_dep: Callable,
    *,
    live_session: Optional[LiveSession] = None,
    on_record_changed: Optional[RecordChanged] = None,
) -> APIRouter:
    """The library router, gated by ``actor_dep`` (agent token or local token).

    Both optional arguments are seams onto the session ``main.py`` owns and this
    package must not import: ``live_session()`` is the open window's transcript,
    and ``on_record_changed`` is awaited after every successful record write.

    Registration order matters: ``/rebuild-index``, ``/collections``, ``/brief``,
    ``/validate`` and ``/watch`` must be declared before the ``/{video_id}`` routes
    they would otherwise be captured by.
    """
    router = APIRouter(
        prefix=ROUTER_PREFIX, tags=["library"], dependencies=[Depends(actor_dep)]
    )
    register_collection_routes(router, get_store=get_store)
    _register_library_routes(router)
    register_admin_routes(
        router, get_store=get_store, view=_view, library_errors=_library_errors,
        actor_dep=actor_dep, on_record_changed=on_record_changed,
    )
    register_import_routes(
        router, get_store=get_store, view=_view, library_errors=_library_errors,
        actor_dep=actor_dep, on_record_changed=on_record_changed,
    )
    register_publish_routes(
        router, get_store=get_store, library_errors=_library_errors
    )
    _register_record_routes(router, actor_dep, on_record_changed)
    _register_record_write_routes(router, actor_dep, on_record_changed)
    _register_project_routes(router, on_record_changed)
    register_derived_routes(
        router, get_store=get_store, library_errors=_library_errors,
        live_session=live_session,
    )
    _register_asset_routes(router)
    return router


def _register_library_routes(router: APIRouter) -> None:
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
        """Create-or-return: 201 for a new record, 200 for a fingerprint hit.

        A new record's poster is grabbed by the store's ``on_created`` hook
        (off this thread) — the card shows a placeholder until the next list."""
        store = get_store()
        with _library_errors():
            record, created = store.create_or_get(body.source_path, scratch=body.scratch)
        response.status_code = (
            http_status.HTTP_201_CREATED if created else http_status.HTTP_200_OK
        )
        return _view(store, record)


def _register_record_routes(
    router: APIRouter, actor_dep: Callable, on_changed: Optional[RecordChanged]
) -> None:
    """Routes over one record's dossier."""

    @router.get("/{video_id}")
    def get_video(video_id: str) -> dict:
        store = get_store()
        with _library_errors():
            return _view(store, store.get(video_id))

    @router.patch("/{video_id}")
    async def patch_video(
        video_id: str,
        patch: RecordPatch,
        if_match: Optional[str] = Header(None, alias=IF_MATCH_HEADER),
        actor: str = Depends(actor_dep),
    ):
        """``actor`` is the same value the router-level guard resolved, re-declared
        here because the *body* of a write has to record who wrote it.

        The hard rules run over the merged result **before** anything is written,
        so a 422 leaves the stored record exactly as it was.
        """
        store = get_store()
        rev = _require_rev(if_match)
        with _library_errors():
            current = store.get(video_id)
            refusal = violation_refusal(store, current, patch)
            if refusal is not None:
                return refusal
            try:
                with store.write_lock:
                    # Re-checked under the lock: a collection deleted since the
                    # check above must not gain a member (collections plan, 8).
                    refusal = collection_refusal(store, current, patch)
                    if refusal is not None:
                        return refusal
                    record = store.patch(video_id, patch, rev=rev, by=actor)
            except StaleRevision as exc:
                return JSONResponse(
                    status_code=http_status.HTTP_409_CONFLICT,
                    content=jsonable_encoder(
                        {"detail": str(exc), "current": _view(store, exc.current)}
                    ),
                )
        await _announce(on_changed, record, actor, unchanged_rev=current.rev)
        return _view(store, record)


def _register_record_write_routes(
    router: APIRouter, actor_dep: Callable, on_changed: Optional[RecordChanged]
) -> None:
    """The two writes that are not a dossier patch; both always bump ``rev``."""

    @router.post("/{video_id}/promote")
    async def promote_video(video_id: str, actor: str = Depends(actor_dep)) -> dict:
        store = get_store()
        with _library_errors():
            record = store.promote(video_id)
        await _announce(on_changed, record, actor)
        return _view(store, record)

    @router.post("/{video_id}/renders")
    async def add_render(
        video_id: str, entry: RenderEntry, actor: str = Depends(actor_dep)
    ) -> dict:
        store = get_store()
        with _library_errors():
            record = store.add_render(video_id, entry)
        await _announce(on_changed, record, actor)
        return _view(store, record)


def _register_project_routes(
    router: APIRouter, on_changed: Optional[RecordChanged]
) -> None:
    """The session snapshot itself: written by the app, read by `open_video`."""

    @router.put("/{video_id}/project")
    async def put_project(video_id: str, project: dict = Body(...)) -> dict:
        """``by`` is always "user": only the renderer's autosave writes this."""
        store = get_store()
        with _library_errors():
            try:
                # Autosave writes a multi-MB snapshot every couple of seconds
                # during editing; off the event loop so /ws/progress keeps up.
                record = await run_in_threadpool(store.put_project, video_id, project)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        await _announce(on_changed, record, "user")
        return {"rev": record.rev}

    @router.get("/{video_id}/project")
    def get_project(video_id: str) -> dict:
        """The stored v2 session snapshot, verbatim (the renderer's `open_video`).

        Returned byte-for-byte as it was PUT: `open_video` and opening a project
        file must build the same track store, so nothing is reshaped here.
        """
        store = get_store()
        with _library_errors():
            store.get(video_id)  # 404 before we look for the snapshot
            project = store.get_project(video_id)
        if project is None:
            raise HTTPException(
                status_code=404, detail=NO_PROJECT_DETAIL.format(id=video_id)
            )
        return project


def _register_asset_routes(router: APIRouter) -> None:
    """The binary sidecars (poster, peaks, thumbnails) of one record."""

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
