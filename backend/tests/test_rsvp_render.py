"""The RSVP rendered-behaviour contract, read back off real frames.

Companion to ``test_rsvp_layout.py``, which owns the caption band, the pivot
invariant and the immutability guarantees and whose harness this file imports.
What is pinned here is everything that only shows up once a frame exists:

* the **edge fade** is an alpha mask, not a crop — and a clean no-op when off;
* the **silence-gap hold** and, more generally, that RSVP colours the word its
  line is parked on — the one rule, even where ``last_started_index`` and the
  decoration modes' ``start <= t < end`` test disagree (reordered words,
  overlapping timings);
* ``lines`` is forced to 1 and ``alignment`` is ignored — plus what alignment
  still *does* affect (it feeds ``center_x``, so it moves the whole band).

Its two siblings, split out only to keep each file readable:

* ``test_rsvp_background_box.py`` — the group box framing the caption band, and
  the context dimming of the stroke and the per-word boxes.
* ``test_rsvp_reticle.py`` — the pivot reticle: off, unfaded, and drawn at
  exactly its EM size.

Every claim here is one the ``rsvp_layout`` module docstring makes.
"""

from __future__ import annotations

import pytest
from PIL import Image

from backend.exporters import rsvp_layout
from backend.exporters.rsvp import last_started_index
from backend.exporters.rsvp_layout import apply_edge_fade, caption_band
from backend.tests.test_render_golden import RSVP_CONFIG, build_group, diff_stats
from backend.tests.test_rsvp_layout import (
    GROUP_START,
    HOLD_OFFSET,
    INK_ALPHA_MIN,
    INK_CENTRE_SLACK_PX,
    PIVOT_WORDS,
    ROLE_CONFIG,
    WORD_DUR,
    capture_lines,
    pivot_of,
    render,
    role_bbox,
    role_counts,
    rsvp_config,
)


def column_max_alpha(img: Image.Image) -> list[int]:
    """Per-column maximum alpha — how much ink survives in each column."""
    alpha = img.getchannel("A")
    return [alpha.crop((x, 0, x + 1, alpha.height)).getextrema()[1]
            for x in range(alpha.width)]


def gapped_group(
    words: list[str], start: float = 1.0, dur: float = 0.3, gap: float = 0.3,
) -> dict:
    """A group with real **silence** between words, which ``build_group`` has none of.

    ``end + gap == next start``, so every inter-word instant has no
    ``start <= t < end`` answer — the case where the line's anchor rule and the
    decoration modes' active-word rule deliberately disagree.
    """
    word_dicts = []
    cursor = start
    for w in words:
        word_dicts.append({"word": w, "start": cursor, "end": cursor + dur})
        cursor += dur + gap
    return {
        "text": " ".join(words),
        "start": word_dicts[0]["start"],
        "end": word_dicts[-1]["end"],
        "words": word_dicts,
    }


# ---------------------------------------------------------------------------
# 1. Edge fade — a clean no-op when off, an alpha mask when on
# ---------------------------------------------------------------------------

FADE_TEST_BAND = rsvp_layout.CaptionBand(left=100.0, width=400.0)


def opaque_layer(width: int = 640, height: int = 8) -> Image.Image:
    return Image.new("RGBA", (width, height), (255, 255, 255, 255))


@pytest.mark.parametrize("fade", [0.0, -0.5], ids=["zero", "negative"])
def test_apply_edge_fade_off_is_byte_identical(fade: float) -> None:
    """``rsvp_edge_fade <= 0`` must not touch a single byte of the layer."""
    layer = opaque_layer()
    before = layer.tobytes()
    apply_edge_fade(layer, FADE_TEST_BAND, fade)
    assert layer.tobytes() == before


