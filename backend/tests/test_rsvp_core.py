"""Python half of the RSVP (Spritz speed-reading) core contract.

``backend/exporters/rsvp.py`` is one of **three** implementations of the same ORP
/ line-offset rules; the twins are ``src/renderer/src/lib/rsvp.ts`` (Canvas
preview) and ``RSVP_RUNTIME_JS`` in
``backend/exporters/hyperframes_rsvp_runtime.py`` (HTML/GSAP layer).

All three suites read the **same four JSON fixtures** in
``backend/tests/fixtures/`` — so an index or an ease that changes in one language
and not the others fails loudly on the sides that did not change. Never hand-write
an expected value here; add it to the fixture instead.

Twins of this module:

* ``src/renderer/src/lib/rsvp.test.ts`` (TS core)
* ``src/renderer/src/lib/rsvp.embedded.test.ts`` (the embedded HTML-layer JS)

Pure logic — no PIL, no fonts, no I/O beyond reading the four fixtures.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from backend.exporters.rsvp import (
    RSVP_ORP_TABLE,
    UNBOUNDED_TOKEN_LENGTH,
    focus_offset,
    focus_slices,
    line_offset_at,
    orp_index,
)

FIXTURES = Path(__file__).parent / "fixtures"

# ``encoding="utf-8"`` explicitly: the fixtures carry astral characters, so a
# locale-default read would be platform-dependent.
ORP_CASES: list[dict] = json.loads(
    (FIXTURES / "rsvp_orp_cases.json").read_text(encoding="utf-8")
)
LINE_OFFSET_CASES: list[dict] = json.loads(
    (FIXTURES / "rsvp_line_offset_cases.json").read_text(encoding="utf-8")
)
FOCUS_FIXTURE: dict = json.loads(
    (FIXTURES / "rsvp_focus_offset_cases.json").read_text(encoding="utf-8")
)
FOCUS_CASES: list[dict] = FOCUS_FIXTURE["cases"]
SLICES_CASES: list[dict] = json.loads(
    (FIXTURES / "rsvp_focus_slices_cases.json").read_text(encoding="utf-8")
)["cases"]

#: Tight enough that a wrong ease or a wrong branch fails, loose enough for the
#: IEEE754 residue of ``t - start`` (worst observed: ~1.4e-13).
EPS = 1e-9

#: Longest token length the table-agreement sweep covers — long enough to run past
#: the last finite ORP breakpoint (13) into the unbounded row.
SWEEP_MAX_LENGTH = 24

#: A non-BMP (astral) character: one code point, two UTF-16 code units.
ASTRAL_CHAR = "🎬"

#: Minimum case counts. A fixture that shrinks below these is a fixture someone
#: gutted, not a suite that got simpler. Mirrored by the ``MIN_*`` exports in
#: ``src/renderer/src/lib/rsvpFixtures.testutil.ts``.
MIN_ORP_CASES = 20
MIN_FOCUS_OFFSET_CASES = 8
MIN_FOCUS_SLICES_CASES = 8
MIN_LINE_OFFSET_CASES = 10


def _is_surrogate(char: str) -> bool:
    return 0xD800 <= ord(char) <= 0xDFFF


def _has_astral(token: str) -> bool:
    return any(ord(c) > 0xFFFF for c in token)


# ── ORP index ─────────────────────────────────────────────────────


def test_orp_fixtures_are_not_empty() -> None:
    """Guards the fixtures themselves — an unreadable file must not pass silently."""
    assert len(ORP_CASES) >= MIN_ORP_CASES
    assert len(FOCUS_CASES) >= MIN_FOCUS_OFFSET_CASES
    assert len(SLICES_CASES) >= MIN_FOCUS_SLICES_CASES
    assert len(LINE_OFFSET_CASES) >= MIN_LINE_OFFSET_CASES


def test_orp_fixture_covers_astral_and_unpaired_surrogate_tokens() -> None:
    """The code-point contract is only pinned while these cases exist.

    Deleting them must fail here rather than quietly re-open the UTF-16
    divergence the JS twins normalize away.
    """
    assert any(_has_astral(case["token"]) for case in ORP_CASES)
    assert any(any(_is_surrogate(ch) for ch in case["token"]) for case in ORP_CASES)


@pytest.mark.parametrize("case", ORP_CASES, ids=lambda c: c["token"] or "<empty>")
def test_orp_index_matches_fixture(case: dict) -> None:
    assert orp_index(case["token"]) == case["index"]


@pytest.mark.parametrize("length", range(0, SWEEP_MAX_LENGTH + 1))
def test_orp_index_agrees_with_the_table_data(length: int) -> None:
    """``orp_index`` must be a pure lookup of ``RSVP_ORP_TABLE`` (plus the clamp).

    Derived from the exported table rather than a second hand-written mapping, so
    editing the table can never leave the function behind.
    """
    token = "x" * length
    if length == 0:
        assert orp_index(token) == 0
        return

    expected = next(bp.index for bp in RSVP_ORP_TABLE if length <= bp.max_length)
    assert orp_index(token) == min(max(expected, 0), length - 1)


@pytest.mark.parametrize("length", range(0, SWEEP_MAX_LENGTH + 1))
def test_orp_index_counts_code_points_not_utf16_units(length: int) -> None:
    """Swapping every character for an astral one must not move the focus index.

    ``len()`` on a ``str`` already counts code points, so this is free here — it
    is stated as a test because it is the exact property the two JS twins have to
    reproduce with ``Array.from`` (they would otherwise see double the length).
    """
    assert orp_index(ASTRAL_CHAR * length) == orp_index("x" * length)


def test_orp_index_never_returns_an_index_past_the_token() -> None:
    for case in ORP_CASES:
        token = case["token"]
        if token:
            assert 0 <= orp_index(token) <= len(token) - 1


def test_table_is_ordered_and_ends_unbounded() -> None:
    bounds = [bp.max_length for bp in RSVP_ORP_TABLE]
    assert bounds == sorted(bounds)
    assert bounds[-1] == UNBOUNDED_TOKEN_LENGTH
    assert math.isinf(UNBOUNDED_TOKEN_LENGTH)


# ── focus slices ──────────────────────────────────────────────────
#
# The prefix / focus / suffix split every renderer draws as three pieces. Pinned by
# the shared fixture so the code-point rule is stated once for all three
# languages; a code-unit implementation cuts a surrogate pair in half and fails 7
# of the 14 cases.


@pytest.mark.parametrize("case", SLICES_CASES, ids=lambda c: c["name"])
def test_focus_slices_matches_fixture(case: dict) -> None:
    token = case["token"]
    f = orp_index(token) if case["f"] is None else case["f"]
    assert focus_slices(token, f) == (case["prefix"], case["focus"], case["suffix"])


@pytest.mark.parametrize("case", SLICES_CASES, ids=lambda c: c["name"])
def test_focus_slices_rebuilds_the_token(case: dict) -> None:
    """Derived, not restated: the split may drop or duplicate nothing."""
    token = case["token"]
    f = orp_index(token) if case["f"] is None else case["f"]
    prefix, focus, suffix = focus_slices(token, f)
    assert prefix + focus + suffix == token


def test_focus_slices_of_an_empty_token_is_three_empty_strings() -> None:
    assert focus_slices("", 0) == ("", "", "")


def test_focus_slices_never_yields_a_surrogate_half() -> None:
    """Unreachable in Python (``str`` slicing cannot split a code point), asserted
    anyway so the three suites state the same contract."""
    for token in ["a🎬b", "🎬clap", "𝔘𝔫𝔦", "ab🎬cd"]:
        for piece in focus_slices(token, orp_index(token)):
            assert not any(_is_surrogate(char) for char in piece)


# ── focus offset ──────────────────────────────────────────────────
#
# Measurement is injected, so these use a stub where every character is 10px
# wide: the expected value is then arithmetic, not font data.

CHAR_W = 10.0


def fixed_width(text: str) -> float:
    return CHAR_W * len(text)


def test_focus_offset_is_the_focus_glyph_centre() -> None:
    # "the" -> f = 1, so 2 px past the word's left edge is the 'h' centre.
    assert focus_offset(100.0, "the", 1, fixed_width) == 100.0 + 10.0 + 5.0


def test_focus_offset_of_the_first_character() -> None:
    assert focus_offset(0.0, "a", 0, fixed_width) == 5.0


def test_focus_offset_clamps_an_index_past_the_end() -> None:
    # A table edit could point past a short token; the last glyph is the answer.
    assert focus_offset(0.0, "the", 9, fixed_width) == 25.0


def test_focus_offset_clamps_a_negative_index() -> None:
    assert focus_offset(0.0, "the", -3, fixed_width) == 5.0


def test_focus_offset_of_an_empty_token_is_the_word_x() -> None:
    assert focus_offset(42.0, "", 0, fixed_width) == 42.0


def test_focus_offset_uses_the_orp_index_end_to_end() -> None:
    token = "eliminates"  # len 10 -> index 3
    assert focus_offset(0.0, token, orp_index(token), fixed_width) == 35.0


# The shared prefix/focus/suffix cases (astral + unpaired surrogate included) use
# the fixture's own per-character width table, so a UTF-16-code-unit
# implementation measuring a surrogate HALF lands on a different number instead of
# coincidentally matching a uniform-width stub.

DEFAULT_CHAR_WIDTH: float = float(FOCUS_FIXTURE["defaultCharWidth"])
CHAR_WIDTHS: dict[str, float] = {
    char: float(width) for char, width in FOCUS_FIXTURE["charWidths"].items()
}


def fixture_width(text: str) -> float:
    """Injected measure for the focus-offset fixture.

    Iterates **code points** (``for c in text``), exactly as the TS/JS stubs do
    with ``Array.from`` — the stub must never be the thing that diverges; the
    implementation's own slicing is what is under test.
    """
    return sum(CHAR_WIDTHS.get(char, DEFAULT_CHAR_WIDTH) for char in text)


@pytest.mark.parametrize("case", FOCUS_CASES, ids=lambda c: c["name"])
def test_focus_offset_matches_fixture(case: dict) -> None:
    token = case["token"]
    f = orp_index(token) if case["f"] is None else case["f"]
    actual = focus_offset(case["wordX"], token, f, fixture_width)
    assert actual == pytest.approx(case["expected"], abs=EPS)


@pytest.mark.parametrize("case", SLICES_CASES, ids=lambda c: c["name"])
def test_focus_offset_is_built_from_focus_slices(case: dict) -> None:
    """The two accessors can only diverge if one re-implements the slicing."""
    token = case["token"]
    if not token:
        return  # no glyph to centre on; focus_offset returns word_x

    f = orp_index(token) if case["f"] is None else case["f"]
    prefix, focus, _suffix = focus_slices(token, f)
    expected = 7.0 + fixture_width(prefix) + fixture_width(focus) / 2
    assert focus_offset(7.0, token, f, fixture_width) == pytest.approx(expected, abs=EPS)


@pytest.mark.parametrize("junk", [None, "", "2", {}, []])
def test_focus_offset_raises_on_a_non_numeric_index(junk: object) -> None:
    """The junk-``f`` asymmetry, pinned so nobody "restores parity" by accident.

    The JS twins coerce a non-finite/non-numeric ``f`` to 0 because their callers
    are untyped; this signature is typed, so a wrong type is a bug to surface.
    Swallowing it here would hide the caller that produced it.
    """
    with pytest.raises(TypeError):
        focus_offset(0.0, "the", junk, fixed_width)  # type: ignore[arg-type]

    with pytest.raises(TypeError):
        focus_slices("the", junk)  # type: ignore[arg-type]


def test_focus_offset_of_a_nan_index_falls_back_to_the_first_glyph() -> None:
    """A float NaN *is* numeric, so it is clamped to 0 rather than raising —
    matching the JS twins' ``Number.isFinite`` guard."""
    assert focus_offset(0.0, "the", float("nan"), fixed_width) == CHAR_W / 2  # type: ignore[arg-type]


