"""The folder-import, relink and watch routes over the token-gated boundary.

Plan: docs/plans/library-folder-import.md (Backend → Routes)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.library import watch

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    AGENT_HEADER,
    AGENT_TOKEN,
    LOCAL_HEADER,
    LOCAL_TOKEN,
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


@pytest.fixture(autouse=True)
def _forget_watchers():
    yield
    watch.stop_watchers()


def agent() -> dict:
    return {AGENT_HEADER: AGENT_TOKEN}


def user() -> dict:
    return {LOCAL_HEADER: LOCAL_TOKEN}


def clip(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(f"media:{folder.name}/{name}".encode() * 64)
    return p


def create(client, media: Path) -> dict:
    r = client.post("/api/library", json={"source_path": str(media)}, headers=agent())
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture
def announced(main_module, monkeypatch) -> list[dict]:
    """Every WS control event the routes broadcast."""
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(main_module, "broadcast_event", capture)
    return sent


@pytest.mark.parametrize("method,path", [
    ("post", "/api/library/import-folder"),
    ("post", "/api/library/abc/relink"),
    ("get", "/api/library/watch"),
    ("put", "/api/library/watch"),
])
def test_every_new_route_401s_without_a_token(client, method, path):
    kwargs = {} if method == "get" else {"json": {}}
    assert getattr(client, method)(path, **kwargs).status_code == 401


# --- import-folder -------------------------------------------------------------

def test_import_folder_partitions_and_answers_200(client, tmp_path):
    folder = tmp_path / "shoot"
    known = create(client, clip(folder, "a.mp4"))
    clip(folder, "b.mp4")
    clip(folder, "c.mov")

    r = client.post("/api/library/import-folder", json={"path": str(folder)}, headers=user())

    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"created", "existing", "relinked", "failed", "truncated"}
    assert len(body["created"]) == 2
    assert body["existing"] == [known["id"]]
    assert body["relinked"] == [] and body["failed"] == [] and body["truncated"] is False
    listed = {v["id"] for v in client.get("/api/library", headers=user()).json()["videos"]}
    assert listed == {known["id"], *body["created"]}


def test_import_folder_non_recursive(client, tmp_path):
    folder = tmp_path / "shoot"
    clip(folder, "top.mp4")
    clip(folder / "sub", "nested.mp4")
    r = client.post(
        "/api/library/import-folder",
        json={"path": str(folder), "recursive": False},
        headers=user(),
    )
    assert len(r.json()["created"]) == 1


def test_import_folder_relinks_and_announces_each_relinked_record(client, tmp_path, announced):
    media = clip(tmp_path / "old", "talk.mp4")
    rec = create(client, media)
    new_folder = tmp_path / "new"
    new_folder.mkdir()
    os.replace(media, new_folder / "talk.mp4")

    r = client.post("/api/library/import-folder", json={"path": str(new_folder)}, headers=agent())

    assert r.json()["relinked"] == [rec["id"]]
    assert announced == [
        {"type": "record_updated", "video_id": rec["id"], "rev": rec["rev"] + 1, "by": "agent"}
    ]


def test_import_folder_reports_failed_paths(client, tmp_path, monkeypatch):
    from backend.library.store import LibraryStore

    folder = tmp_path / "shoot"
    bad = clip(folder, "a.mp4")
    real = LibraryStore.create_or_get

    def flaky(self, source_path, *, scratch=False):
        if Path(source_path).name == bad.name:
            raise OSError("unreadable")
        return real(self, source_path, scratch=scratch)

    monkeypatch.setattr(LibraryStore, "create_or_get", flaky)
    clip(folder, "b.mp4")
    body = client.post(
        "/api/library/import-folder", json={"path": str(folder)}, headers=user()
    ).json()
    assert len(body["created"]) == 1
    assert body["failed"][0]["path"] == str(bad.resolve())
    assert body["failed"][0]["reason"]


@pytest.mark.parametrize("make", [
    lambda tmp: str(tmp / "missing"),
    lambda tmp: str(clip(tmp, "file.mp4")),
    lambda tmp: "relative/folder",
])
def test_import_folder_422s_for_anything_but_an_existing_directory(client, tmp_path, make):
    r = client.post("/api/library/import-folder", json={"path": make(tmp_path)}, headers=user())
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)


def test_import_folder_refuses_unknown_keys(client, tmp_path):
    r = client.post(
        "/api/library/import-folder",
        json={"path": str(tmp_path), "surprise": 1},
        headers=user(),
    )
    assert r.status_code == 422


# --- relink --------------------------------------------------------------------

def test_relink_same_media_answers_the_record_view_and_announces(client, tmp_path, announced):
    media = clip(tmp_path / "old", "talk.mp4")
    rec = create(client, media)
    moved = tmp_path / "new" / "talk.mp4"
    moved.parent.mkdir()
    os.replace(media, moved)

    r = client.post(f"/api/library/{rec['id']}/relink", json={"path": str(moved)}, headers=user())

    assert r.status_code == 200, r.text
    view = r.json()
    assert view["sourcePath"] == str(moved.resolve())
    assert view["missing_media"] is False and view["rev"] == rec["rev"] + 1
    assert {"status", "hasProject", "poster"} <= set(view)
    assert announced == [
        {"type": "record_updated", "video_id": rec["id"], "rev": view["rev"], "by": "user"}
    ]


def test_relink_no_op_does_not_announce(client, tmp_path, announced):
    media = clip(tmp_path / "a", "talk.mp4")
    rec = create(client, media)
    r = client.post(f"/api/library/{rec['id']}/relink", json={"path": str(media)}, headers=user())
    assert r.status_code == 200 and r.json()["rev"] == rec["rev"]
    assert announced == []


def test_relink_different_media_409_then_force(client, tmp_path):
    rec = create(client, clip(tmp_path / "a", "talk.mp4"))
    other = clip(tmp_path / "b", "other.mp4")
    url = f"/api/library/{rec['id']}/relink"

    refused = client.post(url, json={"path": str(other)}, headers=user())
    assert refused.status_code == 409
    assert refused.json()["reason"] == "different_media"

    forced = client.post(url, json={"path": str(other), "force": True}, headers=user())
    assert forced.status_code == 200
    assert forced.json()["sourcePath"] == str(other.resolve())


def test_relink_media_in_use_409_names_the_owner(client, tmp_path):
    mine = create(client, clip(tmp_path / "a", "mine.mp4"))
    theirs_media = clip(tmp_path / "b", "theirs.mp4")
    theirs = create(client, theirs_media)
    r = client.post(
        f"/api/library/{mine['id']}/relink",
        json={"path": str(theirs_media), "force": True},
        headers=user(),
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "media_in_use"
    assert r.json()["video_id"] == theirs["id"]


def test_relink_missing_file_422(client, tmp_path):
    rec = create(client, clip(tmp_path / "a", "talk.mp4"))
    r = client.post(
        f"/api/library/{rec['id']}/relink",
        json={"path": str(tmp_path / "gone.mp4")},
        headers=user(),
    )
    assert r.status_code == 422
    assert r.json()["reason"] == "media_not_found"


def test_relink_unknown_record_404(client, tmp_path):
    r = client.post(
        f"/api/library/{'0' * 32}/relink",
        json={"path": str(clip(tmp_path, "x.mp4"))},
        headers=user(),
    )
    assert r.status_code == 404


def test_relink_refuses_unknown_keys(client, tmp_path):
    rec = create(client, clip(tmp_path / "a", "talk.mp4"))
    r = client.post(
        f"/api/library/{rec['id']}/relink",
        json={"path": str(tmp_path), "sourcePath": "/x"},
        headers=user(),
    )
    assert r.status_code == 422


# --- watch -----------------------------------------------------------------------

def test_watch_get_defaults_to_not_watching(client):
    r = client.get("/api/library/watch", headers=user())
    assert r.status_code == 200
    assert r.json() == {
        "folder": None, "available": False, "lastScanAt": None, "importedCount": 0
    }


def test_watch_put_sets_and_clears_the_folder(client, tmp_path):
    folder = tmp_path / "inbox"
    folder.mkdir()
    r = client.put("/api/library/watch", json={"folder": str(folder)}, headers=user())
    assert r.status_code == 200, r.text
    assert r.json()["folder"] == str(folder.resolve())
    assert r.json()["available"] is True
    assert client.get("/api/library/watch", headers=user()).json()["folder"] == str(folder.resolve())

    cleared = client.put("/api/library/watch", json={"folder": None}, headers=user())
    assert cleared.status_code == 200 and cleared.json()["folder"] is None


def test_watch_put_422s_with_the_validation_message(client, tmp_path, home):
    r = client.put(
        "/api/library/watch", json={"folder": str(tmp_path / "missing")}, headers=user()
    )
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str) and r.json()["detail"]

    inside = home / "library"
    inside.mkdir(parents=True, exist_ok=True)
    r = client.put("/api/library/watch", json={"folder": str(inside)}, headers=user())
    assert r.status_code == 422


def test_watch_put_requires_the_folder_key(client):
    assert client.put("/api/library/watch", json={}, headers=user()).status_code == 422
    assert client.put(
        "/api/library/watch", json={"folder": None, "extra": 1}, headers=user()
    ).status_code == 422


def test_watch_route_is_not_captured_by_the_record_id_route(client):
    # GET /api/library/{video_id} would 404 "No library record with id 'watch'".
    r = client.get("/api/library/watch", headers=user())
    assert "folder" in r.json()


# --- import-paths (a multi-file drop) ------------------------------------------------

def test_import_paths_answers_the_import_folder_shape(client, tmp_path):
    known = create(client, clip(tmp_path / "a", "known.mp4"))
    fresh = clip(tmp_path / "b", "fresh.mov")
    r = client.post(
        "/api/library/import-paths",
        json={"paths": [str(fresh), known["sourcePath"]]},
        headers=user(),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"created", "existing", "relinked", "failed", "truncated"}
    assert len(body["created"]) == 1 and body["existing"] == [known["id"]]
    assert body["relinked"] == [] and body["failed"] == [] and body["truncated"] is False


def test_import_paths_relinks_a_missing_record_and_announces_it(client, tmp_path, announced):
    media = clip(tmp_path / "old", "talk.mp4")
    rec = create(client, media)
    moved = tmp_path / "new" / "talk.mp4"
    moved.parent.mkdir()
    os.replace(media, moved)

    body = client.post(
        "/api/library/import-paths", json={"paths": [str(moved)]}, headers=agent()
    ).json()

    assert body["relinked"] == [rec["id"]] and body["created"] == []
    assert announced == [
        {"type": "record_updated", "video_id": rec["id"], "rev": rec["rev"] + 1, "by": "agent"}
    ]


def test_import_paths_fails_non_media_and_non_files_without_importing(client, tmp_path):
    notes = tmp_path / "notes.txt"
    notes.write_text("not a recording")
    folder = tmp_path / "a-folder.mp4"
    folder.mkdir()
    good = clip(tmp_path / "c", "good.mp4")
    missing = tmp_path / "gone.mp4"

    body = client.post(
        "/api/library/import-paths",
        json={"paths": [str(notes), str(missing), str(folder), "relative.mp4", str(good)]},
        headers=user(),
    ).json()

    assert len(body["created"]) == 1
    assert body["failed"] == [
        {"path": str(notes), "reason": "not_media"},
        {"path": str(missing), "reason": "media_not_found"},
        {"path": str(folder), "reason": "media_not_found"},
        {"path": "relative.mp4", "reason": "media_not_found"},
    ]
    listed = client.get("/api/library", headers=user()).json()["videos"]
    assert [v["id"] for v in listed] == body["created"]


def test_import_paths_422s_on_an_empty_list(client):
    assert client.post(
        "/api/library/import-paths", json={"paths": []}, headers=user()
    ).status_code == 422


def test_import_paths_422s_past_the_file_cap(client, tmp_path):
    from backend.library.media_scan import SCAN_MAX_FILES

    too_many = [str(tmp_path / f"c{i}.mp4") for i in range(SCAN_MAX_FILES + 1)]
    r = client.post("/api/library/import-paths", json={"paths": too_many}, headers=user())
    assert r.status_code == 422
    at_cap = too_many[:SCAN_MAX_FILES]
    ok = client.post("/api/library/import-paths", json={"paths": at_cap}, headers=user())
    assert ok.status_code == 200 and len(ok.json()["failed"]) == SCAN_MAX_FILES


def test_import_paths_refuses_unknown_keys_and_a_missing_list(client, tmp_path):
    assert client.post(
        "/api/library/import-paths", json={"paths": [str(tmp_path)], "force": True}, headers=user()
    ).status_code == 422
    assert client.post("/api/library/import-paths", json={}, headers=user()).status_code == 422


def test_import_paths_401s_without_a_token(client):
    assert client.post("/api/library/import-paths", json={"paths": ["/x.mp4"]}).status_code == 401
