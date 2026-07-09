"""Phase 2 — ``GET /api/agent/result`` segments-only mode.

An agent doing a review/grammar pass over a long transcript does not need the
per-word timing array; returning it blows the LLM token budget. The endpoint
grows an ``include_words`` query param: default (true) is byte-compatible with
the historical full payload; ``include_words=false`` strips each segment's
``words`` key while keeping ``text``/``start``/``end``/``speaker`` and segment
order. See docs/plans/mcp-transcript-editing-ux.md Phase 2.
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
def client(main_module, monkeypatch):
    """TestClient with a known agent token and a seeded two-segment result.

    current_result is restored after the test."""
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)

    prev_result = m.current_result
    m.current_result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=2.5,
                text="Hello brave world",
                words=[
                    WordSegment(word="Hello", start=0.0, end=0.75),
                    WordSegment(word="brave", start=0.75, end=1.5),
                    WordSegment(word="world", start=1.5, end=2.5),
                ],
            ),
            Segment(
                start=61.25,
                end=63.0,
                text="Crossing the hour",
                words=[
                    WordSegment(word="Crossing", start=61.25, end=62.0),
                    WordSegment(word="the", start=62.0, end=62.5),
                    WordSegment(word="hour", start=62.5, end=63.0),
                ],
                speaker="SPEAKER_00",
            ),
        ],
        language="en",
        audio_path="/tmp/audio.wav",
    )
    try:
        yield TestClient(m.app)
    finally:
        m.current_result = prev_result


def _auth():
    return {AGENT_HEADER: AGENT_TOKEN}


def test_default_includes_words_per_segment(client):
    """Default read is byte-compatible with today — every segment keeps words."""
    res = client.get("/api/agent/result", headers=_auth())
    assert res.status_code == 200
    body = res.json()
    assert body["language"] == "en"
    assert len(body["segments"]) == 2
    for seg in body["segments"]:
        assert "words" in seg
    assert [w["word"] for w in body["segments"][0]["words"]] == [
        "Hello",
        "brave",
        "world",
    ]


def test_include_words_false_strips_words(client):
    """Segments-only mode drops words but keeps every other field + order."""
    res = client.get(
        "/api/agent/result",
        params={"include_words": "false"},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    # language survives at the top level.
    assert body["language"] == "en"
    segs = body["segments"]
    assert len(segs) == 2  # segment count unchanged
    for seg in segs:
        assert "words" not in seg
        # text / start / end retained so the agent can locate a fix.
        assert set(("text", "start", "end", "speaker")) <= set(seg)
    # Segment order + content preserved.
    assert segs[0]["text"] == "Hello brave world"
    assert segs[0]["start"] == 0.0
    assert segs[1]["text"] == "Crossing the hour"
    assert segs[1]["speaker"] == "SPEAKER_00"


def test_include_words_false_is_smaller(client):
    """Sanity check that stripping words actually shrinks the payload."""
    full = client.get("/api/agent/result", headers=_auth())
    compact = client.get(
        "/api/agent/result",
        params={"include_words": "false"},
        headers=_auth(),
    )
    assert len(compact.content) < len(full.content)


def test_include_words_false_does_not_mutate_current_result(client, main_module):
    """model_dump() must copy — pop() must never reach the live Pydantic model.

    Guards the anti-pattern gate's top concern: a future switch from
    ``model_dump()`` to direct attribute access would silently strip the shared
    global's words for every subsequent reader.
    """
    words_before = len(main_module.current_result.segments[0].words)
    res = client.get(
        "/api/agent/result",
        params={"include_words": "false"},
        headers=_auth(),
    )
    assert res.status_code == 200
    assert len(main_module.current_result.segments[0].words) == words_before


def test_missing_result_still_404s(client, main_module):
    """The no-result branch is unchanged in both modes."""
    main_module.current_result = None
    assert client.get("/api/agent/result", headers=_auth()).status_code == 404
    assert (
        client.get(
            "/api/agent/result",
            params={"include_words": "false"},
            headers=_auth(),
        ).status_code
        == 404
    )
