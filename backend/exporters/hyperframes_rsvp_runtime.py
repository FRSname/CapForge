"""The RSVP core + builder as embedded JavaScript — the THIRD implementation of
the shared ORP / line-offset contract, and the HTML/GSAP half of the renderer.

Two constants live here:

* ``RSVP_RUNTIME_JS`` — the shared scalar core (``__capRsvp``), pinned across
  three languages by the fixtures under ``backend/tests/fixtures/``.
* ``RSVP_BUILD_JS`` — the *renderer*: ``__capRsvpBuild``, the twin of
  ``backend/exporters/rsvp_layout.py`` (Pillow, the source of truth) and of
  ``overlayGeometry.ts``'s ``computeRsvp*`` (Canvas). Read ``rsvp_layout``'s module
  docstring first; it is the spec, and nothing here re-derives it.

Twins that must change in lockstep:

* ``src/renderer/src/lib/rsvp.ts`` — the Canvas preview's copy.
* ``backend/exporters/rsvp.py`` — the Pillow renderer's copy (the source of truth
  for the code-point rule, because it indexes a Python ``str``).

Three drifting copies of the ORP contract is precisely the bug class the caption
parity suite exists to catch, so all three are pinned by the *same* literal
fixtures under ``backend/tests/fixtures/`` (``rsvp_orp_cases.json``,
``rsvp_focus_offset_cases.json``, ``rsvp_focus_slices_cases.json``,
``rsvp_last_started_cases.json`` and ``rsvp_line_offset_cases.json``), which the
Python, TS and embedded-JS suites all read.

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
``window.RSVP`` would be a collision surface with no upside. ``RSVP_BUILD_JS``
follows the same rule (``__capRsvpBuild``, ``__capRsvpTrackingGap``,
``__capRsvpReticle``, ``__capRsvpReticleRects``) — it *does* touch the DOM and
GSAP, so it is a second constant rather than an extension of the core block the
standalone node suite evaluates.
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
  // Index of the LAST word whose start is at or before t — the RSVP active-word
  // rule, deliberately NOT start<=t<end: inter-word silence (and the tail after the
  // last word's end) has no start<=t<end answer, so that test would snap the line
  // back instead of holding it. The two rules also disagree when starts do not
  // ascend (a manually reordered group) or when timings overlap.
  // Extracted rather than inlined in lineOffsetAt so the line's ANCHOR and the
  // renderer's COLOURING anchor cannot drift apart — Pillow tints the last-started
  // word for exactly this reason (rsvp_layout.py) and the HTML layer must colour
  // the word the line is parked on. Pinned by rsvp_last_started_cases.json.
  // `count` bounds the scan (lineOffsetAt ignores words with no focus offset);
  // null/undefined means "all of them" (Python: None). 0 for an empty list, before
  // the first word, and for a non-finite t, which no comparison matches.
  lastStartedIndex: function(t, words, count){
    var limit = (count === undefined || count === null)
      ? words.length
      : Math.min(count, words.length);
    var active = 0;
    for(var i = 0; i < limit; i++){ if(words[i].start <= t) active = i; }
    return active;
  },
  // Line x translation at time t. Active word = lastStartedIndex (see above).
  // Eased with the shared quadratic 1-(1-p)^2 == GSAP 'power1.out' (power2 is
  // cubic — docs/caption-parity.md:11-21). Pure in t, so a backwards seek is exact.
  lineOffsetAt: function(t, words, focusOffsets, pivotPx, slideDuration){
    var count = Math.min(words.length, focusOffsets.length);
    if(count === 0) return pivotPx;
    function target(i){ return pivotPx - focusOffsets[i]; }
    // __capRsvp.*, not this.*: the method stays correct when a caller grabs it off
    // the object (var f = __capRsvp.lineOffsetAt).
    var active = __capRsvp.lastStartedIndex(t, words, count);
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


# The HTML/GSAP renderer. Spliced after ``RSVP_RUNTIME_JS`` and before
# ``__capBuild`` (see ``hyperframes_caption_html.CAPTION_RUNTIME_JS``), which calls
# ``__capRsvpBuild`` for a group whenever ``CFG.readingMode === 'rsvp'``.
#
# Pillow is the source of truth: every formula below is the one in
# ``backend/exporters/rsvp_layout.py``, and the numbers it produces are pinned
# against that module by ``backend/tests/test_rsvp_html_layout.py`` (same fake
# measurement in both languages) and against real pixels by
# ``test_caption_parity.py::test_rsvp_parity``.
#
# Three things this layer must express differently from Pillow, none of them a
# formula change:
#
# * **The line translation is a transform, not a redraw.** The row lives in its own
#   ``.crsvp-row`` container translated by ``lineOffsetAt``'s single scalar; GSAP
#   tweens it with ``power1.out`` (the repo's quad ease — ``power2`` is cubic).
#   Words are never absolutely re-positioned per frame.
# * **The active word's three pieces are pre-built, not swapped in.** Pillow draws
#   context words as ONE kerned string and only the active word as three pieces (an
#   accepted delta); browsers do not kern across element boundaries, so pre-splitting
#   *every* word would lose kerning on context words too — a divergence Pillow does
#   not have. Keeping the whole-token span for context words means the two
#   representations differ per WORD STATE, which would otherwise mean mutating the
#   DOM mid-timeline; instead both are emitted up front and toggled with ``tl.set()``
#   opacity, so a frame stays a pure function of time (HyperFrames renders by
#   seeking a paused timeline, and a backwards seek must land on the same pixels).
#   Measured caveat: the parity gate cannot currently *discriminate* the two designs,
#   because Chromium does not apply the GPOS kerning PIL does — a pre-existing,
#   mode-independent divergence (wrap mode shows the same ~7px on a kerned pair, so
#   ``docs/caption-parity.md``'s ``measureText ≡ getlength`` equivalence has a
#   kerning exception). The choice is therefore the one that stays correct if that
#   gap is ever closed, and it costs nothing.
# * **The edge fade is a CSS mask on a STATIC wrapper.** ``.crsvp-band`` carries the
#   ramp and does not move; the sliding row is its child, so the ramp stays in frame
#   coordinates (a mask on the moving row would slide with the text). Two wrappers,
#   one for the per-word boxes and one for the text, so the *unmasked* reticle can
#   sit between them exactly as Pillow's unmasked ``guide_layer`` sits between its
#   masked pill and text layers.
RSVP_BUILD_JS = r"""
// The one inter-character gap a prefix measurement is short of: measureWord counts
// n-1 gaps (as do Pillow's _measure_tracked and Canvas' measureTrackedWidth), so
// the pen position of the character AFTER a non-empty prefix is one `trk` further
// right. focusOffset takes a single measure callback and cannot express that, so
// the layout and the three-piece pen walk both add it from here — one helper, so
// they cannot drift. Twin of rsvp_layout._tracking_gap / rsvpTrackingGap.
function __capRsvpTrackingGap(prefix, trk){ return (prefix && trk) ? trk : 0; }