def test_apply_edge_fade_is_a_ramp_not_a_step() -> None:
    """The fade is an alpha *ramp*: many intermediate values, symmetric, band-scoped."""
    fade_frac = 0.12
    layer = opaque_layer()
    apply_edge_fade(layer, FADE_TEST_BAND, fade_frac)
    alpha = list(layer.getchannel("A").crop((0, 0, layer.width, 1)).tobytes())
    fade_px = FADE_TEST_BAND.width * fade_frac
    left, right = int(FADE_TEST_BAND.left), int(FADE_TEST_BAND.right)

    assert alpha[left - 1] == 0 and alpha[right + 1] == 0     # outside the band
    assert alpha[int(FADE_TEST_BAND.pivot(0.5))] == 255       # untouched core
    ramp = alpha[left + 1:left + int(fade_px)]
    assert ramp == sorted(ramp)                               # monotonic rise
    # A hard clip would only ever produce 0 and 255.
    assert len({a for a in ramp if 0 < a < 255}) > int(fade_px) / 2
    # Symmetric: the two ends carry the same ramp mirrored. Columns are sampled
    # at their CENTRE (`x + 0.5`), so column x mirrors column `right - 1 - x`,
    # not `right - x` — one pixel of ramp apart.
    for d in range(int(fade_px)):
        assert alpha[left + d] == alpha[right - 1 - d]


@pytest.mark.parametrize(
    "animation,t",
    # Both fade call sites: the normal draw path, and the pop branch (which
    # composites the RSVP line through its own scratch layer).
    [("none", 2.7), ("pop", GROUP_START + 0.05)],
    ids=["normal", "pop_mid_entry"],
)
def test_edge_fade_reaches_the_rendered_frame(animation: str, t: float) -> None:
    """The fade must actually be applied by ``_render_frame``, in BOTH paths.

    This is the regression test for the fade having been wired into the pop branch
    only: with it dead, a fade-on frame and a fade-off frame were byte-identical on
    the normal path — i.e. for essentially every frame ever rendered.

    The assertion is the mask's own invariant, "no ink survives outside the band",
    not merely "the frame changed": on the pop path the fade also splits the draw
    onto a scratch layer, and that split alone perturbs anti-aliased pixels, so a
    "something differs" test would pass with the mask itself removed. (Pop scales
    the whole caption toward its centre *after* masking, so the ink can only end up
    narrower than the band, never wider.)
    """
    # No background box: the box is not masked (it frames the band), so it would
    # dominate the ink extent being measured here.
    config = rsvp_config(animation=animation, bg_opacity=0.0)
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    band = caption_band(config, config.resolution_w * config.position_x)

    faded = render(config, group, t).getchannel("A").getbbox()
    unfaded = render(rsvp_config(animation=animation, bg_opacity=0.0,
                                 rsvp_edge_fade=0.0), group, t).getchannel("A").getbbox()

    assert unfaded[0] < band.left or unfaded[2] > band.right, (
        "the unwrapped line was expected to overflow the band with the fade off — "
        "this scenario cannot prove anything about the mask otherwise"
    )
    assert band.left - 1 <= faded[0] and faded[2] <= band.right + 1, (
        f"ink survives outside the caption band on the {animation!r} path: the edge "
        f"fade mask is not being applied (ink spans {faded[0]}-{faded[2]}, band "
        f"spans {band.left}-{band.right})"
    )


# Word index whose drawn position straddles the band's LEFT edge at the mid-hold
# time used below. The tests that rely on it assert that overflow as a
# precondition, so a layout change turns this into a clear failure rather than a
# silently vacuous test.
STRADDLING_WORD_INDEX = 2

#: Text drawn green, the per-word box drawn red, so ``role_bbox(..., "focus")``
#: (red-dominant pixels) isolates the BOX — which lives on the pill layer and
#: therefore needs its own mask call.
BOX_ONLY_CONFIG = {
    "bg_opacity": 0.0,
    "rsvp_reticle": False,
    "text_color": "#00FF00",
    "active_word_color": "#00FF00",
    "rsvp_focus_color": "#00FF00",
}
BOX_OVERRIDES = {"word_bg_opacity": 0.9, "word_bg_color": "#FF0000"}


