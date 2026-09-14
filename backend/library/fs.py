"""Atomic JSON writes and media identity for library records.

Every durable file the library owns is written as a sibling ``.tmp`` in the
same directory and swapped in with ``os.replace`` (the precedent is
``write_coauthor_marker`` in ``hyperframes_project.py``), so a crash mid-write
leaves either the previous file or the new one — never a torn one.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

#: Bytes hashed from each end of the media for the content fingerprint. Hashing
#: the whole file would make a 4 GB import take minutes for no extra safety.
FINGERPRINT_EDGE_BYTES = 1024 * 1024
SOURCE_TAG_LEN = 8


def write_json_atomic(path: Path, data: Any) -> None:
    """Serialize ``data`` to ``path`` via tmp + ``os.replace``; parents created."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def source_tag(source_path: str | os.PathLike[str]) -> str:
    """``sha1(absolute path)[:8]`` — the join key to the studio workspace folder
    (``hyperframes_workspace`` derives the same value; a test pins them equal)."""
    src = Path(source_path).expanduser().resolve()
    return hashlib.sha1(str(src).encode("utf-8")).hexdigest()[:SOURCE_TAG_LEN]


def fingerprint(source_path: str | os.PathLike[str]) -> str:
    """Content identity that survives a move: size + mtime + sha1 of the first
    and last ``FINGERPRINT_EDGE_BYTES``. Raises ``OSError`` if unreadable."""
    p = Path(source_path).expanduser()
    st = p.stat()
    h = hashlib.sha1()
    with p.open("rb") as fh:
        h.update(fh.read(FINGERPRINT_EDGE_BYTES))
        if st.st_size > FINGERPRINT_EDGE_BYTES:
            fh.seek(max(st.st_size - FINGERPRINT_EDGE_BYTES, FINGERPRINT_EDGE_BYTES))
            h.update(fh.read(FINGERPRINT_EDGE_BYTES))
    return f"{st.st_size}-{int(st.st_mtime)}-{h.hexdigest()[:16]}"
