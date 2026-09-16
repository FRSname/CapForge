"""The one write-side step of the schema upgrade: keeping the schema-1 file.

docs/plans/multi-channel-pr2-contract.md → Upgrade → Backup. Before
``LibraryStore._persist`` replaces a ``record.json`` that has no ``schema`` (or
``schema: 1``), the file is copied byte for byte to ``record.v1.json`` beside it,
once: an existing backup is never overwritten. Reads never call this.
"""

from __future__ import annotations

import logging
from pathlib import Path

from backend.library import fs
from backend.library.paths import RECORD_V1_FILE
from backend.library.record_upgrade import is_v1

logger = logging.getLogger(__name__)


def backup_v1(record_path: Path) -> bool:
    """Copy a schema-1 ``record_path`` to ``record.v1.json``; True when it did.

    A missing file (a record being created) or an existing backup is a no-op.
    A ``record.json`` that is not readable JSON raises, as the read before any
    write would have.
    """
    if not record_path.is_file():
        return False
    backup = record_path.with_name(RECORD_V1_FILE)
    if backup.exists():
        return False
    raw = fs.read_json(record_path)
    if not isinstance(raw, dict) or not is_v1(raw):
        return False
    fs.copy_file_atomic(record_path, backup)
    logger.info("Kept the schema-1 record as %s before upgrading it", backup)
    return True
