"""A malformed mirrored render config must 409 with the field named, never 500.

Regression test for a live batch run that stalled on this: an agent got a bare
HTTP 500 from ``/api/render-frame`` and a 422 from ``/api/render-video`` for
every style it tried, and concluded the backend was "stuck in a post-export
state". Both were the same defect — a project restored without merging
STUDIO_DEFAULTS, where ``undefined / 100`` is NaN, which JSON-serializes to
``null``, which a non-Optional float rejects.

``_agent_frame_inputs()`` re-validates the mirrored config with
``VideoRenderConfig(**render["config"])``. Unguarded, the ValidationError
escaped as a 500 — a server-fault status for what is really bad client state,
which is what sent the debugging the wrong way. The guard turns it into a 409
that names the offending field.
"""

from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient

from backend.models.schemas import Segment, TranscriptionResult, WordSegment

AGENT_HEADER = "X-CapForge-Agent-Token"
AGENT_TOKEN = "test-agent-token-frame-guard"


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
def client(main_module, monkeypatch):
    """TestClient with a seeded result; current_result/ui_state are restored."""
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)

    prev_result = m.current_result
    prev_state = m.current_ui_state
    m.current_result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="Hello world",
                words=[
                    WordSegment(word="Hello", start=0.0, end=0.5),
                    WordSegment(word="world", start=0.5, end=1.0),
                ],
            )
        ],
        language="en",
        duration=1.0,
        audio_path="/tmp/nonexistent.mp4",
    )

    yield TestClient(m.app)

    m.current_result = prev_result
    m.current_ui_state = prev_state


def _mirror(main_module, config: dict) -> None:
    main_module.current_ui_state = {"render": {"config": config, "custom_groups": None}}


def _post_frame(client):
    return client.post(
        "/api/render-frame", json={"t": 0.0, "composite": False},
        headers={AGENT_HEADER: AGENT_TOKEN},
    )


def test_nan_null_numeric_field_returns_409_naming_the_field(client, main_module):
    """The exact live failure: `null` where a float is required."""
    # position_y is one of the five `/ 100` arithmetic sites in render.ts — the
    # ones that turn a missing field into NaN -> null rather than an omission.
    _mirror(main_module, {"position_y": None})

    res = _post_frame(client)

    assert res.status_code == 409, f"expected 409, got {res.status_code}"
    detail = res.json()["detail"]
    assert "position_y" in detail["hint"], detail
    assert "older CapForge build" in detail["hint"]


def test_guard_does_not_swallow_the_missing_mirror_case(client, main_module):
    """A config that was never mirrored keeps its own distinct 409 message."""
    main_module.current_ui_state = {}

    res = _post_frame(client)

    assert res.status_code == 409
    assert "No render config mirrored yet" in res.json()["detail"]


def test_absent_field_is_still_accepted(client, main_module):
    """A plainly missing field is harmless — the Pydantic default applies.

    This is the load-bearing distinction: only the arithmetic sites are fatal.
    If this ever starts failing, the guard has become over-strict and would
    reject configs that render fine.
    """
    _mirror(main_module, {})

    res = _post_frame(client)

    assert res.status_code != 409, "an empty config should validate on defaults"
