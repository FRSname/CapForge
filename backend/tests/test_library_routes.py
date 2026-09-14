"""The v3.0 #1 exit test: the library is readable and writable over the
token-gated HTTP boundary with the app sitting on the drop screen
(``current_result is None``). Plan: docs/plans/backend-library.md."""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

AGENT_HEADER = "X-CapForge-Agent-Token"
LOCAL_HEADER = "X-CapForge-Local-Token"
AGENT_TOKEN = "test-agent-token-xyz"
LOCAL_TOKEN = "test-local-token-abc"

CHAPTER_START_S = 61.25


@pytest.fixture
def main_module():
    """Import backend.main with heavy ML deps stubbed (dev venv lacks whisperx).

    huggingface_hub is stubbed too, and with the two names transcriber.py pulls
    at import time, so this file runs alone — the Windows CI job runs only the
    library tests, where no earlier test module has left a stub behind.
    """
    inserted = []
    for name in ("whisperx", "torch", "torchaudio", "huggingface_hub"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
            inserted.append(name)
    hub = sys.modules["huggingface_hub"]
    if not hasattr(hub, "snapshot_download"):
        hub.snapshot_download = lambda *a, **k: None  # type: ignore[attr-defined]
    if "huggingface_hub.errors" not in sys.modules:
        errors = types.ModuleType("huggingface_hub.errors")
        errors.LocalEntryNotFoundError = type(  # type: ignore[attr-defined]
            "LocalEntryNotFoundError", (Exception,), {}
        )
        sys.modules["huggingface_hub.errors"] = errors
        inserted.append("huggingface_hub.errors")
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


def project(words=("Hello", "brave", "world"), duration=3.0) -> dict:
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
            "duration": duration,
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
    ("get", "/api/library/abc/project"),
    ("get", "/api/library/abc/transcript"),
    ("get", "/api/library/abc/moments"),
    ("get", "/api/library/abc/asset/poster.jpg"),
    ("post", "/api/library/abc/renders"),
    ("post", "/api/library/abc/promote"),
    ("post", "/api/library/rebuild-index"),
    ("delete", "/api/library/abc"),
    ("post", "/api/library/import-project"),
    ("post", "/api/library/migrate-studio"),
    ("get", "/api/library/brief"),
    ("patch", "/api/library/brief"),
    ("post", "/api/library/validate"),
    ("get", "/api/library/abc/package"),
])
def test_every_route_401s_without_a_token(client, method, path):
    # httpx's delete() takes no body, so the bodyless methods are grouped.
    kwargs = {} if method in ("get", "delete") else {"json": {}}
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
    # A legal chapter list: first at 00:00, three of them, 10s apart (#4's hard
    # rules run on every patch, so a lone chapter would now be refused).
    chapters = [
        {"start_s": 0.0, "title": "Intro"},
        {"start_s": CHAPTER_START_S, "title": "Deep dive"},
        {"start_s": 180.0, "title": "Wrap up"},
    ]
    by_agent = client.patch(
        f"/api/library/{rec['id']}",
        json={"title": "Agent wrote this", "chapters": chapters},
        headers=agent(**{"If-Match": "1"}),
    ).json()
    assert by_agent["title"] == "Agent wrote this"
    assert by_agent["chapters"][1]["start_s"] == CHAPTER_START_S
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


# --- project GET (the renderer's open_video path) -----------------------------

def test_project_get_returns_what_was_put(client, media):
    rec = create(client, media)
    stored = project()
    client.put(f"/api/library/{rec['id']}/project", json=stored, headers=agent())

    r = client.get(f"/api/library/{rec['id']}/project", headers=agent())

    assert r.status_code == 200
    # Byte-for-byte what was PUT: open_video and a project-file open must build
    # the same track store, so the backend may not reshape the snapshot.
    assert r.json() == stored


def test_project_get_404s_before_any_put(client, media):
    rec = create(client, media)
    assert client.get(f"/api/library/{rec['id']}/project", headers=agent()).status_code == 404


def test_project_get_unknown_id_is_404(client):
    assert client.get("/api/library/nope/project", headers=agent()).status_code == 404


# --- moments -----------------------------------------------------------------

def moments(client, video_id, **params):
    return client.get(f"/api/library/{video_id}/moments", params=params, headers=agent())


