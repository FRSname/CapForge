"""The gradient core as embedded JavaScript — the THIRD implementation of the
shared gradient grammar and gradient-line formula.

Twins that must change in lockstep:

* ``backend/exporters/gradient.py`` — the Pillow renderer's copy (the source of
  truth).
* ``src/renderer/src/lib/gradient.ts`` — the Canvas preview's copy.

All three are pinned by the *same* literal fixture,
``backend/tests/fixtures/gradient_cases.json``, read by
``backend/tests/test_gradient_core.py``, ``lib/gradient.test.ts`` and
``lib/gradient.embedded.test.ts``.

This module holds nothing but the constant, matching
``hyperframes_rsvp_runtime.py``: the block is deliberately self-contained — it
references no GSAP, no DOM and none of the other ``__cap*`` helpers — so
``lib/gradient.embedded.test.ts`` can regex it out of *this* source, evaluate it
in bare node and run it against the shared fixture. The splice into the emitted
runtime happens in ``hyperframes_caption_html.py`` (``CAPTION_RUNTIME_JS``) and
is pinned on the Python side by ``backend/tests/test_hyperframes_project.py``.

ES5 ``var``/``function`` style matches the rest of the runtime.

**Why the HTML layer parses at all**, rather than passing the config string into
a stylesheet: ``__capGradient.toCss`` re-emits from the *parsed* spec, so a
value that came from a ``.cfpreset``, a ``.cfproj`` or an MCP ``set_style`` can
never carry trailing CSS into the render page. Parsing here is the guard, not a
formality.
"""

GRADIENT_RUNTIME_JS = r"""
var __capGradient = {
  PREFIX: 'linear-gradient(',
  MAX_LENGTH: 512,
  MIN_STOPS: 2,
  MAX_STOPS: 8,
  HEX_RE: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
  ANGLE_RE: /^([+-]?(?:\d+\.?\d*|\.\d+))deg$/,
  STOP_RE: /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\s+([+-]?(?:\d+\.?\d*|\.\d+))%$/,

  // '#abc' / '#AaBbCc' -> canonical '#AABBCC'. Assumes a matched hex.
  normalizeHex: function(value){
    var h = String(value).trim().replace(/^#/, '');
    if(h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h.toUpperCase();
  },

  // The safe flat-colour reading of `value`, or `fallback`. Scoped to the
  // fields whose value space the gradient change widened.
  flatHex: function(value, fallback){
    if(typeof value === 'string' && this.HEX_RE.test(value.trim())) return this.normalizeHex(value);
    return fallback;
  },

  // A single '#RRGGBB' reading of `value`, whatever it holds: a gradient reads
  // as its FIRST STOP, for the consumers that cannot take one (the highlight
  // pill's text colour inheriting bgColor, a per-word box inheriting it).
  flatColor: function(value, fallback){
    var spec = this.parse(value);
    if(spec !== null) return spec.stops[0].color;
    return this.flatHex(value, fallback);
  },

  // Parse a restricted linear-gradient string, or null. null covers both
  // "plain hex, keep the flat path" and "malformed, rejected".
  parse: function(value){
    if(typeof value !== 'string') return null;
    var raw = value.trim();
    if(raw.length > this.MAX_LENGTH) return null;
    if(raw.toLowerCase().indexOf(this.PREFIX) !== 0) return null;
    if(raw.charAt(raw.length - 1) !== ')') return null;

    var inner = raw.slice(this.PREFIX.length, -1);
    // No nested parens: closes off url(...), a second gradient, and any ')'
    // that would let trailing declarations ride along into the CSS.
    if(inner.indexOf('(') >= 0 || inner.indexOf(')') >= 0) return null;

    var parts = inner.split(',').map(function(p){ return p.trim(); });
    if(parts.length < 1 + this.MIN_STOPS || parts.length > 1 + this.MAX_STOPS) return null;

    var angleMatch = this.ANGLE_RE.exec(parts[0]);
    if(!angleMatch) return null;
    // JS '%' keeps the sign of the dividend where Python's does not, so a
    // negative angle needs the extra turn to land in [0, 360) like the twin.
    var angle = ((Number(angleMatch[1]) % 360) + 360) % 360;

    var stops = [];
    var previous = -1;
    for(var i = 1; i < parts.length; i++){
      var stopMatch = this.STOP_RE.exec(parts[i]);
      if(!stopMatch) return null;
      var percent = Number(stopMatch[2]);
      if(!(percent >= 0 && percent <= 100)) return null;
      var offset = percent / 100;
      // Non-decreasing: an out-of-order stop is a typo, and the three
      // renderers' native gradient APIs disagree about how to fix one.
      if(offset < previous) return null;
      previous = offset;
      stops.push({ offset: offset, color: this.normalizeHex(stopMatch[1]) });
    }

    return { angle: angle, stops: stops };
  },

  // CSS gradient line for `spec` over `box` = [left, top, width, height],
  // returning [x0, y0, x1, y1] where the 0% and 100% stops sit.
  line: function(spec, box){
    var left = box[0], top = box[1], width = box[2], height = box[3];
    var radians = spec.angle * Math.PI / 180;
    var sinA = Math.sin(radians);
    var cosA = Math.cos(radians);
    // "Magic corner": long enough that 0% and 100% land on opposite corners.
    var length = Math.abs(width * sinA) + Math.abs(height * cosA);
    var centerX = left + width / 2;
    var centerY = top + height / 2;
    var halfX = sinA * length / 2;
    var halfY = cosA * length / 2;
    // y is negated because 0deg points to the *top* and y grows downward.
    return [centerX - halfX, centerY + halfY, centerX + halfX, centerY - halfY];
  },

  // Shortest fixed-point form, <=4 decimals — identical in all three copies.
  fmt: function(value){
    var text = value.toFixed(4).replace(/\.?0+$/, '');
    return (text === '' || text === '-') ? '0' : text;
  },

  // Re-emit from the PARSED spec, never from the caller's raw string.
  toCss: function(spec){
    var self = this;
    var stops = spec.stops.map(function(stop){
      return stop.color + ' ' + self.fmt(stop.offset * 100) + '%';
    }).join(', ');
    return 'linear-gradient(' + this.fmt(spec.angle) + 'deg, ' + stops + ')';
  }
};
"""

__all__ = ["GRADIENT_RUNTIME_JS"]
