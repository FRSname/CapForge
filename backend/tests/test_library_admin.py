"""Library admin: remove/detach, project import, first-launch migration.

The rule these tests exist to pin is §9.1's "the backend never deletes user
files": ``remove`` hides a record and ``detach`` hands Electron a folder to
trash — both leave every byte on disk. Plan: docs/plans/library-home-screen.md.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.exporters.hyperframes_project import write_coauthor_marker
from backend.library.paths import PROJECT_FILE, RECORD_FILE, TRANSCRIPT_FILE
from backend.library.store import LibraryStore, MediaNotFound, RecordNotFound
from backend.library import store_admin
from backend.library.store_admin import (
    PROJECT_IMPORT_MAX_BYTES,
    REMOVED_DIR_NAME,
    TRASH_DIR_NAME,
)

WORDS = ["Hello", "brave", "new", "world"]
#: A stand-in cap for the 64 MB import limit — writing a real 64 MB file per
#: test would trade seconds of IO for no extra coverage.
TINY_CAP_BYTES = 16


@pytest.fixture
def store(tmp_path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


@pytest.fixture
def home(tmp_path, monkeypatch):
    """A relocated ``CAPFORGE_HOME`` — what the migration scan walks."""
    path = tmp_path / "home"
    monkeypatch.setenv("CAPFORGE_HOME", str(path))
    return path


def media(tmp_path, name: str = "talk.mp4", body: bytes = b"media") -> Path:
    p = tmp_path / name
    p.write_bytes(body * 20)
    return p


def project(source: Path | None = None, words=WORDS) -> dict:
    body: dict = {
        "version": 2,
        "studioSettings": {"fontSize": 48},
        "transcriptionResult": {
            "segments": [
                {
                    "start": 0.0,
                    "end": float(len(words)),
                    "text": " ".join(words),
                    "words": [
                        {"word": w, "start": float(i), "end": float(i + 1), "wid": f"w{i}"}
                        for i, w in enumerate(words)
                    ],
                }
            ],
            "language": "en",
            "audio_path": "/tmp/a.wav",
            "duration": float(len(words)),
        },
    }
    if source is not None:
        body["selectedFilePath"] = str(source)
    return body


def write_project_file(tmp_path, source: Path, name: str = "session.capforge") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(project(source)), encoding="utf-8")
    return path


def studio_folder(home: Path, name: str, source: Path | str | None) -> Path:
    """A fake pre-v3 studio workspace, with a co-author marker when asked."""
    folder = home / "studio" / name
    folder.mkdir(parents=True, exist_ok=True)
    if source is not None:
        write_coauthor_marker(folder, True, source=str(source))
    return folder


# --- remove ------------------------------------------------------------------

def test_remove_hides_the_record_and_keeps_every_file(store, tmp_path):
    src = media(tmp_path)
    rec = store.create(str(src))
    store.put_project(rec.id, project())

    removed = store.remove(rec.id)

    assert removed.id == rec.id
    assert store.list() == []
    with pytest.raises(RecordNotFound):
        store.get(rec.id)
    assert not (store.root / rec.id).exists()
    hidden = store.root / REMOVED_DIR_NAME / rec.id
    assert (hidden / RECORD_FILE).is_file()
    assert (hidden / PROJECT_FILE).is_file()
    assert (hidden / TRANSCRIPT_FILE).is_file()
    assert src.exists()  # the user's media is never touched


def test_remove_drops_the_record_from_the_index(store, tmp_path):
    from backend.library.schemas import RecordPatch

    rec = store.create(str(media(tmp_path)))
    store.patch(rec.id, RecordPatch(title="Kubernetes"), rev=rec.rev, by="user")
    assert store.index.search("kubernetes") == [rec.id]

    store.remove(rec.id)

    assert store.index.search("kubernetes") == []


def test_remove_keeps_an_earlier_removal_by_stamping_the_clash(store, tmp_path):
    rec = store.create(str(media(tmp_path)))
    clash = store.root / REMOVED_DIR_NAME / rec.id
    clash.mkdir(parents=True)
    (clash / "earlier.txt").write_text("kept", encoding="utf-8")

    store.remove(rec.id)

    assert (clash / "earlier.txt").read_text(encoding="utf-8") == "kept"
    stamped = [
        p for p in (store.root / REMOVED_DIR_NAME).iterdir() if p.name.startswith(f"{rec.id}-")
    ]
    assert len(stamped) == 1
    assert (stamped[0] / RECORD_FILE).is_file()


def test_remove_unknown_id_raises(store):
    with pytest.raises(RecordNotFound):
        store.remove("f" * 32)


# --- detach ------------------------------------------------------------------

def test_detach_returns_the_moved_folder_with_its_files_intact(store, tmp_path):
    src = media(tmp_path)
    rec = store.create(str(src))
    store.put_project(rec.id, project())

    folder = store.detach(rec.id)

    assert folder == store.root / TRASH_DIR_NAME / rec.id
    assert folder.is_dir()
    stored = json.loads((folder / RECORD_FILE).read_text(encoding="utf-8"))
    assert stored["id"] == rec.id
    assert (folder / PROJECT_FILE).is_file()
    assert src.exists()
    with pytest.raises(RecordNotFound):
        store.get(rec.id)
    assert store.list() == []


def test_detach_unknown_id_raises(store):
    with pytest.raises(RecordNotFound):
        store.detach("a" * 32)


def test_removed_and_trash_folders_are_invisible_to_iteration(store, tmp_path):
    first = store.create(str(media(tmp_path, "a.mp4", b"aaa")))
    second = store.create(str(media(tmp_path, "b.mp4", b"bbb")))

    store.remove(first.id)
    store.detach(second.id)

    assert store.list(include_scratch=True) == []
    assert store.find_by_path(str(tmp_path / "a.mp4")) is None
    assert store.rebuild_index() == 0


# --- hasProject (derived, never a field) -------------------------------------

def test_has_project_is_derived_at_read_time(store, tmp_path):
    rec = store.create(str(media(tmp_path)))

    assert store.has_project(rec) is False
    assert store.list()[0]["hasProject"] is False
    assert "hasProject" not in rec.model_dump()  # derived like status, not stored

    store.put_project(rec.id, project())

    assert store.has_project(store.get(rec.id)) is True
    assert store.list()[0]["hasProject"] is True


# --- import_project_file -----------------------------------------------------

def test_import_project_file_creates_then_matches(store, tmp_path):
    src = media(tmp_path)
    path = write_project_file(tmp_path, src)

    record, created = store.import_project_file(str(path))

    assert created is True
    assert record.sourcePath == str(src.resolve())
    assert store.get_project(record.id) == project(src)
    assert store.status_of(record) == "transcribed"

    again, created_again = store.import_project_file(str(path))

    assert created_again is False
    assert again.id == record.id
    assert len(store.list()) == 1


def test_import_project_file_accepts_a_mixed_case_suffix(store, tmp_path):
    src = media(tmp_path)
    path = write_project_file(tmp_path, src, name="Session.CapForge")

    record, created = store.import_project_file(str(path))

    assert created is True and record.id


@pytest.mark.parametrize("relative", ["session.capforge", "./session.capforge"])
def test_import_project_file_refuses_a_relative_path(store, relative):
    with pytest.raises(ValueError, match="absolute"):
        store.import_project_file(relative)


def test_import_project_file_refuses_a_foreign_suffix(store, tmp_path):
    src = media(tmp_path)
    path = write_project_file(tmp_path, src, name="session.json")

    with pytest.raises(ValueError, match=r"\.capforge"):
        store.import_project_file(str(path))


def test_import_project_file_refuses_a_missing_file(store, tmp_path):
    with pytest.raises(ValueError, match="not found"):
        store.import_project_file(str(tmp_path / "gone.capforge"))


def test_import_project_file_refuses_an_oversized_file(store, tmp_path, monkeypatch):
    monkeypatch.setattr(store_admin, "PROJECT_IMPORT_MAX_BYTES", TINY_CAP_BYTES)
    path = write_project_file(tmp_path, media(tmp_path))

    with pytest.raises(ValueError, match="too large"):
        store.import_project_file(str(path))


def test_the_import_cap_is_64_mb():
    assert PROJECT_IMPORT_MAX_BYTES == 64 * 1024 * 1024


@pytest.mark.parametrize("body,reason", [
    ("not json at all", "JSON"),
    ('["a", "list"]', "object"),
    ('{"selectedFilePath": "/tmp/a.mp4"}', "transcriptionResult"),
    ('{"transcriptionResult": "nope", "selectedFilePath": "/tmp/a.mp4"}', "transcriptionResult"),
    ('{"transcriptionResult": {}}', "selectedFilePath"),
    ('{"transcriptionResult": {}, "selectedFilePath": ""}', "selectedFilePath"),
    ('{"transcriptionResult": {}, "selectedFilePath": 7}', "selectedFilePath"),
])
def test_import_project_file_refuses_a_malformed_body(store, tmp_path, body, reason):
    path = tmp_path / "session.capforge"
    path.write_text(body, encoding="utf-8")

    with pytest.raises(ValueError, match=reason):
        store.import_project_file(str(path))


def test_import_project_file_propagates_missing_media(store, tmp_path):
    path = write_project_file(tmp_path, tmp_path / "gone.mp4")

    with pytest.raises(MediaNotFound):
        store.import_project_file(str(path))


# --- migrate_studio_workspaces -----------------------------------------------

def test_migrate_imports_live_markers_and_skips_the_rest(home, tmp_path):
    src = media(tmp_path)
    studio_folder(home, "a-live", src)
    studio_folder(home, "b-gone", tmp_path / "gone.mp4")
    studio_folder(home, "c-no-marker", None)
    store = LibraryStore(home / "library")
    try:
        result = store.migrate_studio_workspaces()

        assert len(result["imported"]) == 1
        imported_id = result["imported"][0]
        assert store.get(imported_id).sourcePath == str(src.resolve())
        skipped = {entry["folder"]: entry["reason"] for entry in result["skipped"]}
        assert set(skipped) == {"b-gone", "c-no-marker"}
        assert "gone.mp4" in skipped["b-gone"]
        assert skipped["c-no-marker"]

        # Idempotent: a second run matches the same record instead of minting one.
        assert store.migrate_studio_workspaces()["imported"] == [imported_id]
        assert len(store.list()) == 1
    finally:
        store.close()


def test_migrate_records_an_unreadable_source_and_keeps_scanning(home, tmp_path, monkeypatch):
    """A per-folder failure is the ONE swallowed error, and it is reported.

    The folder that fails sorts *first*, so a scan that aborted on it would
    never reach the live workspace behind it.
    """
    from backend.library import fs as library_fs

    broken = media(tmp_path, "a-broken.mp4", b"xx")
    real_fingerprint = library_fs.fingerprint

    def flaky(source_path):
        if Path(source_path).name == broken.name:
            raise OSError(f"cannot read {source_path}")
        return real_fingerprint(source_path)

    monkeypatch.setattr(library_fs, "fingerprint", flaky)
    studio_folder(home, "a-broken", broken)
    studio_folder(home, "b-live", media(tmp_path))
    store = LibraryStore(home / "library")
    try:
        result = store.migrate_studio_workspaces()

        assert len(result["imported"]) == 1
        assert [entry["folder"] for entry in result["skipped"]] == ["a-broken"]
        assert "a-broken.mp4" in result["skipped"][0]["reason"]
    finally:
        store.close()


def test_migrate_without_a_studio_folder_is_empty(home):
    store = LibraryStore(home / "library")
    try:
        assert store.migrate_studio_workspaces() == {"imported": [], "skipped": []}
    finally:
        store.close()


def test_migrate_ignores_a_stray_file_in_the_studio_folder(home, tmp_path):
    (home / "studio").mkdir(parents=True)
    (home / "studio" / "stray.txt").write_text("not a workspace", encoding="utf-8")
    studio_folder(home, "live", media(tmp_path))
    store = LibraryStore(home / "library")
    try:
        result = store.migrate_studio_workspaces()

        assert len(result["imported"]) == 1
        assert result["skipped"] == []
    finally:
        store.close()
