"""``POST /api/agent/command`` op ``load_video``.

`load_video` is the entry point of an agent-driven batch run: it imports a file
into the *open* app and starts transcription there, so the transcript, style and
render all stay in the UI. The relay itself is fire-and-forget, which is exactly
why this op validates up front — a bad path or a closed app must fail at the
call the agent made, not vanish into a broadcast nobody receives.

See docs/plans/mcp-batch-control.md Phase 3.
"""

from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient

AGENT_HEADER = "X-CapForge-Agent-Token"
AGENT_TOKEN = "test-agent-token-xyz"


@pytest.fixture
def main_module():
    """Import backend.main with heavy ML deps stubbed (dev venv lacks whisperx).

    huggingface_hub needs more than a bare module: transcriber.py imports
    `snapshot_download` from it *and* `LocalEntryNotFoundError` from its
    `.errors` submodule at import time. Stubbing both here (rather than relying
    on another test module having done so first) keeps this file runnable alone.
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
def client(main_module, monkeypatch):
    """TestClient with a known agent token and one fake connected UI."""
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    # A non-empty ws_clients stands in for "CapForge is open". broadcast_event
    # tolerates objects that fail to send, so a sentinel is enough.
    monkeypatch.setattr(m, "ws_clients", [object()], raising=False)
    return TestClient(m.app)


def _auth():
    return {AGENT_HEADER: AGENT_TOKEN}


def _post(client, payload):
    return client.post(
        "/api/agent/command",
        headers=_auth(),
        json={"op": "load_video", "payload": payload},
    )


def test_accepts_an_existing_file(client, tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"not really a video, but it is a file")

    res = _post(client, {"path": str(video)})

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_rejects_a_path_that_does_not_exist(client, tmp_path):
    """The agent's most likely batch mistake — it must not be a silent no-op."""
    res = _post(client, {"path": str(tmp_path / "missing.mp4")})

    assert res.status_code == 400
    assert "not found" in res.json()["detail"].lower()


def test_rejects_a_directory(client, tmp_path):
    res = _post(client, {"path": str(tmp_path)})

    assert res.status_code == 400


@pytest.mark.parametrize("payload", [{}, {"path": ""}, {"path": "   "}, {"path": 42}])
def test_rejects_a_missing_or_non_string_path(client, payload):
    res = _post(client, payload)

    assert res.status_code == 400
    assert "path" in res.json()["detail"].lower()


def test_rejects_when_no_ui_is_connected(main_module, monkeypatch, tmp_path):
    """Nothing would receive the broadcast, so say so instead of returning ok."""
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "ws_clients", [], raising=False)
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"x")

    res = _post(TestClient(m.app), {"path": str(video)})

    assert res.status_code == 409
    assert "open capforge" in res.json()["detail"].lower()


def test_load_video_is_an_allowed_op(main_module):
    assert "load_video" in main_module.AGENT_COMMAND_OPS


def test_unknown_ops_are_still_rejected(client):
    res = client.post(
        "/api/agent/command",
        headers=_auth(),
        json={"op": "rm_rf", "payload": {}},
    )

    assert res.status_code == 400
