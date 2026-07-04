"""Phase 6 — auth + path-allowlist gate on the local media endpoints.

`GET /api/serve-audio` and `GET /api/video-info` used to accept an arbitrary
filesystem path with no auth, so any local process or browser page hitting
127.0.0.1:53421 could read any file. These tests pin the two guards now in
place:

  1. **Auth** — a per-launch ``LOCAL_TOKEN`` (or the agent token) must be
     presented via ``?token=`` query param or the ``X-CapForge-Local-Token``
     header. No/blank/wrong token → 401.
  2. **Path allowlist** — even with a valid token, only the current
     transcription source (or a file in its HyperFrames workspace) is served;
     any other path → 403.
"""

from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient

from backend.models.schemas import TranscriptionResult


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
def source_audio(tmp_path):
    """A real on-disk file to stand in for the current transcription source."""
    f = tmp_path / "clip.wav"
    f.write_bytes(b"RIFF....WAVEfmt fake audio bytes")
    return f


@pytest.fixture
def client(main_module, source_audio, monkeypatch):
    """TestClient with a known local token and current_result pointed at
    source_audio. current_result is restored after the test."""
    m = main_module
    # Keep the HyperFrames workspace (used by the allowlist) inside tmp so the
    # workspace test never touches the real ~/.capforge home.
    monkeypatch.setenv("CAPFORGE_HOME", str(source_audio.parent / "home"))
    monkeypatch.setattr(m, "LOCAL_TOKEN", "test-local-token-abc", raising=False)
    monkeypatch.setattr(m, "AGENT_TOKEN", "test-agent-token-xyz", raising=False)

    prev_result = m.current_result
    m.current_result = TranscriptionResult(audio_path=str(source_audio), language="en")
    try:
        yield TestClient(m.app)
    finally:
        m.current_result = prev_result


# ── Auth: serve-audio ────────────────────────────────────────────────────────

def test_serve_audio_without_token_is_401(client, source_audio):
    res = client.get("/api/serve-audio", params={"path": str(source_audio)})
    assert res.status_code == 401


def test_serve_audio_with_wrong_token_is_401(client, source_audio):
    res = client.get(
        "/api/serve-audio",
        params={"path": str(source_audio), "token": "nope"},
    )
    assert res.status_code == 401


def test_serve_audio_with_valid_query_token_is_200(client, source_audio):
    res = client.get(
        "/api/serve-audio",
        params={"path": str(source_audio), "token": "test-local-token-abc"},
    )
    assert res.status_code == 200
    assert res.content == source_audio.read_bytes()


def test_serve_audio_with_valid_header_token_is_200(client, source_audio):
    res = client.get(
        "/api/serve-audio",
        params={"path": str(source_audio)},
        headers={"X-CapForge-Local-Token": "test-local-token-abc"},
    )
    assert res.status_code == 200


def test_serve_audio_accepts_agent_token(client, source_audio):
    """An authorised MCP client (agent token) isn't locked out of media reads."""
    res = client.get(
        "/api/serve-audio",
        params={"path": str(source_audio), "token": "test-agent-token-xyz"},
    )
    assert res.status_code == 200


# ── Path allowlist: serve-audio ──────────────────────────────────────────────

def test_serve_audio_rejects_path_outside_allowlist(client, tmp_path):
    """Valid token but a path that is neither the source nor in its workspace."""
    secret = tmp_path / "secret.txt"
    secret.write_text("do not read me")
    res = client.get(
        "/api/serve-audio",
        params={"path": str(secret), "token": "test-local-token-abc"},
    )
    assert res.status_code == 403


def test_serve_audio_rejects_when_no_current_result(client, source_audio, main_module):
    """With no active transcription, nothing is servable even with a valid token."""
    main_module.current_result = None
    res = client.get(
        "/api/serve-audio",
        params={"path": str(source_audio), "token": "test-local-token-abc"},
    )
    assert res.status_code == 403


def test_serve_audio_allows_file_in_workspace(client, main_module, source_audio):
    """A file inside the source's HyperFrames workspace is servable."""
    ws = main_module.hyperframes_workspace(str(source_audio))
    from pathlib import Path

    ws_path = Path(ws)
    ws_path.mkdir(parents=True, exist_ok=True)
    inner = ws_path / "frame.png"
    inner.write_bytes(b"\x89PNG fake")
    res = client.get(
        "/api/serve-audio",
        params={"path": str(inner), "token": "test-local-token-abc"},
    )
    assert res.status_code == 200


# ── Auth + allowlist ordering: video-info ────────────────────────────────────

