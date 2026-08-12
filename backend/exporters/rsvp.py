"""RSVP ("Spritz" speed-reading) caption core — the Python half of a three-way pin.

RSVP shows one unwrapped line of a group's words and slides it horizontally so
that one letter of the active word — the Optimal Recognition Point (ORP) —
always lands on a fixed pivot column. The eye never moves; the text moves under
it.

**This module has two twins and they must change in lockstep:**

* ``src/renderer/src/lib/rsvp.ts`` — the Canvas preview's copy.
* ``RSVP_RUNTIME_JS`` in ``backend/exporters/hyperframes_rsvp_runtime.py`` — the
  HTML/GSAP layer's copy.

Three drifting copies of the ORP contract is precisely the bug class the caption
parity suite exists to catch, so all three are pinned by the *same* literal
fixtures under ``backend/tests/fixtures/`` — ``rsvp_orp_cases.json``,
``rsvp_focus_offset_cases.json``, ``rsvp_focus_slices_cases.json``,
``rsvp_last_started_cases.json`` and ``rsvp_line_offset_cases.json`` — which the
Python, TS and embedded-JS suites all read.

Invariants:

* **Presentation only.** Nothing here reads or writes a word's timing; it
  consumes ``start`` values and returns pixels. RSVP never re-times, re-orders or
  re-slices words (CLAUDE.md → Word-timing locality).
* **Measurement is injected.** The caller passes a ``measure`` callback so each
  renderer keeps its own equivalent primitive (PIL ``font.getlength()`` ↔ Canvas
  ``measureText().width``, per ``docs/caption-parity.md:11-21``). This module
  imports no PIL, does no I/O and knows nothing about FastAPI.
* **``line_offset_at`` is a pure function of ``t``.** No accumulated state, so
  seeking backwards lands on exactly the same offset as playing forwards.
* **Tokens are indexed in Unicode code points, not UTF-16 code units.** This
  module gets that for free — ``len(token)`` and ``token[i]`` on a ``str`` count
  code points — and *this* behaviour is the contract the twins normalize to: JS
  ``String#length``/``token[i]`` count code units, so both JS copies route through
  ``Array.from(token)`` before measuring or indexing. Without that, ``"🎬clap"``
  is 6 units → focus index 2 in JS but 5 code points → index 1 here, and
  ``"a🎬b"[1]`` is a lone surrogate in JS instead of the emoji — a different
  pivot offset and a tofu glyph. An **unpaired surrogate** (malformed input)
  counts as exactly one unit in all three languages: one ``str`` element here,
  one ``Array.from`` element there. See ``rsvp_orp_cases.json`` /
  ``rsvp_focus_offset_cases.json`` / ``rsvp_focus_slices_cases.json`` for the
  pinned astral + lone-surrogate cases.
* **Tokens are NFC-normalised first** (:func:`normalize_token`). A decomposed
  token — ``"é"`` as ``e`` + U+0301 — is two code points, so ``orp_index`` returns
  1 and the "focus glyph" would be the **combining mark on its own**, drawn by its
  own ``draw.text()`` call at an advanced pen with no base character under it.
  Pillow draws a bare U+0301, browsers draw it on a dotted circle (U+25CC): a
  parity divergence that cannot be fixed downstream. NFC composes it back to one
  code point, so all three languages see the same token.

  **Residual, accepted delta:** a combining mark with *no* precomposed form (e.g.
  ``"a"`` + U+0348) still counts as its own code point and can still be selected
  as the focus glyph. NFC cannot compose what Unicode has no composition for; the
  fixtures pin that case so the behaviour is known rather than surprising.
"""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from typing import Any, NamedTuple

# Upper bound of the last ORP breakpoint. Using +infinity (JS ``Infinity``)
# rather than a None sentinel keeps the lookup branch-free and identical in all
# three languages.
UNBOUNDED_TOKEN_LENGTH: float = math.inf


class OrpBreakpoint(NamedTuple):
    """One row of the Spritz ORP table.

    ``max_length`` is an *inclusive* upper bound on token length; ``index`` is
    the 0-based index of the focus character for tokens that fit it.
    """

    max_length: float
    index: int


#: The Spritz ORP table, as data so tests can assert against it instead of
#: re-deriving a hand-written mapping::
#:
#:     token length | focus index
#:            <= 1  | 0
#:            2-5   | 1
#:            6-9   | 2
#:            10-13 | 3
#:           >= 14  | 4
#:
#: Confirmed 9/9 against the reference clip (see
#: ``docs/plans/rsvp-speed-reading-mode.md``). Rows are ordered by ascending
#: ``max_length``; the first row whose bound the token fits wins.
RSVP_ORP_TABLE: tuple[OrpBreakpoint, ...] = (
    OrpBreakpoint(max_length=1, index=0),
    OrpBreakpoint(max_length=5, index=1),
    OrpBreakpoint(max_length=9, index=2),
    OrpBreakpoint(max_length=13, index=3),
    OrpBreakpoint(max_length=UNBOUNDED_TOKEN_LENGTH, index=4),
)


