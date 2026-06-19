"""Tests for the HyperFrames transcript exporter."""

import json

from backend.exporters.hyperframes_export import export_hyperframes
from backend.models.schemas import Segment, TranscriptionResult, WordSegment


def test_emits_flat_word_array_with_only_text_start_end(transcription_result):
    words = json.loads(export_hyperframes(transcription_result))
    # 3 words in segment 1 + 3 words in segment 2.
    assert len(words) == 6
    assert all(set(w.keys()) == {"text", "start", "end"} for w in words)
    assert [w["text"] for w in words] == ["Hello", "brave", "world", "Crossing", "the", "hour"]


def test_uses_text_key_not_word(transcription_result):
    # HyperFrames' field is `text`; CapForge's source field is `word`.
    words = json.loads(export_hyperframes(transcription_result))
    assert "word" not in words[0]
    assert words[0]["text"] == "Hello"


def test_timestamps_are_per_word_floats(transcription_result):
    words = json.loads(export_hyperframes(transcription_result))
    assert words[0]["start"] == 0.0 and words[0]["end"] == 0.75
    assert words[-1]["start"] == 3722.0 and words[-1]["end"] == 3723.5
    assert all(isinstance(w["start"], float) and isinstance(w["end"], float) for w in words)


def test_text_is_stripped(transcription_result):
    words = json.loads(export_hyperframes(transcription_result))
    assert all(w["text"] == w["text"].strip() for w in words)


def test_filters_empty_and_whitespace_words():
    result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=2.0,
                text="hi there",
                words=[
                    WordSegment(word="hi", start=0.0, end=0.5),
                    WordSegment(word="   ", start=0.5, end=0.6),  # whitespace-only → dropped
                    WordSegment(word="", start=0.6, end=0.7),  # empty → dropped
                    WordSegment(word="there", start=0.7, end=1.2),
                ],
            ),
        ],
    )
    words = json.loads(export_hyperframes(result))
    assert [w["text"] for w in words] == ["hi", "there"]


def test_empty_result_produces_empty_array(empty_result):
    assert json.loads(export_hyperframes(empty_result)) == []
