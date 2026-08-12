"""The RSVP geometry contract: the caption band, the pivot invariant, immutability.

The scalar core (ORP table, code-point slicing, the eased line offset) is pinned
across all three languages by the JSON fixtures that ``test_rsvp_core.py`` reads.
This module pins the *renderer* half, which those fixtures cannot reach:

* **The pivot invariant, numerically** — the active word's focus glyph centre
  lands on the pivot column. Derived from ``caption_band()`` + ``layout_line()``
  and an independent re-walk of ``_draw_single_word``'s pen, never from a
  screenshot, and re-checked at the pixel level on a real frame.
* **The caption band vs the reference clip** — the band definition
  (``resolution_w * max_width`` centred on the row anchor) must reproduce the
  measurements in ``docs/plans/rsvp-speed-reading-mode.md``.
* **Presentation-only** — RSVP never mutates the word metrics it is handed
  (CLAUDE.md → Word-timing locality).

The *rendered-behaviour* half — the edge fade, the reticle, the silence-gap colour
hold, ``lines``/``alignment`` — lives in ``test_rsvp_render.py``, which imports
this module's harness. Neither file replaces ``test_render_golden.py``'s
``rsvp_mid_word`` / ``rsvp_mid_slide`` goldens: the goldens pin whole frames,
these pin the specific claims ``rsvp_layout``'s module docstring makes, so a
golden regenerated for an unrelated reason cannot quietly bless a broken pivot.
"""

from __future__ import annotations

import copy
from pathlib import Path

import pytest
from PIL import Image, ImageFont