def normalize_token(token: str) -> str:
    """The token as the ORP rules see it: **NFC-composed**.

    The one place normalisation happens — every public entry point routes through
    it (``orp_index`` for the length, ``focus_slices`` for the split, and
    ``focus_offset`` via ``focus_slices``), so an index can never be computed on
    one form and applied to the other. The JS twins do the same with
    ``String#normalize('NFC')`` at the top of their code-point conversion
    (``codePoints``); this is the Python half of that pin.

    Why: see the module docstring — a decomposed ``"é"`` makes the *combining
    mark* the focus glyph, which Pillow and the browsers draw differently.
    Idempotent, so calling it twice on the same token is free of surprises.
    """
    return unicodedata.normalize("NFC", token)


def orp_index(token: str) -> int:
    """Focus-character index for a whitespace token.

    The length counted is that of the **whole token, punctuation included** —
    Spritz tokenizes on whitespace, so ``"saccades,"`` is length 9 → index 2.
    The empty string yields 0. ``len()`` on a ``str`` counts **code points**,
    which is the contract the JS twins normalize to (module docstring):
    ``"🎬clap"`` is 5 → index 1. The token is NFC-composed first
    (:func:`normalize_token`), so a decomposed ``"café"`` is 4, not 5.

    The result is always a valid index into ``token``: a table row that would
    point past the end (only reachable if the table is edited) is clamped to the
    last character, never returned out of range.
    """
    length = len(normalize_token(token))
    if length == 0:
        return 0

    index = RSVP_ORP_TABLE[-1].index
    for breakpoint_ in RSVP_ORP_TABLE:
        if length <= breakpoint_.max_length:
            index = breakpoint_.index
            break
    return min(max(index, 0), length - 1)


def _clamp_focus_index(length: int, f: int) -> int:
    """The one clamp both focus accessors share, so an out-of-range or junk ``f``
    can never mean two different things in ``focus_offset`` and ``focus_slices``.

    ``length`` is a **code point** count. ``f`` out of range is clamped into
    ``[0, length - 1]``; a non-finite ``f`` (only reachable from an untyped
    caller passing a float NaN) is read as 0, matching the JS twins'
    ``Number.isFinite`` guard.
    """
    if length <= 0:
        return 0
    raw = int(f) if math.isfinite(f) else 0
    return min(max(raw, 0), length - 1)


class FocusSlices(NamedTuple):
    """The active word split for drawing: before / at / after the focus glyph.

    ``prefix + focus + suffix == normalize_token(token)`` always holds — the
    pieces rebuild the **NFC** form, which is also the form the renderers draw.
    """

    prefix: str
    focus: str
    suffix: str


def focus_slices(token: str, f: int) -> FocusSlices:
    """Split ``token`` around its focus character, in **code points**.

    The single source of that split for all three renderers — Pillow draws the
    active word as three pieces, the Canvas preview draws three pieces and the
    HTML layer emits three spans, so hand-rolling the code-point rule a fourth
    time is exactly how the renderers would drift. ``str`` slicing already counts
    code points here; the JS twins reproduce it with ``Array.from``, which also
    keeps an **unpaired surrogate** whole (one unit, never split or dropped)
    instead of cutting an astral glyph in half.

    The token is NFC-composed first (:func:`normalize_token`), so the pieces
    rebuild the composed form and the focus piece is never a bare combining mark
    that has a precomposed form.

    ``f`` is clamped by :func:`_clamp_focus_index`. An empty token has nothing to
    split and yields three empty strings.
    """
    composed = normalize_token(token)
    if not composed:
        return FocusSlices("", "", "")

    i = _clamp_focus_index(len(composed), f)
    return FocusSlices(composed[:i], composed[i], composed[i + 1 :])


def focus_offset(
    word_x: float,
    token: str,
    f: int,
    measure: Callable[[str], float],
) -> float:
    """Centre of the focus character, in the same space as ``word_x``::

        focus_offset = word_x + measure(token[0:f]) + measure(token[f]) / 2

    ``word_x`` is the token's left edge on the unwrapped line, so the return
    value is "how far from the line's origin this word's focus glyph sits". The
    prefix/focus split comes from :func:`focus_slices`, so the pieces handed to
    ``measure`` are **NFC-composed**, ``f`` indexes **code points** and an astral
    glyph is measured whole; the JS twins reproduce that
    with ``Array.from``. ``f`` out of range is clamped into
    ``[0, len(token) - 1]``; an empty token has no glyph to centre on and returns
    ``word_x`` unchanged **without calling** ``measure``, so the answer cannot
    depend on what a caller's ``measure("")`` reports.

    Junk ``f`` is deliberately **asymmetric** across the twins and must stay that
    way: the JS copies coerce a non-finite/non-numeric ``f`` to 0 because their
    callers are untyped, while here a non-``int`` (``None``, ``"2"``) raises —
    this signature is typed, so a wrong type is a bug to surface, not to swallow.
    Do not "restore parity" by making Python absorb junk.
    """
    if not token:
        return word_x

    pieces = focus_slices(token, f)
    return word_x + measure(pieces.prefix) + measure(pieces.focus) / 2


