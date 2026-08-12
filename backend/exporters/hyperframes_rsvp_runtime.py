"""The RSVP core as embedded JavaScript — the THIRD implementation of the shared
ORP / line-offset contract.

Twins that must change in lockstep:

* ``src/renderer/src/lib/rsvp.ts`` — the Canvas preview's copy.
* ``backend/exporters/rsvp.py`` — the Pillow renderer's copy (the source of truth
  for the code-point rule, because it indexes a Python ``str``).

Three drifting copies of the ORP contract is precisely the bug class the caption
parity suite exists to catch, so all three are pinned by the *same* literal
fixtures under ``backend/tests/fixtures/`` (``rsvp_orp_cases.json``,
``rsvp_focus_offset_cases.json``, ``rsvp_focus_slices_cases.json`` and
``rsvp_line_offset_cases.json``), which the Python, TS and embedded-JS suites all
read.

This module holds nothing but the constant. It lives apart from
``hyperframes_caption_html.py`` because that module is at the repo's file-size
ceiling and because the block is deliberately self-contained: it references no
GSAP, no DOM and none of the ``__cap*`` helpers, so
``src/renderer/src/lib/rsvp.embedded.test.ts`` can regex it out of *this* source,
evaluate it in bare node and run it against the shared fixtures. The splice into
the emitted runtime happens in ``hyperframes_caption_html.py``
(``CAPTION_RUNTIME_JS``) and is pinned by ``backend/tests/test_hyperframes_project.py``.

ES5 ``var``/``function`` style matches the rest of the runtime; the three ES6
*builtins* it leans on (``Array.from`` for code-point iteration,
``String#normalize`` for the NFC pin and
``Number.isFinite``) exist in both hosts that ever evaluate this block — headless
Chromium and node — and are what keep it behaviourally identical to the TS twin.

Every top-level symbol the emitted runtime defines is ``__cap``-prefixed
(``__capHexToRgb``, ``__capRgb``, ``__capWhenFontsReady``, ``__capBuild``), so
this one is ``__capRsvp``: the block is spliced into a top-level inline
``<script>`` on a page that also loads GSAP from a CDN, the HyperFrames scaffold
and (in co-author mode) agent/CLI-installed components. An unprefixed
``window.RSVP`` would be a collision surface with no upside.
"""

from __future__ import annotations

RSVP_RUNTIME_JS = r"""
var __capRsvp = {
  // token length -> 0-based focus index; the first row the token fits wins.
  // Infinity is the unbounded last row (Python: math.inf) — no null sentinel, so
  // the lookup stays branch-free and identical across the three languages.
  ORP_TABLE: [
    { maxLength: 1,        index: 0 },
    { maxLength: 5,        index: 1 },
    { maxLength: 9,        index: 2 },
    { maxLength: 13,       index: 3 },
    { maxLength: Infinity, index: 4 }
  ],
  // Unicode CODE POINTS, not UTF-16 code units. The Python twin indexes a str
  // (code points) and it is the source of truth, so JS must normalize: '🎬clap'
  // is 5 code points but 6 code units (index 1 vs 2), and 'a🎬b'[1] is a lone
  // surrogate -> wrong pivot AND tofu from measureText/fillText. Array.from
  // iterates code points, so an UNPAIRED surrogate counts as exactly one unit and
  // is sliced whole — same as Python, where it is also one str element.
  // NFC first, and ONLY here (every rule below reaches its code points through
  // this function): a decomposed 'é' (e + U+0301) is two code points, so the focus
  // glyph would be the bare combining mark — drawn on a dotted circle (U+25CC) by
  // a browser but as a bare mark by Pillow. Python: unicodedata.normalize('NFC').
  // Residual accepted delta: a mark with no precomposed form (a + U+0348) has
  // nothing to compose to and can still be the focus glyph.
  codePoints: function(token){ return Array.from((token || '').normalize('NFC')); },
  // Length counts the WHOLE whitespace token, punctuation included ('saccades,'
  // is 9 -> 2). Result is always a valid index into the token.
  orpIndex: function(token){
    // __capRsvp.codePoints / __capRsvp.ORP_TABLE, not this.*: the methods stay
    // correct when a caller grabs one off the object (var f = __capRsvp.orpIndex).
    var len = __capRsvp.codePoints(token).length;
    if(len === 0) return 0;
    var table = __capRsvp.ORP_TABLE;
    var index = table[table.length - 1].index;
    for(var k = 0; k < table.length; k++){
      if(len <= table[k].maxLength){ index = table[k].index; break; }
    }
    return Math.min(Math.max(index, 0), len - 1);
  },
  // The one clamp both focus accessors share, so an out-of-range or junk f can
  // never mean two different things. `len` is a CODE POINT count.
  // Number.isFinite, not global isFinite: '' / null must not coerce to 0 here
  // (the TS twin uses Number.isFinite, so the two must agree on junk input).
  clampFocusIndex: function(len, f){
    if(len <= 0) return 0;
    var raw = Number.isFinite(f) ? Math.trunc(f) : 0;
    return Math.min(Math.max(raw, 0), len - 1);
  },
  // The active word split for drawing: everything before the focus glyph, the
  // focus glyph, everything after. Sliced by CODE POINT, so an astral glyph is
  // never cut in half and prefix + focus + suffix always rebuilds the token's NFC
  // form (which is what every renderer draws).
  // The single source of that split for all three renderers (Pillow draws three
  // pieces, Canvas draws three pieces, the HTML layer emits three spans).
  focusSlices: function(token, f){
    var chars = __capRsvp.codePoints(token);
    if(chars.length === 0) return { prefix: '', focus: '', suffix: '' };
    var i = __capRsvp.clampFocusIndex(chars.length, f);
    return {
      prefix: chars.slice(0, i).join(''),
      focus: chars[i],
      suffix: chars.slice(i + 1).join('')
    };
  },
  // wordX + measure(token[0:f]) + measure(token[f])/2 — the focus glyph's centre,
  // sliced by code point (via focusSlices) so an astral glyph is measured whole.
  focusOffset: function(wordX, token, f, measure){
    var chars = __capRsvp.codePoints(token);
    // An empty token has no glyph to centre on: return wordX WITHOUT calling
    // measure, so the answer cannot depend on what measure('') reports.
    if(chars.length === 0) return wordX;
    var s = __capRsvp.focusSlices(token, f);
    return wordX + measure(s.prefix) + measure(s.focus) / 2;
  },
  // Line x translation at time t. Active word = the LAST word whose start has
  // passed (NOT start<=t<end): inter-word silence must HOLD, not snap. Eased with
  // the shared quadratic 1-(1-p)^2 == GSAP 'power1.out' (power2 is cubic —
  // docs/caption-parity.md:11-21). Pure in t, so a backwards seek is exact.
  lineOffsetAt: function(t, words, focusOffsets, pivotPx, slideDuration){
    var count = Math.min(words.length, focusOffsets.length);
    if(count === 0) return pivotPx;
    function target(i){ return pivotPx - focusOffsets[i]; }
    var active = 0;
    for(var i = 0; i < count; i++){ if(words[i].start <= t) active = i; }
    if(active === 0) return target(0);
    var elapsed = t - words[active].start;
    if(!(slideDuration > 0) || elapsed >= slideDuration) return target(active);
    var p = elapsed / slideDuration;
    var eased = 1 - Math.pow(1 - p, 2);
    var from = target(active - 1);
    return from + (target(active) - from) * eased;
  }
};
"""

__all__ = ["RSVP_RUNTIME_JS"]