def test_edge_fade_masks_the_per_word_background_boxes() -> None:
    """A per-word box dissolves with its word instead of floating past the band.

    The boxes are drawn on the *pill* layer, so masking only the text layer would
    leave a box hanging outside the band with no text in it.
    """
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    group["words"][STRADDLING_WORD_INDEX]["overrides"] = dict(BOX_OVERRIDES)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET

    config = rsvp_config(**BOX_ONLY_CONFIG)
    band = caption_band(config, config.resolution_w * config.position_x)
    faded_left = role_bbox(render(config, group, t), "focus")[0]
    unfaded_left = role_bbox(
        render(rsvp_config(rsvp_edge_fade=0.0, **BOX_ONLY_CONFIG), group, t), "focus",
    )[0]

    assert unfaded_left < band.left, (
        f"word {STRADDLING_WORD_INDEX}'s box was expected to overflow the band's "
        f"left edge with the fade off (box starts at {unfaded_left}, band at "
        f"{band.left}) — nothing is being proved otherwise"
    )
    assert faded_left >= band.left - 1, (
        f"a per-word background box survives outside the caption band (starts at "
        f"{faded_left}, band starts at {band.left}) — the pill layer is not masked"
    )


def test_edge_fade_dissolves_a_straddling_word_instead_of_slicing_it() -> None:
    """A word crossing the band edge must lose *alpha*, not pixels.

    Column by column inside the fade zone, the surviving ink equals the unfaded
    ink scaled by the ramp — with genuinely partial columns in between. A crop
    would give a hard 0/255 step at the band edge instead.
    """
    fade_frac = RSVP_CONFIG["rsvp_edge_fade"]
    # No background box, no reticle: every inked pixel is a glyph.
    config = rsvp_config(bg_opacity=0.0, rsvp_reticle=False)
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET

    faded = column_max_alpha(render(config, group, t))
    unfaded = column_max_alpha(render(rsvp_config(bg_opacity=0.0, rsvp_reticle=False,
                                                  rsvp_edge_fade=0.0), group, t))
    band = caption_band(config, config.resolution_w * config.position_x)
    fade_px = band.width * fade_frac

    partial_columns = 0
    for x in range(int(band.left), int(band.left + fade_px)):
        if unfaded[x] < INK_ALPHA_MIN:
            continue  # no ink in this column to dissolve
        expected = unfaded[x] * ((x + 0.5 - band.left) / fade_px)
        assert faded[x] == pytest.approx(expected, abs=2)
        if 0 < faded[x] < unfaded[x]:
            partial_columns += 1
    assert partial_columns > 5, (
        "no partially-transparent ink columns inside the fade zone — the band edge "
        "is behaving like a crop, not a mask"
    )
    # Ink that overflowed the band with the fade off is gone with it on.
    assert max(unfaded[:int(band.left)]) >= INK_ALPHA_MIN
    assert max(faded[:int(band.left)]) == 0


# ---------------------------------------------------------------------------
# 2. The silence gap — the anchor rule and the active-word rule disagree
# ---------------------------------------------------------------------------

# Every word is multi-character on purpose: a 1-char word IS its own focus glyph,
# so it has no active-coloured remainder for the colour assertion to look at.
SILENCE_WORDS = ["reading", "rapid", "eliminates"]
SILENCE_DUR = 0.3
SILENCE_GAP = 0.3
#: Index of the word the line parks on in each case — the *first* word is a poor
#: choice for the silence case because ``line_offset_at`` snaps (rather than
#: eases) to target(0), so a bug in the anchor could hide behind it.
SILENCE_CASE_INDEX = {"inter_word_silence": 1, "after_last_word": len(SILENCE_WORDS) - 1}


def test_the_two_active_word_rules_disagree_in_silence() -> None:
    """Premise of the hold: in silence there is no ``start <= t < end`` word."""
    group = gapped_group(SILENCE_WORDS, start=GROUP_START,
                         dur=SILENCE_DUR, gap=SILENCE_GAP)
    words = group["words"]
    t = words[0]["end"] + SILENCE_GAP / 2

    assert last_started_index(t, words) == 0
    assert next((i for i, w in enumerate(words) if w["start"] <= t < w["end"]), -1) == -1