@pytest.fixture
def transcribed(client, media):
    rec = create(client, media)
    client.put(
        f"/api/library/{rec['id']}/project",
        json=project(words=("Hello", "brave", "world")),
        headers=agent(),
    )
    return rec["id"]


def test_moments_by_query(client, transcribed):
    r = moments(client, transcribed, query="brave")

    assert r.status_code == 200
    matches = r.json()["matches"]
    assert [m["text"] for m in matches] == ["brave"]
    assert matches[0]["start"] == 1.0


def test_moments_by_kind(client, transcribed):
    r = moments(client, transcribed, kind="pause")

    assert r.status_code == 200
    # Contiguous words, so no pause — the route still answers with an empty list.
    assert r.json()["matches"] == []


def test_moments_requires_exactly_one_of_query_or_kind(client, transcribed):
    neither = moments(client, transcribed)
    both = moments(client, transcribed, query="brave", kind="pause")

    assert neither.status_code == 400 and both.status_code == 400
    assert "query" in neither.json()["detail"] and "kind" in neither.json()["detail"]


def test_moments_unknown_kind_is_400_with_the_valueerror_text(client, transcribed):
    r = moments(client, transcribed, kind="vibes")

    assert r.status_code == 400
    assert "Unknown semantic kind" in r.json()["detail"]


def test_moments_404s_without_a_transcript(client, media):
    rec = create(client, media)
    assert moments(client, rec["id"], query="brave").status_code == 404


def test_moments_unknown_id_is_404(client):
    assert moments(client, "nope", query="brave").status_code == 404


def test_moments_treats_a_blank_param_as_absent(client, transcribed):
    """`?query=` is a caller that meant to send nothing, not a match-everything."""
    assert moments(client, transcribed, query="").status_code == 400
    assert moments(client, transcribed, query="brave", kind="").status_code == 200


# --- delete: remove / detach (the backend never deletes files) ----------------

def test_delete_defaults_to_remove_and_keeps_every_file(client, media, home):
    rec = create(client, media)
    client.put(f"/api/library/{rec['id']}/project", json=project(), headers=agent())

    r = client.delete(f"/api/library/{rec['id']}", headers=agent())

    assert r.status_code == 200
    assert r.json() == {"status": "ok", "mode": "remove"}
    assert client.get(f"/api/library/{rec['id']}", headers=agent()).status_code == 404
    assert client.get("/api/library", headers=agent()).json()["videos"] == []
    hidden = home / "library" / ".removed" / rec["id"]
    assert (hidden / "record.json").is_file()
    assert (hidden / "project.capforge").is_file()
    assert media.exists()


def test_delete_detach_returns_the_folder_for_electron_to_trash(client, media, home):
    rec = create(client, media)

    r = client.delete(f"/api/library/{rec['id']}", params={"mode": "detach"}, headers=agent())

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["mode"] == "detach"
    folder = Path(body["folder"])
    assert folder == home / "library" / ".trash" / rec["id"]
    assert (folder / "record.json").is_file()  # handed over, not deleted
    assert client.get(f"/api/library/{rec['id']}", headers=agent()).status_code == 404


def test_delete_unknown_id_is_404(client):
    assert client.delete("/api/library/nope", headers=agent()).status_code == 404


def test_delete_rejects_an_unknown_mode(client, media):
    rec = create(client, media)
    r = client.delete(f"/api/library/{rec['id']}", params={"mode": "shred"}, headers=agent())
    assert r.status_code == 422
    assert client.get(f"/api/library/{rec['id']}", headers=agent()).status_code == 200


# --- import-project ----------------------------------------------------------

def capforge_file(tmp_path, media_path, name="session.capforge") -> Path:
    path = tmp_path / name
    body = {**project(), "selectedFilePath": str(media_path)}
    path.write_text(json.dumps(body), encoding="utf-8")
    return path


def test_import_project_creates_then_matches(client, media, tmp_path):
    path = capforge_file(tmp_path, media)

    created = client.post("/api/library/import-project", json={"path": str(path)}, headers=agent())

    assert created.status_code == 201
    rec = created.json()
    assert rec["sourcePath"] == str(media.resolve())
    assert rec["status"] == "transcribed"
    assert rec["hasProject"] is True

    again = client.post("/api/library/import-project", json={"path": str(path)}, headers=agent())

    assert again.status_code == 200
    assert again.json()["id"] == rec["id"]


