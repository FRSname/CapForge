"""Platform facts, stated once (docs/plans/multi-channel-pr1-contract.md → platforms.py).

The table is served to the renderer as ``GET /api/library/platforms``; PR 1 only
serves and tests it. The numbers are pinned here, and the "no second copy"
rule is pinned by identity against the modules that already enforce them.
"""

from __future__ import annotations

import pytest

from backend.library import platform_posts, platforms, validate
from backend.library.platforms import PLATFORM_IDS, count, served_platforms

EMOJI = "\N{GRINNING FACE}"
X_URL_WEIGHT = 23
#: Limits on something counted inside another field (Instagram's @mentions).
COUNTED_INSIDE_A_FIELD = ("mentions",)


def spec(platform_id: str) -> dict:
    return next(s for s in served_platforms() if s["id"] == platform_id)


def limit(platform_id: str, field: str) -> dict:
    return next(entry for entry in spec(platform_id)["limits"] if entry["field"] == field)


# --- the table ---------------------------------------------------------------

def test_the_platform_ids_in_menu_order():
    assert PLATFORM_IDS == ("youtube", "tiktok", "instagram", "linkedin", "x")
    assert [s["id"] for s in served_platforms()] == list(PLATFORM_IDS)


def test_every_spec_has_the_wire_shape():
    for entry in served_platforms():
        assert set(entry) == {"id", "label", "fields", "limits"}
        for rule in entry["limits"]:
            assert set(rule) - {"min"} == {"field", "max", "unit", "severity"}
            assert rule["unit"] in platforms.UNITS
            assert rule["severity"] in ("hard", "style")
            assert rule["field"] in (*entry["fields"], *COUNTED_INSIDE_A_FIELD)


@pytest.mark.parametrize("platform_id,label,fields", [
    ("youtube", "YouTube", ["title", "description", "tags", "hashtags", "cover", "localized"]),
    ("tiktok", "TikTok", ["caption", "hashtags", "cover"]),
    ("instagram", "Instagram", ["caption", "hashtags", "cover"]),
    ("linkedin", "LinkedIn", ["text", "hashtags", "cover"]),
    ("x", "X", ["text", "hashtags"]),
])
def test_labels_and_fields(platform_id, label, fields):
    assert spec(platform_id)["label"] == label
    assert spec(platform_id)["fields"] == fields


def test_instagram_mentions_are_a_field_limit_even_without_a_field():
    """``mentions`` is counted inside the caption, so it is not an editable field."""
    entry = spec("instagram")
    assert [rule["field"] for rule in entry["limits"]] == ["caption", "hashtags", "mentions"]
    assert "mentions" not in entry["fields"]


@pytest.mark.parametrize("platform_id,field,expected", [
    ("youtube", "title", {"max": 100, "unit": "chars", "severity": "hard"}),
    ("youtube", "description", {"max": 5000, "unit": "bytes", "severity": "hard"}),
    ("youtube", "tags", {"max": 500, "unit": "chars", "severity": "hard"}),
    ("tiktok", "caption", {"max": 2200, "unit": "utf16", "severity": "hard"}),
    ("tiktok", "hashtags", {"max": 5, "unit": "items", "severity": "style"}),
    ("instagram", "caption", {"max": 2200, "unit": "chars", "severity": "hard"}),
    ("instagram", "hashtags", {"max": 30, "unit": "items", "severity": "hard"}),
    ("instagram", "mentions", {"max": 20, "unit": "items", "severity": "hard"}),
    ("linkedin", "text", {"max": 3000, "unit": "chars", "severity": "hard"}),
    ("linkedin", "hashtags", {"max": 5, "min": 3, "unit": "items", "severity": "style"}),
    ("x", "text", {"max": 280, "unit": "weighted", "severity": "hard"}),
])
def test_the_limits(platform_id, field, expected):
    assert limit(platform_id, field) == {"field": field, **expected}


def test_only_linkedin_hashtags_carry_a_min():
    with_min = [
        (entry["id"], rule["field"])
        for entry in served_platforms() for rule in entry["limits"] if "min" in rule
    ]
    assert with_min == [("linkedin", "hashtags")]


def test_no_second_copy_of_a_number():
    assert limit("youtube", "title")["max"] is validate.TITLE_MAX_CHARS
    assert limit("youtube", "description")["max"] is validate.DESCRIPTION_MAX_BYTES
    assert limit("youtube", "tags")["max"] is validate.TAGS_MAX_CHARS
    for name in ("LINKEDIN_MAX_CHARS", "LINKEDIN_MAX_HASHTAGS", "LINKEDIN_MIN_HASHTAGS",
                 "X_MAX_WEIGHTED_CHARS", "X_URL_WEIGHT", "INSTAGRAM_MAX_CHARS",
                 "INSTAGRAM_MAX_HASHTAGS"):
        assert getattr(platform_posts, name) is getattr(platforms, name), name


def test_served_platforms_is_a_fresh_copy_each_call():
    first = served_platforms()
    first[0]["limits"].clear()

    assert served_platforms()[0]["limits"]


# --- count() -----------------------------------------------------------------

@pytest.mark.parametrize("unit,value,expected", [
    ("chars", "héllo", 5),
    ("chars", EMOJI, 1),
    ("bytes", "héllo", 6),
    ("bytes", EMOJI, 4),
    ("utf16", "héllo", 5),
    ("utf16", EMOJI, 2),
    ("utf16", "", 0),
    ("items", ["#a", "#b", "#c"], 3),
    ("items", [], 0),
    ("weighted", "hello", 5),
])
def test_count_per_unit(unit, value, expected):
    assert count(unit, value) == expected


def test_an_x_url_weighs_23_whatever_its_length():
    long_url = "https://example.com/" + "a" * 80
    text = f"Watch {long_url}"

    assert count("weighted", text) == len("Watch ") + X_URL_WEIGHT
    assert count("weighted", "https://t.co") == X_URL_WEIGHT


def test_the_url_weight_is_a_parameter():
    assert count("weighted", "see http://a.b", url_weight=10) == len("see ") + 10


def test_count_refuses_an_unknown_unit():
    with pytest.raises(ValueError):
        count("words", "a b")


@pytest.mark.parametrize("unit,value", [("items", "abc"), ("chars", ["a"])])
def test_count_refuses_the_wrong_value_type(unit, value):
    with pytest.raises(TypeError):
        count(unit, value)
