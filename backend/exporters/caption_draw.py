"""Low-level caption drawing primitives shared by the Pillow renderer.

Extracted from ``video_render.py`` so the RSVP layer
(``backend/exporters/rsvp_layout.py``) can reuse the *identical* colour and
advance-width primitives without importing ``video_render`` (which imports
``rsvp_layout``) — i.e. to keep the import graph acyclic rather than adding a
fourth copy of "measure a tracked string" / "convert a hex colour".

Nothing here knows about ``VideoRenderConfig``, groups or timing: these are the
three primitives every caption draw site needs. ``video_render`` re-exports
them, so ``video_render._hex_to_rgba`` keeps resolving for existing callers.

**Measurement contract** (``docs/caption-parity.md``): advance widths come from
``font.getlength()``, never ``getbbox()``/``textbbox()`` — the latter strips side
bearings and would drift from Canvas ``measureText().width`` and the HTML
runtime.
"""

from __future__ import annotations

from PIL import ImageDraw, ImageFont


def _hex_to_rgba(hex_color: str, opacity: float = 1.0) -> tuple[int, int, int, int]:
    """Convert '#RRGGBB' to (R, G, B, A)."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, int(opacity * 255))


def _measure_tracked(text: str, font: ImageFont.FreeTypeFont, tracking: float) -> float:
    """Advance width of ``text``, honouring letter tracking.

    The single implementation of the renderer's word-measurement primitive: with
    ``tracking == 0`` it is one ``font.getlength()`` call over the whole string
    (so the font's own kerning/shaping applies, matching the single
    ``draw.text()`` call :func:`_draw_single_word` makes in that case); with
    tracking it is the per-character sum plus ``n - 1`` gaps, matching that
    function's char-by-char pen walk.

    The ``n - 1`` convention is why a *prefix* measurement is one gap short of
    the pen position of the character that follows it — see ``_tracking_gap`` in
    ``rsvp_layout.py``, which is the one place that difference matters.
    """
    if tracking == 0:
        return font.getlength(text)
    # Interleaved (the gap added inside the loop) rather than the algebraically
    # equal `sum(getlength) + (n - 1) * tracking`: the two differ in the last ULP
    # of float addition, and this shape is the one `_draw_single_word`'s pen walk
    # below uses — and, through `_measure_word`/`_measure_with_font`, every
    # measurement call site — so measure and draw agree bit-for-bit.
    w = 0.0
    for ci, ch in enumerate(text):
        w += font.getlength(ch)
        if ci < len(text) - 1:
            w += tracking
    return w


def _draw_single_word(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: float,
    y: float,
    font: ImageFont.FreeTypeFont,
    color: tuple,
    tracking: float,
    outline_sw: int,
    stroke_rgba: tuple | None,
) -> None:
    """Draw one word (full string when tracking=0, char-by-char otherwise)."""
    if tracking == 0:
        if outline_sw > 0:
            draw.text((x, y), text, font=font, fill=color,
                      stroke_width=outline_sw, stroke_fill=stroke_rgba)
        else:
            draw.text((x, y), text, font=font, fill=color)
    else:
        cx = x
        for ci, ch in enumerate(text):
            if outline_sw > 0:
                draw.text((cx, y), ch, font=font, fill=color,
                          stroke_width=outline_sw, stroke_fill=stroke_rgba)
            else:
                draw.text((cx, y), ch, font=font, fill=color)
            cx += font.getlength(ch)
            if ci < len(text) - 1:
                cx += tracking


__all__ = ["_hex_to_rgba", "_measure_tracked", "_draw_single_word"]
