"""The disposable search index over the library.

The folders are the truth; this DB is a cache that is dropped and rebuilt when
it is missing or its ``user_version`` differs (§2.2). FTS5 is used when the
SQLite build has it and a plain table searched with ``LIKE`` when it does not —
the Windows embeddable Python is unverified on FTS5 (§9.6) — and if ``sqlite3``
itself cannot be imported, ``NullIndex`` keeps search working in pure Python.

Matching: FTS5 turns every word of the query into a *prefix* term, so typing
``vizu`` finds ``vizualni``; its default ``unicode61`` tokenizer folds case and
diacritics. The two fallbacks are substring searches over text passed through
``fold_text`` on both sides (casefold, combining marks stripped, runs of
whitespace/``-``/``_``/``.`` read as one space), so they fold diacritics too —
but only those Unicode decomposes (``ł``/``ø`` stay as they are).

Errors are never swallowed: a broken DB raises ``sqlite3.Error`` at the caller,
which is the signal to rebuild.

``LibraryIndex`` holds ONE connection shared by every thread that touches the
store (request threads, the poster pool, the watch-folder thread), so each
method that uses it takes the index's own ``RLock``: a shared
``sqlite3.Connection`` used concurrently can raise "recursive use of cursors"
or interleave two transactions.
"""

from __future__ import annotations

import re
import threading
import unicodedata
from pathlib import Path
from typing import Optional, Protocol, Union

try:  # pragma: no cover - exercised by monkeypatching `sqlite3` to None
    import sqlite3
except ImportError:  # pragma: no cover
    sqlite3 = None  # type: ignore[assignment]

#: Bump when the table shape changes, or when the indexed text or its folding
#: changes (2: the source file's stem joined the title column; the fallbacks
#: store folded text) — a mismatch forces a rebuild from folders.
SCHEMA_VERSION = 2

FTS_TABLE = "records_fts"
LIKE_TABLE = "records_like"
COLUMNS = ("id", "title", "description", "tags", "transcript")
_SEARCH_COLUMNS = ("title", "description", "tags", "transcript")
_LIKE_ESCAPE = "\\"
# Word characters minus ``_``: ``unicode61`` splits on it, so the query must too.
_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
_SEPARATOR_RUN_RE = re.compile(r"[\s_.\-]+", re.UNICODE)


def fold_text(text: str) -> str:
    """Case- and diacritic-insensitive form for the substring fallbacks.

    ``Sázení_stromků.v2`` → ``sazeni stromku v2``. Applied to the stored text
    and to the query alike, so the two always compare in the same form.
    """
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _SEPARATOR_RUN_RE.sub(" ", stripped.casefold()).strip()


class SearchIndex(Protocol):
    """What ``LibraryStore`` needs; both implementations satisfy it."""

    def needs_rebuild(self) -> bool: ...
    def reset(self) -> None: ...
    def upsert(self, video_id: str, title: str, description: str, tags_text: str, transcript_text: str) -> None: ...
    def delete(self, video_id: str) -> None: ...
    def search(self, q: str) -> list[str]: ...
    def close(self) -> None: ...


def has_fts5() -> bool:
    """Whether this SQLite build can create an FTS5 table."""
    if sqlite3 is None:
        return False
    try:
        with sqlite3.connect(":memory:") as conn:
            conn.execute("CREATE VIRTUAL TABLE probe USING fts5(x)")
        return True
    except sqlite3.Error:
        return False


