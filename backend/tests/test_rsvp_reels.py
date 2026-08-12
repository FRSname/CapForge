"""Backend half of the RSVP reel contract.

``backend/exporters/rsvp_reels.py`` is one of **two** implementations of the same
break rule; the twin is ``src/renderer/src/lib/rsvpReels.ts`` (the Canvas
preview). Both suites read the **same** fixture,
``backend/tests/fixtures/rsvp_reel_cases.json``, so a rule that changes in one
language and not the other fails loudly on the side that did not change. Never
hand-write an expected range here — add a case to the fixture.

The fixture pins the break rule alone (as index ranges over a normalised group
view); the *merge* output shape is each language's own, so it is asserted here in
Python terms and in TS terms there.

Pure dicts — no PIL, no config, no audio.
"""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any

import pytest

from backend.exporters.rsvp_reels import breaks_reel, merge_reels, reel_ranges

FIXTURES = Path(__file__).parent / "fixtures"
REEL_CASES: list[dict] = json.loads(
    (FIXTURES / "rsvp_reel_cases.json").read_text(encoding="utf-8")
)["cases"]

#: A fixture that shrinks below this was gutted, not simplified. Mirrored by
#: ``MIN_REEL_CASES`` in ``src/renderer/src/lib/rsvpFixtures.testutil.ts``.
MIN_REEL_CASES = 18


def _time(value: Any) -> float:
    """JSON has no ``NaN`` literal, so the fixtures spell it as the string
    ``"NaN"`` — the same sentinel ``rsvp_last_started_cases.json`` uses (Python's
    ``json`` would accept a bare ``NaN`` token, ``JSON.parse`` would not, and a
    fixture both languages cannot read is not a shared fixture)."""
    return math.nan if value == "NaN" else float(value)


def _group(row: dict, *, words: list[dict] | None = None) -> dict:
    """One normalised fixture row as the group dict this side consumes."""
    group: dict = {
        "text": "x",
        "start": _time(row["start"]),
        "end": _time(row["end"]),
        "speaker": row["speaker"],
        "words": [] if words is None else words,
    }
    # Sparse exactly like a real ``CustomGroup`` dump: an unset override is an
    # absent key on one path and an explicit ``None`` on the other, and the rule
    # must read both the same way — so only set the key when the fixture does.
    for key, value in (("position_x", row["posX"]), ("position_y", row["posY"])):
        if value is not None:
            group[key] = value
    return group


def _groups(case: dict) -> list[dict]:
    return [_group(row) for row in case["groups"]]


def _ids(cases: list[dict]) -> list[str]:
    return [c["name"] for c in cases]


# --- The shared fixture ------------------------------------------------------


def test_the_fixture_is_not_gutted():
    assert len(REEL_CASES) >= MIN_REEL_CASES


def test_the_fixture_still_covers_every_break_reason():
    """Otherwise a rule could be deleted and every case would still pass."""
    reasons = {"gap": False, "position": False, "non_finite": False, "join": False}
    for case in REEL_CASES:
        rows = case["groups"]
        for a, b in zip(rows, rows[1:]):
            if not breaks_reel(_group(a), _group(b)):
                reasons["join"] = True
                continue
            if not math.isfinite(_time(a["end"])) or not math.isfinite(_time(b["start"])):
                reasons["non_finite"] = True
            elif _time(a["end"]) < _time(b["start"]):
                reasons["gap"] = True
            else:
                reasons["position"] = True
    assert all(reasons.values()), reasons


def test_the_fixture_still_covers_a_speaker_change_that_must_not_break():
    """The one rule this pass deliberately does NOT have (see the module
    docstring in ``rsvp_reels.py``). Without a case where two touching groups
    have *different* speakers and still share a reel, adding the rule back would
    pass every other case."""
    assert any(
        a["speaker"] != b["speaker"] and not breaks_reel(_group(a), _group(b))
        for case in REEL_CASES
        for a, b in zip(case["groups"], case["groups"][1:])
    )


@pytest.mark.parametrize("case", REEL_CASES, ids=_ids(REEL_CASES))
def test_reel_ranges_match_the_shared_fixture(case: dict):
    expected = [tuple(r) for r in case["reels"]]
    assert reel_ranges(_groups(case)) == expected


@pytest.mark.parametrize("case", REEL_CASES, ids=_ids(REEL_CASES))
def test_ranges_cover_every_group_exactly_once(case: dict):
    ranges = reel_ranges(_groups(case))
    covered = [i for start, end in ranges for i in range(start, end)]
    assert covered == list(range(len(case["groups"])))


@pytest.mark.parametrize("case", REEL_CASES, ids=_ids(REEL_CASES))
def test_merge_produces_one_group_per_range(case: dict):
    groups = _groups(case)
    assert len(merge_reels(groups)) == len(reel_ranges(groups))


