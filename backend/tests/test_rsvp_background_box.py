"""RSVP's background boxes: the group box, and what ``rsvp_context_opacity`` dims.

Split out of ``test_rsvp_render.py`` (whose harness this imports, the same way
that file imports ``test_rsvp_layout``'s) so neither grows past being readable.
What is pinned here:

* the **group background box frames the caption band** — the window the line
  slides inside — for a group narrower than the band as well as a wider one, and
  it stays centred on the band when ``text_offset_x`` moves the row;
* **context dimming reaches the stroke and the per-word boxes**, not only the
  fill, so an outlined context word is not a solid outline around a ghost;
* a **negative ``bg_*_extra``** that inverts the box is skipped rather than
  raising out of ``_draw_rounded_rect`` and failing the whole render job.
"""

from __future__ import annotations

import pytest
from PIL import Image

from backend.exporters.rsvp_layout import caption_band
from backend.tests.test_render_golden import build_group
from backend.tests.test_rsvp_layout import (
    GROUP_START,
    HOLD_OFFSET,
    INK_ALPHA_MIN,
    PIVOT_WORDS,
    ROLE_CONFIG,
    WORD_DUR,
    capture_lines,
    render,
    rsvp_config,
)


# ---------------------------------------------------------------------------
# 1. The group background box frames the caption BAND
# ---------------------------------------------------------------------------
#
# A `min(row_width, band_width)` clamp only ever narrows the box, so a group
# NARROWER than the band used to get a text-sized box centred on `center_x` while
# the line itself is placed by the *pivot* — the caption slid out of its own box.
# `words_per_group` defaults to 3, so that is most groups, not an edge case.

#: A group that is comfortably narrower than the band at the test resolution.
SHORT_WORDS = ["hi", "there"]

#: Box drawn blue, every glyph white, so a pixel's identity is unambiguous.
#: `max_width` is below the default so the padded box still fits inside the frame
#: at `text_offset_x=40` — a box clipped by the frame edge cannot be measured.
BOX_BAND_CONFIG = {
    "max_width": 0.6,
    "bg_opacity": 1.0,
    "bg_color": "#0000FF",
    "text_color": "#FFFFFF",
    "active_word_color": "#FFFFFF",
    "rsvp_focus_color": "#FFFFFF",
    "rsvp_context_opacity": 1.0,
    "rsvp_edge_fade": 0.0,
    "rsvp_reticle": False,
    "shadow_enabled": False,
}


def blue_box_columns(img: Image.Image, row_y: int) -> tuple[int, int]:
    """First/last column of the opaque blue background box on row ``row_y``."""
    px = img.load()
    cols = [x for x in range(img.width)
            if px[x, row_y][2] > 200 and px[x, row_y][0] < 100 and px[x, row_y][3] > 200]
    assert cols, "no background box was drawn"
    return min(cols), max(cols)


def white_ink_columns(img: Image.Image) -> tuple[int, int]:
    """First/last column carrying white glyph ink."""
    px = img.load()
    cols = [x for x in range(img.width) for y in range(img.height)
            if px[x, y][3] > INK_ALPHA_MIN and min(px[x, y][:3]) > 200]
    assert cols, "no glyph ink in the frame"
    return min(cols), max(cols)


