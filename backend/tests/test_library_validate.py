"""The publish validators — one implementation, in Python (plan §3.3).

Structural coverage is fixture-driven (``fixtures/validate_cases.json``) so a
new rule is a JSON row; the messages and the ``hard``/``style`` split are
asserted directly, because those are what the Publish panel renders.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from backend.library.brief import Brief, HouseRules
from backend.library.schemas import Chapter, VideoRecord
from backend.library.validate import (
    CHAPTER_MIN_GAP_S,
    CHAPTERS_MIN,
    DESCRIPTION_MAX_BYTES,
    HOOK_CHARS,
    TAGS_MAX_CHARS,
    TITLE_MAX_CHARS,
    Violation,
    hard_violations,
    validate_fields,
    validate_record,
)

FIXTURE = Path(__file__).parent / "fixtures" / "validate_cases.json"

#: ``"<repeat:101:T>"`` in the fixture means ``"T" * 101`` — a 5000-character
#: string would otherwise make the JSON unreadable. It expands anywhere inside
#: a string, so a case can put a line break after 160 characters.
REPEAT_RE = re.compile(r"<repeat:(\d+):(.)>")


def expand(value):
    """Expand the fixture's repeat shorthand anywhere in a JSON value."""
    if isinstance(value, str):
        return REPEAT_RE.sub(lambda m: m.group(2) * int(m.group(1)), value)
    if isinstance(value, list):
        return [expand(item) for item in value]
    if isinstance(value, dict):
        return {key: expand(item) for key, item in value.items()}
    return value


def load_cases() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


CASES = load_cases()


def rules(violations: list[Violation]) -> list[str]:
    return sorted(v.rule for v in violations)


# --- the fixture -------------------------------------------------------------

def test_the_fixture_covers_every_rule_the_module_can_emit():
    """A rule with no fixture row is a rule nobody ever saw fire."""
    covered = {rule for case in CASES for rule in case["expect"]}
    assert covered == {
        "title_max_chars", "description_max_bytes", "tags_max_chars",
        "no_angle_brackets", "chapters_start_at_zero", "chapters_min",
        "chapters_ascending", "chapter_min_gap", "chapter_within_duration",
        "no_em_dashes", "description_chars", "keywords_terms", "hook_first_150",
    }


def test_the_fixture_names_are_unique():
    names = [case["name"] for case in CASES]
    assert len(names) == len(set(names))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fixture_case(case):
    brief = Brief.model_validate(case["brief"]) if case["brief"] is not None else None

    found = validate_fields(
        expand(case["fields"]), duration=case["duration"], brief=brief
    )

    assert rules(found) == sorted(case["expect"])


# --- messages and severities -------------------------------------------------

def test_a_long_title_reports_the_field_the_count_and_the_limit():
    found = validate_fields({"title": "T" * 140}, duration=None, brief=None)

    assert len(found) == 1
    violation = found[0]
    assert violation.field == "title"
    assert violation.severity == "hard"
    assert "140" in violation.message and str(TITLE_MAX_CHARS) in violation.message


def test_a_long_title_option_names_its_index():
    found = validate_fields(
        {"title_options": ["ok", "T" * 101]}, duration=None, brief=None
    )

    assert [v.field for v in found] == ["title_options[1]"]


def test_the_description_limit_is_counted_in_bytes_not_characters():
    """4000 three-byte characters are 12000 bytes — well over the limit."""
    found = validate_fields({"description": "日" * 4000}, duration=None, brief=None)

    assert [v.rule for v in found] == ["description_max_bytes"]
    assert "12000" in found[0].message and str(DESCRIPTION_MAX_BYTES) in found[0].message


def test_the_tags_limit_counts_the_joined_line_separators_included():
    """``", ".join`` is the line YouTube actually stores."""
    tags = ["a" * 24] * 20  # 480 characters of tag + 38 of separator
    found = validate_fields({"tags": tags}, duration=None, brief=None)

    assert [v.rule for v in found] == ["tags_max_chars"]
    assert "518" in found[0].message and str(TAGS_MAX_CHARS) in found[0].message


def test_angle_brackets_are_reported_once_per_field():
    found = validate_fields(
        {"title": "<a>", "description": "<b>", "tags": ["<c>", "<d>"]},
        duration=None, brief=None,
    )

    assert [v.field for v in found] == ["title", "description", "tags"]
    assert all(v.rule == "no_angle_brackets" for v in found)


def test_a_chapter_violation_names_the_chapter_index():
    found = validate_fields(
        {"chapters": [
            {"start_s": 0, "title": "a"},
            {"start_s": 3, "title": "b"},
            {"start_s": 90, "title": "c"},
        ]},
        duration=600, brief=None,
    )

    assert [v.field for v in found] == ["chapters[1]"]
    assert f"{CHAPTER_MIN_GAP_S}" in found[0].message


