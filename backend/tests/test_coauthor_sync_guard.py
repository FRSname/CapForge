"""Phase 3 — sync_captions returns a clear 409 outside co-author mode.

Before this guard, a non-co-author ``sync_captions`` call fell through to
``sync_companions`` and died with a generic ``FileNotFoundError``→400 that read
like a bug, which pushed agents into a "call it to be safe → 400 → rationalize"
loop. The upfront ``coauthor_active()`` check replaces that with an explicit,
self-explanatory 409. See docs/plans/mcp-transcript-editing-ux.md Phase 3.
"""

from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient

from backend.models.schemas import Segment, TranscriptionResult, WordSegment

AGENT_HEADER = "X-CapForge-Agent-Token"
AGENT_TOKEN = "test-agent-token-xyz"


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
    """TestClient seeded with a result but NOT in co-author mode.

    ``current_coauthor`` is forced False and ``audio_path`` lives under the test's
    ``tmp_path`` so the derived workspace carries no co-author marker — i.e.
    ``coauthor_active()`` resolves False. ``current_result`` is restored after.
    """
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "current_coauthor", False, raising=False)
    # Pin the co-author workspace root under tmp_path. hyperframes_workspace()
    # resolves from CAPFORGE_HOME (or ~/.capforge) — without this override a
    # stray real ~/.capforge/audio-hyperframes marker on a dev machine could
    # flip coauthor_active() True and defeat the 409-guard assertion.
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))

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


def test_sync_captions_outside_coauthor_returns_clear_409(client):
    """The guard fires before any filesystem work, with an actionable message."""
    res = client.post("/api/agent/coauthor/sync-captions", headers=_auth())
    assert res.status_code == 409
    detail = res.json()["detail"].lower()
    assert "co-author" in detail  # names the actual precondition
    assert "update_words" in detail  # points the agent at the real path


def test_sync_captions_no_result_still_404s(client, main_module):
    """The 404 (no transcript) branch is unchanged and still wins first."""
    main_module.current_result = None
    res = client.post("/api/agent/coauthor/sync-captions", headers=_auth())
    assert res.status_code == 404