@pytest.mark.parametrize("text_offset_x", [0, 40], ids=["no_offset", "offset_40"])
def test_short_group_box_frames_the_band_and_contains_the_text(text_offset_x: int) -> None:
    """A group narrower than the band still gets a band-wide, band-centred box.

    Three claims in one frame, because they share a root cause: the box spans the
    whole band (plus its own padding), it is symmetric about the band — which is
    what `text_offset_x` used to break, moving the text and the fade but not the
    box — and no glyph falls outside it.
    """
    config = rsvp_config(text_offset_x=text_offset_x, **BOX_BAND_CONFIG)
    group = build_group(SHORT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    frame = render(config, group, GROUP_START + WORD_DUR + HOLD_OFFSET)

    band = caption_band(config, config.resolution_w * config.position_x + text_offset_x)
    box_left, box_right = blue_box_columns(frame, int(config.resolution_h * config.position_y))
    pad = config.bg_padding_h  # stroke_width 0, bg_width_extra 0

    # Premise: the group really is narrower than the band, so a text-sized box
    # would be visibly smaller — otherwise this proves nothing.
    row_w = sum(m["width"] for m in _short_group_metrics(config, group))
    assert row_w < band.width

    assert box_left == pytest.approx(band.left - pad, abs=1)
    assert box_right == pytest.approx(band.right + pad, abs=1)
    assert (box_left + box_right) / 2 == pytest.approx(band.left + band.width / 2, abs=1)

    ink_left, ink_right = white_ink_columns(frame)
    assert box_left <= ink_left and ink_right <= box_right, (
        f"glyph ink spans {ink_left}-{ink_right} but the box spans {box_left}-{box_right}: "
        f"the caption is drawn outside its own background box"
    )


def _short_group_metrics(config, group) -> list[dict]:
    """The row's word advances, measured the way ``_render_frame`` does."""
    from backend.exporters.caption_draw import _measure_tracked
    from backend.exporters.video_render import _get_font

    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    return [{"width": _measure_tracked(w["word"], font, config.tracking)}
            for w in group["words"]]


# ---------------------------------------------------------------------------
# 2. Context dimming reaches the STROKE, not just the fill
# ---------------------------------------------------------------------------
#
# `stroke_rgba` is built once at `anim_alpha` by `_draw_word_list`, so passing it
# through undimmed left a context word as a fully opaque outline around a ghost
# fill — the inverse of what `rsvp_context_opacity` means. Captions very commonly
# carry an outline, so this is a default-path defect, not a corner.

#: Cyan, so a stroke pixel is distinguishable from all three ROLE_COLORS.
STROKE_COLOR = "#00FFFF"
STROKE_WIDTH = 4
CONTEXT_OPACITY = 0.25


def max_alpha_where(
    img: Image.Image, x0: int, x1: int, predicate,
    rows: tuple[int, int] | None = None,
) -> int:
    """Highest alpha among pixels in columns ``[x0, x1]`` matching ``predicate``.

    ``rows`` narrows the scan to a row band — needed whenever the thing being
    measured sits *under* the glyphs, since an anti-aliased glyph fringe
    composited over it reads as the same hue at a higher alpha.
    """
    px = img.load()
    y0, y1 = rows if rows is not None else (0, img.height - 1)
    best = 0
    for x in range(max(0, x0), min(img.width, x1 + 1)):
        for y in range(max(0, y0), min(img.height, y1 + 1)):
            r, g, b, a = px[x, y]
            if predicate(r, g, b):
                best = max(best, a)
    return best


def _is_stroke(r: int, g: int, b: int) -> bool:
    return g > 200 and b > 200 and r < 80


def _is_context_fill(r: int, g: int, b: int) -> bool:
    return b > 200 and r < 80 and g < 80        # ROLE_COLORS["context"]


def test_context_stroke_is_dimmed_like_the_context_fill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A context word's outline is dimmed by ``rsvp_context_opacity``; the active
    word's outline is not."""
    config = rsvp_config(stroke_width=STROKE_WIDTH, stroke_color=STROKE_COLOR,
                         rsvp_context_opacity=CONTEXT_OPACITY, bg_opacity=0.0,
                         rsvp_edge_fade=0.0, rsvp_reticle=False,
                         shadow_enabled=False, **ROLE_CONFIG)
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    index = 3
    t = GROUP_START + index * WORD_DUR + HOLD_OFFSET

    frame, calls = capture_lines(monkeypatch, config, group, t)
    line, kwargs = calls[0]
    assert line.anchor_index == index
    positions = line.positions()
    metrics = kwargs["word_metrics"]

    def span(i: int) -> tuple[int, int]:
        return (int(positions[i]) - STROKE_WIDTH,
                int(positions[i] + metrics[i]["width"]) + STROKE_WIDTH)

    expected = int(255 * CONTEXT_OPACITY)
    context_index = index - 1
    ctx_x0, ctx_x1 = span(context_index)
    context_stroke = max_alpha_where(frame, ctx_x0, ctx_x1, _is_stroke)
    context_fill = max_alpha_where(frame, ctx_x0, ctx_x1, _is_context_fill)

    assert context_fill == expected, "the context FILL is not dimmed — bad premise"
    assert context_stroke == expected, (
        f"a context word's stroke is drawn at alpha {context_stroke}, not the dimmed "
        f"{expected}: rsvp_context_opacity dims the fill but not the outline, so the "
        f"word reads as a solid outline around a ghost"
    )
    assert context_stroke == context_fill

    active_x0, active_x1 = span(index)
    assert max_alpha_where(frame, active_x0, active_x1, _is_stroke) == 255, (
        "the ACTIVE word's stroke must stay at full alpha"
    )


#: Distinct from the text colours so the box is readable on its own.
WORD_BOX_COLOR = "#FF00FF"


def test_context_word_background_boxes_are_dimmed_but_the_active_one_is_not(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The per-word boxes follow the same rule as the fill and the stroke.

    Decision recorded here: a *context* word's box is dimmed by
    ``rsvp_context_opacity`` (it belongs to a dimmed word), the **active** word's
    box is left at full strength (it belongs to an undimmed word).
    """
    opacity = 1.0
    config = rsvp_config(bg_opacity=0.0, rsvp_reticle=False, rsvp_edge_fade=0.0,
                         shadow_enabled=False, rsvp_context_opacity=CONTEXT_OPACITY,
                         **ROLE_CONFIG)
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    index = 3
    for word in group["words"]:
        word["overrides"] = {"word_bg_opacity": opacity, "word_bg_color": WORD_BOX_COLOR}
    t = GROUP_START + index * WORD_DUR + HOLD_OFFSET

    frame, calls = capture_lines(monkeypatch, config, group, t)
    line, kwargs = calls[0]
    positions = line.positions()
    metrics = kwargs["word_metrics"]
    text_h = kwargs["bbox"][3] - kwargs["bbox"][1]
    # The box is `pad_v` taller than the glyphs on each side, so this band is
    # box-only: sampling over the glyphs would read an anti-aliased fringe
    # composited over the box, which is a higher alpha than the box's own.
    box_only_rows = (int(kwargs["center_y"] - text_h / 2 - config.bg_padding_v + 2),
                     int(kwargs["center_y"] - text_h / 2 - 3))

    def box_alpha(i: int) -> int:
        cx = int(positions[i] + metrics[i]["width"] / 2)
        return max_alpha_where(frame, cx, cx,
                               lambda r, g, b: r > 200 and b > 200 and g < 80,
                               rows=box_only_rows)

    assert box_alpha(index) == 255, "the active word's box must not be dimmed"
    assert box_alpha(index - 1) == int(255 * CONTEXT_OPACITY), (
        "a context word's background box must be dimmed by rsvp_context_opacity, "
        "the same factor as that word's fill and stroke"
    )


# ---------------------------------------------------------------------------
# 3. A negative bg_*_extra must not kill the render
# ---------------------------------------------------------------------------
#
# `bg_width_extra`/`bg_height_extra` are documented as "can be negative to shrink"
# and are unbounded below, while `bg_padding_*` and `max_width` are only `ge=0` —
# so the box can invert and `_draw_rounded_rect` raises
# `ValueError: x1 must be greater than or equal to x0`, failing the whole job.
# The width case is RSVP-only (the band clamp caps `max_row_w`); the height case
# is pre-existing in BOTH modes and the same guard fixes it.

NEGATIVE_BOX_CASES = {
    "negative_width_extra": {"resolution_w": 1080, "resolution_h": 1920,
                             "max_width": 0.10, "bg_width_extra": -200},
    "negative_height_extra": {"resolution_w": 1080, "resolution_h": 1920,
                              "lines": 3, "bg_height_extra": -120},
}


@pytest.mark.parametrize("mode", ["rsvp", "wrap"])
@pytest.mark.parametrize("case", list(NEGATIVE_BOX_CASES), ids=list(NEGATIVE_BOX_CASES))
@pytest.mark.parametrize("animation", ["none", "pop"])
def test_a_negative_background_extra_renders_instead_of_raising(
    mode: str, case: str, animation: str,
) -> None:
    """An inverted background box is skipped, not fatal — in both branches."""
    config = rsvp_config(reading_mode=mode, animation=animation,
                         bg_opacity=1.0, shadow_enabled=False,
                         **NEGATIVE_BOX_CASES[case])
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 0.05 if animation == "pop" else GROUP_START + 2 * WORD_DUR

    frame = render(config, group, t)
    assert frame.size == (config.resolution_w, config.resolution_h)
    # The words are still drawn: the guard skips the box, not the caption.
    assert frame.getchannel("A").getbbox() is not None


def test_the_background_box_is_still_drawn_when_the_extra_is_survivable() -> None:
    """Control for the guard above: a merely *smaller* box must still appear."""
    config = rsvp_config(bg_opacity=1.0, bg_color="#0000FF", shadow_enabled=False,
                         rsvp_reticle=False, rsvp_edge_fade=0.0, bg_width_extra=-20)
    group = build_group(SHORT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    frame = render(config, group, GROUP_START + WORD_DUR)
    assert blue_box_columns(frame, int(config.resolution_h * config.position_y))