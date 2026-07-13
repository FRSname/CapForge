"""Phase 1 — token-gate + sandbox the export/render endpoints.

``POST /api/export``, ``POST /api/render-video``, and
``POST /api/export-hyperframes`` used to accept unauthenticated requests and
write to a client-supplied ``output_dir`` raw (``os.makedirs``), so any local
process or page hitting 127.0.0.1:53421 could trigger a render/export and
choose (within OS permissions) where files landed. These tests pin the two
guards now in place:

  1. **Auth** — ``require_local_token`` gates all three routes; the per-launch
     ``LOCAL_TOKEN`` via ``X-CapForge-Local-Token`` (the renderer's header) or
     the agent token via ``X-CapForge-Agent-Token`` (the MCP client's header —
     added by this fix so the agent isn't locked out) is required. No/blank/
     wrong token → 401. The renderer only ever sends tokens as headers on
     POSTs (see ``api.ts``'s ``post()``); the shared dependency's ``?token=``
     query slot remains for the media ``<src>`` loads that can't set headers.
  2. **Output-dir sandbox** — a non-absolute ``output_dir`` (e.g. a `..`
     traversal string) resolves to the folder next to the source media
     (``resolve_output_dir``), never to the literal client-supplied path.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

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
    """TestClient with a known local/agent token and current_result pointed at
    source_audio. current_result is restored after the test."""
    m = main_module
    monkeypatch.setenv("CAPFORGE_HOME", str(source_audio.parent / "home"))
    monkeypatch.setattr(m, "LOCAL_TOKEN", "test-local-token-abc", raising=False)
    monkeypatch.setattr(m, "AGENT_TOKEN", "test-agent-token-xyz", raising=False)

    prev_result = m.current_result
    m.current_result = TranscriptionResult(audio_path=str(source_audio), language="en")
    try:
        yield TestClient(m.app)
    finally:
        m.current_result = prev_result


LOCAL_HEADERS = {"X-CapForge-Local-Token": "test-local-token-abc"}
AGENT_HEADERS = {"X-CapForge-Agent-Token": "test-agent-token-xyz"}


# ── 401 without a token, on all three routes ─────────────────────────────────

def test_export_without_token_is_401(client):
    res = client.post("/api/export", json={"formats": ["json"]})
    assert res.status_code == 401


def test_render_video_without_token_is_401(client):
    res = client.post("/api/render-video", json={})
    assert res.status_code == 401


def test_export_hyperframes_without_token_is_401(client):
    res = client.post("/api/export-hyperframes", json={"render": False})
    assert res.status_code == 401


def test_export_with_wrong_token_is_401(client):
    res = client.post(
        "/api/export", json={"formats": ["json"]}, headers={"X-CapForge-Local-Token": "nope"}
    )
    assert res.status_code == 401


# ── 200 with X-CapForge-Local-Token ───────────────────────────────────────────

def test_export_with_local_token_is_200(client, source_audio):
    res = client.post(
        "/api/export",
        json={"formats": ["json"], "output_dir": str(source_audio.parent)},
        headers=LOCAL_HEADERS,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert len(body["files"]) == 1
    assert Path(body["files"][0]).is_file()


def test_render_video_with_local_token_is_200(client, main_module, monkeypatch, source_audio):
    captured: dict = {}

    def fake_render(result, config, output_dir, **kwargs):
        captured["output_dir"] = output_dir
        return str(Path(output_dir) / "out.mov")

    monkeypatch.setattr(main_module, "render_subtitle_video", fake_render)

    res = client.post(
        "/api/render-video",
        json={"output_dir": str(source_audio.parent)},
        headers=LOCAL_HEADERS,
    )
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_export_hyperframes_with_local_token_is_200(
    client, main_module, monkeypatch, source_audio
):
    monkeypatch.setattr(main_module, "export_hyperframes_project", lambda *a, **k: "proj-dir")
    res = client.post(
        "/api/export-hyperframes",
        json={"render": False},
        headers=LOCAL_HEADERS,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["project"] == "proj-dir"


# ── 200 with X-CapForge-Agent-Token (pins the MCP regression) ────────────────
#
# The MCP client (mcp_server/client.py) authenticates every call with
# X-CapForge-Agent-Token, not X-CapForge-Local-Token. Before this fix,
# require_local_token never read that header, so an authorised MCP agent
# would have been 401'd by newly-gated routes it already relies on.

def test_export_with_agent_token_header_is_200(client, source_audio):
    res = client.post(
        "/api/export",
        json={"formats": ["json"], "output_dir": str(source_audio.parent)},
        headers=AGENT_HEADERS,
    )
    assert res.status_code == 200


def test_render_video_with_agent_token_header_is_200(
    client, main_module, monkeypatch, source_audio
):
    monkeypatch.setattr(
        main_module,
        "render_subtitle_video",
        lambda result, config, output_dir, **kwargs: str(Path(output_dir) / "out.mov"),
    )
    res = client.post(
        "/api/render-video",
        json={"output_dir": str(source_audio.parent)},
        headers=AGENT_HEADERS,
    )
    assert res.status_code == 200


def test_export_hyperframes_with_agent_token_header_is_200(
    client, main_module, monkeypatch, source_audio
):
    monkeypatch.setattr(main_module, "export_hyperframes_project", lambda *a, **k: "proj-dir")
    res = client.post(
        "/api/export-hyperframes",
        json={"render": False},
        headers=AGENT_HEADERS,
    )
    assert res.status_code == 200


# ── output_dir sandbox: traversal input resolves to the fallback dir ─────────

TRAVERSAL_OUTPUT_DIR = "../../../tmp/evil"


def test_export_traversal_output_dir_falls_back_to_source_folder(client, source_audio):
    res = client.post(
        "/api/export",
        json={"formats": ["json"], "output_dir": TRAVERSAL_OUTPUT_DIR},
        headers=LOCAL_HEADERS,
    )
    assert res.status_code == 200
    written = Path(res.json()["files"][0])
    # Landed next to the source file, not inside a resolved "../../../tmp/evil".
    assert written.parent == source_audio.parent.resolve()
    assert "evil" not in str(written)


def test_render_video_traversal_output_dir_falls_back_to_source_folder(
    client, main_module, monkeypatch, source_audio
):
    captured: dict = {}

    def fake_render(result, config, output_dir, **kwargs):
        captured["output_dir"] = output_dir
        return str(Path(output_dir) / "out.mov")

    monkeypatch.setattr(main_module, "render_subtitle_video", fake_render)

    res = client.post(
        "/api/render-video",
        json={"output_dir": TRAVERSAL_OUTPUT_DIR},
        headers=LOCAL_HEADERS,
    )
    assert res.status_code == 200
    # render_subtitle_video receives the raw request output_dir; the sandbox
    # is applied *inside* it via resolve_output_dir. Confirm that resolution.
    from backend.exporters.hyperframes_project import resolve_output_dir

    assert resolve_output_dir(captured["output_dir"], str(source_audio)) == str(
        source_audio.resolve().parent
    )


def test_export_hyperframes_traversal_output_dir_falls_back_to_source_folder(
    client, main_module, monkeypatch, source_audio
):
    monkeypatch.setattr(main_module, "export_hyperframes_project", lambda *a, **k: "proj-dir")

    captured: dict = {}

    def fake_render(project_dir, out_path, **kwargs):
        captured["out_path"] = out_path
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_bytes(b"\x00")
        return out_path

    monkeypatch.setattr(main_module, "render_hyperframes_project", fake_render)

    res = client.post(
        "/api/export-hyperframes",
        json={"render": True, "use_ui_config": False, "output_dir": TRAVERSAL_OUTPUT_DIR},
        headers=LOCAL_HEADERS,
    )
    assert res.status_code == 200
    out_path = Path(captured["out_path"])
    assert out_path.parent == source_audio.resolve().parent
    assert "evil" not in str(out_path)
