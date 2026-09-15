"""Description-template slots: one-pass ``{{slot}}`` substitution (collections plan,
decision 4). Pure module, no store.

The blank-line rule is deliberately narrow: only the blank lines an *empty slot*
leaves behind are squeezed. Blank lines the template author typed, and blank
lines inside a slot's value, are kept — that is what keeps the default template
byte-identical to the layout the package printed before templates existed.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from backend.library.template import (
    BUILTIN_SLOTS,
    DEFAULT_DESCRIPTION_TEMPLATE,
    SLOT_NAME_RE,
    Rendered,
    render_template,
    validate_slot_names,
)

FIXTURES = Path(__file__).parent / "fixtures"
MAX_SLOT_NAME_CHARS = 32


# --- substitution ------------------------------------------------------------

def test_a_known_slot_is_substituted():
    assert render_template("Hi {{name}}", {"name": "Ada"}) == Rendered("Hi Ada", ())


def test_substitution_is_one_pass_so_a_value_is_never_re_expanded():
    rendered = render_template("{{a}}", {"a": "{{b}}", "b": "x"})

    assert rendered.text == "{{b}}"
    assert rendered.unknown == ()  # the value's braces are not a template's


def test_a_slot_that_names_itself_does_not_loop():
    assert render_template("{{a}}", {"a": "{{a}}"}).text == "{{a}}"


def test_whitespace_inside_the_braces_is_tolerated():
    assert render_template("At {{ event }}!", {"event": "PyCon"}).text == "At PyCon!"


def test_the_same_slot_twice_is_substituted_twice():
    assert render_template("{{x}}-{{x}}", {"x": "1"}).text == "1-1"


def test_an_empty_slot_inside_a_line_leaves_the_rest_of_the_line():
    assert render_template("Event: {{x}}!", {"x": ""}).text == "Event: !"


# --- blank lines -------------------------------------------------------------

def test_an_empty_slots_line_collapses_to_one_blank_line():
    assert render_template("A\n\n{{x}}\n\nB", {"x": ""}).text == "A\n\nB"


def test_several_empty_slots_in_a_row_collapse_to_one_blank_line():
    text = render_template("A\n\n{{x}}\n\n{{y}}\n\n{{z}}\n\nB", {"x": "", "y": "", "z": ""}).text

    assert text == "A\n\nB"


def test_an_empty_slot_between_single_newlines_leaves_no_blank_line():
    assert render_template("A\n{{x}}\nB", {"x": ""}).text == "A\nB"


def test_empty_slots_at_either_end_are_stripped():
    assert render_template("{{x}}\n\nA\n\n{{y}}", {"x": "", "y": ""}).text == "A"


def test_the_text_is_stripped():
    assert render_template("  \nA\n  ", {}).text == "A"


def test_everything_empty_renders_nothing():
    assert render_template("{{x}}\n\n{{y}}", {"x": "", "y": ""}).text == ""


def test_blank_lines_the_template_author_typed_are_kept():
    """No empty slot, nothing squeezed: the author's spacing is theirs."""
    assert render_template("A\n\n\nB", {}).text == "A\n\n\nB"


def test_a_slot_values_own_blank_lines_are_kept():
    assert render_template("{{d}}\n\n{{e}}", {"d": "x\n\n\ny", "e": ""}).text == "x\n\n\ny"


def test_a_slot_values_own_surrounding_whitespace_is_kept():
    """Values are opaque: stripping one is the caller's choice, not the template's."""
    assert render_template("{{a}}\n\n{{b}}", {"a": "A", "b": "B\n"}).text == "A\n\nB\n"


# --- unknown and malformed ---------------------------------------------------

def test_an_unknown_slot_stays_verbatim_and_is_reported_once():
    rendered = render_template("Hi {{typo}} and {{ typo }} {{other}}", {})

    assert rendered.text == "Hi {{typo}} and {{ typo }} {{other}}"
    assert rendered.unknown == ("typo", "other")


def test_an_unknown_slot_is_content_so_its_line_does_not_collapse():
    assert render_template("A\n\n{{typo}}\n\nB", {}).text == "A\n\n{{typo}}\n\nB"


@pytest.mark.parametrize("text", [
    "{{}}", "{{ Bad }}", "{{a-b}}", "{{1x}}", "{single}", "{{ not a slot }}",
    "{{" + "a" * (MAX_SLOT_NAME_CHARS + 1) + "}}", "{{x", "x}}",
])
def test_braces_without_a_valid_name_are_left_alone_and_not_reported(text):
    assert render_template(text, {"x": "X", "a": "A"}) == Rendered(text, ())


def test_rendered_is_a_frozen_value():
    rendered = render_template("x", {})

    with pytest.raises(dataclasses.FrozenInstanceError):
        rendered.text = "y"  # type: ignore[misc]


def test_rendering_never_mutates_the_slot_map():
    slots = {"a": "1"}

    render_template("{{a}}", slots)

    assert slots == {"a": "1"}


# --- names -------------------------------------------------------------------

def test_valid_custom_slot_names_pass():
    validate_slot_names({"event": "UCK", "city_2": "Brno", "a" * MAX_SLOT_NAME_CHARS: ""})


@pytest.mark.parametrize("name", ["Event", "1x", "a-b", "", "_x", "a" * (MAX_SLOT_NAME_CHARS + 1)])
def test_a_malformed_slot_name_is_refused(name):
    with pytest.raises(ValueError, match="slot name"):
        validate_slot_names({name: "x"})


@pytest.mark.parametrize("name", sorted(BUILTIN_SLOTS))
def test_a_custom_slot_may_not_shadow_a_built_in(name):
    with pytest.raises(ValueError, match="built-in"):
        validate_slot_names({name: "x"})


def test_the_slot_name_pattern_is_the_plans():
    assert SLOT_NAME_RE.pattern == r"^[a-z][a-z0-9_]{0,31}$"


def test_builtin_slots_equal_the_shared_fixture():
    fixture = json.loads((FIXTURES / "builtin_slots.json").read_text(encoding="utf-8"))

    assert len(fixture["slots"]) == len(set(fixture["slots"]))
    assert BUILTIN_SLOTS == frozenset(fixture["slots"])


def test_every_built_in_is_a_legal_slot_name():
    assert all(SLOT_NAME_RE.match(name) for name in BUILTIN_SLOTS)


def test_the_default_template_is_todays_description_order():
    assert DEFAULT_DESCRIPTION_TEMPLATE == "\n\n".join(
        f"{{{{{name}}}}}" for name in (
            "description", "recorded_at", "highlights", "chapters",
            "links", "speakers", "footer", "hashtags",
        )
    )
