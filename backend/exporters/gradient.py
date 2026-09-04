"""Gradient colour core — the Python half of a three-way pin.

A caption colour setting (``text_color``, ``bg_color``) is a ``str`` that is
*either* a plain ``#RRGGBB`` hex — the value space it has always had, and the
untouched fast path — *or* a restricted linear-gradient string::

    linear-gradient(135deg, #FF0080 0%, #7928CA 100%)

**This module has two twins and they must change in lockstep:**

* ``src/renderer/src/lib/gradient.ts`` — the Canvas preview's copy.
* ``GRADIENT_RUNTIME_JS`` in ``backend/exporters/hyperframes_gradient_runtime.py``
  — the HTML/GSAP layer's copy.

All three are pinned by the *same* literal fixture,
``backend/tests/fixtures/gradient_cases.json``, read by
``backend/tests/test_gradient_core.py``, ``lib/gradient.test.ts`` and
``lib/gradient.embedded.test.ts``. Never hand-write an expected value in one
language — add it to the fixture.

Invariants:

* **Purely scalar.** No PIL, no DOM, no canvas, no I/O. The Pillow-only painter
  that turns a spec into pixels lives in ``caption_draw.paint_gradient``.
* **Parsing is a trust boundary.** A ``.cfpreset`` (``electron/preset-io.js``), a
  restored ``.cfproj`` and an MCP ``set_style`` all reach this function, and the
  HTML layer interpolates the result into CSS. So the grammar is a closed subset
  — no ``rgb()``/``hsl()``/named colours, no nested parens, no ``url()``, no
  trailing text — and anything outside it returns ``None`` rather than being
  repaired. :func:`to_css` re-emits from the *parsed* spec, so the caller's raw
  string never reaches a stylesheet.
* **The gradient line is the CSS one.** ``0deg`` points to the top and the angle
  increases clockwise; the line is centred on the box and long enough that the
  first and last stops land exactly on the corners (the "magic corner" rule,
  length ``|W·sin a| + |H·cos a|``). This is invisible at 0/90/180/270° and wrong
  at every other angle, which is why it is fixture-pinned rather than re-derived
  per renderer.
"""

from __future__ import annotations

import math
import re
from typing import NamedTuple

__all__ = [
    "GRADIENT_PREFIX",
    "MAX_GRADIENT_LENGTH",
    "MAX_STOPS",
    "MIN_STOPS",
    "GradientSpec",
    "GradientStop",
    "flat_color",
    "flat_hex",
    "gradient_line",
    "normalize_hex",
    "parse_gradient",
    "to_css",
]

#: Only ``linear-gradient`` is accepted. A second kind (radial) would be a new
#: branch here and in both twins, plus fixture rows — not a rewrite.
GRADIENT_PREFIX = "linear-gradient("

#: Bounds the parse work an untrusted preset can ask for.
MAX_GRADIENT_LENGTH = 512

MIN_STOPS = 2
MAX_STOPS = 8

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_ANGLE_RE = re.compile(r"^([+-]?(?:\d+\.?\d*|\.\d+))deg$")
_STOP_RE = re.compile(
    r"^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\s+([+-]?(?:\d+\.?\d*|\.\d+))%$"
)


class GradientStop(NamedTuple):
    """One colour stop. ``offset`` is a 0–1 fraction, ``color`` a ``#RRGGBB``."""

    offset: float
    color: str


class GradientSpec(NamedTuple):
    """A parsed gradient. ``angle`` is normalised into ``[0, 360)`` degrees."""

    angle: float
    stops: tuple[GradientStop, ...]


def normalize_hex(value: str) -> str:
    """``'#abc'`` / ``'#AaBbCc'`` → canonical ``'#AABBCC'``.

    Callers must have matched :data:`_HEX_RE` first; this only canonicalises.
    """
    h = value.strip().lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    return "#" + h.upper()


def flat_hex(value: object, fallback: str) -> str:
    """The safe flat-colour reading of ``value``, or ``fallback``.

    Deliberately scoped to the fields whose value space this change *widened*
    (``text_color``, ``bg_color``): a malformed gradient string from a preset
    would otherwise reach ``_hex_to_rgba``'s ``int(h[0:2], 16)`` and abort the
    render. Colours that never accepted a gradient keep their existing
    unguarded path — widening those is a separate decision.
    """
    if isinstance(value, str) and _HEX_RE.match(value.strip()):
        return normalize_hex(value)
    return fallback


