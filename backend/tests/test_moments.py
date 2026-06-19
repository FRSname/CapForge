"""Tests for transcript moment-finding (backs the agent's find_moments tool)."""

from backend.engine.moments import find_transcript_moments


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
