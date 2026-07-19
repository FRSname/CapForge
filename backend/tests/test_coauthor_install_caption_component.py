"""Phase 5 — `install_caption_component` lets the co-author agent legitimately
install a registry caption component into its own workspace.

Before this endpoint, a registry component only ever landed in a co-author
project as a side effect of a render's ``sync_companions`` call — the agent had
no direct way to request one, and the CLI passthrough allowlist
(``CLI_ALLOWED_SUBCOMMANDS``) deliberately excludes ``add``. See
docs/plans/caption-style-visibility-feedback.md Phase 5.
"""

from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient

from backend.exporters.hyperframes_captions import CaptionStyleError
from backend.exporters.hyperframes_project import coauthor_project_dir, write_coauthor_marker
from backend.models.schemas import Segment, TranscriptionResult, VideoRenderConfig, WordSegment

AGENT_HEADER = "X-CapForge-Agent-Token"
AGENT_TOKEN = "test-agent-token-xyz"
ROUTE = "/api/agent/coauthor/install-caption-component"


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
def client(main_module, monkeypatch, tmp_path):
    """TestClient seeded with a result but NOT in co-author mode, and a mirrored
    render config (install-caption-component reads it via ``_agent_frame_inputs``,
    same as ``sync_captions``)."""
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "current_coauthor", False, raising=False)
    # Pin the co-author workspace root under tmp_path — see test_coauthor_sync_guard.py.
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))
    monkeypatch.setattr(
        m, "current_ui_state", {"render": {"config": VideoRenderConfig().model_dump()}}
    )

    prev_result = m.current_result
    m.current_result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="Hello",
                words=[WordSegment(word="Hello", start=0.0, end=1.0)],
            ),
        ],
        language="en",
        audio_path=str(tmp_path / "audio.wav"),
    )
    try:
        yield TestClient(m.app)
    finally:
        m.current_result = prev_result


def _auth():
    return {AGENT_HEADER: AGENT_TOKEN}


def _activate_coauthor(main_module, client, tmp_path):
    """Mark the derived co-author project active (mirrors test_coauthor_sync_guard's
    approach of driving state via the durable marker, not a full seed)."""
    m = main_module
    workspace = m.hyperframes_workspace(m.current_result.audio_path)
    project_dir = coauthor_project_dir(m.current_result, workspace)
    project_dir.mkdir(parents=True, exist_ok=True)
    write_coauthor_marker(project_dir, True, source=m.current_result.audio_path)
    return project_dir


def test_install_without_token_is_401(client):
    res = client.post(ROUTE, json={"style": "caption-kinetic-slam"})
    assert res.status_code == 401


def test_install_outside_coauthor_returns_clear_409(client):
    res = client.post(ROUTE, json={"style": "caption-kinetic-slam"}, headers=_auth())
    assert res.status_code == 409
    assert "co-author" in res.json()["detail"].lower()


@pytest.mark.parametrize("style", ["classic", "custom", "", "   "])
def test_install_rejects_non_registry_styles(main_module, client, tmp_path, style):
    _activate_coauthor(main_module, client, tmp_path)
    res = client.post(ROUTE, json={"style": style}, headers=_auth())
    assert res.status_code == 400


def test_install_rejects_missing_style_field(main_module, client, tmp_path):
    _activate_coauthor(main_module, client, tmp_path)
    res = client.post(ROUTE, json={}, headers=_auth())
    assert res.status_code == 400


@pytest.mark.parametrize(
    "style",
    [
        "../../evil",  # path traversal — would escape compositions/components/
        "--dir",  # argv flag injection into the `npx hyperframes add` command
        "Caption-Kinetic-Slam",  # uppercase not allowed by the slug regex
        "a b",  # whitespace not allowed by the slug regex
    ],
)
def test_install_rejects_malformed_style_names_without_calling_installer(
    main_module, client, tmp_path, monkeypatch, style
):
    """Security fix: a strict slug check runs before ANYTHING else touches
    `style` — it flows into an f-string path and CLI argv, so path traversal
    and flag-like values must be rejected with 400 and never reach the
    installer."""
    m = main_module
    _activate_coauthor(m, client, tmp_path)

    calls = []
    monkeypatch.setattr(
        m, "install_caption_component_for_coauthor", lambda *a, **k: calls.append((a, k))
    )

    res = client.post(ROUTE, json={"style": style}, headers=_auth())

    assert res.status_code == 400
    assert calls == []


def test_install_success_calls_installer_with_coauthor_dir_and_returns_hint(
    main_module, client, tmp_path, monkeypatch
):
    m = main_module
    project_dir = _activate_coauthor(m, client, tmp_path)

    calls = []

    def _fake_install(result, config, project_dir_arg, style, **kwargs):
        calls.append((project_dir_arg, style))
        return "compositions/components/caption-kinetic-slam.html"

    monkeypatch.setattr(m, "install_caption_component_for_coauthor", _fake_install)

    res = client.post(ROUTE, json={"style": "caption-kinetic-slam"}, headers=_auth())

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["path"] == "compositions/components/caption-kinetic-slam.html"
    assert "data-composition-src" in body["hint"]
    assert "refresh" in body["hint"].lower()
    assert calls == [(str(project_dir), "caption-kinetic-slam")]


def test_install_maps_caption_style_error_to_400(main_module, client, tmp_path, monkeypatch):
    m = main_module
    _activate_coauthor(m, client, tmp_path)

    def _raise(*_a, **_k):
        raise CaptionStyleError("Node.js 22+ is required to use this caption style.")

    monkeypatch.setattr(m, "install_caption_component_for_coauthor", _raise)

    res = client.post(ROUTE, json={"style": "caption-kinetic-slam"}, headers=_auth())

    assert res.status_code == 400
    assert "node" in res.json()["detail"].lower()


def test_install_no_result_still_404s(main_module, client):
    main_module.current_result = None
    res = client.post(ROUTE, json={"style": "caption-kinetic-slam"}, headers=_auth())
    assert res.status_code == 404