def test_focus_offset_never_measures_a_surrogate_half() -> None:
    """The tofu failure mode: half an astral glyph reaching the text measurer.

    Unreachable in Python (``str`` slicing cannot split a code point), asserted
    anyway so the three suites state the same contract.
    """
    seen: list[str] = []

    def spy(text: str) -> float:
        seen.append(text)
        return float(len(text))

    for token in ["a🎬b", "🎬clap", "𝔘𝔫𝔦", "ab🎬cd"]:
        focus_offset(0.0, token, orp_index(token), spy)

    assert seen
    assert not any(_is_surrogate(char) for text in seen for char in text)


# ── line offset ───────────────────────────────────────────────────


@pytest.mark.parametrize("case", LINE_OFFSET_CASES, ids=lambda c: c["name"])
def test_line_offset_at_matches_fixture(case: dict) -> None:
    actual = line_offset_at(
        case["t"],
        case["words"],
        case["focusOffsets"],
        case["pivotPx"],
        case["slideDuration"],
    )
    assert actual == pytest.approx(case["expected"], abs=EPS)


def test_line_offset_at_is_a_pure_function_of_t() -> None:
    """Seeking backwards must land on the same offset as playing forwards did."""
    words = [{"start": 0.0, "end": 0.5}, {"start": 0.5, "end": 1.0}]
    offsets = [10.0, 100.0]
    forwards = [line_offset_at(t / 100, words, offsets, 400.0, 0.1) for t in range(0, 100)]
    backwards = [line_offset_at(t / 100, words, offsets, 400.0, 0.1) for t in range(99, -1, -1)]
    assert backwards == list(reversed(forwards))


def test_line_offset_at_ignores_a_focus_offset_without_a_word() -> None:
    """A ragged pair of inputs must not raise; the shorter list wins."""
    words = [{"start": 0.0, "end": 1.0}]
    assert line_offset_at(5.0, words, [10.0, 999.0], 400.0, 0.1) == 390.0


def test_line_offset_at_with_no_words_returns_the_pivot() -> None:
    assert line_offset_at(1.0, [], [], 400.0, 0.1) == 400.0
