"""``folder_import`` — a folder (or an explicit list) of media becomes records.

Plan: docs/plans/library-folder-import.md (Backend → folder_import.py)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from backend.library import folder_import
from backend.library.folder_import import FolderImport, import_folder, import_paths
from backend.library.store import LibraryStore


@pytest.fixture
def created_log() -> list[str]:
    return []


@pytest.fixture
def store(tmp_path: Path, created_log: list[str]):
    s = LibraryStore(
        tmp_path / "library", on_created=lambda _store, rec: created_log.append(rec.id)
    )
    yield s
    s.close()


def clip(folder: Path, name: str) -> Path:
    """Distinct bytes per file — records are keyed by a content fingerprint."""
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(f"media:{name}".encode() * 64)
    return p


def project_for(media: Path) -> dict:
    return {
        "version": 2,
        "selectedFilePath": str(media),
        "meta": {"selectedFilePath": str(media), "note": f"was {media} once"},
        "transcriptionResult": {
            "segments": [{"start": 0.0, "end": 1.0, "text": "Hi", "words": []}],
            "language": "en",
            "audio_path": str(media),
            "duration": 1.0,
        },
    }


def test_new_files_are_created_and_on_created_fires_once_each(store, tmp_path, created_log):
    folder = tmp_path / "shoot"
    clip(folder, "a.mp4")
    clip(folder, "b.mov")
    (folder / "notes.txt").write_text("not media")

    result = import_folder(store, folder)

    assert isinstance(result, FolderImport)
    assert len(result.created) == 2
    assert result.existing == () and result.relinked == () and result.failed == ()
    assert result.truncated is False
    assert sorted(created_log) == sorted(result.created)

    again = import_folder(store, folder)
    assert again.created == ()
    assert sorted(again.existing) == sorted(result.created)
    assert len(created_log) == 2  # a fingerprint hit mints nothing


def test_a_moved_file_relinks_its_missing_record_and_snapshot(store, tmp_path):
    old = clip(tmp_path / "drive-old", "talk.mp4")
    record = store.create(old)
    store.put_project(record.id, project_for(old.resolve()))
    new_folder = tmp_path / "drive-new"
    new_folder.mkdir()
    moved = new_folder / "talk.mp4"
    os.replace(old, moved)  # a rename keeps size + mtime, so the fingerprint holds
    assert store.get(record.id).missing_media is True

    result = import_folder(store, new_folder)

    assert result.relinked == (record.id,)
    assert result.created == () and result.existing == ()
    healed = store.get(record.id)
    assert healed.missing_media is False
    assert healed.sourcePath == str(moved.resolve())
    snapshot = store.get_project(record.id)
    assert snapshot["selectedFilePath"] == str(moved.resolve())
    assert snapshot["transcriptionResult"]["audio_path"] == str(moved.resolve())
    assert store.get_transcript(record.id)["audio_path"] == str(moved.resolve())


def test_a_duplicate_file_whose_original_still_exists_is_existing_not_relinked(store, tmp_path):
    original = clip(tmp_path / "a", "talk.mp4")
    record = store.create(original)
    copy = tmp_path / "b" / "talk.mp4"
    copy.parent.mkdir()
    copy.write_bytes(original.read_bytes())
    os.utime(copy, ns=(original.stat().st_atime_ns, original.stat().st_mtime_ns))

    result = import_folder(store, copy.parent)

    assert result.existing == (record.id,)
    assert store.get(record.id).sourcePath == str(original.resolve())


@pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="needs POSIX permissions")
def test_an_unreadable_file_lands_in_failed_and_the_pass_continues(store, tmp_path):
    folder = tmp_path / "shoot"
    bad = clip(folder, "a-locked.mp4")
    clip(folder, "b-fine.mp4")
    bad.chmod(0)
    try:
        result = import_folder(store, folder)
    finally:
        bad.chmod(0o644)

    assert len(result.created) == 1
    assert [path for path, _ in result.failed] == [str(bad)]
    assert result.failed[0][1]  # a reason, never empty


def test_import_paths_skips_nothing_and_reports_a_vanished_file(store, tmp_path):
    good = clip(tmp_path, "good.mp4")
    gone = tmp_path / "gone.mp4"
    result = import_paths(store, [gone, good], by="user")
    assert len(result.created) == 1
    assert [path for path, _ in result.failed] == [str(gone)]


def test_a_scratch_hit_is_promoted_and_reported_existing(store, tmp_path):
    media = clip(tmp_path / "shoot", "qa.mp4")
    scratch = store.create(media, scratch=True)
    result = import_folder(store, media.parent)
    assert result.existing == (scratch.id,)
    assert store.get(scratch.id).scratch is False


def test_truncated_is_passed_through(store, tmp_path, monkeypatch):
    folder = tmp_path / "many"
    for i in range(4):
        clip(folder, f"c{i}.mp4")
    monkeypatch.setattr(folder_import, "SCAN_MAX_FILES", 2)
    result = import_folder(store, folder)
    assert len(result.created) == 2 and result.truncated is True


def test_a_non_directory_raises(store, tmp_path):
    with pytest.raises(NotADirectoryError):
        import_folder(store, tmp_path / "nope")


def test_result_wire_shape(store, tmp_path):
    gone = tmp_path / "gone.mp4"
    result = import_paths(store, [gone], by="user")
    wire = result.to_wire()
    assert wire == {
        "created": [], "existing": [], "relinked": [],
        "failed": [{"path": str(gone), "reason": result.failed[0][1]}],
        "truncated": False,
    }
    json.dumps(wire)


# --- a multi-file drop ---------------------------------------------------------------

def test_import_dropped_paths_prechecks_then_imports(store, tmp_path):
    good = clip(tmp_path / "drop", "good.MP4")
    notes = tmp_path / "drop" / "notes.txt"
    notes.write_text("text")
    missing = tmp_path / "drop" / "gone.wav"

    result = folder_import.import_dropped_paths(
        store, [str(notes), str(good), str(missing)], by="user"
    )

    assert len(result.created) == 1
    assert result.failed == (
        (str(notes), folder_import.REASON_NOT_MEDIA),
        (str(missing), folder_import.REASON_MEDIA_NOT_FOUND),
    )
    assert result.truncated is False


def test_import_dropped_paths_relinks_a_missing_record(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    moved = tmp_path / "new" / "talk.mp4"
    moved.parent.mkdir()
    os.replace(media, moved)
    result = folder_import.import_dropped_paths(store, [str(moved)], by="agent")
    assert result.relinked == (record.id,)
    assert store.get(record.id).history[-1].by == "agent"