def test_video_info_without_token_is_401(client, source_audio):
    res = client.get("/api/video-info", params={"path": str(source_audio)})
    assert res.status_code == 401


def test_video_info_rejects_path_outside_allowlist(client, tmp_path):
    """Valid token, disallowed path — refused (403) before ffprobe is invoked."""
    secret = tmp_path / "secret.mp4"
    secret.write_bytes(b"not really a video")
    res = client.get(
        "/api/video-info",
        params={"path": str(secret), "token": "test-local-token-abc"},
    )
    assert res.status_code == 403


# ── Path-gate traversal regressions (valid token, testing the PATH gate) ──────
# Each uses a VALID token so it exercises `_is_servable_path`, not the auth gate.
# All three would pass a naive `startswith` allowlist (which is why they matter):
# the guard only holds because the path is realpath-resolved before comparison.

def test_serve_audio_rejects_dotdot_traversal(client, source_audio, tmp_path):
    """A path lexically prefixed by the source but escaping via `..` → 403.

    ``<source>/../secret.txt`` string-startswith the source path, so a naive
    prefix check would allow it; realpath resolves it to ``<tmp>/secret.txt``
    (outside the allowlist) → refused."""
    secret = tmp_path / "secret.txt"
    secret.write_text("do not read me")
    evil = f"{source_audio}/../secret.txt"
    res = client.get(
        "/api/serve-audio",
        params={"path": evil, "token": "test-local-token-abc"},
    )
    assert res.status_code == 403


def test_serve_audio_rejects_symlink_escape(client, main_module, source_audio, tmp_path):
    """A symlink INSIDE the workspace pointing OUTSIDE it → 403.

    The link's own path is inside the workspace (a naive check would allow it),
    but resolving through the symlink lands outside → refused."""
    from pathlib import Path

    ws_path = Path(main_module.hyperframes_workspace(str(source_audio)))
    ws_path.mkdir(parents=True, exist_ok=True)
    secret = tmp_path / "outside_secret.txt"
    secret.write_text("do not read me")
    link = ws_path / "escape"
    link.symlink_to(secret)
    res = client.get(
        "/api/serve-audio",
        params={"path": str(link), "token": "test-local-token-abc"},
    )
    assert res.status_code == 403


def test_serve_audio_rejects_sibling_prefix_dir(client, main_module, source_audio):
    """A sibling dir whose name is ``<workspace>`` + 'EVIL' → 403.

    It shares the workspace's string prefix (naive startswith would allow it)
    but is not contained in the workspace, so parent-containment refuses it."""
    from pathlib import Path

    ws = main_module.hyperframes_workspace(str(source_audio))
    sibling = Path(str(ws) + "EVIL")
    sibling.mkdir(parents=True, exist_ok=True)
    inner = sibling / "loot.txt"
    inner.write_text("do not read me")
    res = client.get(
        "/api/serve-audio",
        params={"path": str(inner), "token": "test-local-token-abc"},
    )
    assert res.status_code == 403


# ── Auth on PUT /api/result (H2/M1) ──────────────────────────────────────────
# current_result is the media allowlist anchor; PUT must be authenticated so it
# can't be repointed (→ arbitrary read) or wiped cross-origin. GET stays open.

def _sample_result(source_audio):
    return TranscriptionResult(audio_path=str(source_audio), language="en").model_dump(
        mode="json"
    )


def test_get_result_is_unauthenticated(client):
    """Reading the current result stays open (no token required)."""
    res = client.get("/api/result")
    assert res.status_code == 200


def test_put_result_without_token_is_401(client, source_audio):
    res = client.put("/api/result", json=_sample_result(source_audio))
    assert res.status_code == 401


def test_put_result_with_wrong_token_is_401(client, source_audio):
    res = client.put(
        "/api/result",
        json=_sample_result(source_audio),
        headers={"X-CapForge-Local-Token": "nope"},
    )
    assert res.status_code == 401


def test_put_result_with_valid_local_token_is_200(client, source_audio):
    res = client.put(
        "/api/result",
        json=_sample_result(source_audio),
        headers={"X-CapForge-Local-Token": "test-local-token-abc"},
    )
    assert res.status_code == 200


def test_put_result_accepts_agent_token(client, source_audio):
    """An authorised agent (agent token) may also update the result.

    require_local_token reads the token from ``?token=`` or the
    ``X-CapForge-Local-Token`` header and accepts either the local OR the agent
    token, so an agent presents its token the same way media reads do."""
    res = client.put(
        "/api/result",
        params={"token": "test-agent-token-xyz"},
        json=_sample_result(source_audio),
    )
    assert res.status_code == 200
