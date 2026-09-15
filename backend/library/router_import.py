"""Folder import, multi-file drop, "Locate…" relink and the watch folder (v3.0 3s).

Split out of ``router.py`` for its size ceiling. Like ``router_admin``, the
helpers it needs are **passed in** by ``build_router`` so there is no import
edge back to ``router``. Blocking work (a folder scan, fingerprinting) runs
through ``run_in_threadpool`` so ``/ws/progress`` keeps up.

A relink refusal answers with a machine-readable ``reason`` at the top level of
the body (beside ``detail``), because the UI branches on it: ``different_media``
asks the user to confirm with ``force``; ``media_in_use`` names the owner.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, ContextManager, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette import status as http_status
from starlette.concurrency import run_in_threadpool

from backend.library import watch
from backend.library.errors import (
    LibraryError,
    MediaInUse,
    MediaMismatch,
    MediaNotFound,
    RecordNotFound,
)
from backend.library.folder_import import (
    FolderImport,
    import_dropped_paths,
    import_folder,
    require_import_folder,
)
from backend.library.media_scan import SCAN_MAX_FILES

logger = logging.getLogger(__name__)

RecordChanged = Callable[[str, int, str], Awaitable[None]]

REASON_MEDIA_NOT_FOUND = "media_not_found"
REASON_DIFFERENT_MEDIA = "different_media"
REASON_MEDIA_IN_USE = "media_in_use"


class ImportFolderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    recursive: bool = True


class ImportPathsRequest(BaseModel):
    """A multi-file drop; bounded like a folder scan so one request stays cheap."""

    model_config = ConfigDict(extra="forbid")

    paths: list[str] = Field(..., min_length=1, max_length=SCAN_MAX_FILES)


class RelinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    force: bool = False


class WatchRequest(BaseModel):
    """``folder`` is required but nullable: ``null`` stops watching."""

    model_config = ConfigDict(extra="forbid")

    folder: Optional[str]


def register_import_routes(
    router: APIRouter,
    *,
    get_store: Callable,
    view: Callable,
    library_errors: Callable[[], ContextManager[None]],
    actor_dep: Callable,
    on_record_changed: Optional[RecordChanged] = None,
) -> None:
    """Register import-folder, import-paths, relink and watch. Must precede
    ``/{video_id}``: ``GET /watch`` would otherwise be read as a record id."""
    _register_folder_import(router, get_store, actor_dep, on_record_changed)
    _register_paths_import(router, get_store, actor_dep, on_record_changed)
    _register_relink(router, get_store, view, library_errors, actor_dep, on_record_changed)
    _register_watch(router, get_store)


def _refusal(status_code: int, reason: str, exc: LibraryError, **extra: Any) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"reason": reason, "detail": str(exc), **extra},
    )


def _register_folder_import(
    router: APIRouter,
    get_store: Callable,
    actor_dep: Callable,
    on_changed: Optional[RecordChanged],
) -> None:
    @router.post("/import-folder")
    async def import_media_folder(
        body: ImportFolderRequest, actor: str = Depends(actor_dep)
    ) -> dict:
        """Import every media file in a folder: ids by outcome, failures, the cap.

        422 when the path is not an absolute, existing, readable directory.
        """
        store = get_store()
        try:
            folder = require_import_folder(body.path)
            result = await run_in_threadpool(
                import_folder, store, folder, recursive=body.recursive, by=actor
            )
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _log_import(f"Folder import of {folder}", result)
        await _announce_relinked(store, result, actor, on_changed)
        return result.to_wire()


def _register_paths_import(
    router: APIRouter,
    get_store: Callable,
    actor_dep: Callable,
    on_changed: Optional[RecordChanged],
) -> None:
    @router.post("/import-paths")
    async def import_media_paths(
        body: ImportPathsRequest, actor: str = Depends(actor_dep)
    ) -> dict:
        """A multi-file drop, one request: the import-folder body (``truncated``
        always false). Per path, not a regular file is ``media_not_found`` and a
        non-media suffix is ``not_media``; neither is imported."""
        store = get_store()
        result = await run_in_threadpool(
            import_dropped_paths, store, body.paths, by=actor
        )
        _log_import(f"Import of {len(body.paths)} dropped path(s)", result)
        await _announce_relinked(store, result, actor, on_changed)
        return result.to_wire()


def _log_import(what: str, result: FolderImport) -> None:
    logger.info(
        "%s: %d created, %d existing, %d relinked, %d failed",
        what, len(result.created), len(result.existing),
        len(result.relinked), len(result.failed),
    )


async def _announce_relinked(
    store: Any, result: FolderImport, actor: str, on_changed: Optional[RecordChanged]
) -> None:
    """Each relink bumped a record's rev; the open window refreshes it."""
    if on_changed is None:
        return
    for video_id in result.relinked:
        try:
            record = store.get(video_id)
        except RecordNotFound:
            continue  # removed since the import answered — nothing to refresh
        await on_changed(record.id, record.rev, actor)


def _register_relink(
    router: APIRouter,
    get_store: Callable,
    view: Callable,
    library_errors: Callable[[], ContextManager[None]],
    actor_dep: Callable,
    on_changed: Optional[RecordChanged],
) -> None:
    @router.post("/{video_id}/relink")
    async def relink_video(
        video_id: str, body: RelinkRequest, actor: str = Depends(actor_dep)
    ):
        """Point a record at its media's new location (or, with ``force``, at
        different media). 404 unknown record; 422 ``media_not_found``; 409
        ``different_media`` / ``media_in_use`` (+ ``video_id``)."""
        store = get_store()

        def relink() -> tuple[int, Any]:
            before = store.get(video_id)
            return before.rev, store.relink(video_id, body.path, by=actor, force=body.force)

        with library_errors():
            try:
                previous_rev, record = await run_in_threadpool(relink)
            except MediaNotFound as exc:
                return _refusal(422, REASON_MEDIA_NOT_FOUND, exc)
            except MediaMismatch as exc:
                return _refusal(http_status.HTTP_409_CONFLICT, REASON_DIFFERENT_MEDIA, exc)
            except MediaInUse as exc:
                return _refusal(
                    http_status.HTTP_409_CONFLICT, REASON_MEDIA_IN_USE, exc,
                    video_id=exc.video_id,
                )
        if on_changed is not None and record.rev != previous_rev:
            await on_changed(record.id, record.rev, actor)
        return view(store, record)


def _register_watch(router: APIRouter, get_store: Callable) -> None:
    @router.get("/watch")
    def get_watch() -> dict:
        return watch.get_watcher(get_store()).status().to_wire()

    @router.put("/watch")
    async def put_watch(body: WatchRequest) -> dict:
        """Watch a folder (``null`` stops); 422 carries the validation sentence."""
        watcher = watch.get_watcher(get_store())
        try:
            status = await run_in_threadpool(watcher.set_folder, body.folder)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return status.to_wire()