from backend.exporters import rsvp_layout, video_render
from backend.exporters.caption_draw import _measure_tracked
from backend.exporters.rsvp import focus_slices, orp_index
from backend.exporters.rsvp_layout import RsvpLine, caption_band, layout_line
from backend.exporters.video_render import _get_font, _render_frame
from backend.models.schemas import VideoRenderConfig
from backend.tests.test_render_golden import (
    FONT_PATH,
    RSVP_CONFIG,
    build_config,
    build_group,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

#: A second bundled font for the per-word font-override case. The override
#: carries a ``custom_font_path``, which ``_get_font`` prefers over the family
#: name — so the case is deterministic and never touches system font lookup.
OVERRIDE_FONT_PATH = REPO_ROOT / "Fonts" / "Minecraft.ttf"

#: Tolerance for the pivot invariant. The invariant is exact arithmetic, so this
#: is float residue only — "sub-pixel" by three orders of magnitude. A tracking
#: gap dropped at the layout site lands one whole ``tracking`` off and is caught
#: with room to spare. (Which glyph is *chosen* is not pinned here: this file
#: reads ``orp_index`` too, so the ORP rule itself stays pinned where it belongs —
#: the cross-language fixtures in ``test_rsvp_core.py`` — plus the goldens.)
SUBPIXEL_EPS = 1e-6

#: Non-zero letter tracking, in px — the case that exercises ``_tracking_gap``.
#: (``tracking`` here is the frontend's ``letterTracking``.)
TRACKING_PX = 7.0

#: Alpha floor for "this pixel is part of a drawn glyph". Context words are drawn
#: at ``rsvp_context_opacity`` (0.75 → alpha 191), so the floor has to sit below
#: that while still excluding anti-aliased fringes.
INK_ALPHA_MIN = 150

#: Mutually distinct primaries so a pixel's *role* is readable from its dominant
#: channel: focus glyph / rest of the active word / context words.
ROLE_COLORS = {
    "focus": "#FF0000",
    "active": "#00FF00",
    "context": "#0000FF",
}
ROLE_CONFIG = {
    "rsvp_focus_color": ROLE_COLORS["focus"],
    "active_word_color": ROLE_COLORS["active"],
    "text_color": ROLE_COLORS["context"],
}


# ---------------------------------------------------------------------------
# Harness — shared with test_rsvp_render.py, which imports it from here (the same
# way test_render_dedup.py imports test_render_golden's builders).
# ---------------------------------------------------------------------------


def rsvp_config(**overrides) -> VideoRenderConfig:
    """``build_config`` with the goldens' RSVP block applied, then overrides."""
    return build_config(**{**RSVP_CONFIG, **overrides})


def render(config: VideoRenderConfig, group: dict, t: float) -> Image.Image:
    """Render one frame through the real ``_render_frame``."""
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    assert isinstance(font, ImageFont.FreeTypeFont), "custom font failed to load"
    return _render_frame(config, font, group, t)


def capture_lines(
    monkeypatch: pytest.MonkeyPatch,
    config: VideoRenderConfig,
    group: dict,
    t: float,
) -> tuple[Image.Image, list[tuple[RsvpLine, dict]]]:
    """Render a real frame, returning it plus one entry per ``draw_line`` call.

    Spying on ``rsvp_layout.draw_line`` (rather than rebuilding ``word_metrics``
    by hand) means the numbers under test are the ones the renderer actually used:
    real per-word widths, the real row centre, the real font cache. One call per
    drawn row, so the call count also witnesses "RSVP draws exactly one row".
    """
    calls: list[tuple[RsvpLine, dict]] = []
    real = rsvp_layout.draw_line

    def spy(draw, **kwargs):
        line = real(draw, **kwargs)
        calls.append((line, kwargs))
        return line

    monkeypatch.setattr(video_render.rsvp_layout, "draw_line", spy)
    frame = render(config, group, t)
    return frame, calls


def pivot_of(config: VideoRenderConfig, kwargs: dict) -> float:
    """The pivot column of the row ``draw_line`` was called for."""
    return caption_band(config, kwargs["center_x"]).pivot(config.rsvp_pivot_x)


def word_font(config: VideoRenderConfig, overrides: dict | None) -> ImageFont.FreeTypeFont:
    """Resolve a word's font the way ``_resolve_scaled_font`` does."""
    ov = overrides or {}
    scale = float(ov.get("font_size_scale", 1.0))
    bold = bool(ov["bold"]) if "bold" in ov else config.bold
    family = ov.get("font_family") or config.font_family
    if scale == 1.0 and bold == config.bold and family == config.font_family:
        return _get_font(config.font_family, config.font_size,
                         config.custom_font_path, bold=config.bold)
    return _get_font(family, round(config.font_size * scale),
                     ov.get("custom_font_path") or config.custom_font_path, bold)


def drawn_focus_center(
    token: str, x: float, font: ImageFont.FreeTypeFont, tracking: float,
) -> float:
    """Where the focus glyph's centre actually lands when the word is drawn.

    Re-derived from ``_draw_single_word``'s **pen walk** — ``tracking`` after
    every character it draws — and deliberately NOT from ``_measure_tracked`` /
    ``_tracking_gap``, which count ``n - 1`` gaps. That is the whole point: if the
    layout ever drops the one missing gap, this number and the pivot part company
    by exactly ``tracking``.
    """
    pieces = focus_slices(token, orp_index(token))
    if tracking == 0:
        pen = x + font.getlength(pieces.prefix)  # one shaped draw.text call
    else:
        pen = x + sum(font.getlength(ch) + tracking for ch in pieces.prefix)
    return pen + font.getlength(pieces.focus) / 2


def _role_of(r: int, g: int, b: int) -> str | None:
    """Which ``ROLE_COLORS`` primary dominates this pixel, if any."""
    if r > 2 * max(g, b):
        return "focus"
    if g > 2 * max(r, b):
        return "active"
    if b > 2 * max(r, g):
        return "context"
    return None


def _inked_pixels(img: Image.Image):
    """Yield ``(index, role)`` for every inked pixel of a known role."""
    data = img.convert("RGBA").tobytes()
    for i, (r, g, b, a) in enumerate(zip(data[0::4], data[1::4], data[2::4], data[3::4])):
        if a < INK_ALPHA_MIN:
            continue
        role = _role_of(r, g, b)
        if role is not None:
            yield i, role


def role_counts(img: Image.Image) -> dict[str, int]:
    """Count inked pixels by role, using the ``ROLE_COLORS`` primaries.

    Consumed by ``test_rsvp_render.py``; it lives here beside ``role_bbox`` so the
    two readers of ``_inked_pixels`` stay together.
    """
    counts = {"focus": 0, "active": 0, "context": 0}
    for _, role in _inked_pixels(img):
        counts[role] += 1
    return counts


def role_bbox(img: Image.Image, role: str) -> tuple[int, int, int, int]:
    """Ink bounding box of one role's pixels (see ``role_counts``)."""
    x0, y0, x1, y1 = img.width, img.height, -1, -1
    for i, pixel_role in _inked_pixels(img):
        if pixel_role != role:
            continue
        x, y = i % img.width, i // img.width
        x0, y0 = min(x0, x), min(y0, y)
        x1, y1 = max(x1, x), max(y1, y)
    assert x1 >= 0, f"no {role} pixels in frame"
    return x0, y0, x1, y1


# ---------------------------------------------------------------------------
# 1. The caption band vs the reference clip
# ---------------------------------------------------------------------------

# Ground truth measured off the reference clip — see the "Measurements taken from
# the reference clip (do not re-derive; these are ground truth)" table in
# docs/plans/rsvp-speed-reading-mode.md. The clip is 1320x2868.
REF_FRAME_W = 1320
REF_MAX_WIDTH = 0.9
REF_POSITION_X = 0.5
REF_BAND_LEFT = 66            # measured band ≈ x 66 → 1260
REF_BAND_RIGHT_MEASURED = 1260
REF_PIVOT_MEASURED = 479      # stable ±2 px across all 156 sampled frames
REF_PIVOT_TOLERANCE = 2
REF_PIVOT_OFFSET_IN_BAND = REF_PIVOT_MEASURED - REF_BAND_LEFT  # the plan's 413

#: The band's own definition: `resolution_w * max_width`, centred on the anchor.
EXPECTED_BAND_WIDTH = REF_FRAME_W * REF_MAX_WIDTH          # 1188
EXPECTED_BAND_RIGHT = REF_BAND_LEFT + EXPECTED_BAND_WIDTH  # 1254

#: How far the computed pivot may sit from the measured one. The measured value
#: is 479 ±2 (i.e. 477-481) and the default dial puts it at 481.8, so this is
#: deliberately 1 px wider than the measurement's own error bar: see
#: ``test_default_pivot_fraction_is_the_measurement_rounded`` for why the residue
#: is the *dial's* rounding (35 % vs the measured 34.76 %), not the band.
REF_PIVOT_SLACK_PX = 3


def reference_band_config(**overrides) -> VideoRenderConfig:
    return rsvp_config(resolution_w=REF_FRAME_W, resolution_h=2868,
                       max_width=REF_MAX_WIDTH, position_x=REF_POSITION_X,
                       rsvp_pivot_x=0.35, **overrides)


def test_caption_band_matches_the_reference_clip() -> None:
    """The band is the wrap path's usable caption width, centred on the anchor."""
    config = reference_band_config()
    row_center_x = config.resolution_w * config.position_x  # no align slack, no offset
    band = caption_band(config, row_center_x)

    assert band.width == pytest.approx(EXPECTED_BAND_WIDTH)
    assert band.left == pytest.approx(REF_BAND_LEFT)
    assert band.right == pytest.approx(EXPECTED_BAND_RIGHT)
    # The measured right edge is 1260: 6 px wider than the definition gives. The
    # clip's band edge is where a *faded* line vanishes, so it has no hard pixel;
    # the left edge, which the fade also touches, matched to the pixel.
    assert band.right < REF_BAND_RIGHT_MEASURED


def test_default_pivot_at_reference_resolution() -> None:
    """``rsvp_pivot_x`` 0.35 reproduces the clip's measured pivot column."""
    config = reference_band_config()
    band = caption_band(config, config.resolution_w * config.position_x)
    pivot = band.pivot(config.rsvp_pivot_x)

    assert pivot == pytest.approx(481.8)
    assert abs(pivot - REF_PIVOT_MEASURED) <= REF_PIVOT_SLACK_PX


def test_default_pivot_fraction_is_the_measurement_rounded() -> None:
    """The ~2.8 px residue is the dial's rounding, not the band's definition.

    Feeding the band the *measured* pivot offset as a fraction lands exactly on
    the measured column, and that fraction rounds to the schema default of 0.35 —
    so 0.35 is the correctly-rounded reading of the measurement under this band,
    and there is nothing to "fix" with a second width concept.
    """
    config = reference_band_config()
    band = caption_band(config, config.resolution_w * config.position_x)

    measured_fraction = REF_PIVOT_OFFSET_IN_BAND / band.width  # 413 / 1188
    assert band.pivot(measured_fraction) == pytest.approx(REF_PIVOT_MEASURED)
    assert round(measured_fraction, 2) == 0.35
    assert VideoRenderConfig.model_fields["rsvp_pivot_x"].default == 0.35


def test_caption_band_follows_the_row_anchor() -> None:
    """The band rides ``row_center_x``, so position/alignment move it as one."""
    config = reference_band_config()
    base = caption_band(config, 660.0)
    shifted = caption_band(config, 660.0 + 120)
    assert shifted.width == base.width
    assert shifted.left == pytest.approx(base.left + 120)
    assert shifted.pivot(0.35) == pytest.approx(base.pivot(0.35) + 120)


# ---------------------------------------------------------------------------
# 2. The pivot invariant, numerically
# ---------------------------------------------------------------------------

# One word per row of the Spritz ORP table plus the two hard cases: trailing
# punctuation (counted in the token length) and a per-word font override.
#   "I"                1 char  → focus index 0
#   "rapid"            5       → 1
#   "saccades,"        9       → 2   (punctuation counts)
#   "eliminates"      10       → 3
#   "extraordinarily" 15       → 4   (the table's top row)
#   "overridden"      10       → 3   (drawn in its own, larger font)
PIVOT_WORDS = ["I", "rapid", "saccades,", "eliminates", "extraordinarily", "overridden"]
PIVOT_OVERRIDE_INDEX = 5
PIVOT_OVERRIDES = {
    "font_family": "Minecraft",
    "custom_font_path": str(OVERRIDE_FONT_PATH),
    "font_size_scale": 1.3,
}
WORD_DUR = 0.5
GROUP_START = 1.0
#: Long enough after a word's start that the 60 ms slide has finished.
HOLD_OFFSET = 0.3


def pivot_group() -> dict:
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    group["words"][PIVOT_OVERRIDE_INDEX]["overrides"] = dict(PIVOT_OVERRIDES)
    return group


def test_orp_indices_of_the_pivot_words_cover_the_table() -> None:
    """Coverage guard on the sweep's INPUTS, not a second copy of the ORP rule.

    (The rule is pinned by the cross-language fixtures in ``test_rsvp_core.py``.)
    If someone shortens a word here, the sweep below silently stops covering a
    table row — this fails instead.
    """
    assert [orp_index(w) for w in PIVOT_WORDS] == [0, 1, 2, 3, 4, 3]


@pytest.mark.parametrize("tracking", [0, TRACKING_PX], ids=["tracking0", "tracking7"])
@pytest.mark.parametrize("index", range(len(PIVOT_WORDS)))
def test_focus_glyph_centre_lands_on_the_pivot(
    monkeypatch: pytest.MonkeyPatch, index: int, tracking: float,
) -> None:
    """Mid-hold, the active word's focus glyph centre IS the pivot column.

    The core claim of the feature. Checked against a pen walk re-derived from the
    draw primitive, for every ORP-table row, with trailing punctuation, and for a
    word carrying ``font_family``/``font_size_scale`` overrides — the docstring
    claims that word's focus glyph still lands on the pivot, and it does: the
    line's translation is solved from *that* word's own measurement, so the
    (pre-existing) base-font width asymmetry only moves the words after it.
    """
    config = rsvp_config(tracking=tracking)
    group = pivot_group()
    t = GROUP_START + index * WORD_DUR + HOLD_OFFSET

    _, calls = capture_lines(monkeypatch, config, group, t)
    assert len(calls) == 1
    line, kwargs = calls[0]
    assert line.anchor_index == index

    token = PIVOT_WORDS[index]
    font = word_font(config, group["words"][index].get("overrides"))
    center = drawn_focus_center(token, line.positions()[index], font, tracking)
    assert center == pytest.approx(pivot_of(config, kwargs), abs=SUBPIXEL_EPS)


@pytest.mark.parametrize("tracking", [0, TRACKING_PX], ids=["tracking0", "tracking7"])
def test_tracked_prefix_is_one_gap_short_of_the_drawn_pen(tracking: float) -> None:
    """The premise of ``_tracking_gap``: n-1 gaps measured, n gaps drawn.

    Without this, the invariant test above could pass against an implementation
    where BOTH the layout and the draw dropped the gap — this pins that the two
    conventions really do differ, so the gap has to exist somewhere.
    """
    font = _get_font("Caviar Dreams", 36, str(FONT_PATH), bold=False)
    prefix = "eli"
    measured = _measure_tracked(prefix, font, tracking)
    drawn = sum(font.getlength(ch) + tracking for ch in prefix) if tracking else \
        font.getlength(prefix)
    assert drawn - measured == pytest.approx(tracking)


@pytest.mark.parametrize("tracking", [0, TRACKING_PX], ids=["tracking0", "tracking7"])
def test_mid_slide_offset_is_eased_between_the_two_targets(
    monkeypatch: pytest.MonkeyPatch, tracking: float,
) -> None:
    """Mid-slide the line sits strictly between the neighbouring targets.

    And exactly on the shared quadratic ease-out (GSAP ``power1.out``): a
    ``power2`` swap, a linear tween or a wrong ``slide_duration`` all break this.
    """
    config = rsvp_config(tracking=tracking)
    group = pivot_group()
    index = 3
    start = group["words"][index]["start"]
    slide = config.rsvp_slide_duration
    t = start + slide / 2  # strictly inside the slide

    _, calls = capture_lines(monkeypatch, config, group, t)
    line, kwargs = calls[0]
    pivot = pivot_of(config, kwargs)
    previous_target = pivot - line.focus_offsets[index - 1]
    target = pivot - line.focus_offsets[index]

    p = (t - start) / slide
    eased = 1 - (1 - p) ** 2
    assert eased == pytest.approx(0.75)
    assert line.line_x == pytest.approx(
        previous_target + (target - previous_target) * eased, abs=SUBPIXEL_EPS,
    )
    assert min(previous_target, target) < line.line_x < max(previous_target, target)

    # ...and the focus glyph is therefore NOT yet on the pivot.
    font = word_font(config, group["words"][index].get("overrides"))
    center = drawn_focus_center(PIVOT_WORDS[index], line.positions()[index], font, tracking)
    assert abs(center - pivot) > 1.0


#: How far the focus glyph's *ink* centre may sit from the pivot column. A glyph's
#: ink box is not its advance box (side bearings), which is also why the reference
#: clip's tracked pivot (479) sits a couple of px off the computed advance centre.
#: A whole-glyph error — the bug class here — is roughly half a font size.
INK_CENTRE_SLACK_PX = 0.15 * 36  # ≈ 5 px at font_size 36


def focus_ink_centre(monkeypatch: pytest.MonkeyPatch, tracking: float) -> tuple[float, float]:
    """``(focus ink centre, pivot)`` from a real frame at word 3's mid-hold."""
    config = rsvp_config(bg_opacity=0.0, rsvp_reticle=False, tracking=tracking, **ROLE_CONFIG)
    index = 3
    t = GROUP_START + index * WORD_DUR + HOLD_OFFSET
    frame, calls = capture_lines(monkeypatch, config, pivot_group(), t)
    x0, _, x1, _ = role_bbox(frame, "focus")
    return (x0 + x1) / 2, pivot_of(config, calls[0][1])


@pytest.mark.parametrize("tracking", [0, TRACKING_PX], ids=["tracking0", "tracking7"])
def test_focus_glyph_ink_is_centred_on_the_pivot_in_a_real_frame(
    monkeypatch: pytest.MonkeyPatch, tracking: float,
) -> None:
    """The same invariant, read back off the pixels — draw_line draws where layout says."""
    centre, pivot = focus_ink_centre(monkeypatch, tracking)
    assert centre == pytest.approx(pivot, abs=INK_CENTRE_SLACK_PX)


def test_focus_glyph_ink_does_not_move_when_tracking_is_added(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Letter tracking must not budge the focus glyph: the pivot is unchanged by it.

    The strict version of the invariant. Absolute-tolerance checks have to allow
    for side bearings, but the *same* glyph in the *same* font has the same
    bearings at any tracking — so its ink centre must land on the same column.
    This is what catches a tracking gap dropped at the **draw** site (the pen walk
    in ``_draw_active_word``): the layout would still solve to the pivot while the
    ink landed one ``tracking`` away, and every advance-width assertion would agree
    with the bug.
    """
    plain, plain_pivot = focus_ink_centre(monkeypatch, 0)
    tracked, tracked_pivot = focus_ink_centre(monkeypatch, TRACKING_PX)
    assert tracked_pivot == plain_pivot
    assert tracked == pytest.approx(plain, abs=1.0)



# ---------------------------------------------------------------------------
# 6. Presentation-only: nothing here mutates the word metrics
# ---------------------------------------------------------------------------


def base_metrics(tracking: float = 0.0) -> list[dict]:
    font = _get_font("Caviar Dreams", 36, str(FONT_PATH), bold=False)
    return [
        {"word": w, "width": _measure_tracked(w, font, tracking),
         "start": GROUP_START + i * WORD_DUR, "end": GROUP_START + (i + 1) * WORD_DUR,
         "overrides": None}
        for i, w in enumerate(PIVOT_WORDS)
    ]


def test_layout_line_does_not_mutate_word_metrics() -> None:
    font = _get_font("Caviar Dreams", 36, str(FONT_PATH), bold=False)
    metrics = base_metrics()
    before = copy.deepcopy(metrics)
    identities = [id(m) for m in metrics]

    line = layout_line(
        metrics, space_w=font.getlength(" "), tracking=0.0,
        measure=lambda i, s: _measure_tracked(s, font, 0.0),
        current_time=GROUP_START + 1.7, pivot_px=233.6, slide_duration=0.06,
    )

    assert isinstance(line, RsvpLine)
    assert metrics == before, "layout_line rewrote the word metrics"
    assert [id(m) for m in metrics] == identities, "layout_line reordered the words"


def test_draw_line_does_not_mutate_word_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    """No timing written, no word reordered — RSVP is presentation-only."""
    snapshot: dict = {}
    real = rsvp_layout.draw_line

    def spy(draw, **kwargs):
        metrics = kwargs["word_metrics"]
        snapshot["before"] = copy.deepcopy(metrics)
        snapshot["identities"] = [id(m) for m in metrics]
        snapshot["live"] = metrics
        return real(draw, **kwargs)

    monkeypatch.setattr(video_render.rsvp_layout, "draw_line", spy)
    render(rsvp_config(tracking=TRACKING_PX), pivot_group(),
           GROUP_START + 3 * WORD_DUR + HOLD_OFFSET)

    assert snapshot["live"] == snapshot["before"], "draw_line rewrote the word metrics"
    assert [id(m) for m in snapshot["live"]] == snapshot["identities"]


def test_group_word_dicts_survive_a_render() -> None:
    """End to end: rendering an RSVP frame leaves the group's own words untouched."""
    group = pivot_group()
    before = copy.deepcopy(group)
    render(rsvp_config(), group, GROUP_START + 2 * WORD_DUR + HOLD_OFFSET)
    assert group == before