def test_import_project_404s_when_the_media_is_gone(client, tmp_path):
    path = capforge_file(tmp_path, tmp_path / "gone.mp4")

    r = client.post("/api/library/import-project", json={"path": str(path)}, headers=agent())

    assert r.status_code == 404
    assert "gone.mp4" in r.json()["detail"]


@pytest.mark.parametrize("name,body", [
    ("session.json", '{"transcriptionResult": {}, "selectedFilePath": "/tmp/a.mp4"}'),
    ("session.capforge", "not json"),
    ("session.capforge", '{"transcriptionResult": {}}'),
])
def test_import_project_422s_on_a_bad_file_with_the_reason(client, tmp_path, name, body):
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")

    r = client.post("/api/library/import-project", json={"path": str(path)}, headers=agent())

    assert r.status_code == 422
    assert r.json()["detail"]


# --- migrate-studio ----------------------------------------------------------

def test_migrate_studio_imports_live_workspaces_and_reports_the_rest(client, media, home):
    from backend.exporters.hyperframes_project import write_coauthor_marker

    live = home / "studio" / "aaaa1111"
    live.mkdir(parents=True)
    write_coauthor_marker(live, True, source=str(media))
    (home / "studio" / "bbbb2222").mkdir(parents=True)  # no marker

    r = client.post("/api/library/migrate-studio", headers=agent())

    assert r.status_code == 200
    body = r.json()
    assert len(body["imported"]) == 1
    assert [entry["folder"] for entry in body["skipped"]] == ["bbbb2222"]
    listed = client.get("/api/library", headers=agent()).json()["videos"]
    assert [v["id"] for v in listed] == body["imported"]


# --- hasProject --------------------------------------------------------------

def test_record_view_and_list_summary_carry_has_project(client, media):
    rec = create(client, media)

    assert client.get(f"/api/library/{rec['id']}", headers=agent()).json()["hasProject"] is False
    assert client.get("/api/library", headers=agent()).json()["videos"][0]["hasProject"] is False

    client.put(f"/api/library/{rec['id']}/project", json=project(), headers=agent())

    assert client.get(f"/api/library/{rec['id']}", headers=agent()).json()["hasProject"] is True
    assert client.get("/api/library", headers=agent()).json()["videos"][0]["hasProject"] is True


# --- validate ----------------------------------------------------------------

LEGAL_CHAPTERS = [
    {"start_s": 0, "title": "Intro"},
    {"start_s": 60, "title": "Middle"},
    {"start_s": 180, "title": "End"},
]
LONG_VIDEO_S = 600.0
EM_DASH_DESCRIPTION = "A talk — with an em dash."


def validate(client, **body):
    return client.post("/api/library/validate", json=body, headers=agent())


def transcribed_record(client, media, duration=LONG_VIDEO_S) -> str:
    rec = create(client, media)
    client.put(
        f"/api/library/{rec['id']}/project",
        json=project(duration=duration),
        headers=agent(),
    )
    return rec["id"]


def test_validate_with_explicit_fields_needs_no_record(client):
    r = validate(client, fields={"title": "T" * 101}, duration=None)

    assert r.status_code == 200
    violations = r.json()["violations"]
    assert [v["rule"] for v in violations] == ["title_max_chars"]
    assert violations[0]["field"] == "title"
    assert violations[0]["severity"] == "hard"


def test_validate_with_no_fields_at_all_is_an_empty_answer(client):
    assert validate(client).json() == {"violations": []}


def test_validate_takes_the_duration_from_the_record_when_given_a_video_id(client, media):
    video_id = transcribed_record(client, media, duration=LONG_VIDEO_S)
    late = [*LEGAL_CHAPTERS[:2], {"start_s": 900, "title": "After the end"}]

    r = validate(client, video_id=video_id, fields={"chapters": late})

    assert [v["rule"] for v in r.json()["violations"]] == ["chapter_within_duration"]


def test_validate_takes_the_fields_and_the_brief_from_storage(client, media):
    """No ``fields`` in the body: the stored dossier and the stored brief."""
    video_id = transcribed_record(client, media)
    client.patch("/api/library/brief", json={"house_rules": {"no_em_dashes": True}},
                 headers=agent())
    client.patch(f"/api/library/{video_id}", json={"description": EM_DASH_DESCRIPTION},
                 headers=agent(**{"If-Match": "2"}))

    violations = validate(client, video_id=video_id).json()["violations"]

    assert [v["rule"] for v in violations] == ["no_em_dashes"]
    assert violations[0]["severity"] == "style"


