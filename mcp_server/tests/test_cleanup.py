"""Unit tests for the pure transcript transforms."""

from __future__ import annotations

import copy

import pytest

from mcp_server.cleanup import DEFAULT_FILLERS, apply_word_edits, remove_fillers


def _result() -> dict:
    return {
        "language": "en",
        "audio_path": "/clip.mp4",
        "duration": 3.0,
        "segments": [
            {
                "start": 0.0, "end": 1.5, "text": "um hello their", "speaker": None,
                "words": [
                    {"word": "um", "start": 0.0, "end": 0.3, "score": 0.9, "speaker": None},
                    {"word": "hello", "start": 0.4, "end": 0.9, "score": 0.9, "speaker": None},
                    {"word": "their", "start": 1.0, "end": 1.5, "score": 0.9, "speaker": None},
                ],
            },
            {
                "start": 2.0, "end": 2.4, "text": "uh", "speaker": None,
                "words": [
                    {"word": "uh", "start": 2.0, "end": 2.4, "score": 0.9, "speaker": None},
                ],
            },
        ],
    }


# --- remove_fillers -------------------------------------------------------

def test_remove_fillers_drops_filler_words_and_rebuilds_text() -> None:
    out, removed = remove_fillers(_result())
    assert removed == 2  # "um" and the all-filler "uh" segment
    assert out["segments"][0]["text"] == "hello their"
    assert [w["word"] for w in out["segments"][0]["words"]] == ["hello", "their"]


def test_remove_fillers_drops_segment_that_was_only_filler() -> None:
    out, _ = remove_fillers(_result())
    assert len(out["segments"]) == 1  # second segment was just "uh"


def test_remove_fillers_preserves_surviving_timestamps() -> None:
    out, _ = remove_fillers(_result())
    seg = out["segments"][0]
    # "hello" kept its original timing — no resync/shift.
    assert seg["words"][0]["start"] == 0.4
    # Segment start recomputed from first surviving word.
    assert seg["start"] == 0.4


def test_remove_fillers_is_pure() -> None:
    original = _result()
    snapshot = copy.deepcopy(original)
    remove_fillers(original)
    assert original == snapshot  # input untouched


def test_remove_fillers_matches_punctuation_and_case() -> None:
    r = _result()
    r["segments"][0]["words"][0]["word"] = "Um,"
    out, removed = remove_fillers(r)
    assert removed == 2
    assert out["segments"][0]["text"] == "hello their"


def test_extra_fillers_extend_defaults() -> None:
    r = {
        "segments": [{
            "start": 0.0, "end": 1.0, "text": "like really um cool",
            "words": [
                {"word": "like", "start": 0.0, "end": 0.2},
                {"word": "really", "start": 0.2, "end": 0.5},
                {"word": "um", "start": 0.5, "end": 0.6},
                {"word": "cool", "start": 0.6, "end": 1.0},
            ],
        }],
    }
    out, removed = remove_fillers(r, list(DEFAULT_FILLERS) + ["like"])
    assert removed == 2
    assert out["segments"][0]["text"] == "really cool"


# --- apply_word_edits -----------------------------------------------------

def test_apply_word_edits_replaces_token_and_rebuilds_text() -> None:
    out, count = apply_word_edits(_result(), [{"segment": 0, "word": 2, "new": "there"}])
    assert count == 1
    assert out["segments"][0]["words"][2]["word"] == "there"
    assert out["segments"][0]["text"] == "um hello there"


def test_apply_word_edits_preserves_word_timing() -> None:
    out, _ = apply_word_edits(_result(), [{"segment": 0, "word": 1, "new": "Hello"}])
    w = out["segments"][0]["words"][1]
    assert (w["start"], w["end"]) == (0.4, 0.9)


def test_apply_word_edits_is_pure() -> None:
    original = _result()
    snapshot = copy.deepcopy(original)
    apply_word_edits(original, [{"segment": 0, "word": 0, "new": "x"}])
    assert original == snapshot


def test_apply_word_edits_raises_on_bad_index() -> None:
    with pytest.raises(IndexError):
        apply_word_edits(_result(), [{"segment": 0, "word": 99, "new": "x"}])
