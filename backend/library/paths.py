"""Where the library lives on disk, and the fixed-name asset allowlist.

``capforge_home()`` is the ONE reader of ``CAPFORGE_HOME`` — discovery, the
studio workspace, the import guard and the library all resolve through it so a
test can relocate everything with a single env var (decision D5).
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional

CAPFORGE_HOME_ENV = "CAPFORGE_HOME"
LIBRARY_DIR_NAME = "library"
SCRATCH_DIR_NAME = ".scratch"
#: Where a removed / detached record folder is parked. Both are dot-folders so
#: they hold no ``record.json`` of their own and record iteration skips them —
#: the backend hides records, it never deletes their files (vision §9.1).
REMOVED_DIR_NAME = ".removed"
TRASH_DIR_NAME = ".trash"
#: Pre-v3 per-source HyperFrames workspaces, the input of the first-launch
#: migration (``hyperframes_workspace`` writes ``<home>/studio/<tag>``).
STUDIO_DIR_NAME = "studio"
INDEX_DB_NAME = "library.db"
RECORD_FILE = "record.json"
#: The schema-1 file as it was, kept once beside ``record.json`` by the first
#: write that upgrades it (``record_io.backup_v1``). Reads never write it.
RECORD_V1_FILE = "record.v1.json"
PROJECT_FILE = "project.capforge"
TRANSCRIPT_FILE = "transcript.json"
#: Thumbnail frames (``frames.py``) live in this sub-folder of the record.
THUMBNAILS_DIR = "thumbnails"

#: The only names the asset route will ever serve, resolved strictly under the
#: record folder — never a client-supplied path (vision §2.2).
ASSET_NAME_RE = re.compile(r"^(?:poster\.jpg|peaks\.bin|thumbnails/[0-9a-f]{8,64}\.jpg)$")


def capforge_home() -> Path:
    """``$CAPFORGE_HOME`` or ``~/.capforge``."""
    raw = os.environ.get(CAPFORGE_HOME_ENV)
    return Path(raw).expanduser() if raw else Path.home() / ".capforge"


def library_root() -> Path:
    return capforge_home() / LIBRARY_DIR_NAME


def record_dir(video_id: str, *, scratch: bool = False, root: Optional[Path] = None) -> Path:
    """Folder holding one record; scratch records hide under ``.scratch/``."""
    base = root if root is not None else library_root()
    return (base / SCRATCH_DIR_NAME / video_id) if scratch else (base / video_id)


def resolve_asset(record_folder: Path, name: str) -> Optional[Path]:
    """Return the on-disk path for an allowlisted asset name, or ``None``.

    ``None`` covers every rejection (name not on the allowlist, file missing,
    or a symlink that escapes the record folder) so the route can answer a
    uniform 404 without revealing which guard fired.
    """
    if not ASSET_NAME_RE.match(name):
        return None
    try:
        base = record_folder.resolve(strict=True)
        target = (record_folder / name).resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return None
    if base not in target.parents:
        return None
    return target if target.is_file() else None
