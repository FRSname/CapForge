"""Failures the library raises; the router maps them to status codes."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.schemas import VideoRecord


class LibraryError(Exception):
    """Base for every library failure."""


class RecordNotFound(LibraryError):
    """No record folder with that id (404)."""


class MediaNotFound(LibraryError):
    """The source media is unreadable, so no record can be created (404)."""


class StaleRevision(LibraryError):
    """``If-Match`` did not equal the stored ``rev`` (409).

    Carries the *current* record so the caller re-reads instead of clobbering
    (vision §2.3) — today's 409s carry only a detail string.
    """

    def __init__(self, current: "VideoRecord") -> None:
        super().__init__(
            f"Record {current.id} is at rev {current.rev}; re-read it before writing again"
        )
        self.current = current


class ScratchReadOnly(LibraryError):
    """A scratch record's dossier cannot be patched until it is promoted (409)."""


class MediaInUse(LibraryError):
    """Relink target already belongs to another record, library or scratch (409).

    Carries that record's id so the UI can point at the card that owns the file.
    """

    def __init__(self, video_id: str) -> None:
        super().__init__(f"That file already belongs to library record {video_id}")
        self.video_id = video_id


class MediaMismatch(LibraryError):
    """Relink target is different media from the record's; needs ``force`` (409)."""
