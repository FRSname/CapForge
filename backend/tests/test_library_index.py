"""The disposable search index: FTS5 when available, LIKE when not, NullIndex
when sqlite3 itself is missing (the Windows embeddable-python risk, §9.6)."""

from __future__ import annotations

import sqlite3

import pytest

from backend.library import index as index_mod
from backend.library.index import SCHEMA_VERSION, LibraryIndex, NullIndex, has_fts5, open_index

TITLE = "Kubernetes at scale"
DESCRIPTION = "How we ran a cluster for a year"
TAGS = "kubernetes devops platform"
TRANSCRIPT = "Hello brave new world of container orchestration"


def _seed(idx) -> None:
    idx.upsert("vid1", TITLE, DESCRIPTION, TAGS, TRANSCRIPT)
    idx.upsert("vid2", "Baking sourdough", "A loaf a week", "bread food", "flour water salt")


@pytest.fixture
def fts(tmp_path):
    if not has_fts5():
        pytest.skip("SQLite build has no FTS5")
    idx = LibraryIndex(tmp_path / "library.db")
    idx.reset()
    yield idx
    idx.close()


@pytest.fixture
def like(tmp_path, monkeypatch):
    monkeypatch.setattr(index_mod, "has_fts5", lambda: False)
    idx = LibraryIndex(tmp_path / "like.db")
    idx.reset()
    yield idx
    idx.close()


@pytest.mark.parametrize("fixture_name", ["fts", "like"])
@pytest.mark.parametrize("query,expected", [
    ("kubernetes", {"vid1"}),
    ("KUBERNETES", {"vid1"}),
    ("cluster", {"vid1"}),
    ("orchestration", {"vid1"}),
    ("sourdough", {"vid2"}),
    ("flour", {"vid2"}),
    ("nothinghere", set()),
    ("", set()),
])
def test_search_hits_every_indexed_column(request, fixture_name, query, expected):
    idx = request.getfixturevalue(fixture_name)
    _seed(idx)
    assert set(idx.search(query)) == expected


@pytest.mark.parametrize("fixture_name", ["fts", "like"])
def test_upsert_replaces_and_delete_removes(request, fixture_name):
    idx = request.getfixturevalue(fixture_name)
    _seed(idx)
    idx.upsert("vid1", "Baking sourdough too", "", "", "")
    assert idx.search("kubernetes") == []
    assert set(idx.search("sourdough")) == {"vid1", "vid2"}
    idx.delete("vid1")
    assert set(idx.search("sourdough")) == {"vid2"}
    idx.delete("vid1")  # deleting twice is not an error


@pytest.mark.parametrize("fixture_name", ["fts", "like"])
def test_reset_empties_the_index(request, fixture_name):
    idx = request.getfixturevalue(fixture_name)
    _seed(idx)
    idx.reset()
    assert idx.search("kubernetes") == []
    assert idx.needs_rebuild() is False


@pytest.mark.parametrize("fixture_name", ["fts", "like"])
def test_search_query_with_fts_punctuation_does_not_raise(request, fixture_name):
    idx = request.getfixturevalue(fixture_name)
    _seed(idx)
    for weird in ['"', 'kubernetes AND', 'k8s* OR (', "it's", "100%"]:
        assert isinstance(idx.search(weird), list)


def test_fresh_db_needs_a_rebuild(tmp_path):
    idx = LibraryIndex(tmp_path / "library.db")
    assert idx.needs_rebuild() is True
    idx.reset()
    assert idx.needs_rebuild() is False
    idx.close()


def test_schema_version_mismatch_needs_a_rebuild(tmp_path):
    db = tmp_path / "library.db"
    idx = LibraryIndex(db)
    idx.reset()
    idx.upsert("vid1", TITLE, DESCRIPTION, TAGS, TRANSCRIPT)
    idx.close()

    conn = sqlite3.connect(str(db))
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    conn.commit()
    conn.close()

    reopened = LibraryIndex(db)
    assert reopened.needs_rebuild() is True
    reopened.reset()
    assert reopened.search("kubernetes") == []
    reopened.close()


def test_sqlite_errors_propagate(tmp_path):
    idx = LibraryIndex(tmp_path / "library.db")
    idx.reset()
    idx.close()
    with pytest.raises(sqlite3.ProgrammingError):
        idx.upsert("vid1", TITLE, DESCRIPTION, TAGS, TRANSCRIPT)


def test_open_index_falls_back_to_null_index_without_sqlite3(tmp_path, monkeypatch):
    monkeypatch.setattr(index_mod, "sqlite3", None)
    idx = open_index(tmp_path / "library.db")
    assert isinstance(idx, NullIndex)
    idx.close()


def test_null_index_behaves_like_the_real_one(tmp_path):
    idx = NullIndex(tmp_path / "library.db")
    assert idx.needs_rebuild() is True
    idx.reset()
    assert idx.needs_rebuild() is False
    _seed(idx)
    assert set(idx.search("KUBERNETES")) == {"vid1"}
    assert set(idx.search("orchestration")) == {"vid1"}
    assert idx.search("") == []
    idx.delete("vid1")
    assert idx.search("kubernetes") == []
    idx.close()
