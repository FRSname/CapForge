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

from PIL import Image, ImageDraw, ImageFont

from backend.exporters import gradient


# Fallbacks for the two colours whose value space gradients widened
# (``text_color``, ``bg_color``). Reached only when the stored value is neither a
# valid hex nor a valid gradient — a corrupt preset or project — and deliberately
# equal to the ``VideoRenderConfig`` defaults, so a broken style renders as the
# stock one instead of aborting the job. Used with ``gradient.flat_hex``.
DEFAULT_TEXT_COLOR = "#FFFFFF"
DEFAULT_BG_COLOR = "#D4952A"


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


# ---------------------------------------------------------------------------
# Gradient fills
# ---------------------------------------------------------------------------
#
# ``ImageDraw``'s ``fill=`` takes a flat RGBA tuple and nothing else, so a
# gradient is applied as a **layer** operation instead: the glyphs (or the box)
# are drawn normally into their own RGBA layer, and that layer's alpha — the
# exact shape, anti-aliasing included — is then re-coloured through the
# gradient. The alpha is never touched, which is why the drop shadow
# (``video_render._render_frame``, built from ``text_layer.getchannel("A")``)
# needs no gradient awareness at all.
#
# The twins do the same thing with their native APIs: Canvas assigns a
# ``CanvasGradient`` to ``fillStyle``, the HTML layer sets ``background-image``
# with ``background-clip: text``. All three interpolate stops linearly in sRGB,
# so the three agree by construction; what has to be kept in lockstep is the
# gradient *line*, which comes from the shared core (``gradient.gradient_line``).

#: Steps in the parameter map. 256 is what ``Image.linear_gradient`` provides and
#: is a fraction of a colour level per step across a caption-sized box.
_GRADIENT_STEPS = 256


def _sample_stops(
    stops: "tuple[gradient.GradientStop, ...]", t: float
) -> tuple[int, int, int]:
    """Colour of ``stops`` at position ``t``, clamped outside ``[0, 1]``.

    Equal consecutive offsets are a hard colour band rather than a special case:
    ``t`` at the shared offset resolves through the *earlier* segment at
    ``f == 1`` and anything past it through the later one at ``f == 0``, which is
    what CSS and ``addColorStop`` both do.
    """
    if t <= stops[0].offset:
        return _rgb_of(stops[0].color)
    if t >= stops[-1].offset:
        return _rgb_of(stops[-1].color)
    for lower, upper in zip(stops, stops[1:]):
        if lower.offset <= t <= upper.offset:
            span = upper.offset - lower.offset
            f = 1.0 if span <= 0 else (t - lower.offset) / span
            a = _rgb_of(lower.color)
            b = _rgb_of(upper.color)
            return (
                round(a[0] + (b[0] - a[0]) * f),
                round(a[1] + (b[1] - a[1]) * f),
                round(a[2] + (b[2] - a[2]) * f),
            )
    return _rgb_of(stops[-1].color)  # pragma: no cover - offsets are sorted


def _rgb_of(hex_color: str) -> tuple[int, int, int]:
    r, g, b, _ = _hex_to_rgba(hex_color)
    return (r, g, b)


def _parameter_map(
    size: tuple[int, int], line: tuple[float, float, float, float]
) -> "tuple[Image.Image, float, float] | None":
    """A per-pixel ``t`` map over ``size``, or ``None`` for a degenerate line.

    ``t`` is the projection of each pixel onto the gradient line, so it is
    affine in ``(x, y)`` and an ``Image.AFFINE`` transform of the 256-row ramp
    computes it entirely in C. The map is rescaled so the *frame's* whole ``t``
    range lands inside ``[0, 255]``: PIL fills out-of-source pixels with a flat
    ``fillcolor`` rather than clamping them, and a glyph's stroke or a box's
    corner can sit slightly outside the caption block box. The returned
    ``(t_min, t_span)`` is how the LUT reverses that rescale.
    """
    width, height = size
    x0, y0, x1, y1 = line
    dx = x1 - x0
    dy = y1 - y0
    length_sq = dx * dx + dy * dy
    if length_sq <= 0:
        return None

    def t_at(x: float, y: float) -> float:
        return ((x - x0) * dx + (y - y0) * dy) / length_sq

    corners = [t_at(x, y) for x in (0, width) for y in (0, height)]
    t_min = min(corners)
    t_span = max(corners) - t_min
    if t_span <= 0:
        return None

    # source_y = (STEPS-1) * (t(x, y) - t_min) / t_span, expanded into the
    # affine's (d, e, f) row. source_x is pinned mid-ramp: every column is equal.
    scale = (_GRADIENT_STEPS - 1) / (t_span * length_sq)
    d = scale * dx
    e = scale * dy
    f = -scale * (x0 * dx + y0 * dy) - (_GRADIENT_STEPS - 1) * t_min / t_span

    ramp = Image.linear_gradient("L")  # STEPS x STEPS, value == y
    t_map = ramp.transform(
        (width, height),
        Image.AFFINE,
        (0, 0, _GRADIENT_STEPS / 2, d, e, f),
        resample=Image.BILINEAR,
    )
    return t_map, t_min, t_span


def gradient_rgb(
    size: tuple[int, int],
    spec: "gradient.GradientSpec",
    box: tuple[float, float, float, float],
) -> Image.Image:
    """An opaque RGB image of ``size`` holding ``spec`` laid over ``box``.

    ``box`` is ``(left, top, width, height)``; pixels beyond its gradient line
    take the first or last stop, exactly like CSS and ``addColorStop``.
    """
    mapped = _parameter_map(size, gradient.gradient_line(spec, box))
    if mapped is None:
        # Degenerate box (zero width AND the angle is axis-aligned to it): the
        # gradient has nowhere to run, so it is its first stop.
        return Image.new("RGB", size, _rgb_of(spec.stops[0].color))

    t_map, t_min, t_span = mapped
    channels = []
    for channel in range(3):
        lut = [
            _sample_stops(spec.stops, t_min + (i / (_GRADIENT_STEPS - 1)) * t_span)[
                channel
            ]
            for i in range(_GRADIENT_STEPS)
        ]
        channels.append(t_map.point(lut))
    return Image.merge("RGB", channels)


def paint_gradient(
    layer: Image.Image,
    spec: "gradient.GradientSpec",
    box: tuple[float, float, float, float],
) -> Image.Image:
    """``layer`` re-coloured by ``spec``, with its alpha channel preserved byte
    for byte — so shape, anti-aliasing and any mask already applied survive.
    """
    filled = gradient_rgb(layer.size, spec, box).convert("RGBA")
    filled.putalpha(layer.getchannel("A"))
    return filled


__all__ = [
    "DEFAULT_BG_COLOR",
    "DEFAULT_TEXT_COLOR",
    "_draw_single_word",
    "_hex_to_rgba",
    "_measure_tracked",
    "gradient_rgb",
    "paint_gradient",
]
