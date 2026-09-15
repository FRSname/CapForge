"""The store's derived ``languages`` (publish-editors Part B, decision 6).

Read-only and derived at read time like ``status`` and ``hasProject``: never a
``VideoRecord`` field, and only on the single-record view (the list summary
stays cheap).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from backend.library.localized import derive_languages
from backend.library.paths import PROJECT_FILE
from backend.library.schemas import VideoRecord

if TYPE_CHECKING:  # pragma: no cover
    from backend.library.store import LibraryStore

logger = logging.getLogger(__name__)


class LocalizedStoreMixin:
    """``languages_of``, mixed into ``LibraryStore``."""

    def languages_of(self: "LibraryStore", record: VideoRecord) -> list[str]:
        """Source language, the stored project's track languages, the localized keys.

        A missing project contributes nothing. An unreadable one is logged and
        skipped: the record view must still answer, and ``GET …/project`` is
        where that file's own error surfaces.
        """
        try:
            project = self._read_json(record, PROJECT_FILE)
        except (OSError, ValueError) as exc:
            logger.warning(
                "Record %s: skipped its unreadable %s while deriving languages: %s",
                record.id, PROJECT_FILE, exc,
            )
            project = None
        return derive_languages(record, project)
