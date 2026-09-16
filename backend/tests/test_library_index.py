"""The disposable search index: FTS5 when available, LIKE when not, NullIndex
when sqlite3 itself is missing (the Windows embeddable-python risk, §9.6)."""

from __future__ import annotations

import sqlite3

import pytest

from backend.library import index as index_mod
from backend.library.index import (
    SCHEMA_VERSION,
    LibraryIndex,
    NullIndex,
    _fts_match_expression,
    fold_text,
    has_fts5,
    open_index,
)

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


# --- matching what people type ------------------------------------------------

CZECH_TITLE = "Sázení stromků"
CZECH_STEM = "Sazeni stromku"  # `Sazeni-stromku.mp4` as the store indexes it


@pytest.fixture
def null(tmp_path):
    idx = NullIndex(tmp_path / "library.db")
    idx.reset()
    yield idx
    idx.close()


def test_fts_query_is_quoted_prefix_terms():
    assert _fts_match_expression("vizu smo") == '"vizu"* "smo"*'
    assert _fts_match_expression("kubernetes AND (") == '"kubernetes"* "AND"*'
    # `_` splits a word, as unicode61 does, so `vizualni_smog` is two terms.
    assert _fts_match_expression("vizualni_smog") == '"vizualni"* "smog"*'
    assert _fts_match_expression('"*()') is None


@pytest.mark.parametrize("fixture_name", ["fts", "like", "null"])
@pytest.mark.parametrize("query,expected", [
    ("kube", {"vid1"}),
    ("sour", {"vid2"}),
    ("orchestr", {"vid1"}),
    ("Kube", {"vid1"}),
])
def test_a_word_start_matches_while_typing(request, fixture_name, query, expected):
    idx = request.getfixturevalue(fixture_name)
    _seed(idx)
    assert set(idx.search(query)) == expected


@pytest.mark.parametrize("fixture_name", ["fts", "like", "null"])
@pytest.mark.parametrize("query", ["vizu", "vizualni", "smog", "vizualni smog", "vizualni-smog"])
def test_file_stem_words_in_the_title_column_match(request, fixture_name, query):
    idx = request.getfixturevalue(fixture_name)
    _seed(idx)
    idx.upsert("vid3", "vizualni smog", "", "", "")
    assert set(idx.search(query)) == {"vid3"}


def test_fts_multi_word_query_needs_every_word(fts):
    _seed(fts)
    assert set(fts.search("kube scale")) == {"vid1"}
    assert fts.search("kube flour") == []


@pytest.mark.parametrize("fixture_name", ["fts", "like", "null"])
@pytest.mark.parametrize("query", ["sazeni", "SÁZENÍ", "stromk", "Sázení stromků"])
def test_czech_name_is_found_without_its_diacritics(request, fixture_name, query):
    idx = request.getfixturevalue(fixture_name)
    _seed(idx)
    idx.upsert("cz", f"{CZECH_TITLE} {CZECH_STEM}", "", "", "")
    assert set(idx.search(query)) == {"cz"}


@pytest.mark.parametrize("fixture_name", ["fts", "like", "null"])
def test_diacritics_fold_from_the_stored_side_too(request, fixture_name):
    idx = request.getfixturevalue(fixture_name)
    idx.upsert("cz", CZECH_TITLE, "", "", "")  # no ASCII stem to fall back on
    assert set(idx.search("sazeni")) == {"cz"}
    assert set(idx.search("STROMKU")) == {"cz"}


@pytest.mark.parametrize("fixture_name", ["like", "null"])
def test_fallback_wildcards_are_literal(request, fixture_name):
    idx = request.getfixturevalue(fixture_name)
    idx.upsert("pct", "100% done", "", "", "")
    idx.upsert("other", "1000 done", "", "", "")
    assert set(idx.search("100%")) == {"pct"}
    assert idx.search("-_.") == []


def test_fold_text():
    assert fold_text("Sázení_stromků.v2") == "sazeni stromku v2"
    assert fold_text("  Vizualni--Smog ") == "vizualni smog"
    assert fold_text("ŘEŘICHA") == "rericha"
    assert fold_text("") == ""


def test_an_index_built_before_the_file_stem_was_indexed_is_rebuilt(tmp_path):
    """Version 1 had no stem in the title column: its DB must not be trusted."""
    assert SCHEMA_VERSION >= 2
    db = tmp_path / "library.db"
    conn = sqlite3.connect(str(db))
    conn.execute("PRAGMA user_version = 1")
    conn.commit()
    conn.close()

    idx = LibraryIndex(db)
    assert idx.needs_rebuild() is True
    idx.reset()
    assert idx.needs_rebuild() is False
    idx.close()