def flat_color(value: object, fallback: str) -> str:
    """A single ``#RRGGBB`` reading of ``value``, whatever it holds.

    For the consumers that *cannot* take a gradient — the highlight pill's text
    colour falling back to ``bg_color``, a per-word background box inheriting
    the global one — a gradient reads as its **first stop**, which keeps the
    inherited colour recognisably related to the gradient instead of snapping
    to an unrelated default. Anything unusable falls back, via :func:`flat_hex`.
    """
    spec = parse_gradient(value)
    if spec is not None:
        return spec.stops[0].color
    return flat_hex(value, fallback)


def parse_gradient(value: object) -> GradientSpec | None:
    """Parse a restricted linear-gradient string, or ``None``.

    ``None`` means "not a gradient" for both a plain hex (the caller keeps its
    flat path) and a malformed gradient (rejected, never repaired) — the caller
    cannot tell them apart and does not need to, because :func:`flat_hex` gives
    the malformed case a safe reading.
    """
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if len(raw) > MAX_GRADIENT_LENGTH:
        return None
    if not raw.lower().startswith(GRADIENT_PREFIX) or not raw.endswith(")"):
        return None

    inner = raw[len(GRADIENT_PREFIX) : -1]
    # No nested parens: closes off `url(...)`, a second gradient, and any
    # `)` that would let trailing declarations ride along into the CSS.
    if "(" in inner or ")" in inner:
        return None

    parts = [p.strip() for p in inner.split(",")]
    if len(parts) < 1 + MIN_STOPS or len(parts) > 1 + MAX_STOPS:
        return None

    angle_match = _ANGLE_RE.match(parts[0])
    if not angle_match:
        return None
    angle = float(angle_match.group(1)) % 360.0

    stops: list[GradientStop] = []
    previous = -1.0
    for part in parts[1:]:
        stop_match = _STOP_RE.match(part)
        if not stop_match:
            return None
        percent = float(stop_match.group(2))
        if not 0.0 <= percent <= 100.0:
            return None
        offset = percent / 100.0
        # Non-decreasing: an out-of-order stop is a typo, and the three
        # renderers' native gradient APIs disagree about how to fix one.
        if offset < previous:
            return None
        previous = offset
        stops.append(GradientStop(offset, normalize_hex(stop_match.group(1))))

    return GradientSpec(angle, tuple(stops))


def gradient_line(
    spec: GradientSpec, box: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    """CSS gradient line for ``spec`` over ``box`` → ``(x0, y0, x1, y1)``.

    ``box`` is ``(left, top, width, height)`` in the renderer's pixel space
    (y grows downward). The returned endpoints are where the ``0%`` and ``100%``
    stops sit, ready for ``ctx.createLinearGradient`` and for the Pillow painter.
    """
    left, top, width, height = box
    radians = math.radians(spec.angle)
    sin_a = math.sin(radians)
    cos_a = math.cos(radians)
    # "Magic corner": long enough that 0% and 100% land on opposite corners.
    length = abs(width * sin_a) + abs(height * cos_a)
    center_x = left + width / 2.0
    center_y = top + height / 2.0
    half_x = sin_a * length / 2.0
    half_y = cos_a * length / 2.0
    # y is negated because 0deg points to the *top* and y grows downward.
    return (center_x - half_x, center_y + half_y, center_x + half_x, center_y - half_y)


def _format_number(value: float) -> str:
    """Shortest fixed-point form, ≤4 decimals — identical in all three copies."""
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return text if text else "0"


def to_css(spec: GradientSpec) -> str:
    """Re-emit ``spec`` as a canonical CSS string.

    The HTML layer stylesheets this, so it must be built from the *parsed* spec
    and never from the caller's raw string — that is what makes the grammar's
    closure an actual injection guard rather than a validation gesture.
    """
    stops = ", ".join(
        f"{stop.color} {_format_number(stop.offset * 100.0)}%" for stop in spec.stops
    )
    return f"linear-gradient({_format_number(spec.angle)}deg, {stops})"
