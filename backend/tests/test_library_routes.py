"""The v3.0 #1 exit test: the library is readable and writable over the
token-gated HTTP boundary with the app sitting on the drop screen
(``current_result is None``). Plan: docs/plans/backend-library.md."""

from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient

AGENT_HEADER = "X-CapForge-Agent-Token"
LOCAL_HEADER = "X-CapForge-Local-Token"
AGENT_TOKEN = "test-agent-token-xyz"
LOCAL_TOKEN = "test-local-token-abc"

CHAPTER_START_S = 61.25


@pytest.fixture
def main_module():
    """Import backend.main with heavy ML deps stubbed (dev venv lacks whisperx)."""
    inserted = []
    for name in ("whisperx", "torch", "torchaudio"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
            inserted.append(name)
    import backend.main as m

    yield m

    for name in inserted:
        sys.modules.pop(name, None)


@pytest.fixture
def home(tmp_path, monkeypatch):
    path = tmp_path / "home"
    monkeypatch.setenv("CAPFORGE_HOME", str(path))
    return path


@pytest.fixture
def client(main_module, monkeypatch, home):
    """Drop screen: no transcription result, both tokens known."""
    from backend.library import router as library_router

    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "LOCAL_TOKEN", LOCAL_TOKEN, raising=False)
    prev_result = m.current_result
    m.current_result = None
    try:
        yield TestClient(m.app)
    finally:
        m.current_result = prev_result
        library_router.reset_store_cache()


@pytest.fixture
def media(tmp_path):
    p = tmp_path / "talk.mp4"
    p.write_bytes(b"media-bytes" * 100)
    return p


def agent(**kw):
    return {AGENT_HEADER: AGENT_TOKEN, **kw}


def project(words=("Hello", "brave", "world")) -> dict:
    return {
        "version": 2,
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
            "duration": 3.0,
        },
    }


def create(client, media, **body) -> dict:
    r = client.post("/api/library", json={"source_path": str(media), **body}, headers=agent())
    assert r.status_code in (200, 201), r.text
    return r.json()


# --- the guard ---------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", "/api/library"),
    ("post", "/api/library"),
    ("get", "/api/library/abc"),
    ("patch", "/api/library/abc"),
    ("put", "/api/library/abc/project"),
    ("get", "/api/library/abc/transcript"),
    ("get", "/api/library/abc/asset/poster.jpg"),
    ("post", "/api/library/abc/renders"),
    ("post", "/api/library/abc/promote"),
    ("post", "/api/library/rebuild-index"),
])
def test_every_route_401s_without_a_token(client, method, path):
    kwargs = {} if method == "get" else {"json": {}}
    assert getattr(client, method)(path, **kwargs).status_code == 401


def test_agent_token_and_local_token_both_pass(client, media):
    assert client.get("/api/library", headers=agent()).status_code == 200
    assert client.get("/api/library", headers={LOCAL_HEADER: LOCAL_TOKEN}).status_code == 200
    assert client.get("/api/library", params={"token": LOCAL_TOKEN}).status_code == 200
    assert client.get("/api/library", headers={AGENT_HEADER: "wrong"}).status_code == 401


def test_drop_screen_has_no_active_result(client, main_module):
    assert main_module.current_result is None


# --- create / list / get -----------------------------------------------------

def test_create_then_list_then_get(client, media):
    r = client.post("/api/library", json={"source_path": str(media)}, headers=agent())
    assert r.status_code == 201
    rec = r.json()
    assert rec["status"] == "imported"
    assert rec["rev"] == 1 and rec["missing_media"] is False

    again = client.post("/api/library", json={"source_path": str(media)}, headers=agent())
    assert again.status_code == 200
    assert again.json()["id"] == rec["id"]

    listed = client.get("/api/library", headers=agent()).json()["videos"]
    assert [v["id"] for v in listed] == [rec["id"]]

    got = client.get(f"/api/library/{rec['id']}", headers=agent()).json()
    assert got["id"] == rec["id"] and got["status"] == "imported"
    assert "transcript" not in got