def test_the_minimum_chapter_count_is_named_in_the_message():
    found = validate_fields(
        {"chapters": [{"start_s": 0, "title": "only one"}]}, duration=600, brief=None
    )

    assert [v.rule for v in found] == ["chapters_min"]
    assert str(CHAPTERS_MIN) in found[0].message


def test_a_descending_chapter_is_not_also_reported_as_a_short_gap():
    """One pair, one finding: the gap rule is meaningless on a backwards jump."""
    found = validate_fields(
        {"chapters": [
            {"start_s": 0, "title": "a"},
            {"start_s": 90, "title": "b"},
            {"start_s": 89, "title": "c"},
        ]},
        duration=600, brief=None,
    )

    assert [v.rule for v in found] == ["chapters_ascending"]


def test_a_chapter_past_the_duration_reports_both_timestamps():
    found = validate_fields(
        {"chapters": [
            {"start_s": 0, "title": "a"},
            {"start_s": 60, "title": "b"},
            {"start_s": 3700, "title": "c"},
        ]},
        duration=3600, brief=None,
    )

    assert [v.rule for v in found] == ["chapter_within_duration"]
    assert "1:01:40" in found[0].message and "1:00:00" in found[0].message


def test_every_style_rule_is_marked_style_and_every_limit_rule_hard():
    brief = Brief(house_rules=HouseRules(no_em_dashes=True, keywords_terms=(12, 20)))
    found = validate_fields(
        {"title": "T" * 101, "description": "A — dash.\nSecond line.", "keywords": ["one"]},
        duration=None, brief=brief,
    )

    by_rule = {v.rule: v.severity for v in found}
    assert by_rule["title_max_chars"] == "hard"
    assert by_rule["no_em_dashes"] == "style"
    assert by_rule["keywords_terms"] == "style"
    assert by_rule["hook_first_150"] == "style"


def test_the_hook_rule_message_names_the_window():
    brief = Brief()
    found = validate_fields(
        {"description": "Hook.\nRest."}, duration=None, brief=brief
    )

    assert [v.rule for v in found] == ["hook_first_150"]
    assert str(HOOK_CHARS) in found[0].message


def test_style_rules_describe_written_content_not_an_empty_draft():
    """An empty description is "not written yet", not "1800 characters short"."""
    brief = Brief(house_rules=HouseRules(
        description_chars=(1800, 2200), keywords_terms=(12, 20)
    ))

    found = validate_fields(
        {"description": "", "keywords": []}, duration=None, brief=brief
    )

    assert found == []


def test_validate_fields_refuses_a_key_that_is_not_an_authored_field():
    """External data, validated at the boundary — a typo is never a silent pass."""
    with pytest.raises(ValueError):
        validate_fields({"titel": "typo"}, duration=None, brief=None)
    with pytest.raises(ValueError):
        validate_fields({"rev": 3}, duration=None, brief=None)


def test_validate_fields_refuses_a_malformed_chapter():
    with pytest.raises(ValueError):
        validate_fields({"chapters": [{"title": "no start"}]}, duration=None, brief=None)


def test_validate_fields_does_not_mutate_what_it_was_given():
    fields = {"title": "T" * 101, "chapters": [{"start_s": 0, "title": "a"}]}
    before = json.dumps(fields, sort_keys=True)

    validate_fields(fields, duration=None, brief=None)

    assert json.dumps(fields, sort_keys=True) == before


# --- hard_violations / validate_record ---------------------------------------

def test_hard_violations_drops_the_style_findings():
    brief = Brief(house_rules=HouseRules(no_em_dashes=True))
    fields = {"title": "T" * 101, "description": "A — dash."}

    assert rules(hard_violations(fields, duration=None, brief=brief)) == ["title_max_chars"]
    assert "no_em_dashes" in rules(validate_fields(fields, duration=None, brief=brief))


def test_hard_violations_needs_no_brief():
    assert hard_violations({"title": "T" * 101}, duration=None) != []


def record(**fields) -> VideoRecord:
    return VideoRecord(id="0" * 32, **fields)


def test_validate_record_reads_the_stored_dossier():
    stored = record(
        title="T" * 101,
        chapters=[Chapter(start_s=0, title="a"), Chapter(start_s=5, title="b")],
    )

    found = validate_record(stored, duration=600, brief=None)

    assert rules(found) == ["chapter_min_gap", "chapters_min", "title_max_chars"]


def test_validate_record_ignores_the_system_half_of_the_dossier():
    """``rev``/``sourcePath`` are not authored, so they can never be validated."""
    stored = record(sourcePath="/tmp/<weird>.mp4", rev=7)

    assert validate_record(stored, duration=None, brief=None) == []
