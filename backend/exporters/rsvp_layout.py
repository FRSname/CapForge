"""RSVP ("Spritz" speed-reading) caption layout + drawing for the Pillow renderer.

Pillow is the declared **source of truth** for caption rendering
(``docs/caption-parity.md``), so what this module draws is what Phase 4's Canvas
preview (``useSubtitleOverlay.ts``/``overlayGeometry.ts``) and HTML/GSAP runtime
(``hyperframes_caption_html.py`` + ``hyperframes_rsvp_runtime.py``) must match.
The shared scalar core — the ORP table, the code-point slicing, the eased line
offset and the active-word rule — lives in ``backend/exporters/rsvp.py`` and is
pinned across all three languages by the fixtures under ``backend/tests/fixtures``;
**nothing here re-derives any of it.**

The caption band
----------------
``rsvp_pivot_x`` and ``rsvp_edge_fade`` are fractions of the **caption band**,
which is deliberately *not* a new width concept: it is the usable caption width
the wrap path already enforces — ``resolution_w * max_width`` — centred on the
row's own anchor (``config.position_x`` or a group's ``position_x`` override,
plus ``text_align_h`` slack and ``text_offset_x``, i.e. the exact ``center_x``
``_draw_word_list`` is handed). So::

    band.width = resolution_w * max_width
    band.left  = row_center_x - band.width / 2
    pivot_px   = band.left + rsvp_pivot_x * band.width

That reproduces the reference clip: a 1320-wide frame at ``max_width`` 0.9 and
``position_x`` 0.5 gives a band of 1188 px spanning x 66→1254 (measured 66→1260),
and ``rsvp_pivot_x`` 0.35 puts the pivot at x ≈ 482 (measured 479 ± 2).
Phase 4 must use this same definition in the other two renderers.

Everything RSVP places horizontally is derived from that one band: the pivot, the
reticle, the edge-fade ramp **and the group background box** (``video_render``
sizes the box to ``band.width`` and centres it on the band, never on the raw
``center_x`` — see the ``is_rsvp`` branch there). A box centred anywhere else
drifts off the column the text is placed on as soon as ``text_offset_x`` is
non-zero or the group is narrower than the band.

The edge fade vs the pivot
--------------------------
The fade is a property of the **band**, so a focus column placed *inside* the
ramp (``rsvp_pivot_x`` near 0 or 1 with a non-zero ``rsvp_edge_fade``) genuinely
dims the focus glyph — the band is a window, and that is what looking through the
edge of a window does. It is **not** clamped: silently rewriting the user's
``rsvp_pivot_x`` would be worse than the visible consequence. The UI (Reading
card) carries the hint instead.

The **reticle is exempt**: it is a fixed guide painted on the frame, not text
sliding inside the band, so it must stay crisp wherever the pivot is. It is drawn
to its own unmasked target (``reticle_draw``) rather than onto the pill layer,
which *is* masked so a per-word background box cannot float past the band edge
without its word.

The pivot invariant
-------------------
Absent a per-word ``pos_offset_x`` (an explicit nudge the user asked for, which
moves the drawn word — and therefore its focus glyph — by exactly that offset),
the line is laid out **once** as a single unwrapped row (``lines`` forced to 1,
``text_align_h`` not used to align text inside the box — the pivot governs
horizontal placement), then translated as a whole so that the active word's focus
glyph centre lands on the pivot::

    focus_offset(i) = word_x[i] + measure(token[:f]) + measure(token[f]) / 2
    line_x(t)       = eased(pivot_px - focus_offset(active))

Words are drawn at ``word_x[i] + line_x``, so a single scalar carries the whole
animation — which is what keeps three renderers in parity.

Tracking: the renderer's word-measurement primitive counts ``n - 1``
inter-character gaps (``_measure_tracked``), so a *prefix* measurement is exactly
one gap short of the pen position of the character that follows it. ``rsvp.py``'s
``focus_offset`` takes a single ``measure`` callback and cannot express that, so
the one missing gap is added here by :func:`_tracking_gap` — at the layout site
and at the draw site, from the same helper, so they cannot drift. With
``tracking == 0`` (the default) it is 0 and both reduce to ``getlength(prefix)``.

Colouring: one rule, the line's own anchor
------------------------------------------
Focus glyph in ``rsvp_focus_color``; the rest of the active word in
``active_word_color``; every other word in ``text_color`` at
``rsvp_context_opacity`` — **fill and stroke both**, so an outlined context word
is a dimmed outline around a dimmed fill rather than a solid outline around a
ghost. The per-word background boxes (drawn through ``draw_bg_boxes``) are dimmed
by the same factor for the same reason; the *active* word's box is **not** dimmed,
so it matches its own undimmed fill/stroke.

There is exactly **one** colouring rule and it is the rule that *places* the line:
``colour_idx = line.anchor_index`` (``last_started_index``, "the last word whose
``start`` has passed"). It is deliberately **not** ``_draw_word_list``'s
``start <= t < end`` ``active_idx``:

* in inter-word silence and in the tail after the last word's ``end`` there is no
  ``start <= t < end`` answer at all, so that test would drop the glyph parked on
  the pivot to context colour mid-hold;
* where the two rules merely *disagree* — overlapping word timings, or a group
  whose words were manually reordered, which ships ``custom_groups[].words``
  verbatim so ``start`` values need not ascend — ``active_idx`` would colour a
  word that is **not** on the pivot column, leaving the reticle marking an empty
  column. Anchoring both to ``last_started_index`` is the only self-consistent
  answer: the glyph parked on the pivot is the glyph that gets the focus colour.

``draw_line`` therefore does not take an ``active_idx`` at all — there is no
second rule for Phase 4's Canvas/HTML renderers to reproduce.

Per-word overrides in RSVP mode
-------------------------------
Honoured (same reads as the wrap path, so the authoritative set in
``test_caption_cfg_contract.PILLOW_HONORED_OVERRIDE_KEYS`` is unchanged):

* ``text_color`` — the context colour of that word.
* ``active_word_color`` — the non-focus part of that word while it is active.
* ``font_family`` / ``font_size_scale`` / ``bold`` / ``custom_font_path`` — the
  word is measured *and* drawn with its own font, so its focus glyph still lands
  exactly on the pivot.
* ``pos_offset_x`` / ``pos_offset_y`` — additive nudges, exactly as in wrap mode
  (they move the drawn word, not the line's layout).
* the nine ``word_bg_*`` keys — the per-word background boxes are drawn at the
  RSVP positions via the caller's ``draw_bg_boxes`` callback.

Deliberately ignored (documented, not silently dropped):

* ``word_transition`` — RSVP owns word colouring; this is the mode-level contract
  from ``docs/plans/rsvp-speed-reading-mode.md`` and the UI says so.
* consequently its sub-settings: ``highlight_*`` (there is no pill),
  ``underline_*``, ``bounce_strength``, ``scale_factor``.

Two pre-existing wrap-mode asymmetries carry over unchanged and are *not*
RSVP bugs: the line advance for each word comes from ``word_metrics[i]["width"]``,
which ``_render_frame`` measures with ``config.font_family`` even when a word
overrides ``font_family``; and the active word is drawn as three pieces, so
kerning across the prefix/focus/suffix seams is lost (an accepted delta of the
same class as the karaoke branch's split draw).

A third, smaller one comes with the NFC pin in ``rsvp.py``: the active word is
drawn from ``focus_slices``, i.e. **NFC-composed**, while its line advance still
comes from ``word_metrics[i]["width"]`` (measured on the raw token) and context
words are drawn raw. For a decomposed token the two forms can differ by a fraction
of a pixel, which moves the words *after* the active one — never the focus glyph
itself, which is solved from the same composed pieces it is drawn from.

No timing is read beyond each word's ``start``/``end`` and no timing is ever
written: RSVP is presentation-only (CLAUDE.md → Word-timing locality).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import NamedTuple, Optional

from PIL import Image, ImageChops, ImageDraw, ImageFont

from backend.exporters.caption_draw import (
    _draw_single_word,
    _hex_to_rgba,
    _measure_tracked,
)
from backend.exporters.rsvp import (
    focus_offset,
    focus_slices,
    last_started_index,
    line_offset_at,
    orp_index,
)
from backend.models.schemas import VideoRenderConfig

# ---------------------------------------------------------------------------
# Reticle geometry — a v1 approximation of the reference clip, which shows "a
# short horizontal rule with a small notch at the pivot, above and below the
# line" but gives no measured dimensions. Every value is a multiple of the
# line's text height so the reticle scales with font size instead of needing a
# second set of dials; revisit them (not magic numbers at the call site) if the
# reference is ever measured properly.
# ---------------------------------------------------------------------------

#: Total length of each rule, as a multiple of the line's text height.
RETICLE_RULE_LEN_EM = 1.10
#: Rule/notch thickness, as a multiple of text height (floored at 1 px).
RETICLE_THICKNESS_EM = 0.055
#: Clearance between the line's text box and the nearer edge of each rule.
RETICLE_GAP_EM = 0.32
#: Length of the notch that points from each rule back toward the text.
RETICLE_NOTCH_LEN_EM = 0.20

#: A word's measurement function: ``(word_index, text) -> advance width``, so a
#: word with a per-word font override is measured in its own font.
WordMeasure = Callable[[int, str], float]

#: ``(font_family, font_size_scale, bold, custom_font_path) -> (font, bbox, text_h)``
#: — ``_draw_word_list``'s ``_resolve_scaled_font`` closure, injected so RSVP
#: shares the wrap path's per-word font cache instead of building a second one.
FontResolver = Callable[[str, float, bool, Optional[str]], tuple]

#: ``(word left edges, per-word alpha multipliers) -> None`` — ``_draw_word_list``'s
#: ``_draw_word_bg_boxes`` closure. The second argument is how the context dimming
#: reaches the per-word boxes without RSVP owning a second copy of the box code.
BgBoxDrawer = Callable[[Sequence[float], Sequence[float]], None]


class CaptionBand(NamedTuple):
    """The horizontal window RSVP fractions are measured against (see module docstring)."""

    left: float
    width: float

    @property
    def right(self) -> float:
        return self.left + self.width

    def pivot(self, fraction: float) -> float:
        """The pivot column for ``rsvp_pivot_x`` (0 = band left, 1 = band right)."""
        return self.left + self.width * fraction


def caption_band(config: VideoRenderConfig, row_center_x: float) -> CaptionBand:
    """The caption band for a row centred on ``row_center_x``.

    ``row_center_x`` must be the value ``_draw_word_list`` receives as
    ``center_x`` (anchor + alignment slack + ``text_offset_x``) so the band, the
    pivot, the reticle and the edge fade all sit on the same column as the text.
    """
    width = config.resolution_w * getattr(config, "max_width", 0.9)
    return CaptionBand(left=row_center_x - width / 2, width=width)


class RsvpLine(NamedTuple):
    """The laid-out RSVP line: one x per word plus the single line translation."""

    #: Each word's left edge in line-origin space (before ``line_x``).
    word_x: tuple[float, ...]
    #: Each word's focus-glyph centre in line-origin space.
    focus_offsets: tuple[float, ...]
    #: The whole line's x translation at the current time.
    line_x: float
    #: The word the line is anchored on — ``last_started_index``, *not* the
    #: ``start <= t < end`` active word (see the module docstring).
    anchor_index: int

    def positions(self) -> tuple[float, ...]:
        """Absolute left edge of every word, i.e. ``word_x[i] + line_x``."""
        return tuple(wx + self.line_x for wx in self.word_x)


def _tracking_gap(prefix: str, tracking: float) -> float:
    """The one inter-character gap a prefix measurement is short of.

    ``_measure_tracked`` counts ``n - 1`` gaps, so the pen position of the
    character *after* a non-empty prefix is one ``tracking`` further right.
    ``rsvp.focus_offset`` takes a single ``measure`` callback and so cannot
    account for it; both the layout and the three-piece draw add it from here.
    """
    return tracking if (prefix and tracking) else 0.0


def layout_line(
    word_metrics: Sequence[dict],
    *,
    space_w: float,
    tracking: float,
    measure: WordMeasure,
    current_time: float,
    pivot_px: float,
    slide_duration: float,
) -> RsvpLine:
    """Lay the group out as one unwrapped line and solve the line translation.

    Word advances come from ``word_metrics[i]["width"]`` — the same measurement
    the wrap path uses — so nothing is measured twice; ``measure`` is only used
    for the *prefix* of each word, to find its focus glyph.
    """
    word_x: list[float] = []
    x = 0.0
    for wm in word_metrics:
        word_x.append(x)
        x += wm["width"] + space_w

    focus_offsets: list[float] = []
    for i, wm in enumerate(word_metrics):
        token = wm["word"]
        f = orp_index(token)
        offset = focus_offset(word_x[i], token, f, lambda s, i=i: measure(i, s))
        focus_offsets.append(offset + _tracking_gap(focus_slices(token, f).prefix, tracking))

    line_x = line_offset_at(
        current_time, word_metrics, focus_offsets, pivot_px, slide_duration,
    )
    return RsvpLine(
        word_x=tuple(word_x),
        focus_offsets=tuple(focus_offsets),
        line_x=line_x,
        anchor_index=last_started_index(current_time, word_metrics),
    )


def _fade_alpha(x: float, band: CaptionBand, fade_px: float) -> int:
    """Alpha (0-255) of the edge-fade ramp at column centre ``x``.

    The ramp runs 0 → 255 over the leftmost ``fade_px`` of the band and 255 → 0
    over the rightmost ``fade_px``; outside the band it is already 0 by
    continuity, so the band is the window rather than a hard clip inside it.
    """
    if x < band.left or x > band.right:
        return 0
    distance = min(x - band.left, band.right - x)
    return round(255 * min(max(distance / fade_px, 0.0), 1.0))


def apply_edge_fade(layer: Image.Image, band: CaptionBand, fade_frac: float) -> None:
    """Multiply ``layer``'s alpha by the band's edge-fade ramp, in place.

    An alpha mask, never a crop: a word straddling the band edge dissolves
    instead of being sliced. ``fade_frac <= 0`` is a **clean no-op** — the caller
    skips this function entirely, so an unmasked line may overflow the band, which
    is what "no edge fade" means.
    """
    fade_px = band.width * fade_frac
    if fade_px <= 0:
        return
    width, height = layer.size
    row = bytes(_fade_alpha(x + 0.5, band, fade_px) for x in range(width))
    ramp = Image.frombytes("L", (width, 1), row).resize((width, height), Image.NEAREST)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), ramp))


def _fill_box(
    draw: ImageDraw.ImageDraw,
    x0: float, y0: float, x1: float, y1: float,
    color: tuple[int, int, int, int],
) -> None:
    """Fill the **half-open** box ``[x0, x1) x [y0, y1)``.

    ``ImageDraw.rectangle`` includes *both* endpoints, while Canvas
    ``fillRect(x, y, w, h)`` and a CSS box are exclusive at the far edge — so a
    box handed to Pillow verbatim draws one pixel wider and one taller than the
    formula that produced it (measured: a "floored at 1 px" reticle thickness drew
    2 px, a 66.00 px rule drew 67). Every RSVP guide box goes through here so the
    drawn size *is* the EM formula, and so Phase 4's Canvas/HTML twins can use the
    constants unmodified.
    """
    draw.rectangle([x0, y0, x1 - 1, y1 - 1], fill=color)


def draw_reticle(
    draw: ImageDraw.ImageDraw,
    *,
    pivot_px: float,
    center_y: float,
    text_h: float,
    color: tuple[int, int, int, int],
) -> None:
    """Draw the pivot reticle: a short rule with an inward notch, above and below.

    Boxes are half-open (see :func:`_fill_box`), which also makes each rule and
    its notch exactly contiguous instead of overlapping by a pixel.
    """
    thickness = max(1.0, text_h * RETICLE_THICKNESS_EM)
    half_len = text_h * RETICLE_RULE_LEN_EM / 2
    gap = text_h * RETICLE_GAP_EM
    notch = text_h * RETICLE_NOTCH_LEN_EM
    half_thick = thickness / 2

    top = center_y - text_h / 2 - gap        # inner edge of the upper rule
    bottom = center_y + text_h / 2 + gap     # inner edge of the lower rule

    _fill_box(draw, pivot_px - half_len, top - thickness,
              pivot_px + half_len, top, color)
    _fill_box(draw, pivot_px - half_len, bottom,
              pivot_px + half_len, bottom + thickness, color)
    # Notches point back toward the text so the eye is guided to the pivot.
    _fill_box(draw, pivot_px - half_thick, top,
              pivot_px + half_thick, top + notch, color)
    _fill_box(draw, pivot_px - half_thick, bottom - notch,
              pivot_px + half_thick, bottom, color)


def _draw_active_word(
    draw: ImageDraw.ImageDraw,
    *,
    token: str,
    x: float,
    y: float,
    word_font: ImageFont.FreeTypeFont,
    tracking: float,
    outline_sw: int,
    stroke_rgba: tuple | None,
    active_rgba: tuple[int, int, int, int],
    focus_rgba: tuple[int, int, int, int],
) -> None:
    """Draw the active word as prefix / focus glyph / suffix.

    The pen walks with the same advances :func:`layout_line` used, so the focus
    glyph's centre lands on the pivot column by construction.
    """
    pieces = focus_slices(token, orp_index(token))
    pen = x
    for piece, rgba in (
        (pieces.prefix, active_rgba),
        (pieces.focus, focus_rgba),
        (pieces.suffix, active_rgba),
    ):
        if not piece:
            continue
        _draw_single_word(draw, piece, pen, y, word_font, rgba,
                          tracking, outline_sw, stroke_rgba)
        pen += _measure_tracked(piece, word_font, tracking) + _tracking_gap(piece, tracking)


def _dim_alpha(rgba: Optional[tuple], factor: float) -> Optional[tuple]:
    """Scale an already-built RGBA tuple's alpha by ``factor``.

    Used for the context words' **stroke**: the caller builds ``stroke_rgba`` once
    at ``anim_alpha``, so without this the outline of a context word stays fully
    opaque while its fill is dimmed to ``rsvp_context_opacity`` — a solid outline
    around a ghost, the inverse of the intent. ``int()`` (not ``round()``) matches
    ``_hex_to_rgba``'s truncation, so the dimmed stroke lands on the same alpha as
    the dimmed fill instead of one step off it.
    """
    if rgba is None:
        return None
    r, g, b, a = rgba
    return (r, g, b, int(a * factor))


def draw_line(
    draw: ImageDraw.ImageDraw,
    *,
    word_metrics: Sequence[dict],
    config: VideoRenderConfig,
    current_time: float,
    tracking: float,
    space_w: float,
    bbox: tuple,
    center_x: float,
    center_y: float,
    outline_sw: int,
    stroke_rgba: tuple | None,
    anim_alpha: float,
    resolve_font: FontResolver,
    draw_bg_boxes: Optional[BgBoxDrawer] = None,
    reticle_draw: Optional[ImageDraw.ImageDraw] = None,
) -> RsvpLine:
    """Draw one group as a single sliding RSVP line. Returns the layout it used.

    There is no ``active_idx`` parameter: the word that is coloured is the word the
    line is parked on (``layout_line``'s ``anchor_index``), which is a single rule.
    See the module docstring.

    ``reticle_draw`` is the target for the pivot reticle — a separate,
    **unmasked** surface, because the reticle is a fixed guide and must not be
    dimmed by the edge fade. It falls back to ``draw`` when the caller has no
    layering (the pop branch with the fade off).
    """
    text_h = bbox[3] - bbox[1]
    band = caption_band(config, center_x)
    pivot_px = band.pivot(config.rsvp_pivot_x)

    def word_font(index: int) -> tuple:
        ov = word_metrics[index].get("overrides") or {}
        return resolve_font(
            ov.get("font_family") or config.font_family,
            float(ov.get("font_size_scale", 1.0)),
            bool(ov["bold"]) if "bold" in ov else config.bold,
            ov.get("custom_font_path") or getattr(config, "custom_font_path", None),
        )

    line = layout_line(
        word_metrics,
        space_w=space_w,
        tracking=tracking,
        measure=lambda i, s: _measure_tracked(s, word_font(i)[0], tracking),
        current_time=current_time,
        pivot_px=pivot_px,
        slide_duration=config.rsvp_slide_duration,
    )
    positions = line.positions()

    # ONE rule: the word that is coloured is the word the line is parked on
    # (module docstring → "Colouring: one rule, the line's own anchor").
    colour_idx = line.anchor_index
    context_opacity = config.rsvp_context_opacity

    if draw_bg_boxes is not None:
        # Non-active words' boxes are dimmed exactly like their fill and stroke;
        # the active word's box is left undimmed to match its undimmed glyphs.
        draw_bg_boxes(
            positions,
            [1.0 if i == colour_idx else context_opacity
             for i in range(len(word_metrics))],
        )

    if config.rsvp_reticle:
        draw_reticle(
            reticle_draw if reticle_draw is not None else draw,
            pivot_px=pivot_px,
            center_y=center_y,
            text_h=text_h,
            color=_hex_to_rgba(config.rsvp_focus_color, anim_alpha),
        )

    base_y = center_y - text_h / 2 - bbox[1]

    for i, wm in enumerate(word_metrics):
        ov = wm.get("overrides") or {}
        w_font, _, w_text_h = word_font(i)
        x = positions[i] + float(ov.get("pos_offset_x", 0))
        # Same vertical formula as the wrap path, so a scaled word stays centred
        # on the line's midline and Phase 4's baseline rules carry over.
        y = base_y - (w_text_h - text_h) / 2 + float(ov.get("pos_offset_y", 0))

        if i == colour_idx:
            active_hex = ov["active_word_color"] if "active_word_color" in ov \
                else config.active_word_color
            _draw_active_word(
                draw,
                token=wm["word"], x=x, y=y, word_font=w_font,
                tracking=tracking, outline_sw=outline_sw, stroke_rgba=stroke_rgba,
                active_rgba=_hex_to_rgba(active_hex, anim_alpha),
                focus_rgba=_hex_to_rgba(config.rsvp_focus_color, anim_alpha),
            )
            continue

        context_hex = ov["text_color"] if "text_color" in ov else config.text_color
        _draw_single_word(
            draw, wm["word"], x, y, w_font,
            _hex_to_rgba(context_hex, anim_alpha * context_opacity),
            tracking, outline_sw,
            # The stroke is dimmed too — see _dim_alpha.
            _dim_alpha(stroke_rgba, context_opacity),
        )

    return line


__all__ = [
    "RETICLE_RULE_LEN_EM",
    "RETICLE_THICKNESS_EM",
    "RETICLE_GAP_EM",
    "RETICLE_NOTCH_LEN_EM",
    "BgBoxDrawer",
    "CaptionBand",
    "FontResolver",
    "RsvpLine",
    "caption_band",
    "layout_line",
    "apply_edge_fade",
    "draw_reticle",
    "draw_line",
]