def test_create_missing_media_is_404(client, tmp_path):
    r = client.post("/api/library", json={"source_path": str(tmp_path / "gone.mp4")}, headers=agent())
    assert r.status_code == 404
    assert "gone.mp4" in r.json()["detail"]


def test_get_unknown_id_is_404(client):
    assert client.get("/api/library/nope", headers=agent()).status_code == 404


# --- patch -------------------------------------------------------------------

def test_patch_requires_if_match(client, media):
    rec = create(client, media)
    r = client.patch(f"/api/library/{rec['id']}", json={"title": "T"}, headers=agent())
    assert r.status_code == 428
    r = client.patch(
        f"/api/library/{rec['id']}", json={"title": "T"}, headers=agent(**{"If-Match": "not-a-rev"})
    )
    assert r.status_code == 428


def test_patch_stale_rev_409s_with_the_current_record(client, media):
    rec = create(client, media)
    ok = client.patch(
        f"/api/library/{rec['id']}", json={"title": "first"}, headers=agent(**{"If-Match": "1"})
    )
    assert ok.status_code == 200 and ok.json()["rev"] == 2

    stale = client.patch(
        f"/api/library/{rec['id']}", json={"title": "second"}, headers=agent(**{"If-Match": "1"})
    )
    assert stale.status_code == 409
    body = stale.json()
    assert body["current"]["rev"] == 2 and body["current"]["title"] == "first"
    assert body["detail"]


def test_patch_records_the_actor_agent_or_user(client, media):
    rec = create(client, media)
    by_agent = client.patch(
        f"/api/library/{rec['id']}",
        json={"title": "Agent wrote this", "chapters": [{"start_s": CHAPTER_START_S, "title": "Deep dive"}]},
        headers=agent(**{"If-Match": "1"}),
    ).json()
    assert by_agent["title"] == "Agent wrote this"
    assert by_agent["chapters"][0]["start_s"] == CHAPTER_START_S
    assert [h["by"] for h in by_agent["history"]] == ["agent", "agent"]

    by_user = client.patch(
        f"/api/library/{rec['id']}",
        json={"description": "User wrote this"},
        headers={LOCAL_HEADER: LOCAL_TOKEN, "If-Match": str(by_agent["rev"])},
    ).json()
    assert by_user["history"][-1]["by"] == "user"
    assert by_user["status"] == "drafted"


def test_patch_refuses_a_system_or_unknown_field(client, media):
    rec = create(client, media)
    for payload in ({"rev": 9}, {"nope": 1}):
        r = client.patch(
            f"/api/library/{rec['id']}", json=payload, headers=agent(**{"If-Match": "1"})
        )
        assert r.status_code == 422


def test_patch_unknown_id_is_404(client):
    r = client.patch("/api/library/nope", json={"title": "T"}, headers=agent(**{"If-Match": "1"}))
    assert r.status_code == 404


# --- project / transcript ----------------------------------------------------

def test_put_project_then_transcript_envelope(client, media):
    rec = create(client, media)
    r = client.put(f"/api/library/{rec['id']}/project", json=project(), headers=agent())
    assert r.status_code == 200
    assert r.json() == {"rev": 2}

    envelope = client.get(f"/api/library/{rec['id']}/transcript", headers=agent()).json()
    assert envelope["rev"] == 2 and envelope["source"] == "record"
    seg = envelope["transcript"]["segments"][0]
    assert "words" not in seg  # segments_only defaults to true
    assert envelope["transcript"]["duration"] == 3.0

    full = client.get(
        f"/api/library/{rec['id']}/transcript", params={"segments_only": "false"}, headers=agent()
    ).json()
    words = full["transcript"]["segments"][0]["words"]
    assert [w["word"] for w in words] == ["Hello", "brave", "world"]
    assert "wid" not in words[0]

    assert client.get(f"/api/library/{rec['id']}", headers=agent()).json()["status"] == "transcribed"


