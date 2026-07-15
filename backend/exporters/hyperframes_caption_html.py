"""Faithful HTML/CSS/GSAP caption generator — CapForge parity for HyperFrames.

The CapForge panel renders captions two ways that already match pixel-for-pixel:
the Canvas preview (`src/renderer/src/hooks/useSubtitleOverlay.ts`) and the Pillow
final render (`backend/exporters/video_render.py`). When the HyperFrames engine
renders captions it is effectively a *third* renderer, and it must match the other
two — otherwise entering co-author mode (or rendering with a native HyperFrames
caption) silently changes the look the user configured.

This module emits that third renderer. It reproduces the Canvas logic — every
`word_transition` mode (instant, crossfade, highlight, underline, bounce, scale,
karaoke, reveal, none), the group entrance/exit animations (none/fade/slide/pop), text
stroke, drop shadow, tracking, alignment, multi-line grouping and positioning —
from the same `VideoRenderConfig` the other two renderers consume.

Design:
- The Python side stays small: it emits a compact ``CAP_CFG`` (style) + ``CAP_GROUPS``
  (word timings) payload and a *static* JS runtime that does all the work in the
  browser, generically, so there is no per-word JS string generation to drift.
- The runtime measures glyph metrics with a canvas 2D context using the SAME
  ``measureText('Ayg')`` approach as the Canvas preview, then positions DOM word
  spans and overlay elements (pill / underline / karaoke) with the SAME formulas.
  Text is real DOM (crisp), overlays are measured from the rendered layout.
- Determinism (HyperFrames contract): no ``Math.random`` / ``Date.now`` / infinite
  repeats. One group visible at a time, a hard ``tl.set`` kill at each group end.

Parity is anchored by ``backend/tests/test_caption_parity.py`` (Pillow vs the
HyperFrames snapshot). When you change a formula here, change it in
``useSubtitleOverlay.ts`` + ``video_render.py`` in lockstep (see CLAUDE.md
"Preview ↔ Render Parity").
"""

from __future__ import annotations

import html
import json
from typing import Optional

from backend.models.schemas import VideoRenderConfig


def _crossfade_dur(config: VideoRenderConfig) -> float:
    """Crossfade ramp seconds, from the render config so the three renderers share
    one value (mirrors ``CROSSFADE_DUR`` / ``video_render._CROSSFADE_DUR``)."""
    return float(config.crossfade_duration or 0.06)


def caption_cfg(config: VideoRenderConfig) -> dict:
    """The style payload the JS runtime reads (camel keys mirror StudioSettings).

    All geometry/animation is derived in the runtime from these + measured glyph
    metrics, exactly as ``useSubtitleOverlay.ts`` does."""
    return {
        "resW": config.resolution_w,
        "resH": config.resolution_h,
        "fontFamily": config.font_family or "",
        "fontSize": config.font_size,
        "lineHeight": config.line_height,
        "tracking": config.tracking or 0,
        "lines": config.lines,
        "maxWidth": config.max_width,  # fraction 0-1
        "posX": config.position_x,     # fraction 0-1
        "posY": config.position_y,     # fraction 0-1
        "padH": config.bg_padding_h,
        "padV": config.bg_padding_v,
        "bgColor": config.bg_color,
        "bgOpacity": config.bg_opacity,
        "bgRadius": config.bg_corner_radius,
        "bgWidthExtra": config.bg_width_extra,
        "bgHeightExtra": config.bg_height_extra,
        "textOffsetX": config.text_offset_x,
        "textOffsetY": config.text_offset_y,
        "alignH": config.text_align_h,
        "alignV": config.text_align_v,
        "textColor": config.text_color,
        "activeColor": config.active_word_color,
        "strokeWidth": config.stroke_width,
        "strokeColor": config.stroke_color,
        "shadowEnabled": bool(config.shadow_enabled),
        "shadowColor": config.shadow_color,
        "shadowOpacity": config.shadow_opacity,
        "shadowBlur": config.shadow_blur,
        "shadowOffsetX": config.shadow_offset_x,
        "shadowOffsetY": config.shadow_offset_y,
        "animation": config.animation,
        "animDur": config.animation_duration,
        "crossfadeDur": _crossfade_dur(config),
        "wordTransition": config.word_transition,
        "highlightTextColor": config.highlight_text_color or "",
        "hlPadX": config.highlight_padding_x,
        "hlPadY": config.highlight_padding_y,
        "hlRadius": config.highlight_radius,
        "hlOpacity": config.highlight_opacity,
        # Same getattr default as Pillow (video_render.py highlight_anim).
        "hlAnim": getattr(config, "highlight_animation", "jump"),
        "hlOffX": getattr(config, "highlight_offset_x", 0),
        "hlOffY": getattr(config, "highlight_offset_y", 0),
        "ulThickness": config.underline_thickness,
        "ulColor": config.underline_color or "",
        "ulOffsetY": config.underline_offset_y,
        "ulWidth": config.underline_width,
        "bounceStrength": config.bounce_strength,
        "scaleFactor": config.scale_factor,
    }