def test_validate_refuses_a_field_that_is_not_authored(client):
    assert validate(client, fields={"nope": 1}).status_code == 422
    assert validate(client, fields={"rev": 2}).status_code == 422


def test_validate_refuses_an_unknown_body_key(client):
    r = client.post("/api/library/validate", json={"fieldz": {}}, headers=agent())

    assert r.status_code == 422


def test_validate_unknown_video_id_is_404(client):
    assert validate(client, video_id="nope").status_code == 404


# --- package -----------------------------------------------------------------

def package(client, video_id, **params):
    return client.get(f"/api/library/{video_id}/package", params=params, headers=agent())


def test_package_renders_the_record_with_its_violations(client, media):
    video_id = transcribed_record(client, media)
    client.patch(
        f"/api/library/{video_id}",
        json={"title": "Captions without a render farm", "chapters": LEGAL_CHAPTERS},
        headers=agent(**{"If-Match": "2"}),
    )

    r = package(client, video_id)

    assert r.status_code == 200
    body = r.json()
    assert body["platform"] == "youtube"
    assert body["violations"] == []
    assert body["text"].startswith("TITLE OPTIONS\n1. Captions without a render farm")
    assert "00:00 Intro" in body["text"] and "01:00 Middle" in body["text"]
    # The duration came from the stored transcript.
    assert "Source: CapForge transcript, talk.mp4, 10:00" in body["text"]


def test_package_is_rendered_even_when_violations_ride_along(client, media):
    video_id = transcribed_record(client, media)
    client.patch("/api/library/brief", json={"house_rules": {"no_em_dashes": True}},
                 headers=agent())
    client.patch(f"/api/library/{video_id}", json={"description": EM_DASH_DESCRIPTION},
                 headers=agent(**{"If-Match": "2"}))

    body = package(client, video_id).json()

    assert EM_DASH_DESCRIPTION in body["text"]
    assert [v["rule"] for v in body["violations"]] == ["no_em_dashes"]


def test_package_uses_the_stored_brief(client, media):
    video_id = transcribed_record(client, media)
    client.patch("/api/library/brief", json={"footer": "Made with CapForge."},
                 headers=agent())
    client.patch(f"/api/library/{video_id}", json={"title": "A talk"},
                 headers=agent(**{"If-Match": "2"}))

    assert "Made with CapForge." in package(client, video_id).json()["text"]


def test_package_refuses_any_platform_but_youtube(client, media):
    video_id = transcribed_record(client, media)

    r = package(client, video_id, platform="tiktok")

    assert r.status_code == 400
    assert "youtube" in r.json()["detail"]


def test_package_without_a_transcript_still_renders(client, media):
    """No duration known yet — the Source line simply omits it."""
    rec = create(client, media)

    body = package(client, rec["id"]).json()

    assert body["text"].endswith("Chapters: none\n")
    assert "Source: CapForge transcript, talk.mp4\n" in body["text"]


def test_package_unknown_id_is_404(client):
    assert package(client, "nope").status_code == 404


# --- PATCH refuses a hard violation ------------------------------------------

def test_patch_refuses_a_hard_violation_and_writes_nothing(client, media):
    rec = create(client, media)

    r = client.patch(
        f"/api/library/{rec['id']}",
        json={"title": "T" * 101, "description": "fine"},
        headers=agent(**{"If-Match": "1"}),
    )

    assert r.status_code == 422
    body = r.json()
    assert body["detail"] == "1 rule(s) violated"
    assert [v["rule"] for v in body["violations"]] == ["title_max_chars"]

    after = client.get(f"/api/library/{rec['id']}", headers=agent()).json()
    assert after["rev"] == 1
    assert after["title"] == "" and after["description"] == ""
    assert after["history"] == []


def test_patch_refuses_chapters_that_fall_outside_the_stored_duration(client, media):
    video_id = transcribed_record(client, media, duration=30.0)

    r = client.patch(
        f"/api/library/{video_id}",
        json={"chapters": LEGAL_CHAPTERS},
        headers=agent(**{"If-Match": "2"}),
    )

    assert r.status_code == 422
    rules = {v["rule"] for v in r.json()["violations"]}
    assert rules == {"chapter_within_duration"}


