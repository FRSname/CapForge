"""Backend half of the caption gap-closing parity contract.

``_close_group_gaps`` (``backend/exporters/video_render.py``) is the mirror of
``closeGroupGaps`` (``src/renderer/src/lib/groups.ts``). The two implementations
must agree **case for case**, so this module mirrors the TypeScript suite in
``src/renderer/src/lib/groups.test.ts`` one test at a time, and finishes with a
cross-check against a literal transcription of the documented TS rules applied
to a shared hand-written fixture.

Four TS cases have no backend counterpart on purpose: the hand-placed-end
exemption is driven by a frontend-only per-group flag, and such a group reaches
the backend as ``custom_groups`` (which bypasses ``_build_groups`` entirely),
so there is nothing to exempt here.

Pure dicts — no ``TranscriptionResult``, no audio, no model, no fixtures.
"""

from __future__ import annotations

import copy
import math

import pytest

from backend.exporters.video_render import _build_groups, _close_group_gaps
from backend.models.schemas import (
    Segment,
    TranscriptionResult,
    VideoRenderConfig,
    WordSegment,
)

THRESHOLD = 0.25
HOLD = 1.0


def group(
    text: str,
    start: float,
    end: float,
    *,
    speaker: str | None = None,
    words: list[dict] | None = None,
) -> dict:
    """A group dict in the shape ``_build_groups`` emits."""
    if words is None:
        words = [{"word": text, "start": start, "end": end}]
    return {"text": text, "start": start, "end": end, "speaker": speaker, "words": words}


# --- Gap closing -------------------------------------------------------------


def test_closes_a_gap_at_or_below_the_threshold():
    # Arrange — 0.09s gap, well under the 0.25s threshold.
    groups = [group("a", 2.00, 2.31), group("b", 2.40, 3.00)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 2.40


def test_leaves_a_gap_longer_than_the_threshold_alone():
    # Arrange — 0.55s gap: a real pause, the screen should clear.
    groups = [group("a", 2.00, 2.31), group("b", 2.86, 3.40)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 2.31


def test_closes_a_gap_exactly_equal_to_the_threshold():
    # Arrange — pins the INCLUSIVE boundary (`gap <= threshold`).
    groups = [group("a", 1.00, 2.00), group("b", 2.25, 3.00)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 2.25


def test_gap_closing_is_idempotent_excluding_the_tail_hold():
    # Arrange — hold deliberately 0: the tail hold is NOT idempotent by design.
    groups = [group("a", 0.0, 1.0), group("b", 1.1, 2.0), group("c", 2.6, 3.0)]

    # Act
    once = _close_group_gaps(groups, THRESHOLD, 0.0)
    twice = _close_group_gaps(once, THRESHOLD, 0.0)

    # Assert
    assert once == twice


def test_never_bridges_a_speaker_change():
    # Arrange — a 0.02s gap, but across a diarization boundary.
    groups = [
        group("a", 0.0, 1.00, speaker="SPEAKER_00"),
        group("b", 1.02, 2.00, speaker="SPEAKER_01"),
    ]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 1.00


def test_two_missing_speakers_count_as_the_same_speaker():
    # Arrange — no diarization at all is the common case; it must still close.
    groups = [group("a", 0.0, 1.00), group("b", 1.02, 2.00)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 1.02


def test_never_changes_group_count_text_start_or_words():
    # Arrange
    groups = [
        group("a", 0.0, 1.0, words=[{"word": "a", "start": 0.0, "end": 1.0}]),
        group("b", 1.1, 2.0, words=[{"word": "b", "start": 1.1, "end": 2.0}]),
        group("c", 2.9, 3.5, words=[{"word": "c", "start": 2.9, "end": 3.5}]),
    ]
    before = copy.deepcopy(groups)

    # Act
    out = _close_group_gaps(groups, THRESHOLD, HOLD)

    # Assert
    assert len(out) == len(before)
    for produced, original in zip(out, before):
        assert produced["text"] == original["text"]
        assert produced["start"] == original["start"]
        assert produced["words"] == original["words"]
        assert produced["speaker"] == original["speaker"]
    # …and the input array is untouched.
    assert groups == before


def test_returns_an_empty_list_for_empty_input():
    assert _close_group_gaps([], THRESHOLD, HOLD) == []


# --- Guard 06: missing / non-finite word timing ------------------------------


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf, None, "1.0"])
def test_leaves_a_boundary_alone_when_the_left_word_end_is_not_finite(bad):
    # Arrange — `a`'s last word has no usable end.
    groups = [
        group("a", 0.0, 1.00, words=[{"word": "a", "start": 0.0, "end": bad}]),
        group("b", 1.02, 2.00),
    ]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 1.00


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf, None, "1.02"])
def test_leaves_a_boundary_alone_when_the_right_word_start_is_not_finite(bad):
    # Arrange — the guard is symmetric: `b`'s first word start counts too.
    groups = [
        group("a", 0.0, 1.00),
        group("b", 1.02, 2.00, words=[{"word": "b", "start": bad, "end": 2.00}]),
    ]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 1.00