// Reticle geometry, as multiples of the line's text height so it scales with font
// size. MUST equal rsvp_layout.py's RETICLE_*_EM (pinned by test_rsvp_reticle.py)
// and overlayGeometry.ts's constants of the same names.
var __capRsvpReticle = { RULE_LEN_EM: 1.10, THICKNESS_EM: 0.055, GAP_EM: 0.32, NOTCH_LEN_EM: 0.20 };

// A short rule with an inward notch, above and below the line, centred on the
// pivot. Pillow fills the HALF-OPEN box precisely so its drawn size IS this
// formula (ImageDraw.rectangle includes both endpoints; a CSS box does not), so
// these rects are used verbatim as left/top/width/height.
function __capRsvpReticleRects(pivotPx, centerY, textH){
  var R = __capRsvpReticle;
  var thickness = Math.max(1, textH * R.THICKNESS_EM);
  var halfLen = textH * R.RULE_LEN_EM / 2;
  var gap = textH * R.GAP_EM;
  var notch = textH * R.NOTCH_LEN_EM;
  var halfThick = thickness / 2;
  var top = centerY - textH / 2 - gap;      // inner edge of the upper rule
  var bottom = centerY + textH / 2 + gap;   // inner edge of the lower rule
  var ruleX = pivotPx - halfLen, notchX = pivotPx - halfThick;
  return [
    { x: ruleX, y: top - thickness, w: (pivotPx + halfLen) - ruleX, h: thickness },
    { x: ruleX, y: bottom, w: (pivotPx + halfLen) - ruleX, h: thickness },
    // Notches point back toward the text so the eye is guided to the pivot.
    { x: notchX, y: top, w: (pivotPx + halfThick) - notchX, h: notch },
    { x: notchX, y: bottom - notch, w: (pivotPx + halfThick) - notchX, h: notch }
  ];
}

