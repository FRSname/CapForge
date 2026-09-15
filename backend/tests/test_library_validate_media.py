"""The Shorts and Thumbnail rules (publish-editors Part A, decision 4).

Hard rules block a ``PATCH``; style rules are advice and, like every other
style rule, run only when a brief is given (the routes always give one).
"""

from __future__ import annotations

from typing import Any, Optional

import pytest

from backend.library.brief import Brief
from backend.library.schemas import RecordPatch
from backend.library.validate import hard_violations, validate_fields
from backend.library.validate_media import (
    SHORTS_MAX_S,
    candidates_findings,
)

COVER = "a" * 32 + ".jpg"
OTHER = "b" * 32 + ".jpg"


def clip(start: float, end: float) -> dict:
    return {"start_s": start, "end_s": end, "why": "a claim"}


def idea(recommended: bool = False) -> dict:
    return {"label": "L", "type": "face", "headline": "H", "recommended": recommended}


def found(fields: dict, *, duration: Optional[float] = None, brief: Optional[Brief] = None) -> list[tuple[str, str, str]]:
    return sorted(
        (v.field, v.rule, v.severity)
        for v in validate_fields(fields, duration=duration, brief=brief)
    )


# --- thumbnail.cover ----------------------------------------------------------

@pytest.mark.parametrize("thumbnail", [
    {"candidates": [], "cover": None},
    {"candidates": [COVER, OTHER], "cover": COVER},
])
def test_a_cover_that_is_null_or_a_candidate_is_fine(thumbnail: dict) -> None:
    assert found({"thumbnail": thumbnail}) == []


def test_a_cover_that_is_not_a_candidate_is_hard() -> None:
    violations = validate_fields(
        {"thumbnail": {"candidates": [OTHER], "cover": COVER}}, duration=None, brief=None
    )

    assert [(v.field, v.rule, v.severity) for v in violations] == [
        ("thumbnail.cover", "cover_not_a_candidate", "hard")
    ]
    assert COVER in violations[0].message


# --- shorts.clip_suggestions ---------------------------------------------------

@pytest.mark.parametrize("start,end", [(10.0, 10.0), (20.0, 10.0), (-1.0, 5.0)])
def test_a_clip_out_of_order_is_hard(start: float, end: float) -> None:
    fields = {"shorts": {"caption": "", "clip_suggestions": [clip(0, 5), clip(start, end)]}}

    assert found(fields, duration=100.0) == [
        ("shorts.clip_suggestions[1]", "clip_order", "hard")
    ]


def test_a_clip_past_the_end_is_hard_and_one_ending_on_it_is_fine() -> None:
    fields = {"shorts": {"clip_suggestions": [clip(0, 30), clip(20, 30.5)]}}

    assert found(fields, duration=30.0) == [
        ("shorts.clip_suggestions[1]", "clip_past_end", "hard")
    ]
    violations = validate_fields(fields, duration=30.0, brief=None)
    assert "00:30" in violations[0].message


def test_with_no_known_duration_no_clip_is_past_the_end() -> None:
    assert found({"shorts": {"clip_suggestions": [clip(0, 9000)]}}) == []


def test_a_clip_longer_than_a_short_is_style_advice() -> None:
    long_clip = clip(0, SHORTS_MAX_S + 0.5)
    exact = clip(100, 100 + SHORTS_MAX_S)
    fields = {"shorts": {"clip_suggestions": [exact, long_clip]}}

    assert found(fields, brief=Brief()) == [
        ("shorts.clip_suggestions[1]", "shorts_clip_length", "style")
    ]
    assert SHORTS_MAX_S == 60
    assert hard_violations(fields, duration=None, brief=Brief()) == []


def test_style_rules_need_a_brief_like_every_other_style_rule() -> None:
    fields = {
        "shorts": {"clip_suggestions": [clip(0, 90)]},
        "thumbnail": {"ideas": [idea(), idea()]},
    }

    assert found(fields) == []


# --- thumbnail.ideas -----------------------------------------------------------

@pytest.mark.parametrize("ideas,expected", [
    ([], []),
    ([idea(True)], []),
    ([idea(), idea(True), idea()], []),
    ([idea(), idea()], [("thumbnail.ideas", "thumbnail_recommended", "style")]),
    ([idea(True), idea(True)], [("thumbnail.ideas", "thumbnail_recommended", "style")]),
])
def test_exactly_one_idea_is_recommended(ideas: list, expected: list) -> None:
    assert found({"thumbnail": {"ideas": ideas}}, brief=Brief()) == expected