def test_patch_validates_the_merged_record_not_only_the_patch(client, media, home):
    """A record written by an older build carries its violation into the merge."""
    rec = create(client, media)
    path = home / "library" / rec["id"] / "record.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    path.write_text(json.dumps({**stored, "title": "T" * 101}), encoding="utf-8")

    refused = client.patch(
        f"/api/library/{rec['id']}", json={"tags": ["a"]}, headers=agent(**{"If-Match": "1"})
    )
    assert refused.status_code == 422
    assert [v["rule"] for v in refused.json()["violations"]] == ["title_max_chars"]

    fixed = client.patch(
        f"/api/library/{rec['id']}",
        json={"tags": ["a"], "title": "Short enough"},
        headers=agent(**{"If-Match": "1"}),
    )
    assert fixed.status_code == 200 and fixed.json()["title"] == "Short enough"


def test_patch_is_not_blocked_by_a_style_violation(client, media):
    client.patch("/api/library/brief", json={"house_rules": {"no_em_dashes": True}},
                 headers=agent())
    rec = create(client, media)

    r = client.patch(
        f"/api/library/{rec['id']}",
        json={"description": EM_DASH_DESCRIPTION},
        headers=agent(**{"If-Match": "1"}),
    )

    assert r.status_code == 200
    assert r.json()["description"] == EM_DASH_DESCRIPTION


# --- the live session proxy (wired in main.py) -------------------------------

def session_result(text="Live words here"):
    from backend.models.schemas import Segment, TranscriptionResult, WordSegment

    return TranscriptionResult(
        segments=[Segment(
            start=0.0, end=2.0, text=text,
            words=[WordSegment(word=w, start=float(i), end=float(i + 1))
                   for i, w in enumerate(text.split())],
        )],
        language="en",
        audio_path="/tmp/live.wav",
        duration=2.0,
    )


def test_transcript_answers_from_the_session_for_the_active_record(
    client, main_module, monkeypatch, media
):
    video_id = transcribed_record(client, media)
    monkeypatch.setattr(main_module, "current_result", session_result())
    monkeypatch.setattr(main_module, "current_ui_state", {"activeVideoId": video_id})

    body = client.get(f"/api/library/{video_id}/transcript", headers=agent()).json()

    assert body["source"] == "session"
    assert body["rev"] == 2  # the record's rev, not the session's
    segment = body["transcript"]["segments"][0]
    assert segment["text"] == "Live words here"
    assert "words" not in segment  # segments_only is honoured on the session too


def test_the_session_transcript_can_be_asked_for_its_words(
    client, main_module, monkeypatch, media
):
    video_id = transcribed_record(client, media)
    monkeypatch.setattr(main_module, "current_result", session_result())
    monkeypatch.setattr(main_module, "current_ui_state", {"activeVideoId": video_id})

    body = client.get(
        f"/api/library/{video_id}/transcript",
        params={"segments_only": "false"}, headers=agent(),
    ).json()

    words = body["transcript"]["segments"][0]["words"]
    assert [w["word"] for w in words] == ["Live", "words", "here"]


def test_transcript_falls_back_to_the_record_when_another_video_is_open(
    client, main_module, monkeypatch, media
):
    video_id = transcribed_record(client, media)
    monkeypatch.setattr(main_module, "current_result", session_result())
    monkeypatch.setattr(main_module, "current_ui_state", {"activeVideoId": "b" * 32})

    body = client.get(f"/api/library/{video_id}/transcript", headers=agent()).json()

    assert body["source"] == "record"
    assert body["transcript"]["segments"][0]["text"] == "Hello brave world"


def test_transcript_falls_back_to_the_record_with_no_session_loaded(
    client, main_module, monkeypatch, media
):
    video_id = transcribed_record(client, media)
    monkeypatch.setattr(main_module, "current_result", None)
    monkeypatch.setattr(main_module, "current_ui_state", {"activeVideoId": video_id})

    body = client.get(f"/api/library/{video_id}/transcript", headers=agent()).json()

    assert body["source"] == "record"


def test_a_record_write_broadcasts_record_updated(client, main_module, monkeypatch, media):
    """main.py's ``on_record_changed`` is the ``/ws/progress`` push."""
    sent = []

    async def capture(payload):
        sent.append(payload)

    monkeypatch.setattr(main_module, "broadcast_event", capture)
    rec = create(client, media)

    client.patch(f"/api/library/{rec['id']}", json={"title": "Pushed"},
                 headers=agent(**{"If-Match": "1"}))

    assert sent == [
        {"type": "record_updated", "video_id": rec["id"], "rev": 2, "by": "agent"}
    ]