class LibraryIndex:
    """SQLite-backed index; FTS5 when available, ``LIKE`` otherwise."""

    def __init__(self, db_path: Union[str, Path]) -> None:
        if sqlite3 is None:  # pragma: no cover - guarded by open_index
            raise RuntimeError("sqlite3 is unavailable; use NullIndex")
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.fts = has_fts5()
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._stored_version = int(self._conn.execute("PRAGMA user_version").fetchone()[0])
        self._create_table()

    @property
    def table(self) -> str:
        return FTS_TABLE if self.fts else LIKE_TABLE

    def _create_table(self) -> None:
        with self._lock:
            self._create_table_locked()

    def _create_table_locked(self) -> None:
        if self.fts:
            columns = ", ".join(["id UNINDEXED", *_SEARCH_COLUMNS])
            self._conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5({columns})"
            )
        else:
            columns = ", ".join(["id TEXT PRIMARY KEY", *(f"{c} TEXT" for c in _SEARCH_COLUMNS)])
            self._conn.execute(f"CREATE TABLE IF NOT EXISTS {LIKE_TABLE} ({columns})")
        self._conn.commit()

    def needs_rebuild(self) -> bool:
        """True on a fresh DB (``user_version`` 0) or a schema mismatch."""
        with self._lock:
            return self._stored_version != SCHEMA_VERSION

    def reset(self) -> None:
        """Drop every row and stamp the current schema version."""
        with self._lock:
            self._conn.execute(f"DROP TABLE IF EXISTS {FTS_TABLE}")
            self._conn.execute(f"DROP TABLE IF EXISTS {LIKE_TABLE}")
            self._create_table_locked()
            self._conn.execute(f"PRAGMA user_version = {int(SCHEMA_VERSION)}")
            self._conn.commit()
            self._stored_version = SCHEMA_VERSION

    def upsert(
        self,
        video_id: str,
        title: str,
        description: str,
        tags_text: str,
        transcript_text: str,
    ) -> None:
        placeholders = ", ".join("?" * len(COLUMNS))
        texts = (title, description, tags_text, transcript_text)
        if not self.fts:
            texts = tuple(fold_text(text) for text in texts)
        with self._lock:
            self._conn.execute(f"DELETE FROM {self.table} WHERE id = ?", (video_id,))
            self._conn.execute(
                f"INSERT INTO {self.table} ({', '.join(COLUMNS)}) VALUES ({placeholders})",
                (video_id, *texts),
            )
            self._conn.commit()

    def delete(self, video_id: str) -> None:
        with self._lock:
            self._conn.execute(f"DELETE FROM {self.table} WHERE id = ?", (video_id,))
            self._conn.commit()

    def search(self, q: str) -> list[str]:
        if not q or not q.strip():
            return []
        if self.fts:
            match = _fts_match_expression(q)
            if match is None:
                return []
            sql = f"SELECT id FROM {FTS_TABLE} WHERE {FTS_TABLE} MATCH ? ORDER BY rank"
            params: tuple[str, ...] = (match,)
        else:
            needle = fold_text(q)
            if not needle:
                return []
            pattern = f"%{_escape_like(needle)}%"
            where = " OR ".join(f"{c} LIKE ? ESCAPE '{_LIKE_ESCAPE}'" for c in _SEARCH_COLUMNS)
            sql = f"SELECT id FROM {LIKE_TABLE} WHERE {where} ORDER BY rowid"
            params = tuple([pattern] * len(_SEARCH_COLUMNS))
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [row[0] for row in rows]

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class NullIndex:
    """Pure-Python fallback for a runtime without ``sqlite3`` at all.

    Same interface, an in-memory dict, substring search over ``fold_text``
    (like the ``LIKE`` table). Nothing is persisted,
    so it reports ``needs_rebuild()`` until the store has filled it.
    """

    def __init__(self, db_path: Union[str, Path, None] = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else None
        self.fts = False
        self._rows: dict[str, str] = {}
        self._built = False

    def needs_rebuild(self) -> bool:
        return not self._built

    def reset(self) -> None:
        self._rows = {}
        self._built = True

    def upsert(
        self,
        video_id: str,
        title: str,
        description: str,
        tags_text: str,
        transcript_text: str,
    ) -> None:
        self._rows = {
            **self._rows,
            video_id: fold_text(" ".join((title, description, tags_text, transcript_text))),
        }

    def delete(self, video_id: str) -> None:
        self._rows = {k: v for k, v in self._rows.items() if k != video_id}

    def search(self, q: str) -> list[str]:
        if not q or not q.strip():
            return []
        needle = fold_text(q)
        if not needle:
            return []
        return [vid for vid, haystack in self._rows.items() if needle in haystack]

    def close(self) -> None:
        self._rows = {}


def open_index(db_path: Union[str, Path]) -> SearchIndex:
    """``LibraryIndex`` when SQLite is importable, ``NullIndex`` when it is not."""
    if sqlite3 is None:
        return NullIndex(db_path)
    return LibraryIndex(db_path)


def _fts_match_expression(q: str) -> Optional[str]:
    """Quote each token and make it a prefix term: ``vizu smo`` → ``"vizu"* "smo"*``.

    Quoting keeps user text from ever being FTS5 *syntax*: ``kubernetes AND (``
    from a search box must return rows or nothing — never an
    ``sqlite3.OperationalError``. The terms are ANDed (FTS5's implicit
    operator), so every word typed has to start a word somewhere in the row.
    """
    tokens = _TOKEN_RE.findall(q)
    if not tokens:
        return None
    return " ".join(f'"{token}"*' for token in tokens)


def _escape_like(q: str) -> str:
    escaped = q.strip().replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
    for wildcard in ("%", "_"):
        escaped = escaped.replace(wildcard, _LIKE_ESCAPE + wildcard)
    return escaped
