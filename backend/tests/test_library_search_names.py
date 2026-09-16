"""Search finds a video by the name its card shows.

Most records have no authored title, so the card shows the source file's stem
(``displayTitle`` in ``lib/libraryView.ts``). The index's title column carries
that stem as words beside the title, and follows the file through a relink."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest

from backend.library import paths
from backend.library.index import SCHEMA_VERSION
from backend.library.schemas import RecordPatch
from backend.library.store import LibraryStore
from backend.library.store_posts import index_title, source_stem_words


@pytest.fixture
def store(tmp_path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def media(folder: Path, name: str, body: bytes) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(body * 64)
    return p


def found(store: LibraryStore, q: str) -> set[str]:
    return {v["id"] for v in store.list(q=q)}


@pytest.mark.parametrize("path,words", [
    ("/m/vizualni-smog.mp4", "vizualni smog"),
    ("C:\\m\\talk_v2.final.mov", "talk v2 final"),
    ("/m/a  --  b.mp4", "a b"),
    ("/m/.hidden", "hidden"),
    ("/m/noext", "noext"),
    ("", ""),
])
def test_source_stem_words(path, words):
    assert source_stem_words(path) == words


def test_index_title_joins_title_and_stem():
    assert index_title("Keynote", "/m/uck26-day1.mp4") == "Keynote uck26 day1"
    assert index_title("  ", "/m/uck26-day1.mp4") == "uck26 day1"
    assert index_title("Keynote", "") == "Keynote"


@pytest.mark.parametrize("q", ["vizualni-smog", "vizualni", "vizu", "smog", "vizualni smog"])
def test_an_untitled_record_is_found_by_its_file_name(store, tmp_path, q):
    rec = store.create(media(tmp_path, "vizualni-smog.mp4", b"smog"))
    other = store.create(media(tmp_path, "baking.mp4", b"bread"))
    assert rec.title == ""
    assert found(store, q) == {rec.id}
    assert other.id not in found(store, q)


def test_title_and_file_name_both_match(store, tmp_path):
    rec = store.create(media(tmp_path, "Sazeni-stromku.mp4", b"trees"))
    store.patch(rec.id, RecordPatch(title="Sázení stromků"), rev=rec.rev, by="user")
    for q in ("sazeni", "Sázení", "stromk", "Sazeni-stromku"):
        assert found(store, q) == {rec.id}, q


def test_relink_reindexes_the_new_file_name(store, tmp_path):
    original = media(tmp_path / "old", "draft-cut.mp4", b"cut")
    rec = store.create(original)
    renamed = tmp_path / "new" / "final-premiere.mp4"
    renamed.parent.mkdir()
    os.replace(original, renamed)  # same bytes and mtime: the same media

    store.relink(rec.id, renamed, by="user")

    assert found(store, "premiere") == {rec.id}
    assert found(store, "draft") == set()


def test_an_old_schema_index_is_rebuilt_with_file_names(store, tmp_path):
    """A library.db from before the stem was indexed rebuilds on the next start."""
    rec = store.create(media(tmp_path, "vizualni-smog.mp4", b"smog"))
    store.close()

    db = store.root / paths.INDEX_DB_NAME
    conn = sqlite3.connect(str(db))
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION - 1}")
    # Empty the rows too, so only a rebuild can make the search below pass.
    for table in ("records_fts", "records_like"):
        if _has_table(conn, table):
            conn.execute(f"DELETE FROM {table}")
    conn.commit()
    conn.close()

    reopened = LibraryStore(store.root)
    try:
        assert reopened.index.needs_rebuild() is True
        reopened.ensure_index()
        assert reopened.index.needs_rebuild() is False
        assert found(reopened, "vizu") == {rec.id}
    finally:
        reopened.close()


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (name,)).fetchone()
    return row is not None