# --- candidates_managed ----------------------------------------------------------

def _patch(**fields: Any) -> RecordPatch:
    return RecordPatch.model_validate(fields)


def test_a_patch_without_a_thumbnail_does_not_touch_candidates() -> None:
    assert candidates_findings([COVER], _patch(title="T")) == []


def test_a_patch_that_sends_the_stored_candidates_back_is_fine() -> None:
    patch = _patch(thumbnail={"candidates": [COVER, OTHER], "cover": OTHER})

    assert candidates_findings([COVER, OTHER], patch) == []


@pytest.mark.parametrize("sent", [[], [COVER], [OTHER, COVER], [COVER, OTHER, "c" * 32 + ".jpg"]])
def test_a_patch_that_changes_the_candidates_is_hard(sent: list) -> None:
    [violation] = candidates_findings([COVER, OTHER], _patch(thumbnail={"candidates": sent}))

    assert (violation.field, violation.rule, violation.severity) == (
        "thumbnail.candidates", "candidates_managed", "hard"
    )
    assert "grab_frames" in violation.message or "frames" in violation.message


# --- an omitted key means "unchanged" -------------------------------------------

from backend.library.schemas import Thumbnail  # noqa: E402
from backend.library.validate_media import (  # noqa: E402
    inherit_thumbnail,
    merge_thumbnail_fields,
)

STORED = Thumbnail(
    ideas=[{"label": "Old", "type": "face", "headline": "Old", "recommended": True}],
    candidates=[COVER, OTHER],
    cover=COVER,
)


def test_a_thumbnail_patch_without_candidates_is_not_a_change() -> None:
    assert candidates_findings(STORED.candidates, _patch(thumbnail={"ideas": []})) == []
    assert candidates_findings(STORED.candidates, _patch(thumbnail={"cover": OTHER})) == []


def test_thumbnail_null_with_stored_candidates_is_still_refused() -> None:
    [violation] = candidates_findings([COVER], _patch(thumbnail=None))

    assert violation.rule == "candidates_managed"


def test_inherit_fills_only_the_keys_the_patch_omitted() -> None:
    ideas_only = inherit_thumbnail(STORED, _patch(thumbnail={"ideas": []})).thumbnail
    cover_only = inherit_thumbnail(STORED, _patch(thumbnail={"cover": OTHER})).thumbnail
    null_cover = inherit_thumbnail(STORED, _patch(thumbnail={"cover": None})).thumbnail
    explicit = inherit_thumbnail(STORED, _patch(thumbnail={"candidates": [OTHER]})).thumbnail

    assert (ideas_only.ideas, ideas_only.candidates, ideas_only.cover) == ([], STORED.candidates, COVER)
    assert (cover_only.ideas, cover_only.candidates, cover_only.cover) == (STORED.ideas, STORED.candidates, OTHER)
    assert null_cover.cover is None and null_cover.candidates == STORED.candidates
    assert (explicit.candidates, explicit.cover) == ([OTHER], COVER)


def test_inherit_leaves_a_patch_without_a_thumbnail_object_alone() -> None:
    title = _patch(title="T")
    null = _patch(thumbnail=None)

    assert inherit_thumbnail(STORED, title) is title
    assert inherit_thumbnail(STORED, null) is null


def test_inherit_never_mutates_the_patch_or_the_stored_thumbnail() -> None:
    patch = _patch(thumbnail={"ideas": []})
    before = STORED.model_dump()

    merged = inherit_thumbnail(STORED, patch)

    assert merged is not patch
    assert patch.thumbnail.model_fields_set == {"ideas"}
    assert patch.thumbnail.candidates == []
    assert STORED.model_dump() == before


def test_a_partial_draft_is_judged_against_the_stored_candidates() -> None:
    fields = {"title": "T", "thumbnail": {"cover": OTHER}}

    merged = merge_thumbnail_fields(STORED, fields)

    assert merged == {"title": "T", "thumbnail": {**STORED.model_dump(), "cover": OTHER}}
    assert fields == {"title": "T", "thumbnail": {"cover": OTHER}}
    assert found(merged) == []
    assert merge_thumbnail_fields(STORED, {"title": "T"}) == {"title": "T"}
