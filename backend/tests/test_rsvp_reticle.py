"""The RSVP pivot reticle: off, unfaded, and drawn at exactly its EM size.

Split out of ``test_rsvp_render.py`` (whose harness this imports, the same way
that file imports ``test_rsvp_layout``'s) so neither grows past being readable.
What is pinned here:

* ``rsvp_reticle=False`` is a **clean no-op**, and on it draws in the focus colour;
* the reticle is **exempt from the edge fade** — it is a fixed guide, not text
  sliding inside the band, so a focus column inside the fade ramp (legal:
  ``rsvp_pivot_x`` is ``ge=0.0``) must not dim the guide that marks it;
* its **drawn** size is its ``*_EM`` formula, not one pixel more —
  ``ImageDraw.rectangle`` includes both endpoints while Canvas ``fillRect`` and a
  CSS box do not, and Phase 4 will be written from those constants.
"""

from __future__ import annotations

import math

import pytest
from PIL import Image, ImageDraw

from backend.exporters.rsvp_layout import (
    RETICLE_GAP_EM,
    RETICLE_NOTCH_LEN_EM,
    RETICLE_RULE_LEN_EM,
    RETICLE_THICKNESS_EM,
    caption_band,
    draw_reticle,
)
from backend.tests.test_render_golden import build_group, diff_stats
from backend.tests.test_rsvp_layout import (
    GROUP_START,
    HOLD_OFFSET,
    PIVOT_WORDS,
    ROLE_CONFIG,
    WORD_DUR,
    capture_lines,
    pivot_of,
    render,
    role_counts,
    rsvp_config,
)


# ---------------------------------------------------------------------------
# 1. Reticle — a clean no-op when off
# ---------------------------------------------------------------------------


def reticle_rule_rows(center_y: float, text_h: float) -> list[tuple[int, int]]:
    """The row spans of the two reticle rules, re-derived from the ``*_EM`` constants."""
    thickness = max(1.0, text_h * RETICLE_THICKNESS_EM)
    gap = text_h * RETICLE_GAP_EM
    top = center_y - text_h / 2 - gap
    bottom = center_y + text_h / 2 + gap
    return [
        (math.ceil(top - thickness), math.floor(top)),
        (math.ceil(bottom), math.floor(bottom + thickness)),
    ]


def reticle_rule_columns(pivot_px: float, text_h: float) -> tuple[int, int]:
    half_len = text_h * RETICLE_RULE_LEN_EM / 2
    return math.ceil(pivot_px - half_len), math.floor(pivot_px + half_len)