# --- The merge ---------------------------------------------------------------


def _word(text: str, start: float, end: float) -> dict:
    return {"word": text, "start": start, "end": end}


def test_a_reel_carries_every_word_in_order_and_spans_its_members():
    # Arrange — three touching groups, i.e. one reel.
    groups = [
        {"text": "a b", "start": 0.0, "end": 1.0, "speaker": None,
         "words": [_word("a", 0.0, 0.5), _word("b", 0.5, 1.0)]},
        {"text": "c", "start": 1.0, "end": 1.5, "speaker": None,
         "words": [_word("c", 1.0, 1.5)]},
        {"text": "d e", "start": 1.5, "end": 2.5, "speaker": None,
         "words": [_word("d", 1.5, 2.0), _word("e", 2.0, 2.5)]},
    ]

    # Act
    merged = merge_reels(groups)

    # Assert
    assert len(merged) == 1
    reel = merged[0]
    assert reel["start"] == 0.0
    assert reel["end"] == 2.5
    assert [w["word"] for w in reel["words"]] == ["a", "b", "c", "d", "e"]
    assert reel["text"] == "a b c d e"


def test_word_timings_are_carried_through_untouched():
    """RSVP is presentation-only: merging must never re-time a word."""
    words = [_word("a", 0.0, 0.5), _word("b", 0.5, 1.0), _word("c", 1.0, 1.5)]
    groups = [
        {"text": "a b", "start": 0.0, "end": 1.0, "words": copy.deepcopy(words[:2])},
        {"text": "c", "start": 1.0, "end": 1.5, "words": copy.deepcopy(words[2:])},
    ]

    merged = merge_reels(groups)

    assert merged[0]["words"] == words


def test_a_gap_keeps_the_groups_apart():
    groups = [
        {"text": "a", "start": 0.0, "end": 1.0, "words": [_word("a", 0.0, 1.0)]},
        {"text": "b", "start": 2.0, "end": 3.0, "words": [_word("b", 2.0, 3.0)]},
    ]

    merged = merge_reels(groups)

    assert [g["text"] for g in merged] == ["a", "b"]
    assert [len(g["words"]) for g in merged] == [1, 1]


def test_a_single_group_reel_round_trips_equal():
    """With every gap real (or gap closing disabled) the pass is the identity —
    which is what makes it safe to apply unconditionally in RSVP mode."""
    groups = [
        {"text": "a", "start": 0.0, "end": 1.0, "speaker": "S0", "words": [_word("a", 0.0, 1.0)],
         "position_x": 0.4},
        {"text": "b", "start": 2.0, "end": 3.0, "speaker": "S1", "words": [_word("b", 2.0, 3.0)]},
    ]

    assert merge_reels(groups) == groups


def test_the_position_override_of_a_merged_reel_is_its_members_shared_one():
    groups = [
        {"text": "a", "start": 0.0, "end": 1.0, "words": [_word("a", 0.0, 1.0)],
         "position_x": 0.4, "position_y": 0.2},
        {"text": "b", "start": 1.0, "end": 2.0, "words": [_word("b", 1.0, 2.0)],
         "position_x": 0.4, "position_y": 0.2},
    ]

    merged = merge_reels(groups)

    assert len(merged) == 1
    assert (merged[0]["position_x"], merged[0]["position_y"]) == (0.4, 0.2)


def test_a_differing_position_override_is_honoured_not_dropped():
    groups = [
        {"text": "a", "start": 0.0, "end": 1.0, "words": [_word("a", 0.0, 1.0)]},
        {"text": "b", "start": 1.0, "end": 2.0, "words": [_word("b", 1.0, 2.0)],
         "position_y": 0.15},
    ]

    merged = merge_reels(groups)

    assert len(merged) == 2
    assert "position_y" not in merged[0]
    assert merged[1]["position_y"] == 0.15


def test_an_empty_text_does_not_leave_a_double_space():
    groups = [
        {"text": "a", "start": 0.0, "end": 1.0, "words": [_word("a", 0.0, 1.0)]},
        {"text": "", "start": 1.0, "end": 1.2, "words": []},
        {"text": "b", "start": 1.2, "end": 2.0, "words": [_word("b", 1.2, 2.0)]},
    ]

    assert merge_reels(groups)[0]["text"] == "a b"


def test_the_input_is_never_mutated():
    groups = [
        {"text": "a", "start": 0.0, "end": 1.0, "words": [_word("a", 0.0, 1.0)]},
        {"text": "b", "start": 1.0, "end": 2.0, "words": [_word("b", 1.0, 2.0)]},
    ]
    before = copy.deepcopy(groups)

    merge_reels(groups)

    assert groups == before


def test_empty_input():
    assert reel_ranges([]) == []
    assert merge_reels([]) == []