def caption_markup(groups: list[dict]) -> str:
    """Pre-rendered caption DOM: one ``.cgroup`` per group, each a ``.cbubble``
    (positioned context for measured overlays) of ``.cw`` word spans. Text lives
    in the DOM (escaped); the runtime positions + animates by index."""
    blocks: list[str] = []
    for gi, group in enumerate(groups):
        spans = [
            f'<span id="cg-{gi}-w{wj}" class="cw">{html.escape(w["word"].strip())}</span>'
            for wj, w in enumerate(group["words"])
        ]
        blocks.append(
            f'<div id="cg-{gi}" class="cgroup">'
            f'<span id="cb-{gi}" class="cbubble">{"".join(spans)}</span>'
            f"</div>"
        )
    return "\n      ".join(blocks)


# Per-word override keys forwarded to the JS runtime — exactly the set Pillow
# honors (video_render.py _draw_word_list / _render_frame). ``custom_font_path``
# is deliberately absent: local paths must never leak into the HTML; the file
# itself is embedded server-side via a per-word @font-face
# (hyperframes_project._word_font_face_blocks), same mechanism as the main font.
_WORD_OVERRIDE_KEYS = (
    "text_color", "active_word_color", "font_size_scale", "bold", "font_family",
    "word_transition", "pos_offset_x", "pos_offset_y", "bounce_strength",
    "scale_factor", "underline_thickness", "underline_color", "underline_offset_y",
    "underline_width", "highlight_padding_x", "highlight_padding_y",
    "highlight_radius", "highlight_opacity", "highlight_offset_x", "highlight_offset_y",
)


def _word_entry(w: dict) -> dict:
    """One word's payload: timings plus a compact ``"o"`` object carrying only
    the override keys actually present (omitted entirely for plain words)."""
    ov = w.get("overrides") or {}
    o = {k: ov[k] for k in _WORD_OVERRIDE_KEYS if ov.get(k) is not None}
    if o:
        return {"s": w["start"], "e": w["end"], "o": o}
    return {"s": w["start"], "e": w["end"]}


def _group_entry(g: dict) -> dict:
    """One group's payload: timings + words, plus a sparse ``"pos"`` object when
    the group carries a position override (mirrors the per-word ``"o"`` shape)."""
    entry: dict = {
        "s": g["start"],
        "e": g["end"],
        "w": [_word_entry(w) for w in g["words"]],
    }
    pos = {k: g[k] for k in ("position_x", "position_y") if g.get(k) is not None}
    if pos:
        entry["pos"] = pos
    return entry


def caption_groups_json(groups: list[dict]) -> str:
    """Compact word-timing payload aligned by index with the DOM spans."""
    return json.dumps([_group_entry(g) for g in groups], ensure_ascii=False)


def caption_css(config: VideoRenderConfig) -> str:
    """Static CSS for the caption layer. Positions/sizes are set inline by the
    runtime; this only carries what CSS expresses better than JS (base type, the
    text stroke, the drop shadow)."""
    cfg = caption_cfg(config)
    stroke = ""
    if cfg["strokeWidth"] and cfg["strokeWidth"] > 0:
        stroke = (
            f'  -webkit-text-stroke: {cfg["strokeWidth"]}px {cfg["strokeColor"]};\n'
            "  paint-order: stroke fill;\n"
        )
    shadow = ""
    if cfg["shadowEnabled"]:
        a = max(0.0, min(1.0, cfg["shadowOpacity"]))
        sc = _rgba(cfg["shadowColor"], a)
        shadow = (
            f'  text-shadow: {cfg["shadowOffsetX"]}px {cfg["shadowOffsetY"]}px '
            f'{cfg["shadowBlur"]}px {sc};\n'
        )
    fam = cfg["fontFamily"] or "system-ui"
    return f""".captions {{ position: absolute; left: 0; top: 0; width: {cfg['resW']}px; height: {cfg['resH']}px; z-index: 10; pointer-events: none; }}
    .cgroup {{ position: absolute; left: 0; top: 0; width: 100%; height: 100%; opacity: 0; visibility: hidden; }}
    .cbubble {{ position: absolute; left: 0; top: 0; }}
    .cbubble-bg {{ position: absolute; }}
    .cw {{
      position: absolute;
      white-space: nowrap;
      font-family: "{fam}", system-ui, sans-serif;
      font-size: {cfg['fontSize']}px;
      font-weight: 400;
      line-height: 1;
      letter-spacing: {cfg['tracking']}px;
      color: {cfg['textColor']};
{stroke}{shadow}    }}
    .cw-pill {{ position: absolute; }}
    .cw-underline {{ position: absolute; }}
    .cw-kfill {{ position: absolute; white-space: nowrap; overflow: hidden; }}"""


