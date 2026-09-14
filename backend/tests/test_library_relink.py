"""``LibraryStore.relink`` — "Locate…" for a record whose media moved.

Plan: docs/plans/library-folder-import.md (Backend → Relink)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.library import fs
from backend.library.errors import (
    MediaInUse,
    MediaMismatch,
    MediaNotFound,
    RecordNotFound,
)
from backend.library.paths import RECORD_FILE
from backend.library.store import LibraryStore

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    AGENT_HEADER,
    AGENT_TOKEN,
    client,
    home,
    main_module,
)


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    """Records minted through ``get_store`` queue a real ffmpeg grab on the shared
    poster pool; left running, that backlog leaks into test_library_posters'
    call counts. Nothing here is about posters, so the hook is a no-op."""
    from backend.library import posters

    monkeypatch.setattr(posters, "start_grab", lambda store, record: None)


@pytest.fixture
def store(tmp_path: Path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def clip(folder: Path, name: str, body: str | None = None) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes((body or f"media:{folder.name}/{name}").encode() * 64)
    return p


def move(src: Path, folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / src.name
    os.replace(src, dest)
    return dest


def snapshot(media: str) -> dict:
    return {
        "version": 2,
        "selectedFilePath": media,
        "meta": {"selectedFilePath": media, "recent": [media, f"{media}.bak", f"see {media}"]},
        "transcriptionResult": {
            "segments": [{"start": 0.0, "end": 1.0, "text": media, "words": []}],
            "language": "en",
            "audio_path": media,
            "duration": 1.0,
        },
    }


def test_same_media_relinks_silently(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    moved = move(media, tmp_path / "new")

    relinked = store.relink(record.id, moved, by="user")

    assert relinked.sourcePath == str(moved.resolve())
    assert relinked.sourceTag == fs.source_tag(moved)
    assert relinked.fingerprint == record.fingerprint
    assert relinked.missing_media is False
    assert store.get(record.id).sourcePath == str(moved.resolve())


def test_relink_bumps_rev_stamps_history_and_updated_at(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    old_path = record.sourcePath
    moved = move(media, tmp_path / "new")

    relinked = store.relink(record.id, moved, by="agent")

    assert relinked.rev == record.rev + 1
    assert relinked.updatedAt
    last = relinked.history[-1]
    assert (last.field, last.prev, last.by) == ("sourcePath", old_path, "agent")


def test_a_different_file_needs_force(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    other = clip(tmp_path / "new", "different.mp4")

    with pytest.raises(MediaMismatch):
        store.relink(record.id, other, by="user")
    assert store.get(record.id).rev == record.rev  # nothing written

    forced = store.relink(record.id, other, by="user", force=True)
    assert forced.sourcePath == str(other.resolve())
    assert forced.fingerprint == fs.fingerprint(other)
    assert forced.fingerprint != record.fingerprint


def test_a_file_another_record_owns_is_refused_even_with_force(store, tmp_path):
    mine = store.create(clip(tmp_path / "a", "mine.mp4"))
    theirs_media = clip(tmp_path / "b", "theirs.mp4")
    theirs = store.create(theirs_media)

    for force in (False, True):
        with pytest.raises(MediaInUse) as caught:
            store.relink(mine.id, theirs_media, by="user", force=force)
        assert caught.value.video_id == theirs.id


def test_a_scratch_record_counts_as_an_owner(store, tmp_path):
    mine = store.create(clip(tmp_path / "a", "mine.mp4"))
    qa_media = clip(tmp_path / "b", "qa.mp4")
    qa = store.create(qa_media, scratch=True)
    with pytest.raises(MediaInUse) as caught:
        store.relink(mine.id, qa_media, by="user", force=True)
    assert caught.value.video_id == qa.id


def test_relinking_to_the_current_path_is_a_no_op(store, tmp_path):
    media = clip(tmp_path / "a", "talk.mp4")
    record = store.create(media)
    before = (store.root / record.id / RECORD_FILE).read_text()
    same = store.relink(record.id, media, by="user")
    assert same.rev == record.rev and same.history == []
    assert (store.root / record.id / RECORD_FILE).read_text() == before


def test_a_missing_or_non_file_target_is_media_not_found(store, tmp_path):
    record = store.create(clip(tmp_path / "a", "talk.mp4"))
    with pytest.raises(MediaNotFound):
        store.relink(record.id, tmp_path / "nowhere.mp4", by="user")
    with pytest.raises(MediaNotFound):
        store.relink(record.id, tmp_path, by="user")  # a directory


def test_unknown_record_is_record_not_found(store, tmp_path):
    with pytest.raises(RecordNotFound):
        store.relink("0" * 32, clip(tmp_path, "x.mp4"), by="user")


def test_only_exact_equal_strings_are_rewritten_deep(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    old = record.sourcePath
    store.put_project(record.id, snapshot(old))
    moved = move(media, tmp_path / "new")
    new = str(moved.resolve())

    store.relink(record.id, moved, by="user")

    project = store.get_project(record.id)
    assert project["selectedFilePath"] == new
    assert project["meta"]["selectedFilePath"] == new
    assert project["meta"]["recent"] == [new, f"{old}.bak", f"see {old}"]
    assert project["transcriptionResult"]["audio_path"] == new
    assert project["transcriptionResult"]["segments"][0]["text"] == new  # exact-equal, any key
    transcript = store.get_transcript(record.id, segments_only=False)
    assert transcript["audio_path"] == new
    folder = store.root / record.id
    assert not any(p.name.endswith(".tmp") for p in folder.iterdir())


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_symlinked_spelling_of_the_old_path_is_rewritten_too(store, tmp_path):
    real = tmp_path / "real"
    media = clip(real, "talk.mp4")
    alias = tmp_path / "alias"
    os.symlink(real, alias, target_is_directory=True)
    spelled = str(alias / "talk.mp4")  # what a file dialog may have handed the renderer
    record = store.create(spelled)
    assert record.sourcePath == str(media.resolve())
    store.put_project(record.id, snapshot(spelled))
    moved = move(media, tmp_path / "new")

    store.relink(record.id, moved, by="user")

    project = store.get_project(record.id)
    assert project["selectedFilePath"] == str(moved.resolve())
    assert project["meta"]["recent"][1] == f"{spelled}.bak"


def test_a_record_without_a_snapshot_relinks_without_creating_one(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    store.relink(record.id, move(media, tmp_path / "new"), by="user")
    assert store.get_project(record.id) is None
    assert store.get_transcript(record.id) is None


def test_relink_reindexes(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    calls: list[str] = []
    original = store._index_record
    store._index_record = lambda rec: (calls.append(rec.id), original(rec))  # type: ignore[method-assign]
    store.relink(record.id, move(media, tmp_path / "new"), by="user")
    assert calls == [record.id]


def test_source_path_is_still_refused_by_patch(client, tmp_path):
    media = clip(tmp_path / "m", "talk.mp4")
    headers = {AGENT_HEADER: AGENT_TOKEN}
    rec = client.post("/api/library", json={"source_path": str(media)}, headers=headers).json()
    r = client.patch(
        f"/api/library/{rec['id']}",
        json={"sourcePath": "/elsewhere.mp4"},
        headers={**headers, "If-Match": str(rec["rev"])},
    )
    assert r.status_code == 422