@pytest.mark.parametrize(
    "case",
    ["inter_word_silence", "after_last_word"],
)
def test_silence_holds_the_line_and_the_active_colour(case: str) -> None:
    """In a gap, the line holds AND the parked word stays the active word.

    The documented decision (rsvp_layout's module docstring): ``colour_idx``
    falls back to the line's anchor, so the glyph on the pivot column does not
    flicker to context colour during silence. Pinned by comparing against the
    word's own mid-hold frame, which must be pixel-identical — a snap-back would
    move the line, a colour drop would repaint two words.
    """
    config = rsvp_config(**ROLE_CONFIG)
    group = gapped_group(SILENCE_WORDS, start=GROUP_START,
                         dur=SILENCE_DUR, gap=SILENCE_GAP)
    words = group["words"]
    index = SILENCE_CASE_INDEX[case]
    gap_t = (words[index]["end"] + SILENCE_GAP / 2 if case == "inter_word_silence"
             else words[index]["end"] + 1.5)
    hold_t = words[index]["start"] + SILENCE_DUR / 2  # after the 60 ms slide

    gap_frame = render(config, group, gap_t)
    hold_frame = render(config, group, hold_t)
    _, max_diff = diff_stats(gap_frame, hold_frame)
    assert max_diff == 0, "the line did not hold through the gap"

    counts = role_counts(gap_frame)
    assert counts["focus"] > 0, "no focus-coloured glyph during the gap"
    assert counts["active"] > 0, "the parked word lost its active colour"
    assert counts["context"] > 0, "the other words should stay context-coloured"


# ---------------------------------------------------------------------------
# 3. `lines` forced to 1, `alignment` ignored
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("lines", [1, 2, 3])
def test_lines_is_forced_to_one_row(
    monkeypatch: pytest.MonkeyPatch, lines: int,
) -> None:
    """RSVP always draws exactly one unwrapped row, whatever ``lines`` says."""
    config = rsvp_config(lines=lines, bg_opacity=0.0, rsvp_reticle=False)
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET

    frame, calls = capture_lines(monkeypatch, config, group, t)
    assert len(calls) == 1, "more than one row was drawn"
    text_h = calls[0][1]["bbox"][3] - calls[0][1]["bbox"][1]

    _, y0, _, y1 = frame.getchannel("A").getbbox()
    assert (y1 - y0) <= text_h * 1.25, "ink is taller than one row"

    # Same words in wrap mode with the same `lines` really would use more rows —
    # so the single row above is RSVP's doing, not the words being short.
    wrapped = render(rsvp_config(lines=lines, bg_opacity=0.0, reading_mode="wrap"),
                     group, t)
    _, wy0, _, wy1 = wrapped.getchannel("A").getbbox()
    if lines > 1:
        assert (wy1 - wy0) > text_h * 1.5
    assert diff_stats(frame, wrapped)[1] > 0


@pytest.mark.parametrize("lines", [2, 3])
def test_lines_does_not_change_the_rsvp_frame(lines: int) -> None:
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET
    one = render(rsvp_config(lines=1), group, t)
    many = render(rsvp_config(lines=lines), group, t)
    assert diff_stats(one, many)[1] == 0


@pytest.mark.parametrize("align", ["left", "center", "right"])
def test_alignment_is_ignored_without_background_slack(align: str) -> None:
    """``text_align_h`` alone changes nothing: the pivot governs placement."""
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET
    centered = render(rsvp_config(text_align_h="center"), group, t)
    aligned = render(rsvp_config(text_align_h=align), group, t)
    assert diff_stats(centered, aligned)[1] == 0


# What alignment DOES still affect: `text_align_h` shifts the row anchor by half
# the background slack (`align_shift_x`), and the band — and therefore the pivot,
# the reticle and the fade — rides that anchor. So with bg_width_extra != 0 the
# whole RSVP window moves, which is not the same thing as aligning text inside it.
ALIGN_SLACK_PX = 80