def _rgba(hex_color: str, opacity: float) -> str:
    h = (hex_color or "#000000").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    except (ValueError, IndexError):
        r, g, b = 0, 0, 0
    return f"rgba({r}, {g}, {b}, {max(0.0, min(1.0, opacity)):.3f})"


def caption_payload_js(config: VideoRenderConfig, groups: list[dict]) -> str:
    """``var CAP_CFG = {...}; var CAP_GROUPS = [...];`` for the runtime."""
    return (
        f"  var CAP_CFG = {json.dumps(caption_cfg(config), ensure_ascii=False)};\n"
        f"  var CAP_GROUPS = {caption_groups_json(groups)};\n"
    )


def caption_build_call() -> str:
    """The call that wires caption animations onto the shared root timeline."""
    return "  __capBuild(tl, CAP_CFG, CAP_GROUPS);\n"


# The static runtime. Ported from useSubtitleOverlay.ts draw(): identical glyph
# metrics (canvas measureText('Ayg')), identical word-position + box formulas,
# rendered to DOM with a GSAP timeline instead of a per-frame canvas paint.
CAPTION_RUNTIME_JS = r"""
function __capHexToRgb(hex){ var n=parseInt((hex||'').replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function __capRgb(c){ return 'rgb('+c[0]+','+c[1]+','+c[2]+')'; }

// Run `cb` only after the caption font is loaded, so the canvas measureText()
// inside __capBuild reports REAL glyph widths — not a fallback font's. Measuring
// before the @font-face decodes (the headless render's cold-cache case) bakes
// wrong word positions → captions look correctly fonted but mis-spaced ("words
// connected"). The live preview escapes this only because the font is warm.
// GROUPS (optional) lets the gate also await every distinct per-word face
// (font_family / bold overrides) — those spans are styled from JS, so nothing
// in the DOM would otherwise trigger their load before measurement.
// Raced against a timeout so a missing/never-loading font never hangs the render.
function __capWhenFontsReady(CFG, GROUPS, cb){
  if(typeof GROUPS === 'function'){ cb = GROUPS; GROUPS = null; }
  var done = false;
  function run(){ if(done) return; done = true; try { cb(); } catch(e){ if(window.console) console.error('[caption] build failed', e); } }
  try {
    var fam = CFG.fontFamily || '';
    var fonts = document.fonts;
    if(fonts && typeof fonts.load === 'function'){
      var specs = {};
      if(fam) specs['normal ' + (CFG.fontSize || 40) + 'px "' + fam + '"'] = 1;
      (GROUPS || []).forEach(function(g){ (g.w || []).forEach(function(wd){
        var o = wd.o; if(!o) return;
        var wfam = o.font_family || fam; if(!wfam) return;
        var size = Math.round((CFG.fontSize || 40) * (o.font_size_scale != null ? o.font_size_scale : 1));
        specs[(o.bold ? '700 ' : 'normal ') + size + 'px "' + wfam + '"'] = 1;
      }); });
      var keys = Object.keys(specs);
      if(keys.length){
        var loads = keys.map(function(s){ return fonts.load(s).catch(function(){}); });
        var ready = fonts.ready || Promise.resolve();
        Promise.race([
          Promise.all(loads.concat([ready])),
          new Promise(function(r){ setTimeout(r, 3000); })
        ]).then(run, run);
      } else if(fonts.ready){
        Promise.race([ fonts.ready, new Promise(function(r){ setTimeout(r, 3000); }) ]).then(run, run);
      } else {
        run();
      }
    } else if(fonts && fonts.ready){
      Promise.race([ fonts.ready, new Promise(function(r){ setTimeout(r, 3000); }) ]).then(run, run);
    } else {
      run();
    }
  } catch(e){ run(); }
}

function __capBuild(tl, CFG, GROUPS){
  var layer = document.getElementById('captions');
  if(!layer) return;
  var resW = CFG.resW, resH = CFG.resH;

  // Glyph metrics — identical to the Canvas preview (measureText of "Ayg").
  var mc = document.createElement('canvas').getContext('2d');
  var fontStr = 'normal ' + CFG.fontSize + 'px "' + (CFG.fontFamily || '-apple-system') + '", sans-serif';
  mc.font = fontStr;
  var ayg = mc.measureText('Ayg');
  var ascent = ayg.actualBoundingBoxAscent || CFG.fontSize * 0.8;
  var descent = ayg.actualBoundingBoxDescent || CFG.fontSize * 0.2;
  var textH = ascent + descent;
  var baselineShift = (ascent - descent) / 2;
  // Where the browser puts the baseline INSIDE a line-height:1 absolute span:
  // half-leading + FONT ascent (the hhea/OS2 metrics inline layout uses —
  // exposed by canvas fontBoundingBox*), NOT the ink ascent of 'Ayg'. Fonts
  // whose ascent+descent != 1em (CaviarDreams: 106px @ 90px em) otherwise
  // render the whole text ~8px off the Canvas/Pillow position. Falls back to
  // the ink ascent when fontBoundingBox* is unsupported.
  function spanBaseline(size, fm, inkAscent){
    var fa = fm.fontBoundingBoxAscent, fd = fm.fontBoundingBoxDescent;
    return (fa != null && fd != null) ? (size - fa - fd) / 2 + fa : inkAscent;
  }
  var spanBase = spanBaseline(CFG.fontSize, ayg, ascent);
  // Ascender→ink gap ('Ayg'). Pillow anchors words on the font ASCENDER line
  // (PIL 'la' anchor: y = center_y - text_h/2 - bbox[1]), so a font_size_scale
  // override word lands at center_y + (w_bbox[1] - bbox[1]) — ink-centred PLUS
  // the scaled-vs-base gap delta. Canvas fontBoundingBoxAscent - ink ascent is
  // that same gap; the delta term below reproduces Pillow exactly (0 for base).
  var gapBase = (ayg.fontBoundingBoxAscent != null ? ayg.fontBoundingBoxAscent : ascent) - ascent;
  var rowLineGap = textH * ((CFG.lineHeight || 1.2) - 1);
  var trk = CFG.tracking || 0;
  function measureWord(t){ if(!trk) return mc.measureText(t).width; var w=0; for(var i=0;i<t.length;i++){ w+=mc.measureText(t[i]).width; if(i<t.length-1) w+=trk; } return w; }
  var spaceW = mc.measureText(' ').width;

  var padH = CFG.padH, padV = CFG.padV;
  var sStroke = CFG.strokeWidth || 0;
  var maxW = (CFG.maxWidth != null ? CFG.maxWidth : 0.9) * resW;
  var bgOpacity = CFG.bgOpacity || 0;

  GROUPS.forEach(function(g, gi){
    var gEl = document.getElementById('cg-' + gi);
    if(!gEl) return;
    var bubble = gEl.querySelector('.cbubble');
    var spans = Array.prototype.slice.call(gEl.querySelectorAll('.cw'));

    // Measure each word (canvas advance widths — match the rendered DOM glyphs).
    // Per-word overrides (payload "o") resolve with the same fallback chain the
    // Canvas preview uses (useSubtitleOverlay.ts): size scale, family, weight.
    // Each word is measured with ITS OWN font so cursor advance + wrapping match
    // Pillow's per-word measurement; the inter-word space stays base-font.
    var wm = spans.map(function(sp, i){
      var wd = g.w[i], o = wd.o || {};
      var wSize = Math.round(CFG.fontSize * (o.font_size_scale != null ? o.font_size_scale : 1));
      var wFam = o.font_family || CFG.fontFamily || '-apple-system';
      var wStr = (o.bold ? '700 ' : 'normal ') + wSize + 'px "' + wFam + '", sans-serif';
      mc.font = wStr;
      var m = { el: sp, width: measureWord(sp.textContent), s: wd.s, e: wd.e, o: o,
                size: wSize, fam: wFam, weight: o.bold ? '700' : '400', fstr: wStr,
                ascent: ascent, descent: descent, textH: textH, spanBase: spanBase,
                gap: gapBase };
      if(wStr !== fontStr){
        var a2 = mc.measureText('Ayg');
        m.ascent = a2.actualBoundingBoxAscent || wSize * 0.8;
        m.descent = a2.actualBoundingBoxDescent || wSize * 0.2;
        m.textH = m.ascent + m.descent;
        m.spanBase = spanBaseline(wSize, a2, m.ascent);
        m.gap = (a2.fontBoundingBoxAscent != null ? a2.fontBoundingBoxAscent : m.ascent) - m.ascent;
      }
      return m;
    });
    mc.font = fontStr;

    // Rows — greedy wrap for lines<=1, equal-slice for lines>1 (mirrors Canvas).
    var rows = [];
    var numLines = CFG.lines || 1;
    if(numLines <= 1){
      var totalW = wm.reduce(function(s,m,i){ return s + m.width + (i>0?spaceW:0); }, 0);
      if(totalW > maxW && wm.length > 1){
        var row = [], rowW = 0;
        wm.forEach(function(m){
          var addW = row.length>0 ? spaceW + m.width : m.width;
          if(row.length>0 && rowW + addW > maxW){ rows.push(row); row=[m]; rowW=m.width; }
          else { row.push(m); rowW += addW; }
        });
        if(row.length) rows.push(row);
      } else { rows.push(wm); }
    } else {
      var perRow = Math.ceil(wm.length / numLines);
      for(var r=0;r<numLines;r++){ var slice = wm.slice(r*perRow,(r+1)*perRow); if(slice.length) rows.push(slice); }
    }

    var rowWidths = rows.map(function(row){ var w=0; row.forEach(function(m,i){ w+=m.width; if(i<row.length-1) w+=spaceW; }); return w; });
    var maxRowW = Math.max.apply(null, rowWidths);

    var bgWidthExtra = CFG.bgWidthExtra || 0, bgHeightExtra = CFG.bgHeightExtra || 0;
    var strokePad = sStroke;
    var bgW = maxRowW + padH*2 + strokePad*2 + bgWidthExtra;
    var totalTextH = rows.length*textH + (rows.length-1)*rowLineGap;
    var bgH = totalTextH + padV*2 + strokePad*2 + bgHeightExtra;
    // Per-group position override (payload "pos", fractions) beats CFG.
    var gp = g.pos || {};
    var cx = resW * (gp.position_x != null ? gp.position_x : (CFG.posX != null ? CFG.posX : 0.5));
    var cy = resH * (gp.position_y != null ? gp.position_y : (CFG.posY != null ? CFG.posY : 0.82));

    var alignH = CFG.alignH || 'center', alignV = CFG.alignV || 'middle';
    var txOff = CFG.textOffsetX || 0, tyOff = CFG.textOffsetY || 0;
    var alignShiftX = alignH==='left' ? -bgWidthExtra/2 : alignH==='right' ? bgWidthExtra/2 : 0;
    var alignShiftY = alignV==='top' ? -bgHeightExtra/2 : alignV==='bottom' ? bgHeightExtra/2 : 0;

    // Bubble is a positioned context spanning the canvas so children use absolute
    // coords in resolution space.
    bubble.style.left = '0px'; bubble.style.top = '0px';
    bubble.style.width = resW + 'px'; bubble.style.height = resH + 'px';

    // Background pill behind everything.
    if(bgOpacity > 0){
      var bg = document.createElement('div');
      bg.className = 'cbubble-bg';
      bg.style.left = (cx - bgW/2) + 'px';
      bg.style.top = (cy - bgH/2) + 'px';
      bg.style.width = bgW + 'px';
      bg.style.height = bgH + 'px';
      bg.style.background = CFG.bgColor;
      bg.style.opacity = String(bgOpacity);
      bg.style.borderRadius = CFG.bgRadius + 'px';
      bubble.insertBefore(bg, bubble.firstChild);
    }

    // Position each word span (visual centre on its row), then build per-word
    // overlays as the active mode needs.
    var mode = CFG.wordTransition || 'instant';
    var pills = [], underlines = [], kfills = [];
    rows.forEach(function(row, ri){
      var rowY = cy + alignShiftY + tyOff - totalTextH/2 + textH/2 + ri*(textH + rowLineGap);
      var wx = cx + alignShiftX + txOff - rowWidths[ri]/2;
      var prevInRow = null;
      row.forEach(function(m){
        // DOM span top: the browser puts the word's baseline spanBase below the
        // span top (half-leading + FONT ascent — spanBaseline above), so
        // top = desired baseline (rowY + (ascent-descent)/2, the Canvas/Pillow
        // formula) - spanBase. Using the ink ascent here instead lands the text
        // ~8px off for fonts whose ascent+descent != 1em (CaviarDreams).
        // Override words use their OWN metrics — equivalent to Pillow's
        // scaled-word centering word_y = y - (w_text_h - text_h)/2.
        // pos_offset_x/y is additive per word; must NOT shift the cursor.
        var ox = m.o.pos_offset_x || 0, oy = m.o.pos_offset_y || 0;
        m.el.style.left = (wx + ox) + 'px';
        m.el.style.top = (rowY + (m.gap - gapBase) + (m.ascent - m.descent)/2 - m.spanBase + oy) + 'px';
        if(m.fstr !== fontStr){
          m.el.style.fontSize = m.size + 'px';
          m.el.style.fontFamily = '"' + m.fam + '", system-ui, sans-serif';
          m.el.style.fontWeight = m.weight;
        }
        if(m.o.text_color) m.el.style.color = m.o.text_color;
        m.cxc = wx + m.width/2; m.cyc = rowY; m.x = wx; m.ox = ox; m.oy = oy;
        // Row-local previous word: Pillow's highlight slide gates on
        // active_idx > 0 WITHIN the wrapped row (_draw_word_list runs per row),
        // so the pill never slides across a line break.
        m.prev = prevInRow; prevInRow = m;
        wx += m.width + spaceW;
      });
    });

    // Helper makers (appended to bubble; absolute, resolution coords). Each
    // reads the word's own overrides with CFG fallbacks — mirroring Pillow's
    // active-word pill/underline semantics (video_render.py _draw_word_list).
    function mkPill(m){
      var o = m.o;
      var wHlPadX = Math.max(o.highlight_padding_x != null ? o.highlight_padding_x : CFG.hlPadX, sStroke + 2);
      var wHlPadY = Math.max(o.highlight_padding_y != null ? o.highlight_padding_y : CFG.hlPadY, sStroke + 2);
      var wHlOffX = o.highlight_offset_x != null ? o.highlight_offset_x : (CFG.hlOffX||0);
      var wHlOffY = o.highlight_offset_y != null ? o.highlight_offset_y : (CFG.hlOffY||0);
      m.hlPadX = wHlPadX;  // slide tween re-derives the padded rect from this
      m.hlOffX = wHlOffX;  // slide tween adds this to BOTH from/to (rigid translate)
      var p = document.createElement('div'); p.className='cw-pill';
      p.style.left = (m.x + m.ox - wHlPadX + wHlOffX) + 'px';
      // Pill height stays BASE textH even for scaled words (Pillow uses text_h).
      p.style.top = (m.cyc + m.oy - textH/2 - wHlPadY + wHlOffY) + 'px';
      p.style.width = (m.width + wHlPadX*2) + 'px';
      p.style.height = (textH + wHlPadY*2) + 'px';
      p.style.background = CFG.activeColor;  // global — Pillow never recolors the pill per word
      p.style.borderRadius = (o.highlight_radius != null ? o.highlight_radius : CFG.hlRadius) + 'px';
      p.style.opacity = '0';
      bubble.insertBefore(p, bubble.querySelector('.cw'));
      return p;
    }
    function mkUnderline(m){
      var o = m.o;
      var u = document.createElement('div'); u.className='cw-underline';
      var ulWCfg = o.underline_width != null ? o.underline_width : CFG.ulWidth;
      var ulW = ulWCfg > 0 ? ulWCfg : m.width;
      var ulX = ulWCfg > 0 ? m.x + m.ox + (m.width - ulW)/2 : m.x + m.ox;
      u.style.left = ulX + 'px';
      // Bar sits under the word's OWN text height (Pillow: center_y + w_text_h/2).
      u.style.top = (m.cyc + m.textH/2 + (o.underline_offset_y != null ? o.underline_offset_y : CFG.ulOffsetY) + m.oy) + 'px';
      u.style.width = ulW + 'px';
      u.style.height = (o.underline_thickness != null ? o.underline_thickness : CFG.ulThickness) + 'px';
      u.style.background = o.underline_color || CFG.ulColor || CFG.activeColor;
      u.style.opacity = '0';
      bubble.appendChild(u);
      return u;
    }
    function mkKFill(m){
      var k = document.createElement('span'); k.className='cw-kfill';
      k.textContent = m.el.textContent;
      k.style.left = m.el.style.left; k.style.top = m.el.style.top;
      k.style.fontFamily = getComputedStyle(m.el).fontFamily;
      k.style.fontSize = m.size + 'px';
      k.style.fontWeight = m.weight;
      k.style.letterSpacing = trk + 'px';
      k.style.color = m.o.active_word_color || CFG.activeColor;
      k.style.width = '0px';
      bubble.appendChild(k);
      return k;
    }

    // Per-word effective transition (Pillow: w_word_trans) picks the overlay —
    // pill only for effective-'highlight' words, underline for 'underline',
    // karaoke fill for 'karaoke'. Pillow's pill gating on the ACTIVE word's
    // transition falls out naturally: only the active word's own overlay shows.
    wm.forEach(function(m){
      m.mode = m.o.word_transition || mode;
      if(m.mode === 'highlight') m.pill = mkPill(m);
      if(m.mode === 'underline') m.underline = mkUnderline(m);
      if(m.mode === 'karaoke') m.kfill = mkKFill(m);
    });

    // ── Timeline: group entrance/exit + per-word behavior ──
    var anim = CFG.animation || 'none';
    var animDur = CFG.animDur || 0;
    var sel = '#cg-' + gi;
    tl.set(sel, { visibility: 'visible' }, g.s);
    // Entry/exit ease is QUADRATIC: Canvas easeOut (useSubtitleOverlay.ts) and
    // Pillow _ease_out are both 1-(1-t)^2, and GSAP 'power1' IS that quad —
    // 'power2' is cubic (the same naming trap as the highlight slide below).
    // Exit: Canvas alpha = easeOut(remaining/dur) = 1-p^2 in tween progress p,
    // and a GSAP to-opacity-0 tween gives alpha = 1-E(p), so E = 'power1.in' (p^2).
    if(anim === 'none' || animDur <= 0){
      tl.set(sel, { opacity: 1, y: 0, scale: 1 }, g.s);
    } else if(anim === 'fade'){
      tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: animDur, ease: 'power1.out', overwrite: 'auto' }, g.s);
    } else if(anim === 'slide'){
      var slidePx = resH * 0.04;
      tl.fromTo(sel, { opacity: 0, y: slidePx }, { opacity: 1, y: 0, duration: animDur, ease: 'power1.out', overwrite: 'auto' }, g.s);
    } else if(anim === 'pop'){
      gEl.style.transformOrigin = (cx) + 'px ' + (cy) + 'px';
      tl.fromTo(sel, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: animDur, ease: 'power1.out', overwrite: 'auto' }, g.s);
    }

    // Per-word color / effects. Each word animates under its EFFECTIVE
    // transition (m.mode) with per-word colors/params falling back to CFG —
    // the same chain Pillow resolves in _draw_word_list.
    var base = CFG.textColor, active = CFG.activeColor;
    var hlText = CFG.highlightTextColor || CFG.bgColor;
    wm.forEach(function(m){
      var w = m.el, o = m.o;
      var wBase = o.text_color || base, wActive = o.active_word_color || active;
      if(m.mode === 'instant'){
        tl.set(w, { color: wActive }, m.s);
        tl.set(w, { color: wBase }, m.e);
      } else if(m.mode === 'crossfade'){
        var cdur = CFG.crossfadeDur || 0.06;
        tl.fromTo(w, { color: wBase }, { color: wActive, duration: cdur, ease: 'none', overwrite: 'auto' }, m.s);
        tl.to(w, { color: wBase, duration: cdur, ease: 'none', overwrite: 'auto' }, Math.max(m.s, m.e - cdur));
      } else if(m.mode === 'highlight'){
        tl.set(m.pill, { opacity: (o.highlight_opacity != null ? o.highlight_opacity : CFG.hlOpacity) }, m.s);
        if(CFG.hlAnim === 'slide' && m.prev){
          // Pillow slide (video_render.py _draw_word_list): pill lerps from the
          // PREVIOUS word's raw rect (prev x/width — no prev offsets) to the
          // active word's rect, BOTH padded with the ACTIVE word's padding,
          // with t_ease = 1 - (1 - clamp(raw_t*2.5, 0, 1))^2 — a quadratic
          // ease-out finishing at 40% of the word duration. GSAP 'power1.out'
          // IS that quad curve (power2.out would be cubic); duration dur/2.5
          // makes tween progress == clamp(raw_t*2.5). First word of a row and
          // jump mode keep the static mkPill rect (m.prev is row-local).
          tl.fromTo(m.pill,
            { left: (m.prev.x - m.hlPadX + m.hlOffX) + 'px', width: (m.prev.width + m.hlPadX*2) + 'px' },
            { left: (m.x + m.ox - m.hlPadX + m.hlOffX) + 'px', width: (m.width + m.hlPadX*2) + 'px',
              duration: Math.max((m.e - m.s) / 2.5, 0.001), ease: 'power1.out', overwrite: 'auto' }, m.s);
        }
        tl.set(w, { color: hlText }, m.s);
        tl.set(m.pill, { opacity: 0 }, m.e);
        tl.set(w, { color: wBase }, m.e);
      } else if(m.mode === 'underline'){
        tl.set(w, { color: wActive }, m.s);
        tl.set(m.underline, { opacity: 1 }, m.s);
        tl.set(w, { color: wBase }, m.e);
        tl.set(m.underline, { opacity: 0 }, m.e);
      } else if(m.mode === 'bounce'){
        // Amplitude uses BASE textH even for scaled words (Pillow: text_h * w_bounce).
        var BO = textH * ((o.bounce_strength != null ? o.bounce_strength : CFG.bounceStrength) || 0.18);
        var half = Math.max((m.e - m.s) / 2, 0.001);
        tl.set(w, { color: wActive }, m.s);
        tl.to(w, { y: -BO, duration: half, ease: 'sine.out', overwrite: 'auto' }, m.s);
        tl.to(w, { y: 0, duration: half, ease: 'sine.in', overwrite: 'auto' }, m.s + half);
        tl.set(w, { color: wBase }, m.e);
      } else if(m.mode === 'scale'){
        // Scale about the word's OWN centre (Canvas scales about the word centre).
        var sf = (o.scale_factor != null ? o.scale_factor : CFG.scaleFactor);
        tl.set(w, { color: wActive, scale: sf, transformOrigin: '50% 50%' }, m.s);
        tl.set(w, { color: wBase, scale: 1, transformOrigin: '50% 50%' }, m.e);
      } else if(m.mode === 'karaoke'){
        // Base word stays in text color until spoken, then active (past). The
        // fill clone wipes left→right over the word's duration.
        tl.fromTo(m.kfill, { width: 0 }, { width: m.width, duration: Math.max(m.e - m.s, 0.001), ease: 'none', overwrite: 'auto' }, m.s);
        tl.set(w, { color: wActive }, m.e);
      } else if(m.mode === 'reveal'){
        w.style.opacity = '0';
        tl.set(w, { opacity: 1, color: wActive }, m.s);
        tl.set(w, { color: wBase }, m.e);
      } else if(m.mode === 'none'){
        // static: base color for the whole group lifetime, no timeline events.
      } else {
        tl.set(w, { color: wActive }, m.s);
        tl.set(w, { color: wBase }, m.e);
      }
    });

    // Hard kill at group end (Caption Exit Guarantee).
    var exitDur = (anim === 'none' || animDur <= 0) ? 0 : animDur;
    if(exitDur > 0){
      var exitAt = Math.max(g.s, g.e - exitDur);
      tl.to(sel, { opacity: 0, duration: exitDur, ease: 'power1.in', overwrite: 'auto' }, exitAt);  // quad — see the entry-ease note above
    }
    tl.set(sel, { opacity: 0, visibility: 'hidden' }, g.e);
  });
}
"""


def caption_block(config: VideoRenderConfig, groups: list[dict]) -> dict:
    """Everything ``_build_index_html`` needs to embed the classic caption layer.

    Returns ``{css, markup, payload_js, runtime_js, build_call}``."""
    return {
        "css": caption_css(config),
        "markup": caption_markup(groups),
        "payload_js": caption_payload_js(config, groups),
        "runtime_js": CAPTION_RUNTIME_JS,
        "build_call": caption_build_call(),
    }


__all__ = [
    "caption_cfg",
    "caption_markup",
    "caption_groups_json",
    "caption_css",
    "caption_payload_js",
    "caption_build_call",
    "caption_block",
    "CAPTION_RUNTIME_JS",
]
