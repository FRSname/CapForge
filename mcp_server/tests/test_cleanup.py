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


# --- apply_word_edits: empty-token + delete/merge (Phase 1) ---------------

def test_replacing_token_with_empty_string_yields_no_double_space() -> None:
    # Legacy shape: a "replace with ''" edit must not leave a double space.
    out, _ = apply_word_edits(_result(), [{"segment": 0, "word": 0, "new": ""}])
    text = out["segments"][0]["text"]
    assert "  " not in text
    assert text == "hello their"


def test_delete_op_removes_token_and_rebuilds_text() -> None:
    out, count = apply_word_edits(
        _result(), [{"segment": 0, "word": 0, "op": "delete"}]
    )
    assert count == 1
    seg = out["segments"][0]
    assert [w["word"] for w in seg["words"]] == ["hello", "their"]
    assert seg["text"] == "hello their"


def test_delete_edge_word_recomputes_bounds_from_kept_set() -> None:
    # Delete the LAST word ("their"). It gets absorbed into the previous survivor
    # ("hello"), whose end grows to cover the deleted end. The segment end therefore
    # reflects the kept set: max(kept ends) == the absorbed 1.5, and the survivor
    # count drops from 3 to 2.
    out, _ = apply_word_edits(
        _result(), [{"segment": 0, "word": 2, "op": "delete"}]
    )
    seg = out["segments"][0]
    assert [w["word"] for w in seg["words"]] == ["um", "hello"]
    # "hello" (0.4–0.9) absorbed "their"'s end (1.5) so no caption gap opens.
    assert seg["words"][-1]["end"] == 1.5
    assert seg["end"] == 1.5

    # Delete the FIRST word instead → the next survivor's start is pulled back and
    # the segment start shrinks to that survivor's (now-earlier) start.
    out2, _ = apply_word_edits(
        _result(), [{"segment": 0, "word": 0, "op": "delete"}]
    )
    seg2 = out2["segments"][0]
    assert [w["word"] for w in seg2["words"]] == ["hello", "their"]
    # "hello" started at 0.4; "um" started at 0.0 → pulled back to 0.0.
    assert seg2["words"][0]["start"] == 0.0
    assert seg2["start"] == 0.0


def test_delete_only_word_drops_segment() -> None:
    out, _ = apply_word_edits(
        _result(), [{"segment": 1, "word": 0, "op": "delete"}]
    )
    # Segment 1 held only "uh" → deleting it drops the whole segment.
    assert len(out["segments"]) == 1
    assert out["segments"][0]["text"] == "um hello their"


def _merge_result(words: list[str]) -> dict:
    ws = []
    for i, word in enumerate(words):
        ws.append({"word": word, "start": float(i), "end": float(i) + 0.5,
                   "score": 0.9, "speaker": None})
    return {
        "language": "en", "audio_path": "/clip.mp4", "duration": float(len(words)),
        "segments": [{
            "start": ws[0]["start"], "end": ws[-1]["end"],
            "text": " ".join(words), "speaker": None, "words": ws,
        }],
    }


def test_merge_two_adjacent_tokens_into_one() -> None:
    # "chat GPT" -> replace survivor with "ChatGPT" + delete neighbor, one call.
    r = _merge_result(["chat", "GPT"])
    out, count = apply_word_edits(r, [
        {"segment": 0, "word": 0, "new": "ChatGPT"},
        {"segment": 0, "word": 1, "op": "delete"},
    ])
    assert count == 2
    seg = out["segments"][0]
    assert [w["word"] for w in seg["words"]] == ["ChatGPT"]
    assert seg["text"] == "ChatGPT"
    # Survivor spans [first.start, second.end] = [0.0, 1.5].
    survivor = seg["words"][0]
    assert (survivor["start"], survivor["end"]) == (0.0, 1.5)
    assert (seg["start"], seg["end"]) == (0.0, 1.5)


def test_replay_cowork_chatgpt_merge_is_single_spaced() -> None:
    r = _merge_result(["said", "to", "chat", "GPT", "hey"])
    out, _ = apply_word_edits(r, [
        {"segment": 0, "word": 2, "new": "ChatGPT"},
        {"segment": 0, "word": 3, "op": "delete"},
    ])
    text = out["segments"][0]["text"]
    assert text == "said to ChatGPT hey"
    assert "  " not in text
    assert not text.endswith(" ")


def test_replay_cowork_bluesky_merge_is_single_spaced() -> None:
    r = _merge_result(["trying", "with", "the", "blue", "sky"])
    # Merge "blue sky" -> "Bluesky" and delete "the" too (three-word → one).
    out, _ = apply_word_edits(r, [
        {"segment": 0, "word": 3, "new": "Bluesky"},
        {"segment": 0, "word": 4, "op": "delete"},
        {"segment": 0, "word": 2, "op": "delete"},
    ])
    text = out["segments"][0]["text"]
    assert text == "trying with Bluesky"
    assert "  " not in text
    seg = out["segments"][0]
    assert [w["word"] for w in seg["words"]] == ["trying", "with", "Bluesky"]


def test_delete_op_raises_on_bad_index() -> None:
    with pytest.raises(IndexError):
        apply_word_edits(_result(), [{"segment": 0, "word": 99, "op": "delete"}])


def test_delete_merge_is_pure() -> None:
    original = _result()
    snapshot = copy.deepcopy(original)
    apply_word_edits(original, [
        {"segment": 0, "word": 1, "new": "HELLO"},
        {"segment": 0, "word": 2, "op": "delete"},
    ])
    assert original == snapshot  # input dict untouched after a delete/merge


def test_consecutive_deletions_accumulate_into_survivor() -> None:
    # Delete a run of two middle words; both spans absorbed into the previous survivor.
    r = _merge_result(["a", "b", "c", "d"])  # ends: 0.5,1.5,2.5,3.5
    out, _ = apply_word_edits(r, [
        {"segment": 0, "word": 1, "op": "delete"},
        {"segment": 0, "word": 2, "op": "delete"},
    ])
    seg = out["segments"][0]
    assert [w["word"] for w in seg["words"]] == ["a", "d"]
    # "a" (0.0–0.5) absorbs "b"(→1.5) then "c"(→2.5) → end 2.5.
    assert seg["words"][0]["end"] == 2.5
    # "d" start untouched (2.0), no resync of survivor starts.
    assert seg["words"][1]["start"] == 3.0
