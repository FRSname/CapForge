"""``POST /api/agent/command`` op ``open_video`` (and ``load_video``'s record).

`open_video` hands the renderer a *library* record to restore: the backend owns
no track state, so the command carries the record id and the window does the
work. Everything that can fail without a window watching is validated here —
a bad id, a record that was never opened (no stored snapshot), or a running
backend with every window closed — so the agent's own call fails instead of a
broadcast vanishing.

`load_video` gains the other half of the pairing: it creates (or finds) the
library record for the file it just loaded and returns its id.

See docs/plans/mcp-library-tools.md → Backend (small).
"""

from __future__ import annotations

import json
import sys
import types

import pytest
from fastapi.testclient import TestClient

AGENT_HEADER = "X-CapForge-Agent-Token"
AGENT_TOKEN = "test-agent-token-xyz"

NO_SNAPSHOT = (
    "Record {id} has no session snapshot yet — open it in CapForge once "
    "(autosave lands with the library screen)"
)
NO_WINDOW = (
    "CapForge is running but no window is open — click the Dock icon, "
    "then retry open_video"
)


@pytest.fixture
def main_module():
    """Import backend.main with heavy ML deps stubbed (dev venv lacks whisperx).

    Same stubs as test_library_routes.py, repeated so this file runs alone:
    transcriber.py imports `snapshot_download` from huggingface_hub *and*
    `LocalEntryNotFoundError` from its `.errors` submodule at import time.
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
def broadcasts(main_module, monkeypatch):
    """Capture what the relay would have sent to the window."""
    sent: list[dict] = []

    async def _capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(main_module, "broadcast_event", _capture)
    return sent


@pytest.fixture
def client(main_module, monkeypatch, home, broadcasts):
    """TestClient with a known agent token and one fake connected window."""
    from backend.library import router as library_router

    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "ws_clients", [object()], raising=False)
    try:
        yield TestClient(m.app)
    finally:
        library_router.reset_store_cache()


@pytest.fixture
def media(tmp_path):
    p = tmp_path / "talk.mp4"
    p.write_bytes(b"media-bytes" * 100)
    return p


def _auth():
    return {AGENT_HEADER: AGENT_TOKEN}


def _post(client, op, payload):
    return client.post(
        "/api/agent/command", headers=_auth(), json={"op": op, "payload": payload}
    )


def _project() -> dict:
    return {
        "version": 2,
        "transcriptionResult": {
            "segments": [
                {
                    "start": 0.0,
                    "end": 2.0,
                    "text": "hello world",
                    "words": [
                        {"word": "hello", "start": 0.0, "end": 1.0},
                        {"word": "world", "start": 1.0, "end": 2.0},
                    ],
                }
            ],
            "language": "en",
            "audio_path": "/tmp/a.wav",
            "duration": 2.0,
        },
    }


def _record(client, media, *, with_project: bool = False) -> str:
    res = client.post("/api/library", json={"source_path": str(media)}, headers=_auth())
    assert res.status_code in (200, 201), res.text
    video_id = res.json()["id"]
    if with_project:
        put = client.put(
            f"/api/library/{video_id}/project", json=_project(), headers=_auth()
        )
        assert put.status_code == 200, put.text
    return video_id


# --- the op ----------------------------------------------------------------

def test_open_video_is_an_allowed_op(main_module):
    assert "open_video" in main_module.AGENT_COMMAND_OPS


@pytest.mark.parametrize("payload", [{}, {"record_id": ""}, {"record_id": "  "},
                                     {"record_id": 42}, {"record_id": None}])
def test_rejects_a_missing_or_non_string_record_id(client, payload):
    res = _post(client, "open_video", payload)

    assert res.status_code == 400
    assert "record_id" in res.json()["detail"]


def test_unknown_record_is_404(client):
    res = _post(client, "open_video", {"record_id": "nope"})

    assert res.status_code == 404


def test_record_without_a_stored_project_is_409(client, media):
    video_id = _record(client, media)

    res = _post(client, "open_video", {"record_id": video_id})

    assert res.status_code == 409
    assert res.json()["detail"] == NO_SNAPSHOT.format(id=video_id)


def test_no_window_is_409_even_with_a_stored_project(
    main_module, monkeypatch, client, media
):
    """The backend answers with every window closed — say so, don't broadcast."""
    video_id = _record(client, media, with_project=True)
    monkeypatch.setattr(main_module, "ws_clients", [], raising=False)

    res = _post(client, "open_video", {"record_id": video_id})

    assert res.status_code == 409
    assert res.json()["detail"] == NO_WINDOW


def test_broadcasts_the_record_id_and_command_id(client, media, broadcasts):
    video_id = _record(client, media, with_project=True)

    res = _post(
        client, "open_video", {"record_id": video_id, "command_id": "c-abc123"}
    )

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert broadcasts[-1] == {
        "type": "agent_command",
        "op": "open_video",
        "payload": {"record_id": video_id, "command_id": "c-abc123"},
    }


# --- load_video creates the record -----------------------------------------

def test_load_video_returns_a_video_id_and_writes_the_record(client, media, home):
    res = _post(client, "load_video", {"path": str(media)})

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    video_id = body["video_id"]
    record = home / "library" / video_id / "record.json"
    assert record.is_file()
    assert json.loads(record.read_text())["sourcePath"] == str(media)


def test_load_video_still_loads_when_the_library_write_fails(
    client, monkeypatch, media, broadcasts
):
    """The index must never block the primary action — log, continue, no id."""
    from backend.library import router as library_router

    def _boom():
        raise OSError("library root is read-only")

    monkeypatch.setattr(library_router, "get_store", _boom)

    res = _post(client, "load_video", {"path": str(media)})

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert broadcasts[-1]["op"] == "load_video"


def test_load_video_validation_is_unchanged(client, tmp_path):
    assert _post(client, "load_video", {"path": str(tmp_path / "gone.mp4")}).status_code == 400
