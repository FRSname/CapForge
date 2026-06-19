"""Tests for transcript moment-finding (backs the agent's find_moments tool)."""

import pytest

from backend.engine.moments import find_semantic_moments, find_transcript_moments
from backend.models.schemas import Segment, TranscriptionResult, WordSegment


def test_single_word_match(transcription_result):
    matches = find_transcript_moments(transcription_result, "world")
    assert len(matches) == 1
    assert matches[0]["text"] == "world"
    assert matches[0]["start"] == 1.5 and matches[0]["end"] == 2.5


def test_match_is_case_and_punctuation_insensitive(transcription_result):
    # Fixture has "Hello"; query upper-cased with punctuation still matches.
    matches = find_transcript_moments(transcription_result, "HELLO!")
    assert len(matches) == 1
    assert matches[0]["text"] == "Hello"


def test_multi_word_contiguous_run(transcription_result):
    matches = find_transcript_moments(transcription_result, "brave world")
    assert len(matches) == 1
    assert matches[0]["start"] == 0.75 and matches[0]["end"] == 2.5
    assert matches[0]["text"] == "brave world"


def test_no_match_returns_empty(transcription_result):
    assert find_transcript_moments(transcription_result, "nonexistent") == []


def test_empty_query_returns_empty(transcription_result):
    assert find_transcript_moments(transcription_result, "   ") == []


def test_word_id_provenance(transcription_result):
    # "Crossing" is the first word of the second segment → "1-0".
    matches = find_transcript_moments(transcription_result, "Crossing")
    assert matches[0]["word_id"] == "1-0"


# --- Semantic detection (Phase D) ---


def _result(words) -> TranscriptionResult:
    """Build a one-segment result from (text, start, end[, speaker]) tuples."""
    ws = [
        WordSegment(word=w[0], start=w[1], end=w[2], speaker=(w[3] if len(w) > 3 else None))
        for w in words
    ]
    seg = Segment(
        start=ws[0].start, end=ws[-1].end,
        text=" ".join(w.word for w in ws), words=ws,
    )
    return TranscriptionResult(
        segments=[seg], language="en", audio_path="/tmp/a.wav", duration=ws[-1].end,
    )


def test_numbers_merges_contiguous_and_detects_digits():
    r = _result([
        ("We", 0.0, 0.3), ("grew", 0.3, 0.6),
        ("twenty", 0.6, 0.9), ("five", 0.9, 1.2), ("percent", 1.2, 1.6),
        ("to", 1.6, 1.8), ("2.4M", 1.8, 2.2), ("users", 2.2, 2.6),
    ])
    moments = find_semantic_moments(r, "numbers")
    texts = [m["text"] for m in moments]
    assert "twenty five percent" in texts and "2.4M" in texts
    run = next(m for m in moments if m["text"] == "twenty five percent")
    assert run["start"] == 0.6 and run["end"] == 1.6


def test_cta_phrase_beats_single_word():
    r = _result([
        ("please", 0.0, 0.3), ("subscribe", 0.3, 0.7),
        ("and", 0.7, 0.9), ("comment", 0.9, 1.2), ("below", 1.2, 1.5),
    ])
    texts = [m["text"] for m in find_semantic_moments(r, "cta")]
    assert "subscribe" in texts and "comment below" in texts
    assert "comment" not in texts  # claimed by the phrase, not double-counted


def test_speaker_change_emits_first_word_of_each_run():
    r = _result([
        ("a", 0.0, 0.2, "S0"), ("b", 0.2, 0.4, "S0"),
        ("c", 0.4, 0.6, "S1"), ("d", 0.6, 0.8, "S1"),
        ("e", 0.8, 1.0, "S0"),
    ])
    moments = find_semantic_moments(r, "speaker_change")
    assert [m["start"] for m in moments] == [0.0, 0.4, 0.8]
    assert [m["speaker"] for m in moments] == ["S0", "S1", "S0"]


def test_speaker_change_empty_without_diarization():
    r = _result([("a", 0.0, 0.2), ("b", 0.2, 0.4)])
    assert find_semantic_moments(r, "speaker_change") == []


def test_unknown_semantic_kind_raises():
    with pytest.raises(ValueError):
        find_semantic_moments(_result([("a", 0.0, 0.2)]), "explosions")