def last_started_index(
    t: float,
    words: Sequence[Mapping[str, Any]],
    count: int | None = None,
) -> int:
    """Index of the **last** word whose ``start`` is at or before ``t``.

    The RSVP active-word rule, and deliberately **not** the ``start <= t < end``
    test the decoration modes use: silence between two words (and the tail after
    the last word's ``end``) has no ``start <= t < end`` answer, so that test
    would snap the line back instead of holding it. Extracted from
    :func:`line_offset_at` so the line's anchor and a renderer's *colouring*
    anchor cannot drift apart — Pillow tints the last-started word as the active
    word for exactly this reason (``rsvp_layout.py``).

    The two rules disagree on more than silence: a manually reordered group ships
    its ``custom_groups[].words`` verbatim, so ``start`` need not ascend, and
    overlapping word timings do it too. Colouring by ``start <= t < end`` painted
    a word that was *not* on the pivot column.

    Returns 0 for an empty ``words``, before the first word starts, and for a
    ``NaN`` ``t`` (which no comparison matches).

    Args:
        t: Time in seconds, on the same clock as each word's ``start``.
        words: The group's words in line order; only ``"start"`` is read.
        count: Optional upper bound on how many words to consider (used by
            :func:`line_offset_at`, which ignores words without a focus offset).
            ``None`` means "all of them"; the JS twins spell that ``undefined``
            (and, for their untyped callers, also accept ``null``).

    Both twins (``src/renderer/src/lib/rsvp.ts`` → ``lastStartedIndex``,
    ``RSVP_RUNTIME_JS`` → ``__capRsvp.lastStartedIndex``) expose the same function
    with the same ``count`` semantics, and all three are pinned by
    ``backend/tests/fixtures/rsvp_last_started_cases.json``.
    """
    limit = len(words) if count is None else min(count, len(words))
    active = 0
    for i in range(limit):
        if words[i]["start"] <= t:
            active = i
    return active


def line_offset_at(
    t: float,
    words: Sequence[Mapping[str, Any]],
    focus_offsets: Sequence[float],
    pivot_px: float,
    slide_duration: float,
) -> float:
    """The line's x translation at time ``t``, eased between consecutive words.

    The line is laid out once (giving one ``focus_offsets`` entry per word, in px
    relative to the line's origin) and then translated as a whole, so the active
    word's focus glyph sits on ``pivot_px``::

        target(i) = pivot_px - focus_offsets[i]

    The active word is the **last** word whose ``start`` is at or before ``t`` —
    deliberately not the ``start <= t < end`` test the decoration modes use.
    Silence between two words must *hold* the previous position; a
    ``start <= t < end`` test would have no answer there and the line would snap.

    Between the previous word's target and the active one's, the line eases over
    ``slide_duration`` seconds with the repo's shared quadratic ease-out
    ``1 - (1 - p) ** 2``. That curve is GSAP **``power1.out``** — ``power1`` is
    quad, ``power2`` is cubic (``docs/caption-parity.md:11-21``); "upgrading" it
    to ``power2`` reintroduces a real mid-slide divergence between renderers.

    Args:
        t: Time in seconds, on the same clock as each word's ``start``.
        words: The group's words in line order; only ``"start"`` is read. Typed
            ``Mapping[str, Any]`` rather than ``Mapping[str, float]`` so a
            renderer can pass its own richer per-word dict straight through —
            ``video_render``'s ``word_metrics`` rows also carry ``"word"`` (str)
            and ``"overrides"`` (dict), and the annotation must stay true if that
            shape is ever tightened.
        focus_offsets: One ``focus_offset()`` per word, px from the line origin.
        pivot_px: The fixed pivot column, in px in the same space.
        slide_duration: Slide length in **plain seconds**; ``<= 0`` snaps.

    Returns:
        The x translation to apply to the whole line. With no words there is
        nothing to align, so the line sits at the pivot (``pivot_px``).
    """
    count = min(len(words), len(focus_offsets))
    if count == 0:
        return pivot_px

    def target(i: int) -> float:
        return pivot_px - focus_offsets[i]

    # Last word whose start has passed; 0 before the first word starts (and for a
    # NaN ``t``, which no comparison matches).
    active = last_started_index(t, words, count)
    if active == 0:
        return target(0)

    elapsed = t - words[active]["start"]
    # ``not (x > 0)`` also rejects a NaN duration.
    if not (slide_duration > 0) or elapsed >= slide_duration:
        return target(active)

    p = elapsed / slide_duration
    eased = 1 - (1 - p) ** 2
    start_target = target(active - 1)
    return start_target + (target(active) - start_target) * eased


__all__ = [
    "UNBOUNDED_TOKEN_LENGTH",
    "OrpBreakpoint",
    "RSVP_ORP_TABLE",
    "FocusSlices",
    "normalize_token",
    "orp_index",
    "focus_slices",
    "focus_offset",
    "last_started_index",
    "line_offset_at",
]
