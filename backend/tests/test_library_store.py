"""LibraryStore: identity, revisions, scratch, derived transcript, status, index."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.library import paths
from backend.library.schemas import (
    HISTORY_CAP,
    HISTORY_PREV_MAX_CHARS,
    Chapter,
    Link,
    RecordPatch,
    RenderEntry,
)
from backend.library.store import (
    SCRATCH_LIFESPAN_DAYS,
    LibraryStore,
    MediaNotFound,
    RecordNotFound,
    ScratchReadOnly,
    StaleRevision,
)

WORDS = ["Hello", "brave", "new", "world"]


@pytest.fixture
def store(tmp_path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def media(tmp_path, name: str = "talk.mp4", body: bytes = b"media") -> Path:
    p = tmp_path / name
    p.write_bytes(body * 20)
    return p


def project(words=WORDS, language="en", duration=4.0) -> dict:
    return {
        "version": 2,
        "studioSettings": {"fontSize": 48},
        "transcriptionResult": {
            "segments": [
                {
                    "start": 0.0,
                    "end": duration,
                    "text": " ".join(words),
                    "words": [
                        {
                            "word": w,
                            "start": float(i),
                            "end": float(i + 1),
                            "wid": f"w{i}",
                            "overrides": {"color": "#fff"},
                        }
                        for i, w in enumerate(words)
                    ],
                }
            ],
            "language": language,
            "audio_path": "/tmp/a.wav",
            "duration": duration,
        },
    }


# --- create / identity -------------------------------------------------------

def test_create_mints_system_fields(store, tmp_path):
    src = media(tmp_path)
    rec = store.create(str(src))
    assert len(rec.id) == 32
    assert rec.rev == 1
    assert rec.fingerprint and rec.sourceTag
    assert Path(rec.sourcePath) == src.resolve()
    assert rec.createdAt.endswith("Z") and rec.updatedAt.endswith("Z")
    assert rec.scratch is False


def test_create_dedupes_by_fingerprint(store, tmp_path):
    src = media(tmp_path)
    first = store.create(str(src))
    again = store.create(str(src))
    assert again.id == first.id
    assert len(store.list()) == 1


def test_create_scratch_on_a_known_real_record_returns_the_real_one(store, tmp_path):
    src = media(tmp_path)
    real = store.create(str(src))
    same = store.create(str(src), scratch=True)
    assert same.id == real.id
    assert same.scratch is False


def test_create_non_scratch_on_a_known_scratch_record_promotes_it(store, tmp_path):
    src = media(tmp_path)
    scratch = store.create(str(src), scratch=True)
    promoted = store.create(str(src))
    assert promoted.id == scratch.id
    assert promoted.scratch is False
    assert not paths.record_dir(scratch.id, scratch=True, root=store.root).exists()
    assert paths.record_dir(scratch.id, root=store.root).exists()


def test_create_missing_media_raises(store, tmp_path):
    with pytest.raises(MediaNotFound):
        store.create(str(tmp_path / "nope.mp4"))


def test_get_unknown_id_raises(store):
    with pytest.raises(RecordNotFound):
        store.get("deadbeef")


def test_find_by_path(store, tmp_path):
    src = media(tmp_path)
    rec = store.create(str(src))
    assert store.find_by_path(str(src)).id == rec.id
    assert store.find_by_path(str(tmp_path / "other.mp4")) is None


def test_missing_media_is_derived_at_read_time(store, tmp_path):
    src = media(tmp_path)
    rec = store.create(str(src))
    assert store.get(rec.id).missing_media is False
    src.unlink()
    assert store.get(rec.id).missing_media is True
    assert store.list()[0]["missing_media"] is True


# --- patch / revisions / history ---------------------------------------------

def test_patch_bumps_rev_and_stamps_history(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    out = store.patch(rec.id, RecordPatch(title="A talk"), rev=rec.rev, by="agent")
    assert out.rev == rec.rev + 1
    assert out.title == "A talk"
    assert [h.field for h in out.history] == ["title"]
    assert out.history[0].by == "agent" and out.history[0].prev == ""
    assert out.updatedAt >= rec.updatedAt
    assert store.get(rec.id).title == "A talk"


def test_patch_with_an_unchanged_value_is_a_no_op(store, tmp_path):
    """Sending a field back with the value it already holds is not an edit:
    no rev bump, no history entry — otherwise a debounced insert-then-remove
    of a chapter stamps "edited" on a list that never changed."""
    rec = store.create(str(media(tmp_path)))
    rec = store.patch(rec.id, RecordPatch(title="T", chapters=[]), rev=rec.rev, by="user")
    assert rec.rev == 2
    assert [h.field for h in rec.history] == ["title"]  # chapters [] -> [] never happened

    same = store.patch(rec.id, RecordPatch(title="T", chapters=[]), rev=rec.rev, by="user")
    assert same.rev == 2
    assert [h.field for h in same.history] == ["title"]
    assert store.get(rec.id).updatedAt == rec.updatedAt

    mixed = store.patch(rec.id, RecordPatch(title="T", description="D"), rev=rec.rev, by="agent")
    assert mixed.rev == 3
    assert [h.field for h in mixed.history] == ["title", "description"]


def test_patch_only_touches_fields_that_were_set(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    rec = store.patch(rec.id, RecordPatch(title="T", description="D"), rev=rec.rev, by="user")
    rec = store.patch(rec.id, RecordPatch(description="D2"), rev=rec.rev, by="user")
    assert rec.title == "T" and rec.description == "D2"
    assert [h.field for h in rec.history] == ["title", "description", "description"]


def test_patch_replaces_lists_wholesale(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    rec = store.patch(rec.id, RecordPatch(links=[Link(label="a", url="u")]), rev=rec.rev, by="user")
    rec = store.patch(rec.id, RecordPatch(links=[Link(label="b", url="v")]), rev=rec.rev, by="user")
    assert [l.label for l in rec.links] == ["b"]


def test_patch_truncates_long_prev_and_caps_history(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    long_text = "x" * (HISTORY_PREV_MAX_CHARS * 3)
    rec = store.patch(rec.id, RecordPatch(description=long_text), rev=rec.rev, by="agent")
    rec = store.patch(rec.id, RecordPatch(description="short"), rev=rec.rev, by="agent")
    assert rec.history[-1].prev == "x" * HISTORY_PREV_MAX_CHARS

    for i in range(HISTORY_CAP + 5):
        rec = store.patch(rec.id, RecordPatch(title=f"t{i}"), rev=rec.rev, by="user")
    assert len(rec.history) == HISTORY_CAP
    assert rec.history[-1].prev == f"t{HISTORY_CAP + 3}"


def test_patch_stale_rev_raises_with_the_current_record(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    store.patch(rec.id, RecordPatch(title="first"), rev=rec.rev, by="user")
    with pytest.raises(StaleRevision) as excinfo:
        store.patch(rec.id, RecordPatch(title="second"), rev=rec.rev, by="user")
    current = excinfo.value.current
    assert current.rev == rec.rev + 1
    assert current.title == "first"
    assert store.get(rec.id).title == "first"


def test_patch_publish_mirrors_published_at(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    out = store.patch(
        rec.id,
        RecordPatch(publish={"youtube": {"videoId": "abc", "publishedAt": "2026-09-01T10:00:00Z"}}),
        rev=rec.rev,
        by="user",
    )
    assert out.publishedAt == "2026-09-01T10:00:00Z"


def test_patch_leaves_no_tmp_files(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    store.patch(rec.id, RecordPatch(title="A"), rev=rec.rev, by="user")
    folder = paths.record_dir(rec.id, root=store.root)
    assert not list(folder.glob("*.tmp"))


# --- scratch -----------------------------------------------------------------

def test_scratch_is_hidden_read_only_and_promotable(store, tmp_path):
    rec = store.create(str(media(tmp_path)), scratch=True)
    assert rec.scratch is True
    assert paths.record_dir(rec.id, scratch=True, root=store.root).exists()
    assert store.list() == []
    assert [v["id"] for v in store.list(include_scratch=True)] == [rec.id]

    with pytest.raises(ScratchReadOnly):
        store.patch(rec.id, RecordPatch(title="nope"), rev=rec.rev, by="agent")

    promoted = store.promote(rec.id)
    assert promoted.scratch is False
    assert [v["id"] for v in store.list()] == [rec.id]
    assert store.patch(rec.id, RecordPatch(title="ok"), rev=promoted.rev, by="agent").title == "ok"


def test_prune_scratch_removes_old_records_only(store, tmp_path):
    fresh = store.create(str(media(tmp_path, "fresh.mp4", b"a")), scratch=True)
    stale = store.create(str(media(tmp_path, "stale.mp4", b"b")), scratch=True)
    keeper = store.create(str(media(tmp_path, "keep.mp4", b"c")))

    old = (datetime.now(timezone.utc) - timedelta(days=SCRATCH_LIFESPAN_DAYS + 1)).isoformat().replace("+00:00", "Z")
    folder = paths.record_dir(stale.id, scratch=True, root=store.root)
    raw = json.loads((folder / paths.RECORD_FILE).read_text())
    raw["updatedAt"] = old
    (folder / paths.RECORD_FILE).write_text(json.dumps(raw))

    assert store.prune_scratch() == 1
    assert not folder.exists()
    ids = {v["id"] for v in store.list(include_scratch=True)}
    assert ids == {fresh.id, keeper.id}


# --- project / transcript ----------------------------------------------------

def test_put_project_writes_both_files_and_strips_renderer_keys(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    out = store.put_project(rec.id, project())
    folder = paths.record_dir(rec.id, root=store.root)
    assert (folder / paths.PROJECT_FILE).exists()
    assert (folder / paths.TRANSCRIPT_FILE).exists()
    assert out.rev == rec.rev + 1
    assert out.duration == 4.0 and out.language == "en"

    raw = (folder / paths.TRANSCRIPT_FILE).read_text()
    assert "wid" not in raw and "overrides" not in raw
    assert store.get_project(rec.id)["studioSettings"] == {"fontSize": 48}
    assert not list(folder.glob("*.tmp"))


def test_put_project_rejects_a_malformed_project(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    for bad in ({}, {"version": 2}, {"version": "2", "transcriptionResult": {}}, {"version": 2, "transcriptionResult": []}):
        with pytest.raises(ValueError):
            store.put_project(rec.id, bad)
    assert store.get_transcript(rec.id, segments_only=True) is None


def test_get_transcript_modes(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    assert store.get_transcript(rec.id, segments_only=True) is None
    store.put_project(rec.id, project())

    full = store.get_transcript(rec.id, segments_only=False)
    assert full["segments"][0]["words"][0]["word"] == "Hello"

    lean = store.get_transcript(rec.id, segments_only=True)
    assert "words" not in lean["segments"][0]
    assert lean["duration"] == 4.0 and lean["language"] == "en"
    assert lean["segments"][0]["text"] == "Hello brave new world"


def test_get_project_is_none_before_any_put(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    assert store.get_project(rec.id) is None


# --- status ------------------------------------------------------------------

def test_status_ladder_through_the_store(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    assert store.status_of(store.get(rec.id)) == "imported"

    store.put_project(rec.id, project())
    assert store.status_of(store.get(rec.id)) == "transcribed"

    store.add_render(rec.id, RenderEntry(path="/out/a.mp4", kind="video", at="2026-09-14T10:00:00Z"))
    rec = store.get(rec.id)
    assert len(rec.renders) == 1
    assert store.status_of(rec) == "captioned"

    rec = store.patch(rec.id, RecordPatch(description="A description"), rev=rec.rev, by="agent")
    assert store.status_of(rec) == "drafted"

    rec = store.patch(rec.id, RecordPatch(publish={"youtube": {"videoId": "vid1"}}), rev=rec.rev, by="agent")
    assert store.status_of(rec) == "published"
    assert store.list()[0]["status"] == "published"


def test_add_render_appends_and_bumps_rev(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    store.add_render(rec.id, RenderEntry(path="/a.mp4", kind="video", at="t1"))
    out = store.add_render(rec.id, RenderEntry(path="/b.mov", kind="overlay", at="t2"))
    assert [r.path for r in out.renders] == ["/a.mp4", "/b.mov"]
    assert out.rev == rec.rev + 2


# --- list / search -----------------------------------------------------------

def test_list_summary_shape(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    store.patch(rec.id, RecordPatch(title="Ship it"), rev=rec.rev, by="user")
    summary = store.list()[0]
    assert set(summary) == {
        "id", "title", "sourcePath", "duration", "language", "status",
        "collection_id", "scratch", "createdAt", "updatedAt", "missing_media",
        # Derived at read time like status, so the card knows whether opening
        # the record restores a session or starts a transcription (#3).
        "hasProject",
        # Also derived: a poster.jpg exists in the record folder (#6).
        "poster",
    }
    assert summary["title"] == "Ship it"
    assert summary["hasProject"] is False


def test_list_filters_by_status_collection_and_query(store, tmp_path):
    a = store.create(str(media(tmp_path, "a.mp4", b"aaa")))
    b = store.create(str(media(tmp_path, "b.mp4", b"bbb")))
    store.put_project(a.id, project(words=["Kubernetes", "at", "scale"]))
    store.patch(a.id, RecordPatch(title="Kubernetes", collection_id="conf26", chapters=[Chapter(start_s=0.0, title="Intro")]), rev=store.get(a.id).rev, by="agent")
    store.patch(b.id, RecordPatch(title="Baking bread"), rev=b.rev, by="agent")

    assert {v["id"] for v in store.list(status="imported")} == {b.id}
    assert {v["id"] for v in store.list(status="transcribed")} == {a.id}
    assert {v["id"] for v in store.list(collection="conf26")} == {a.id}
    assert {v["id"] for v in store.list(q="kubernetes")} == {a.id}
    assert {v["id"] for v in store.list(q="bread")} == {b.id}
    assert store.list(q="nothingmatches") == []


def test_rebuild_index_from_folders_after_the_db_is_deleted(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    store.put_project(rec.id, project(words=["Kubernetes", "at", "scale"]))
    store.patch(rec.id, RecordPatch(title="Kubernetes"), rev=store.get(rec.id).rev, by="agent")
    store.close()

    db = store.root / paths.INDEX_DB_NAME
    for leftover in store.root.glob(paths.INDEX_DB_NAME + "*"):
        leftover.unlink()
    assert not db.exists()

    fresh = LibraryStore(store.root)
    fresh.ensure_index()
    assert {v["id"] for v in fresh.list(q="kubernetes")} == {rec.id}
    fresh.close()


def test_index_forgets_a_deleted_record_folder_after_rebuild(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    store.patch(rec.id, RecordPatch(title="Kubernetes"), rev=rec.rev, by="agent")
    shutil.rmtree(paths.record_dir(rec.id, root=store.root))
    store.rebuild_index()
    assert store.list(q="kubernetes") == []


def test_status_follows_a_rewritten_transcript(store, tmp_path):
    """The segments check is cached by mtime+size — a rewrite must invalidate it."""
    rec = store.create(str(media(tmp_path)))
    store.put_project(rec.id, project())
    assert store.status_of(store.get(rec.id)) == "transcribed"

    emptied = project()
    emptied["transcriptionResult"]["segments"] = []
    store.put_project(rec.id, emptied)
    assert store.status_of(store.get(rec.id)) == "imported"


# --- id hygiene ---------------------------------------------------------------

@pytest.mark.parametrize("bad_id", ["..", ".scratch", "", "ABC", "e9e0/../x", "a" * 31, "z" * 32])
def test_get_rejects_non_hex_ids_before_touching_disk(tmp_path, bad_id):
    """A record id is always a uuid4 hex; anything else is a 404, never a path."""
    from backend.library.store import LibraryStore, RecordNotFound
    store = LibraryStore(tmp_path)
    with pytest.raises(RecordNotFound):
        store.get(bad_id)