@pytest.mark.parametrize(
    "align,expected_shift",
    [("left", -ALIGN_SLACK_PX / 2), ("center", 0), ("right", ALIGN_SLACK_PX / 2)],
)
def test_alignment_moves_the_whole_band_when_the_box_has_slack(
    monkeypatch: pytest.MonkeyPatch, align: str, expected_shift: float,
) -> None:
    config = rsvp_config(text_align_h=align, bg_width_extra=ALIGN_SLACK_PX)
    group = build_group(PIVOT_WORDS, start=GROUP_START, word_dur=WORD_DUR)
    t = GROUP_START + 3 * WORD_DUR + HOLD_OFFSET

    _, calls = capture_lines(monkeypatch, config, group, t)
    assert len(calls) == 1
    kwargs = calls[0][1]
    unshifted = config.resolution_w * config.position_x
    assert kwargs["center_x"] == pytest.approx(unshifted + expected_shift)
    assert pivot_of(config, kwargs) == pytest.approx(
        caption_band(config, unshifted).pivot(config.rsvp_pivot_x) + expected_shift,
    )


# ---------------------------------------------------------------------------
# 4. One colouring rule: the word on the pivot
# ---------------------------------------------------------------------------
#
# `last_started_index` (which PLACES the line) and `start <= t < end` (the
# decoration modes' active word) can disagree even when the second one has an
# answer: a manually reordered group ships `custom_groups[].words` verbatim, so
# `start` need not ascend, and overlapping word timings do it too. Colouring by
# the second rule painted a word that was NOT on the pivot column, leaving the
# reticle marking an empty column.

#: (name, words, t) — each is a group where the two rules disagree.
DISAGREEMENT_CASES = {
    # Displayed order != play order, i.e. what a manual word reorder produces.
    "reordered": ([{"word": "bravo", "start": 1.50, "end": 2.00},
                   {"word": "alpha", "start": 1.00, "end": 1.50}], 1.70),
    # Ascending starts, but word 0 is still "active" when word 1 has begun.
    "overlapping": ([{"word": "alpha", "start": 1.00, "end": 1.60},
                     {"word": "bravo", "start": 1.50, "end": 2.00}], 1.55),
}


@pytest.mark.parametrize("case", list(DISAGREEMENT_CASES), ids=list(DISAGREEMENT_CASES))
def test_the_coloured_word_is_the_word_on_the_pivot(
    monkeypatch: pytest.MonkeyPatch, case: str,
) -> None:
    """Whatever the timings, the focus glyph sits on the pivot column."""
    words, t = DISAGREEMENT_CASES[case]
    group = {"text": " ".join(w["word"] for w in words),
             "start": min(w["start"] for w in words),
             "end": max(w["end"] for w in words),
             "words": [dict(w) for w in words]}

    # Premise: the two rules really do disagree here, so the test is not vacuous.
    anchor = last_started_index(t, words)
    active = next((i for i, w in enumerate(words) if w["start"] <= t < w["end"]), -1)
    assert active >= 0 and active != anchor

    config = rsvp_config(bg_opacity=0.0, rsvp_reticle=False, rsvp_edge_fade=0.0,
                         rsvp_slide_duration=0.0, shadow_enabled=False, **ROLE_CONFIG)
    frame, calls = capture_lines(monkeypatch, config, group, t)
    line, kwargs = calls[0]
    assert line.anchor_index == anchor
    pivot = pivot_of(config, kwargs)

    x0, _, x1, _ = role_bbox(frame, "focus")
    assert (x0 + x1) / 2 == pytest.approx(pivot, abs=INK_CENTRE_SLACK_PX), (
        f"the focus glyph is drawn at {(x0 + x1) / 2:.1f} but the pivot column is "
        f"{pivot:.1f}: the coloured word is not the word the line is parked on"
    )

    # ...and it is the anchor word that carries the colour, not the other one.
    positions = line.positions()
    metrics = kwargs["word_metrics"]
    lo = positions[anchor] - 1
    hi = positions[anchor] + metrics[anchor]["width"] + 1
    assert lo <= x0 and x1 <= hi, (
        f"the focus-coloured glyph at {x0}-{x1} is outside the anchor word's span "
        f"{lo:.1f}-{hi:.1f}"
    )
    counts = role_counts(frame)
    assert counts["context"] > 0, "the other word should stay context-coloured"