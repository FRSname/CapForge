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


def _timed_words(text: str, start: float) -> list[WordSegment]:
    """Words spoken at a steady pace: 0.25 s each with a 0.07 s pause between,
    so karaoke has real inter-word gaps to fold."""
    return [
        WordSegment(word=token, start=round(start + i * 0.32, 3), end=round(start + i * 0.32 + 0.25, 3))
        for i, token in enumerate(text.split())
    ]


@pytest.fixture
def multi_sentence_result() -> TranscriptionResult:
    """Two WhisperX segments carrying four sentences between them.

    A segment is a VAD chunk, not a sentence: the first holds two sentences, one
    of them long enough to wrap and split; the second opens with a one-word
    sentence short enough to trigger the minimum-duration extension.
    """
    first = (
        "Welcome back to the channel. Today we are going to look at how "
        "subtitles get split into readable cues, and why a single segment "
        "is never the right unit for a caption."
    )
    second = "Okay. It matters more than you would think, especially on a phone."
    first_words = _timed_words(first, 0.5)
    second_words = _timed_words(second, 14.0)
    return TranscriptionResult(
        segments=[
            Segment(
                start=first_words[0].start,
                end=first_words[-1].end,
                text=first,
                words=first_words,
                speaker="SPEAKER_00",
            ),
            Segment(
                start=second_words[0].start,
                end=second_words[-1].end,
                text=second,
                words=second_words,
                speaker="SPEAKER_01",
            ),
        ],
        language="en",
        audio_path="/tmp/audio.wav",
        duration=20.0,
    )