# --- the two injected seams, without main.py in the way ----------------------

@pytest.fixture
def wired(home):
    """A bare app holding the library router, so ``build_router``'s two optional
    arguments can be driven directly."""
    from fastapi import FastAPI

    from backend.library.router import build_router, reset_store_cache

    live = {"id": None, "result": None}
    changes: list[tuple] = []

    async def on_record_changed(video_id, rev, by):
        changes.append((video_id, rev, by))

    app = FastAPI()
    app.include_router(build_router(
        lambda: "agent",
        live_session=lambda: (live["id"], live["result"]),
        on_record_changed=on_record_changed,
    ))
    try:
        yield types.SimpleNamespace(
            client=TestClient(app), live=live, changes=changes
        )
    finally:
        reset_store_cache()


def test_the_router_works_without_either_optional_argument(home, media):
    """``build_router(actor_dep)`` alone is still the #1 contract."""
    from fastapi import FastAPI

    from backend.library.router import build_router, reset_store_cache

    app = FastAPI()
    app.include_router(build_router(lambda: "agent"))
    try:
        with TestClient(app) as c:
            rec = c.post("/api/library", json={"source_path": str(media)}).json()
            assert c.put(f"/api/library/{rec['id']}/project", json=project()).status_code == 200
            body = c.get(f"/api/library/{rec['id']}/transcript").json()
            assert body["source"] == "record"
    finally:
        reset_store_cache()


def test_every_record_write_is_reported_to_on_record_changed(wired, media, tmp_path):
    c = wired.client
    rec = c.post("/api/library", json={"source_path": str(media), "scratch": True}).json()
    video_id = rec["id"]

    c.post(f"/api/library/{video_id}/promote")
    c.put(f"/api/library/{video_id}/project", json=project())
    c.patch(f"/api/library/{video_id}", json={"title": "T"}, headers={"If-Match": "3"})
    c.post(f"/api/library/{video_id}/renders",
           json={"path": "/out/a.mp4", "kind": "video", "at": "2026-09-14T10:00:00Z"})

    assert wired.changes == [
        (video_id, 2, "agent"),   # promote
        (video_id, 3, "user"),    # PUT project — only the renderer writes it
        (video_id, 4, "agent"),   # patch
        (video_id, 5, "agent"),   # renders
    ]


def test_importing_a_project_file_is_reported_too(wired, media, tmp_path):
    path = capforge_file(tmp_path, media)

    rec = wired.client.post("/api/library/import-project", json={"path": str(path)}).json()

    assert wired.changes == [(rec["id"], rec["rev"], "agent")]


def test_a_refused_write_reports_nothing(wired, media):
    c = wired.client
    rec = c.post("/api/library", json={"source_path": str(media)}).json()

    c.patch(f"/api/library/{rec['id']}", json={"title": "T" * 101}, headers={"If-Match": "1"})
    c.patch(f"/api/library/{rec['id']}", json={"title": "T"}, headers={"If-Match": "99"})

    assert wired.changes == []


def test_a_patch_that_changes_nothing_reports_nothing(wired, media):
    c = wired.client
    rec = c.post("/api/library", json={"source_path": str(media)}).json()

    assert c.patch(f"/api/library/{rec['id']}", json={}, headers={"If-Match": "1"}).status_code == 200

    assert wired.changes == []


def test_the_session_proxy_is_driven_by_live_session(wired, media):
    c = wired.client
    rec = c.post("/api/library", json={"source_path": str(media)}).json()
    c.put(f"/api/library/{rec['id']}/project", json=project())

    assert c.get(f"/api/library/{rec['id']}/transcript").json()["source"] == "record"

    wired.live["id"] = rec["id"]
    wired.live["result"] = session_result()

    assert c.get(f"/api/library/{rec['id']}/transcript").json()["source"] == "session"


def test_the_session_proxy_answers_before_any_project_was_stored(wired, media):
    """The open video has a transcript even when nothing was autosaved yet."""
    c = wired.client
    rec = c.post("/api/library", json={"source_path": str(media)}).json()
    wired.live["id"] = rec["id"]
    wired.live["result"] = session_result()

    r = c.get(f"/api/library/{rec['id']}/transcript")

    assert r.status_code == 200 and r.json()["source"] == "session"