def test_reticle_off_leaves_no_pixels_where_it_would_be(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``rsvp_reticle=False`` is a clean no-op, and on it draws in the focus colour."""
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET
    base = dict(bg_opacity=0.0, **ROLE_CONFIG)

    on, calls = capture_lines(monkeypatch, rsvp_config(**base), group, t)
    off = render(rsvp_config(rsvp_reticle=False, **base), group, t)
    _, kwargs = calls[0]
    text_h = kwargs["bbox"][3] - kwargs["bbox"][1]
    pivot = pivot_of(rsvp_config(**base), kwargs)
    x0, x1 = reticle_rule_columns(pivot, text_h)

    for y0, y1 in reticle_rule_rows(kwargs["center_y"], text_h):
        box = (x0, y0, x1 + 1, y1 + 1)
        assert off.crop(box).getchannel("A").getextrema() == (0, 0), (
            f"reticle-off frame has ink in the rule band {box}"
        )
        rule = on.crop(box)
        assert rule.getchannel("A").getextrema()[1] == 255, "reticle not drawn"
        counts = role_counts(rule)
        assert counts["focus"] > 0, "reticle is not in the focus colour"
        assert counts["active"] == 0 and counts["context"] == 0

    # Nothing else moved: the text band is identical with the reticle on and off.
    text_band = (0, math.ceil(kwargs["center_y"] - text_h / 2),
                 on.width, math.floor(kwargs["center_y"] + text_h / 2))
    _, max_diff = diff_stats(on.crop(text_band), off.crop(text_band))
    assert max_diff == 0


# ---------------------------------------------------------------------------
# 2. The reticle is exempt from the edge fade
# ---------------------------------------------------------------------------
#
# `rsvp_pivot_x` is `ge=0.0`, so a focus column inside the fade ramp is legal and
# reachable from the UI slider. The text dimming there is correct (the band is a
# window) and deliberately NOT clamped; the reticle is a fixed GUIDE, so it must
# stay crisp — otherwise the one glyph the mode exists to point at is marked by an
# invisible reticle (measured: reticle alpha 76 at pivot 0.0 with the 12 % fade).

PIVOT_INSIDE_FADE = 0.0


def test_the_reticle_is_not_dimmed_by_the_edge_fade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = dict(rsvp_pivot_x=PIVOT_INSIDE_FADE, bg_opacity=0.0,
                  shadow_enabled=False, **ROLE_CONFIG)
    faded = rsvp_config(**config)
    unfaded = rsvp_config(rsvp_edge_fade=0.0, **config)
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET

    on, calls = capture_lines(monkeypatch, faded, group, t)
    off = render(unfaded, group, t)
    _, kwargs = calls[0]
    text_h = kwargs["bbox"][3] - kwargs["bbox"][1]
    pivot = pivot_of(faded, kwargs)
    band = caption_band(faded, kwargs["center_x"])
    x0, x1 = reticle_rule_columns(pivot, text_h)

    # Premise: this pivot really is inside the ramp, and the fade really is doing
    # something to the frame at large.
    assert pivot < band.left + band.width * faded.rsvp_edge_fade
    assert diff_stats(on, off)[1] > 0

    for y0, y1 in reticle_rule_rows(kwargs["center_y"], text_h):
        box = (max(0, x0), y0, x1 + 1, y1 + 1)
        assert on.crop(box).getchannel("A").getextrema()[1] == 255, (
            f"the reticle rule in {box} is dimmed by the edge fade: the pivot guide "
            f"must not fade with the text"
        )
        assert diff_stats(on.crop(box), off.crop(box))[1] == 0, (
            "the reticle differs between fade-on and fade-off, so it is being masked"
        )


# ---------------------------------------------------------------------------
# 3. The reticle's drawn size IS its EM formula
# ---------------------------------------------------------------------------
#
# `ImageDraw.rectangle` includes BOTH endpoints; Canvas `fillRect(x, y, w, h)` and
# a CSS box are exclusive at the far edge. Drawn verbatim, every reticle box came
# out 1 px wider and 1 px taller than the constants say — which Phase 4, written
# from those constants, would then be flagged for by the parity suite.

RETICLE_PROBE_PIVOT = 200.0
RETICLE_PROBE_CENTER_Y = 200.0


def draw_reticle_probe(text_h: float) -> Image.Image:
    """The reticle alone, on its own surface, at a known pivot."""
    layer = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
    draw_reticle(ImageDraw.Draw(layer), pivot_px=RETICLE_PROBE_PIVOT,
                 center_y=RETICLE_PROBE_CENTER_Y, text_h=text_h,
                 color=(255, 0, 0, 255))
    return layer


def inked_rows(layer: Image.Image, x: int) -> list[int]:
    alpha = layer.getchannel("A")
    return [y for y in range(layer.height) if alpha.getpixel((x, y)) > 0]


def test_reticle_thickness_floored_at_one_px_draws_exactly_one_px() -> None:
    """The headline off-by-one: ``max(1.0, …)`` must mean one pixel, not two.

    ``text_h`` 9 puts the EM thickness at 0.495, so the floor applies exactly.
    """
    text_h = 9.0
    assert max(1.0, text_h * RETICLE_THICKNESS_EM) == 1.0, "text_h no longer hits the floor"

    layer = draw_reticle_probe(text_h)
    # A column at the far end of the rule, clear of the notch.
    probe_x = int(RETICLE_PROBE_PIVOT + text_h * RETICLE_RULE_LEN_EM / 2) - 1
    rows = inked_rows(layer, probe_x)
    assert len(rows) == 2, "expected exactly the two rules at this column"
    assert rows[1] - rows[0] > text_h, "the two rows are not the upper/lower rule"


def test_reticle_drawn_size_matches_the_em_formula() -> None:
    """At ``text_h`` 60 every constant lands on a whole pixel count, so the drawn
    geometry can be compared to the formula exactly rather than within a pixel."""
    text_h = 60.0
    thickness = text_h * RETICLE_THICKNESS_EM      # 3.3
    rule_len = text_h * RETICLE_RULE_LEN_EM        # 66.0
    notch = text_h * RETICLE_NOTCH_LEN_EM          # 12.0
    assert rule_len == 66.0 and notch == 12.0, "constants changed; update this case"

    layer = draw_reticle_probe(text_h)
    columns = [x for x in range(layer.width)
               if layer.getchannel("A").crop((x, 0, x + 1, layer.height)).getextrema()[1] > 0]
    assert max(columns) - min(columns) + 1 == int(rule_len), (
        f"the rule is {max(columns) - min(columns) + 1} px wide, but "
        f"RETICLE_RULE_LEN_EM says {rule_len:g}"
    )

    probe_x = int(RETICLE_PROBE_PIVOT + rule_len / 2) - 1
    rule_rows = inked_rows(layer, probe_x)
    assert len(rule_rows) == 2 * int(thickness), (
        f"each rule is {len(rule_rows) / 2:g} px thick, but RETICLE_THICKNESS_EM says "
        f"{thickness:g}"
    )

    # Rule and notch are contiguous — no overlap, no seam — and the notch is its
    # own EM length. Together they are the total ink at the pivot column.
    pivot_rows = inked_rows(layer, int(RETICLE_PROBE_PIVOT))
    upper = [y for y in pivot_rows if y < RETICLE_PROBE_CENTER_Y]
    assert len(upper) == int(thickness) + int(notch)
    assert upper == list(range(upper[0], upper[0] + len(upper))), "rule/notch not contiguous"
