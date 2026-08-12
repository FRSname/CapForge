"""Python half of the Canvas RSVP parity fixture.

``src/renderer/src/lib/__fixtures__/rsvp_canvas_parity.json`` is *generated* from
the Pillow reference (``backend/exporters/rsvp_layout.py``) and *asserted* by
``src/renderer/src/lib/overlayGeometry.rsvp.test.ts``. On its own that is a
one-way pin: if the reference's numbers ever drift, the committed JSON goes stale
and the frontend suite keeps passing green against the old numbers — the exact
failure mode the RSVP fixtures exist to prevent.

This suite closes the loop. It re-derives the payload from the live reference via
the generator's :func:`build_payload` and asserts the committed JSON still
matches, so a Pillow drift fails **here** rather than silently invalidating the
Canvas contract. Both sides now read one file.

The other five RSVP fixtures (``backend/tests/fixtures/rsvp_*_cases.json``) are
hand-written literals read by both languages, so they need no generator check —
see ``backend/tests/test_rsvp_core.py``.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "src" / "renderer" / "src" / "lib" / "__fixtures__"
FIXTURE_PATH = FIXTURE_DIR / "rsvp_canvas_parity.json"
GENERATOR_PATH = FIXTURE_DIR / "gen_rsvp_canvas_parity.py"

#: Provenance/metadata keys, excluded from the value comparison. ``_pillowCommit``
#: is the HEAD at generation time and moves with every commit; comparing it would
#: turn this suite into a "regenerate the fixture on every commit" treadmill and
#: teach the next person to regenerate rather than investigate.
METADATA_PREFIX = "_"

#: Floats are compared exactly: ``json.dumps``/``json.loads`` round-trips a double
#: byte-for-byte, and both sides compute from the same code, so any difference at
#: all is a real drift — not a formatting artefact. A tolerance here would hide
#: precisely the sub-pixel layout change this suite is meant to catch.
FLOAT_ABS_TOL = 0.0


def _load_generator() -> Any:
    """Import the generator by path — it sits under ``src/``, not on a package."""
    spec = importlib.util.spec_from_file_location("gen_rsvp_canvas_parity", GENERATOR_PATH)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise RuntimeError(f"cannot import the fixture generator at {GENERATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def generator() -> Any:
    return _load_generator()


@pytest.fixture(scope="module")
def committed() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def regenerated(generator: Any) -> dict:
    return generator.build_payload()


def _diff(actual: Any, expected: Any, path: str = "") -> list[str]:
    """Structural diff, so a failure names the drifting field, not the whole blob."""
    where = path or "<root>"

    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{where}: expected an object, got {type(actual).__name__}"]
        problems: list[str] = []
        expected_keys = {k for k in expected if not k.startswith(METADATA_PREFIX)}
        actual_keys = {k for k in actual if not k.startswith(METADATA_PREFIX)}
        for missing in sorted(expected_keys - actual_keys):
            problems.append(f"{where}: key {missing!r} missing from the committed fixture")
        for extra in sorted(actual_keys - expected_keys):
            problems.append(f"{where}: committed fixture has stale key {extra!r}")
        for key in sorted(expected_keys & actual_keys):
            problems += _diff(actual[key], expected[key], f"{path}.{key}" if path else key)
        return problems

    if isinstance(expected, list):
        if not isinstance(actual, list):
            return [f"{where}: expected a list, got {type(actual).__name__}"]
        if len(actual) != len(expected):
            return [f"{where}: length {len(actual)} != {len(expected)}"]
        problems = []
        for i, (a, e) in enumerate(zip(actual, expected)):
            problems += _diff(a, e, f"{path}[{i}]")
        return problems

    # bool before (int, float): `True == 1` in Python and would mask a type change.
    if isinstance(expected, bool) or isinstance(actual, bool):
        return [] if actual is expected else [f"{where}: {actual!r} != {expected!r}"]

    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if math.isclose(float(actual), float(expected), rel_tol=0.0, abs_tol=FLOAT_ABS_TOL):
            return []
        return [f"{where}: {actual!r} != {expected!r} (delta {float(actual) - float(expected)!r})"]

    return [] if actual == expected else [f"{where}: {actual!r} != {expected!r}"]


def test_the_generator_and_the_fixture_are_both_present() -> None:
    """A moved fixture must break loudly, not skip this whole suite silently."""
    assert FIXTURE_PATH.is_file(), f"missing {FIXTURE_PATH.relative_to(REPO_ROOT)}"
    assert GENERATOR_PATH.is_file(), f"missing {GENERATOR_PATH.relative_to(REPO_ROOT)}"


def test_committed_fixture_matches_the_live_pillow_reference(
    committed: dict, regenerated: dict, generator: Any
) -> None:
    """The committed JSON is still what ``rsvp_layout`` produces today.

    If this fails, the Pillow reference changed and the fixture is stale. Do **not**
    "fix" it by loosening a comparison: regenerate with the generator's own
    command, review the new numbers, and make sure the Canvas hook still agrees.
    """
    problems = _diff(committed, regenerated)
    assert not problems, (
        f"{FIXTURE_PATH.relative_to(REPO_ROOT)} is stale — the Pillow reference "
        f"(backend/exporters/rsvp_layout.py) no longer produces these numbers.\n"
        f"Regenerate with:\n    {generator.GEN_COMMAND}\n"
        f"...then re-run the Canvas suite (npm test -- overlayGeometry.rsvp).\n\n"
        + "\n".join(f"  - {p}" for p in problems[:40])
    )


def test_the_fixture_still_carries_the_cases_the_canvas_suite_needs(committed: dict) -> None:
    """Mirror of the frontend's own anti-gutting guard (``MIN_PARITY_CASES``).

    A regeneration that quietly dropped cases would keep both suites green while
    covering less, so the census is asserted on both sides.
    """
    assert len(committed["cases"]) >= 14
    assert len(committed["anchorCases"]) >= 2
    # One word per Spritz ORP-table row, punctuation, and a font-size override.
    assert [w["orpIndex"] for w in committed["words"]] == [0, 1, 2, 3, 4, 3]
    assert any(w["widthScale"] != 1 for w in committed["words"])
    trackings = {c["tracking"] for c in committed["cases"]}
    assert 0 in trackings and any(t != 0 for t in trackings)
    assert any("midSlide" in c for c in committed["cases"])


def test_the_fixture_records_that_both_languages_assert_it(committed: dict) -> None:
    """The provenance stamp is the only thing telling a reader this is generated."""
    assert committed["_generatedBy"].endswith("gen_rsvp_canvas_parity.py")
    assert "rsvp_layout" in committed["_reference"]
    asserted_by = committed["_assertedBy"]
    assert "src/renderer/src/lib/overlayGeometry.rsvp.test.ts" in asserted_by
    assert "backend/tests/test_rsvp_canvas_fixture.py" in asserted_by


def test_mid_hold_cases_put_the_focus_glyph_on_the_pivot(committed: dict) -> None:
    """The invariant the whole mode exists for, asserted from the committed values.

    The generator checks this on the numbers it just computed; here it is checked on
    what is actually on disk, so a hand-edited fixture cannot pass.
    """
    holds = [c for c in committed["cases"] if "midSlide" not in c]
    assert len(holds) >= 12
    for case in holds:
        expected = case["expected"]
        assert expected["drawnFocusCenter"] == pytest.approx(expected["pivotPx"], abs=1e-9), (
            f"{case['name']}: focus centre {expected['drawnFocusCenter']} "
            f"is not on the pivot {expected['pivotPx']}"
        )


def test_mid_slide_cases_are_strictly_between_their_targets(committed: dict) -> None:
    """A static-only fixture would pass even with a wrong ease, so pin the eased value."""
    slides = [c for c in committed["cases"] if "midSlide" in c]
    assert slides, "the fixture no longer samples the slide"
    for case in slides:
        mid = case["midSlide"]
        expected = case["expected"]
        index = mid["index"]
        pivot = expected["pivotPx"]
        previous_target = pivot - expected["focusOffsets"][index - 1]
        target = pivot - expected["focusOffsets"][index]

        # 1 - (1 - 0.5)^2 — the shared quadratic ease-out, i.e. GSAP power1.out.
        assert mid["eased"] == pytest.approx(0.75)
        assert expected["lineX"] == pytest.approx(
            previous_target + (target - previous_target) * mid["eased"], abs=1e-9
        )
        assert min(previous_target, target) < expected["lineX"] < max(previous_target, target)
        # ...and the glyph is therefore NOT yet parked on the pivot.
        assert abs(expected["drawnFocusCenter"] - pivot) > 1


def test_anchor_cases_are_not_vacuous(committed: dict) -> None:
    """Each anchor case must be one where the two candidate rules really disagree.

    ``last_started_index`` ("last word with ``start <= t``") vs the decoration modes'
    ``start <= t < end``. If a case stopped disagreeing it would assert nothing.
    """
    for case in committed["anchorCases"]:
        assert case["activeInWindow"] >= 0
        assert case["activeInWindow"] != case["expected"]["anchorIndex"]