@pytest.mark.parametrize("malformed", [{}, {"words": []}, {"words": None}])
def test_a_group_without_words_is_skipped_rather_than_crashing(malformed):
    # Arrange — malformed data (old project file, hand-built payload).
    a = {"text": "a", "start": 0.0, "end": 1.00, **malformed}
    groups = [a, group("b", 1.02, 2.00)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert — no exception, and the boundary is left alone.
    assert out[0]["end"] == 1.00


def test_a_malformed_successor_is_skipped_rather_than_crashing():
    # Arrange — the missing `words` is on `b` this time.
    groups = [group("a", 0.0, 1.00), {"text": "b", "start": 1.02, "end": 2.00}]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 1.00


# --- Guard 01: gap sign ------------------------------------------------------


def test_never_shortens_an_end_when_groups_overlap():
    # Arrange — negative gap: `b` starts before `a` ends.
    groups = [group("a", 0.0, 2.00), group("b", 1.80, 3.00)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 2.00


def test_leaves_an_already_closed_boundary_alone():
    # Arrange — zero gap fails `gap > 0`, which is what makes closing idempotent.
    groups = [group("a", 0.0, 2.00), group("b", 2.00, 3.00)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == 2.00


# --- Tail hold ---------------------------------------------------------------


def test_holds_the_final_group_past_its_original_end():
    # Arrange
    groups = [group("a", 0.0, 1.0), group("b", 1.1, 2.0)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, HOLD)

    # Assert
    assert out[-1]["end"] == pytest.approx(3.0)


def test_does_not_hold_the_final_group_when_the_hold_is_zero():
    # Arrange
    groups = [group("a", 0.0, 1.0), group("b", 1.1, 2.0)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[-1]["end"] == 2.0


def test_does_not_apply_the_hold_to_any_group_but_the_last():
    # Arrange — a 0.6s gap so nothing closes and only the hold can move an end.
    groups = [group("a", 0.0, 1.0), group("b", 1.6, 2.0), group("c", 2.6, 3.0)]

    # Act
    out = _close_group_gaps(groups, 0.0, HOLD)

    # Assert
    assert [g["end"] for g in out] == [1.0, 2.0, pytest.approx(4.0)]


def test_holds_a_single_group_transcript():
    # Arrange — the last group is also the first; no successor to consider.
    groups = [group("only", 0.0, 1.5)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, HOLD)

    # Assert
    assert out[0]["end"] == pytest.approx(2.5)


# --- The two dials are independent -------------------------------------------


def test_threshold_zero_disables_closing_but_still_applies_the_hold():
    # Arrange
    groups = [group("a", 0.0, 1.0), group("b", 1.1, 2.0)]

    # Act
    out = _close_group_gaps(groups, 0.0, HOLD)

    # Assert
    assert out[0]["end"] == 1.0
    assert out[1]["end"] == pytest.approx(3.0)


def test_a_negative_threshold_also_disables_closing():
    # Arrange
    groups = [group("a", 0.0, 1.0), group("b", 1.1, 2.0)]

    # Act
    out = _close_group_gaps(groups, -1.0, 0.0)

    # Assert
    assert out[0]["end"] == 1.0


def test_hold_zero_disables_the_hold_but_still_closes():
    # Arrange
    groups = [group("a", 0.0, 1.0), group("b", 1.1, 2.0)]

    # Act
    out = _close_group_gaps(groups, THRESHOLD, 0.0)

    # Assert
    assert out[0]["end"] == pytest.approx(1.1)
    assert out[1]["end"] == 2.0


# --- _build_groups wiring ----------------------------------------------------


def _two_segment_result() -> TranscriptionResult:
    """Two segments separated by a 0.1s gap, one word each side of it."""
    return TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="one two",
                words=[
                    WordSegment(word="one", start=0.0, end=0.5),
                    WordSegment(word="two", start=0.5, end=1.0),
                ],
            ),
            Segment(
                start=1.1,
                end=2.0,
                text="three",
                words=[WordSegment(word="three", start=1.1, end=2.0)],
            ),
        ],
        audio_path="/tmp/audio.wav",
        duration=5.0,
    )


def test_build_groups_defaults_leave_timings_untouched():
    # Arrange — the load-bearing 0.0 defaults keep every existing caller identical.
    result = _two_segment_result()

    # Act
    groups = _build_groups(result, 2)

    # Assert
    assert [g["end"] for g in groups] == [1.0, 2.0]


def test_build_groups_applies_the_pass_when_the_dials_are_passed():
    # Arrange
    result = _two_segment_result()

    # Act
    groups = _build_groups(result, 2, THRESHOLD, HOLD)

    # Assert
    assert groups[0]["end"] == pytest.approx(1.1)
    assert groups[-1]["end"] == pytest.approx(3.0)


def test_build_groups_emits_the_speaker_so_the_guard_is_expressible():
    # Arrange — Guard 02 compares the group's speaker, which must be carried over.
    result = _two_segment_result()
    result.segments[1].speaker = "SPEAKER_01"

    # Act
    groups = _build_groups(result, 2, THRESHOLD, 0.0)

    # Assert
    assert [g["speaker"] for g in groups] == [None, "SPEAKER_01"]
    assert groups[0]["end"] == 1.0  # not bridged across the speaker change


def test_build_groups_carries_the_speaker_on_the_no_words_fallback():
    # Arrange — segment with no word-level timing takes the fallback branch.
    result = TranscriptionResult(
        segments=[Segment(start=0.0, end=1.0, text="no words", speaker="SPEAKER_00")],
        audio_path="/tmp/audio.wav",
    )

    # Act
    groups = _build_groups(result, 3)

    # Assert
    assert groups[0]["speaker"] == "SPEAKER_00"


def test_the_config_defaults_close_gaps_and_hold_the_tail():
    # Arrange — the shipped VideoRenderConfig defaults (0.25 / 1.0).
    config = VideoRenderConfig()
    result = _two_segment_result()

    # Act
    groups = _build_groups(
        result, config.words_per_group, config.gap_close_threshold, config.last_group_hold
    )

    # Assert
    assert groups[0]["end"] == pytest.approx(1.1)
    assert groups[-1]["end"] == pytest.approx(3.0)


# --- Cross-check against the documented TypeScript rules ---------------------


def _ts_reference(groups: list[dict], threshold: float, last_group_hold: float) -> list[dict]:
    """A literal transcription of `closeGroupGaps` (`lib/groups.ts`), written
    from the TS source rather than from the Python implementation, so the two
    can be diffed. The hand-placed-end exemption is omitted: backend group dicts
    never carry that frontend-only flag (such groups arrive as `custom_groups`)."""

    def is_finite(value):  # Number.isFinite: no coercion, bool is not a number
        return (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
        )

    def closed_end(a, b):
        if b is None:
            return a["end"]
        a_words = a.get("words") or []
        b_words = b.get("words") or []
        a_last_end = a_words[-1].get("end") if a_words else None
        b_first_start = b_words[0].get("start") if b_words else None
        if not is_finite(a_last_end) or not is_finite(b_first_start):
            return a["end"]
        if a.get("speaker") != b.get("speaker"):
            return a["end"]
        gap = b["start"] - a["end"]
        return b["start"] if gap > 0 and gap <= threshold else a["end"]

    if not groups:
        return []
    last_index = len(groups) - 1
    out = []
    for i, g in enumerate(groups):
        end = closed_end(g, groups[i + 1] if i + 1 <= last_index else None)
        if i == last_index and last_group_hold > 0:
            end = max(end, g["end"] + last_group_hold)
        out.append({**g, "end": end})
    return out


# Every branch of the algorithm in one array: a closable gap, an exactly-on-the-
# threshold gap, an over-threshold pause, a speaker change, an overlap, both
# sides of the non-finite-timing guard, an already-closed boundary, and a tail
# to hold.
SHARED_FIXTURE = [
    # 0 → 0.05s gap into #1: closes at any threshold >= 0.05.
    group("closable", 0.00, 1.00, speaker="SPEAKER_00"),
    # 1 → 0.25s gap into #2: exactly the default threshold (inclusive).
    group("boundary", 1.05, 2.00, speaker="SPEAKER_00"),
    # 2 → 0.60s gap into #3: a real pause at 0.25, closable at 0.60.
    group("pause", 2.25, 3.00, speaker="SPEAKER_00"),
    # 3 → 0.02s gap into #4, but across a speaker change: never bridged.
    group("pre-change", 3.60, 4.00, speaker="SPEAKER_00"),
    # 4 → overlaps #5 by 0.20s: a negative gap must never shorten an end.
    group("post-change", 4.02, 5.20, speaker="SPEAKER_01"),
    # 5 → #6's first word start is not finite: right-hand guard 06.
    group("overlapping", 5.00, 6.00, speaker="SPEAKER_01"),
    # 6 → its own last word end is not finite: left-hand guard 06.
    group(
        "no-timing",
        6.10,
        6.50,
        speaker="SPEAKER_01",
        words=[{"word": "no-timing", "start": None, "end": None}],
    ),
    # 7 → 0.0s gap into #8: already closed, fails `gap > 0`.
    group("already-closed", 6.60, 7.00, speaker="SPEAKER_01"),
    # 8 → the last group: only the tail hold can move it.
    group("tail", 7.00, 8.00, speaker="SPEAKER_01"),
]


@pytest.mark.parametrize(
    "threshold,hold",
    [(0.25, 1.0), (0.25, 0.0), (0.0, 1.0), (0.0, 0.0), (0.6, 2.5)],
)
def test_matches_the_documented_typescript_rules_for_a_shared_fixture(threshold, hold):
    # Arrange / Act
    produced = _close_group_gaps(SHARED_FIXTURE, threshold, hold)
    expected = _ts_reference(SHARED_FIXTURE, threshold, hold)

    # Assert — same ends, group for group.
    assert [g["end"] for g in produced] == [g["end"] for g in expected]


def test_the_shared_fixture_exercises_every_branch():
    # Arrange / Act — the ends the documented rules produce at the shipped defaults.
    out = _close_group_gaps(SHARED_FIXTURE, THRESHOLD, HOLD)

    # Assert — spelled out so a rule change shows up as a readable diff.
    assert [g["end"] for g in out] == [
        pytest.approx(1.05),  # closable      — gap 0.05 <= 0.25
        pytest.approx(2.25),  # boundary      — gap 0.25 == threshold (inclusive)
        pytest.approx(3.00),  # pause         — gap 0.60 > threshold
        pytest.approx(4.00),  # pre-change    — speaker change never bridged
        pytest.approx(5.20),  # post-change   — gap -0.20, never shortened
        pytest.approx(6.00),  # overlapping   — successor's word start is None
        pytest.approx(6.50),  # no-timing     — own last word end is None
        pytest.approx(7.00),  # already-closed — gap 0.0 fails `gap > 0`
        pytest.approx(9.00),  # tail          — 8.00 + 1.00 hold
    ]


def test_the_shared_fixture_closes_the_real_pause_at_a_wider_threshold():
    # Arrange / Act — proves #2's boundary is threshold-gated, not guard-blocked.
    # 0.65, not 0.6: `3.60 - 3.00` is 0.6000000000000001 in IEEE754, so an exact
    # 0.6 threshold does NOT close it. JS floats do the same thing, so the two
    # implementations still agree — this is a fixture quirk, not a rule.
    out = _close_group_gaps(SHARED_FIXTURE, 0.65, 0.0)

    # Assert
    assert out[2]["end"] == pytest.approx(3.60)
    assert out[3]["end"] == pytest.approx(4.00)  # still never bridges the speaker
