"""Python half of the gradient core contract.

``backend/exporters/gradient.py`` is one of **three** implementations of the same
grammar and gradient-line formula; the twins are
``src/renderer/src/lib/gradient.ts`` (Canvas preview) and
``GRADIENT_RUNTIME_JS`` in ``backend/exporters/hyperframes_gradient_runtime.py``
(HTML/GSAP layer).

All three suites read the **same fixture**,
``backend/tests/fixtures/gradient_cases.json`` — so a grammar rule or an angle
convention that changes in one language and not the others fails loudly on the
sides that did not change. Never hand-write an expected value here; add it to
the fixture instead.

Twins of this module:

* ``src/renderer/src/lib/gradient.test.ts`` (TS core)
* ``src/renderer/src/lib/gradient.embedded.test.ts`` (the embedded HTML-layer JS)

Pure logic — no PIL, no fonts, no I/O beyond reading the fixture.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.exporters.gradient import (
    GRADIENT_PREFIX,
    MAX_GRADIENT_LENGTH,
    MAX_STOPS,
    MIN_STOPS,
    flat_color,
    flat_hex,
    gradient_line,
    parse_gradient,
    to_css,
)

FIXTURES = Path(__file__).parent / "fixtures"

CASES: dict = json.loads(
    (FIXTURES / "gradient_cases.json").read_text(encoding="utf-8")
)

CLOSE_DIGITS: int = CASES["closeDigits"]

#: Sentinel for "``flat_hex`` should reject this". The fixture spells rejection
#: as ``null`` because it is shared with JS; the fallback proves the branch ran.
_REJECTED = "<<fallback>>"


@pytest.mark.parametrize("case", CASES["parse"], ids=lambda c: c["input"][:60] or "<empty>")
def test_parse_matches_fixture(case: dict) -> None:
    spec = parse_gradient(case["input"])
    expected = case["expected"]

    if expected is None:
        assert spec is None, case["note"]
        return

    assert spec is not None, case["note"]
    assert spec.angle == pytest.approx(expected["angle"]), case["note"]
    assert [[s.offset, s.color] for s in spec.stops] == [
        [offset, color] for offset, color in expected["stops"]
    ], case["note"]


def test_parse_rejects_an_over_long_string() -> None:
    """Bounded before stop-count, so an untrusted preset cannot ask for work."""
    max_length = CASES["parseLongInput"]["maxLength"]
    assert MAX_GRADIENT_LENGTH == max_length

    padding = "#FF0000 0%, " * 60
    over_long = f"{GRADIENT_PREFIX}90deg, {padding}#00FF00 100%)"
    assert len(over_long) > max_length
    assert parse_gradient(over_long) is None


def test_parse_rejects_non_strings() -> None:
    """A ``.cfproj`` or an MCP patch can carry any JSON type into this field."""
    for value in (None, 42, 1.5, True, ["#FFFFFF"], {"color": "#FFFFFF"}):
        assert parse_gradient(value) is None


def test_stop_bounds_are_the_shared_ones() -> None:
    assert (MIN_STOPS, MAX_STOPS) == (2, 8)


@pytest.mark.parametrize(
    "case", CASES["line"], ids=lambda c: f"{c['angle']}deg-{c['box'][2]}x{c['box'][3]}"
)
def test_gradient_line_matches_fixture(case: dict) -> None:
    spec = parse_gradient(
        f"linear-gradient({case['angle']}deg, #FF0000 0%, #00FF00 100%)"
    )
    assert spec is not None
    x0, y0, x1, y1 = gradient_line(spec, tuple(case["box"]))
    for got, want, axis in zip(
        (x0, y0, x1, y1), case["expected"], ("x0", "y0", "x1", "y1")
    ):
        assert got == pytest.approx(want, abs=10**-CLOSE_DIGITS), (
            f"{axis}: {case['note']}"
        )


@pytest.mark.parametrize("case", CASES["toCss"], ids=lambda c: c["input"][:60])
def test_to_css_matches_fixture(case: dict) -> None:
    spec = parse_gradient(case["input"])
    assert spec is not None, case["note"]
    assert to_css(spec) == case["expected"], case["note"]


@pytest.mark.parametrize("case", CASES["toCss"], ids=lambda c: c["input"][:60])
def test_to_css_output_reparses_to_the_same_spec(case: dict) -> None:
    """The canonical form is inside the grammar — the guard is not one-way."""
    spec = parse_gradient(case["input"])
    assert spec is not None
    assert parse_gradient(to_css(spec)) == spec


@pytest.mark.parametrize("case", CASES["flatHex"], ids=lambda c: c["input"][:60] or "<empty>")
def test_flat_hex_matches_fixture(case: dict) -> None:
    got = flat_hex(case["input"], _REJECTED)
    if case["expected"] is None:
        assert got == _REJECTED, case["note"]
    else:
        assert got == case["expected"], case["note"]


def test_flat_hex_rejects_non_strings() -> None:
    for value in (None, 42, True, ["#FFFFFF"], {"color": "#FFFFFF"}):
        assert flat_hex(value, _REJECTED) == _REJECTED


@pytest.mark.parametrize("case", CASES["flatColor"], ids=lambda c: c["input"][:60] or "<empty>")
def test_flat_color_matches_fixture(case: dict) -> None:
    got = flat_color(case["input"], _REJECTED)
    if case["expected"] is None:
        assert got == _REJECTED, case["note"]
    else:
        assert got == case["expected"], case["note"]


def test_flat_color_rejects_non_strings() -> None:
    for value in (None, 42, True, ["#FFFFFF"], {"color": "#FFFFFF"}):
        assert flat_color(value, _REJECTED) == _REJECTED