def test_transcript_404s_before_any_project(client, media):
    rec = create(client, media)
    assert client.get(f"/api/library/{rec['id']}/transcript", headers=agent()).status_code == 404


def test_put_project_rejects_a_malformed_body(client, media):
    rec = create(client, media)
    r = client.put(f"/api/library/{rec['id']}/project", json={"version": 2}, headers=agent())
    assert r.status_code == 422


# --- assets ------------------------------------------------------------------

@pytest.mark.parametrize("name", ["record.json", "poster.jpg", "thumbnails/../record.json", "../record.json"])
def test_asset_404s_for_anything_not_allowlisted_or_missing(client, media, name):
    rec = create(client, media)
    r = client.get(f"/api/library/{rec['id']}/asset/{name}", headers=agent())
    assert r.status_code == 404


def test_asset_serves_an_allowlisted_file(client, media, home):
    rec = create(client, media)
    poster = home / "library" / rec["id"] / "poster.jpg"
    poster.write_bytes(b"\xff\xd8\xff-not-really-a-jpeg")
    r = client.get(f"/api/library/{rec['id']}/asset/poster.jpg", headers=agent())
    assert r.status_code == 200
    assert r.content == b"\xff\xd8\xff-not-really-a-jpeg"


# --- renders / promote / index ----------------------------------------------

def test_add_render_moves_status_to_captioned(client, media):
    rec = create(client, media)
    client.put(f"/api/library/{rec['id']}/project", json=project(), headers=agent())
    r = client.post(
        f"/api/library/{rec['id']}/renders",
        json={"path": "/out/talk.mp4", "kind": "video", "at": "2026-09-14T10:00:00Z"},
        headers=agent(),
    )
    assert r.status_code == 200
    assert r.json()["status"] == "captioned"
    assert [e["path"] for e in r.json()["renders"]] == ["/out/talk.mp4"]


def test_scratch_record_is_hidden_read_only_and_promotable(client, media):
    rec = create(client, media, scratch=True)
    assert rec["scratch"] is True
    assert client.get("/api/library", headers=agent()).json()["videos"] == []
    listed = client.get("/api/library", params={"include_scratch": "true"}, headers=agent()).json()
    assert [v["id"] for v in listed["videos"]] == [rec["id"]]

    denied = client.patch(
        f"/api/library/{rec['id']}", json={"title": "T"}, headers=agent(**{"If-Match": "1"})
    )
    assert denied.status_code == 409

    promoted = client.post(f"/api/library/{rec['id']}/promote", headers=agent())
    assert promoted.status_code == 200 and promoted.json()["scratch"] is False
    assert [v["id"] for v in client.get("/api/library", headers=agent()).json()["videos"]] == [rec["id"]]


def test_rebuild_index_route(client, media):
    rec = create(client, media)
    client.patch(
        f"/api/library/{rec['id']}", json={"title": "Kubernetes"}, headers=agent(**{"If-Match": "1"})
    )
    r = client.post("/api/library/rebuild-index", headers=agent())
    assert r.status_code == 200 and r.json()["indexed"] == 1
    found = client.get("/api/library", params={"q": "kubernetes"}, headers=agent()).json()["videos"]
    assert [v["id"] for v in found] == [rec["id"]]


def test_startup_prepares_the_index_without_a_window(main_module, monkeypatch, home):
    """The lifespan hook must be non-fatal and leave a usable index behind."""
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "LOCAL_TOKEN", LOCAL_TOKEN, raising=False)
    from backend.library import router as library_router

    try:
        with TestClient(m.app) as c:
            assert c.get("/api/library", headers=agent()).status_code == 200
        assert (home / "library" / "library.db").exists()
    finally:
        library_router.reset_store_cache()