// One group as a single sliding RSVP line. `ctx` is assembled by __capBuild and
// carries the values BOTH paths share (so nothing here re-measures or re-derives
// the row's centre, the glyph metrics or the per-word background box):
//   tl, CFG, g, bubble, wm, mc, fontStr, measureWord, mkWordBg,
//   band {left,width}, pivotPx, rowCenterY, textH, gapBase, spaceW, trk, resW, resH
function __capRsvpBuild(ctx){
  var CFG = ctx.CFG, tl = ctx.tl, g = ctx.g, wm = ctx.wm, mc = ctx.mc, trk = ctx.trk;
  var measureWord = ctx.measureWord, band = ctx.band, pivotPx = ctx.pivotPx;
  var fontStr = ctx.fontStr, rowCenterY = ctx.rowCenterY;
  if(!wm.length) return;
  // rsvpContextOpacity is a 0-1 FRACTION and rsvpSlideDuration is plain SECONDS
  // (<= 0 snaps) — see CLAUDE.md "StudioSettings units are NOT uniform".
  var ctxAlpha = (CFG.rsvpContextOpacity != null ? CFG.rsvpContextOpacity : 0.75);
  var slideDur = CFG.rsvpSlideDuration || 0;
  var focusColor = CFG.rsvpFocusColor || '#E4851F';

  // ── Layout: one unwrapped row, then ONE line translation ──────────────
  // Word advances are the wrap path's own measurement (m.width); measureWord is
  // used only for each word's PREFIX, to find its focus glyph.
  var wordX = [], x = 0;
  wm.forEach(function(m){ wordX.push(x); x += m.width + ctx.spaceW; });
  // lineOffsetAt/lastStartedIndex read `.start`; the payload spells it `s`.
  var timings = wm.map(function(m){ return { start: m.s, end: m.e }; });
  var focusOffsets = wm.map(function(m, i){
    mc.font = m.fstr;   // the prefix is measured in the word's OWN font, so a
    var f = __capRsvp.orpIndex(m.word);   // per-word font override still lands
    m.pieces = __capRsvp.focusSlices(m.word, f);   // its focus glyph on the pivot
    return __capRsvp.focusOffset(wordX[i], m.word, f, measureWord)
      + __capRsvpTrackingGap(m.pieces.prefix, trk);
  });
  mc.font = fontStr;
  function targetX(i){ return pivotPx - focusOffsets[i]; }

  // ── DOM: static masked band > sliding row, twice, reticle in between ──
  function mkLayer(cls){
    var d = document.createElement('div');
    d.className = cls;
    d.style.width = ctx.resW + 'px';
    d.style.height = ctx.resH + 'px';
    return d;
  }
  var boxBand = mkLayer('crsvp-band'), boxRow = mkLayer('crsvp-row');
  var textBand = mkLayer('crsvp-band'), textRow = mkLayer('crsvp-row');
  boxBand.appendChild(boxRow);
  textBand.appendChild(textRow);
  // Stacking (Pillow: bg -> word boxes -> guide -> text): the group background box
  // is already the bubble's first child, unmasked, framing the band.
  ctx.bubble.appendChild(boxBand);

  wm.forEach(function(m, i){
    var o = m.o;
    var ox = o.pos_offset_x || 0, oy = o.pos_offset_y || 0;
    // pos_offset_x/y move the DRAWN word including its focus glyph (intended —
    // an explicit nudge the user asked for), never the line's layout.
    var left = wordX[i] + ox;
    // Identical to the wrap path's span top, with the single row's centre: the
    // browser puts the baseline m.spanBase below the span top.
    var top = rowCenterY + (m.gap - ctx.gapBase) + (m.ascent - m.descent) / 2 - m.spanBase + oy;
    // mkWordBg reads these (m.x is line-origin space, like the wrap path's cursor).
    m.x = wordX[i]; m.ox = ox; m.oy = oy; m.cyc = rowCenterY;

    function face(el){
      if(m.fstr === fontStr) return;
      el.style.fontSize = m.size + 'px';
      el.style.fontFamily = '"' + m.fam + '", system-ui, sans-serif';
      el.style.fontWeight = m.weight;
    }
    m.el.style.left = left + 'px';
    m.el.style.top = top + 'px';
    face(m.el);
    m.el.style.color = o.text_color || CFG.textColor;
    // Default state is CONTEXT. Element opacity dims fill, stroke AND shadow
    // together, which is what Pillow's dimmed fill + _dim_alpha'd stroke add up to
    // (dimming only the fill drew an opaque outline around a ghost).
    m.el.style.opacity = String(ctxAlpha);
    textRow.appendChild(m.el);

    // The active representation: prefix / focus glyph / suffix, pre-built and
    // hidden. The pen walks the same advances the layout used, so the focus
    // glyph's centre lands on the pivot by construction. Accepted delta (Pillow
    // has it too): kerning is lost across the two seams.
    mc.font = m.fstr;
    var activeColor = o.active_word_color || CFG.activeColor;
    var pen = left;
    m.rsvpPieces = [];
    [[m.pieces.prefix, activeColor], [m.pieces.focus, focusColor], [m.pieces.suffix, activeColor]]
      .forEach(function(pair){
        if(!pair[0]) return;
        var sp = document.createElement('span');
        sp.className = 'cw crsvp-piece';
        sp.textContent = pair[0];
        sp.style.left = pen + 'px';
        sp.style.top = top + 'px';
        face(sp);
        sp.style.color = pair[1];
        sp.style.opacity = '0';
        textRow.appendChild(sp);
        m.rsvpPieces.push(sp);
        pen += measureWord(pair[0]) + __capRsvpTrackingGap(pair[0], trk);
      });
    mc.font = fontStr;

    // Per-word background box — the wrap path's own maker, into the masked box
    // row, so a box can never float past the band edge without its word.
    ctx.mkWordBg(m, boxRow);
    if(m.bgEl) m.bgEl.style.opacity = String(m.bgAlpha * ctxAlpha);
  });

  // The reticle is a fixed guide: unmasked (a pivot inside the fade ramp must not
  // dim the thing marking it) and outside the sliding rows.
  if(CFG.rsvpReticle){
    __capRsvpReticleRects(pivotPx, rowCenterY, ctx.textH).forEach(function(r){
      var d = document.createElement('div');
      d.className = 'crsvp-guide';
      d.style.left = r.x + 'px';
      d.style.top = r.y + 'px';
      d.style.width = r.w + 'px';
      d.style.height = r.h + 'px';
      d.style.background = focusColor;
      ctx.bubble.appendChild(d);
    });
  }
  ctx.bubble.appendChild(textBand);

  // ── Edge fade: an alpha ramp over the band's edges, as a MASK ──────────
  // 0 -> 1 over the leftmost `rsvpEdgeFade` of the band, 1 -> 0 over the rightmost,
  // 0 outside it (the band is a window). A mask, never a clip: a word straddling
  // the edge dissolves instead of being sliced. `0` is a clean no-op, so an
  // unmasked line may overflow the band — which is what "no edge fade" means.
  var fadePx = band.width * (CFG.rsvpEdgeFade || 0);
  if(fadePx > 0){
    var l = band.left, r = band.left + band.width;
    var ramp = 'linear-gradient(to right, rgba(0,0,0,0) 0px, rgba(0,0,0,0) ' + l + 'px, '
      + 'rgba(0,0,0,1) ' + (l + fadePx) + 'px, rgba(0,0,0,1) ' + (r - fadePx) + 'px, '
      + 'rgba(0,0,0,0) ' + r + 'px, rgba(0,0,0,0) 100%)';
    [boxBand, textBand].forEach(function(el){
      // no-repeat: the wrapper is the frame, so a repeated tile must not resurrect
      // the far end of the (unwrapped, frame-wide) row.
      el.style.webkitMaskImage = ramp; el.style.maskImage = ramp;
      el.style.webkitMaskRepeat = 'no-repeat'; el.style.maskRepeat = 'no-repeat';
    });
  }

  // ── Timeline: the slide, plus ONE colouring rule ──────────────────────
  // The coloured word is the word the line is PARKED on (lastStartedIndex), not
  // the `start <= t < end` active word: in inter-word silence that test has no
  // answer, and where the two merely disagree (overlapping timings, a manually
  // reordered group whose starts need not ascend) it would colour a word that is
  // not on the pivot. rsvp_layout's draw_line has no active_idx either.
  var rows = [boxRow, textRow];
  // force3D false: a 3D transform would promote the row to its own composited
  // layer and re-rasterize the text, so mid-slide glyphs would anti-alias
  // differently from Pillow's (and from a held frame's).
  function setLineX(v, at){ tl.set(rows, { x: v, force3D: false }, at); }
  function paint(m, at, isAnchor){
    tl.set(m.el, { opacity: isAnchor ? 0 : ctxAlpha }, at);
    m.rsvpPieces.forEach(function(sp){ tl.set(sp, { opacity: isAnchor ? 1 : 0 }, at); });
    // A context word's box is dimmed by the same factor as its glyphs; the anchor
    // word's box is not, so it matches its own undimmed fill/stroke.
    if(m.bgEl) tl.set(m.bgEl, { opacity: m.bgAlpha * (isAnchor ? 1 : ctxAlpha) }, at);
  }
  var cur = __capRsvp.lastStartedIndex(g.s, timings);
  setLineX(__capRsvp.lineOffsetAt(g.s, timings, focusOffsets, pivotPx, slideDur), g.s);
  paint(wm[cur], g.s, true);   // every other word already defaults to context
  // The anchor can only change at a word's `start`, so those are the boundaries —
  // walked in TIME order and resolved through lastStartedIndex, which keeps a
  // group with non-ascending starts on the same word the pure function reports.
  timings.map(function(w){ return w.start; })
    .sort(function(a, b){ return a - b; })
    .forEach(function(at){
      if(!(at > g.s)) return;
      var idx = __capRsvp.lastStartedIndex(at, timings);
      if(idx === cur) return;
      // Same ease and same endpoints as lineOffsetAt: the slide runs from the
      // ARRAY-previous word's target (not the previously anchored one, which the
      // pure function also ignores), and index 0 snaps.
      if(idx === 0 || !(slideDur > 0)) setLineX(targetX(idx), at);
      else tl.fromTo(rows, { x: targetX(idx - 1) },
        { x: targetX(idx), duration: slideDur, ease: 'power1.out',
          force3D: false, immediateRender: false, overwrite: 'auto' }, at);
      paint(wm[cur], at, false);
      paint(wm[idx], at, true);
      cur = idx;
    });
}
"""

__all__ = ["RSVP_RUNTIME_JS", "RSVP_BUILD_JS"]
