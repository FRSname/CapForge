"""Atomic JSON writes and media identity for library records.

Every durable file the library owns is written as a sibling ``.tmp`` in the
same directory and swapped in with ``os.replace`` (the precedent is
``write_coauthor_marker`` in ``hyperframes_project.py``), so a crash mid-write
leaves either the previous file or the new one — never a torn one.

On Windows ``os.replace`` (MoveFileEx) fails with ``PermissionError`` while any
other handle holds the destination open — Python's ``open()`` does not pass
``FILE_SHARE_DELETE`` — and a read can hit the same sharing violation mid-swap.
Background readers (the media-facts pool) and request-thread writers make that
a real race, so both sides retry that one error with a short, bounded backoff.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

_T = TypeVar("_T")

#: Bytes hashed from each end of the media for the content fingerprint. Hashing
#: the whole file would make a 4 GB import take minutes for no extra safety.
FINGERPRINT_EDGE_BYTES = 1024 * 1024
SOURCE_TAG_LEN = 8

#: Tries (not retries) at a swap or read that keeps hitting a sharing
#: violation. With the backoff below the worst case waits about 1.1 s.
REPLACE_ATTEMPTS = 10
REPLACE_BACKOFF_S = 0.01
REPLACE_BACKOFF_MAX_S = 0.2


def _retry_permission_error(
    action: Callable[[], _T], what: str, attempts: int, sleep: Callable[[float], Any]
) -> _T:
    """Run ``action``, retrying only ``PermissionError`` with capped exponential
    backoff; the last error is re-raised once ``attempts`` are spent."""
    delay = REPLACE_BACKOFF_S
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except PermissionError as exc:
            if attempt >= attempts:
                raise
            logger.warning(
                "%s hit a sharing violation (attempt %d/%d), retrying in %.3fs: %s",
                what, attempt, attempts, delay, exc,
            )
            sleep(delay)
            delay = min(delay * 2, REPLACE_BACKOFF_MAX_S)
    raise ValueError(f"attempts must be >= 1, got {attempts}")


def replace_with_retry(
    src: str | os.PathLike[str],
    dst: str | os.PathLike[str],
    *,
    attempts: int = REPLACE_ATTEMPTS,
    sleep: Callable[[float], Any] = time.sleep,
) -> None:
    """``os.replace(src, dst)``, retried on ``PermissionError`` only (a Windows
    handle open on ``dst``). Any other ``OSError`` — a missing ``src`` — fails
    on the first try."""
    _retry_permission_error(
        lambda: os.replace(src, dst), f"Replacing {dst}", attempts, sleep
    )


def write_json_atomic(path: Path, data: Any) -> None:
    """Serialize ``data`` to ``path`` via tmp + ``os.replace``; parents created.

    The swap goes through :func:`replace_with_retry`; after a final failure the
    ``finally`` still removes the ``.tmp``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        replace_with_retry(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def read_json(
    path: Path,
    *,
    attempts: int = REPLACE_ATTEMPTS,
    sleep: Callable[[float], Any] = time.sleep,
) -> Any:
    """Parse ``path``; a read that races a Windows swap is retried like
    :func:`replace_with_retry`."""
    text = _retry_permission_error(
        lambda: path.read_text(encoding="utf-8"), f"Reading {path}", attempts, sleep
    )
    return json.loads(text)


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
