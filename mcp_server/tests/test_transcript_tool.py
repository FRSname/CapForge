"""`get_transcript` shape tests — no CapForge running, stubbed `_client`.

The segments-only form is what an agent reads for a review pass and, from v3,
for chapter/description work: it must carry the video `duration` the backend
route already returns, or the agent has to spend a full words-included read
just to learn how long the video is.
"""

from __future__ import annotations

from typing import Any, Optional

import pytest

from mcp_server import server

RESULT = {
    "language": "en",
    "duration": 92.5,
    "audio_path": "/tmp/a.wav",
    "segments": [
        {
            "start": 0.0, "end": 1.2, "text": "Hello world", "speaker": "SPEAKER_00",
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.6},
                {"word": "world", "start": 0.6, "end": 1.2},
            ],
        },
    ],
}


class StubClient:
    """Only the slice of CapForgeClient `get_transcript` touches."""

    def __init__(self, result: Optional[dict] = None) -> None:
        self.result = result if result is not None else RESULT
        self.calls: list[bool] = []

    def get_result(self, words: bool = True) -> Any:
        self.calls.append(words)
        if words:
            return self.result
        stripped = {k: v for k, v in self.result.items() if k != "segments"}
        stripped["segments"] = [
            {k: v for k, v in seg.items() if k != "words"}
            for seg in self.result["segments"]
        ]
        return stripped


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubClient:
    client = StubClient()
    monkeypatch.setattr(server, "_client", client)
    return client


def test_segments_only_carries_the_duration(stub: StubClient) -> None:
    out = server.get_transcript(segments_only=True)
    assert out["duration"] == 92.5
    assert stub.calls == [False]  # the cheap, words-stripped route


def test_segments_only_keeps_its_words_free_shape(stub: StubClient) -> None:
    out = server.get_transcript(segments_only=True)
    assert set(out) == {"language", "duration", "segments"}
    assert out["segments"] == [
        {"index": 0, "start": 0.0, "end": 1.2, "text": "Hello world",
         "speaker": "SPEAKER_00"},
    ]


def test_duration_is_none_when_the_backend_omits_it(monkeypatch: pytest.MonkeyPatch) -> None:
    result = {k: v for k, v in RESULT.items() if k != "duration"}
    monkeypatch.setattr(server, "_client", StubClient(result))
    assert server.get_transcript(segments_only=True)["duration"] is None
