"""Shared fixtures for backend exporter tests.

Tests import `backend.*`, so pytest must run from the repo root —
`pythonpath = ["."]` in pyproject.toml takes care of that.
"""

import pytest

from backend.models.schemas import Segment, TranscriptionResult, WordSegment


@pytest.fixture
def transcription_result() -> TranscriptionResult:
    """Small two-segment transcript with word-level timestamps."""
    return TranscriptionResult(
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
                end=3723.5,
                text="  Crossing the hour  ",
                words=[
                    WordSegment(word="Crossing", start=61.25, end=62.0),
                    WordSegment(word="the", start=62.0, end=62.5),
                    WordSegment(word="hour", start=3722.0, end=3723.5),
                ],
                speaker="SPEAKER_00",
            ),
        ],
        language="en",
        audio_path="/tmp/audio.wav",
        duration=3724.0,
    )


@pytest.fixture
def empty_result() -> TranscriptionResult:
    return TranscriptionResult()
