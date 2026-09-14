"""Library housekeeping over HTTP: delete, import a project file, migrate.

Split out of ``router.py`` for its size ceiling. The three helpers it needs
(``get_store``, the view projection and the error→status contextmanager) are
**passed in** by ``build_router`` rather than imported, so this module has no
import edge back to ``router`` — the same reason the auth guard is injected.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable, ContextManager, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from starlette import status as http_status
from pydantic import BaseModel

logger = logging.getLogger(__name__)

#: ``remove`` hides the record and keeps its folder; ``detach`` also hands the
#: folder back so Electron can put it in the system Trash. Neither deletes.
DeleteMode = Literal["remove", "detach"]
DEFAULT_DELETE_MODE: DeleteMode = "remove"


class ImportProjectRequest(BaseModel):
    """A ``.capforge`` file the user picked; validated in ``read_project_file``."""

    path: str


def register_admin_routes(
    router: APIRouter,
    *,
    get_store: Callable,
    view: Callable,
    library_errors: Callable[[], ContextManager[None]],
    actor_dep: Callable,
    on_record_changed: Optional[Callable[[str, int, str], Awaitable[None]]] = None,
) -> None:
    """Register the delete/import/migrate routes on the library router.

    Declared before ``/{video_id}`` so the two fixed POST paths can never be
    captured by a record-id route.
    """
    _register_import_routes(
        router, get_store, view, library_errors, actor_dep, on_record_changed
    )
    _register_delete_route(router, get_store, library_errors)


def _register_import_routes(
    router: APIRouter,
    get_store: Callable,
    view: Callable,
    library_errors: Callable[[], ContextManager[None]],
    actor_dep: Callable,
    on_record_changed: Optional[Callable[[str, int, str], Awaitable[None]]],
) -> None:
    """Getting records *in*: one project file, or every studio workspace."""

    @router.post("/import-project")
    async def import_project(
        body: ImportProjectRequest,
        response: Response,
        actor: str = Depends(actor_dep),
    ) -> dict:
        """Adopt an outside project file: 201 for new media, 200 for a hit.

        A 404 (``MediaNotFound``) means the project names a video that is gone;
        a 422 carries the validation sentence verbatim, so the UI can show it.
        """
        store = get_store()
        with library_errors():
            try:
                record, created = store.import_project_file(body.path)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        response.status_code = (
            http_status.HTTP_201_CREATED if created else http_status.HTTP_200_OK
        )
        if on_record_changed is not None:
            await on_record_changed(record.id, record.rev, actor)
        return view(store, record)

    @router.post("/migrate-studio")
    def migrate_studio() -> dict:
        """First-launch adoption of the pre-v3 studio workspaces (idempotent)."""
        result = get_store().migrate_studio_workspaces()
        logger.info(
            "Studio migration: %d imported, %d skipped",
            len(result["imported"]), len(result["skipped"]),
        )
        return result


def _register_delete_route(
    router: APIRouter,
    get_store: Callable,
    library_errors: Callable[[], ContextManager[None]],
) -> None:
    """Getting a record *out* — without deleting one byte of it."""

    @router.delete("/{video_id}")
    def delete_video(video_id: str, mode: DeleteMode = DEFAULT_DELETE_MODE) -> dict:
        """Hide a record (``remove``) or hand its folder over (``detach``).

        An unknown ``mode`` is a 422 from the Literal — this route must never
        guess what a caller meant by a third word.
        """
        store = get_store()
        with library_errors():
            if mode == "detach":
                return {"status": "ok", "mode": mode, "folder": str(store.detach(video_id))}
            store.remove(video_id)
        return {"status": "ok", "mode": mode}
