"""Unit tests for fill_group_gaps() — the pure stretch transform that extends
each group's end to the next group's start so captions persist through
silence gaps (see docs/plans/fill-group-gaps.md).
"""

from backend.exporters.video_render import fill_group_gaps
from backend.tests.test_render_golden import build_group


def test_gap_is_stretched_to_next_group_start():
    groups = [
        build_group(["Hello", "brave", "new"], start=0.5, word_dur=0.5),  # 0.5-2.0
        build_group(["world", "this", "is"], start=2.4, word_dur=0.4),    # 2.4-3.6
    ]

    result = fill_group_gaps(groups)

    assert result[0]["end"] == 2.4
    assert result[1]["end"] == groups[1]["end"]


def test_overlapping_groups_are_left_untouched():
    # groups[1].start is BEFORE groups[0].end — no gap, never shrink.
    groups = [
        build_group(["Hello", "brave", "new"], start=0.5, word_dur=0.5),  # 0.5-2.0
        build_group(["world", "this", "is"], start=1.8, word_dur=0.4),    # 1.8-3.0
    ]

    result = fill_group_gaps(groups)

    assert result[0]["end"] == groups[0]["end"]
    assert result[1]["end"] == groups[1]["end"]


def test_back_to_back_groups_with_no_gap_are_unchanged():
    groups = [
        build_group(["Hello", "brave", "new"], start=0.5, word_dur=0.5),  # 0.5-2.0
        build_group(["world", "this", "is"], start=2.0, word_dur=0.4),    # 2.0-3.2
    ]

    result = fill_group_gaps(groups)

    assert result[0]["end"] == groups[0]["end"]
    assert result[1]["end"] == groups[1]["end"]


def test_last_group_is_always_unchanged():
    groups = [
        build_group(["Hello", "brave", "new"], start=0.5, word_dur=0.5),
        build_group(["world", "this", "is"], start=2.4, word_dur=0.4),
        build_group(["short", "tail"], start=6.0, word_dur=0.6),
    ]

    result = fill_group_gaps(groups)

    assert result[-1]["end"] == groups[-1]["end"]
    assert result[-1] == {**groups[-1]}


def test_empty_list_returns_empty_list():
    assert fill_group_gaps([]) == []


def test_input_groups_are_not_mutated():
    groups = [
        build_group(["Hello", "brave", "new"], start=0.5, word_dur=0.5),  # 0.5-2.0
        build_group(["world", "this", "is"], start=2.4, word_dur=0.4),    # 2.4-3.6
    ]
    original_first_end = groups[0]["end"]
    original_first_dict_id = id(groups[0])

    result = fill_group_gaps(groups)

    # Original dict object untouched (not the same identity, value unchanged).
    assert groups[0]["end"] == original_first_end
    assert id(groups[0]) == original_first_dict_id
    # Returned dict is a NEW object, not the same identity as the input.
    assert result[0] is not groups[0]
    assert result[1] is not groups[1]


def test_words_are_untouched_when_end_is_stretched():
    groups = [
        build_group(["Hello", "brave", "new"], start=0.5, word_dur=0.5),  # 0.5-2.0
        build_group(["world", "this", "is"], start=2.4, word_dur=0.4),
    ]

    result = fill_group_gaps(groups)

    assert result[0]["words"] == groups[0]["words"]
    assert result[0]["start"] == groups[0]["start"]
    assert result[0]["text"] == groups[0]["text"]
