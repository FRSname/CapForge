"""Faithful HTML/CSS/GSAP caption generator — CapForge parity for HyperFrames.

The CapForge panel renders captions two ways that already match pixel-for-pixel:
the Canvas preview (`src/renderer/src/hooks/useSubtitleOverlay.ts`) and the Pillow
final render (`backend/exporters/video_render.py`). When the HyperFrames engine
renders captions it is effectively a *third* renderer, and it must match the other
two — otherwise entering co-author mode (or rendering with a native HyperFrames
caption) silently changes the look the user configured.

This module emits that third renderer. It reproduces the Canvas logic — every
`word_transition` mode (instant, crossfade, highlight, underline, bounce, scale,
karaoke, reveal), the group entrance/exit animations (none/fade/slide/pop), text
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


def caption_groups_json(groups: list[dict]) -> str:
    """Compact word-timing payload aligned by index with the DOM spans."""
    payload = [
        {
            "s": g["start"],
            "e": g["end"],
            "w": [{"s": w["start"], "e": w["end"]} for w in g["words"]],
        }
        for g in groups
    ]
    return json.dumps(payload, ensure_ascii=False)


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
    var wm = spans.map(function(sp, i){ return { el: sp, width: measureWord(sp.textContent), s: g.w[i].s, e: g.w[i].e }; });

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
    var cx = resW * (CFG.posX != null ? CFG.posX : 0.5);
    var cy = resH * (CFG.posY != null ? CFG.posY : 0.82);

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
      row.forEach(function(m){
        // DOM span top so the glyph visual-centre lands on rowY.
        m.el.style.left = wx + 'px';
        m.el.style.top = (rowY - ascent + baselineShift) + 'px';
        m.cxc = wx + m.width/2; m.cyc = rowY; m.x = wx;
        wx += m.width + spaceW;
      });
    });

    // Helper makers (appended to bubble; absolute, resolution coords).
    function mkPill(m){
      var wHlPadX = Math.max(CFG.hlPadX, sStroke + 2), wHlPadY = Math.max(CFG.hlPadY, sStroke + 2);
      var p = document.createElement('div'); p.className='cw-pill';
      p.style.left = (m.x - wHlPadX) + 'px';
      p.style.top = (m.cyc - textH/2 - wHlPadY) + 'px';
      p.style.width = (m.width + wHlPadX*2) + 'px';
      p.style.height = (textH + wHlPadY*2) + 'px';
      p.style.background = CFG.activeColor;
      p.style.borderRadius = CFG.hlRadius + 'px';
      p.style.opacity = '0';
      bubble.insertBefore(p, bubble.querySelector('.cw'));
      return p;
    }
    function mkUnderline(m){
      var u = document.createElement('div'); u.className='cw-underline';
      var ulW = CFG.ulWidth > 0 ? CFG.ulWidth : m.width;
      var ulX = CFG.ulWidth > 0 ? m.x + (m.width - ulW)/2 : m.x;
      u.style.left = ulX + 'px';
      u.style.top = (m.cyc + textH/2 + CFG.ulOffsetY) + 'px';
      u.style.width = ulW + 'px';
      u.style.height = CFG.ulThickness + 'px';
      u.style.background = CFG.ulColor || CFG.activeColor;
      u.style.opacity = '0';
      bubble.appendChild(u);
      return u;
    }
    function mkKFill(m){
      var k = document.createElement('span'); k.className='cw-kfill';
      k.textContent = m.el.textContent;
      k.style.left = m.el.style.left; k.style.top = m.el.style.top;
      k.style.fontFamily = getComputedStyle(m.el).fontFamily;
      k.style.fontSize = CFG.fontSize + 'px';
      k.style.letterSpacing = trk + 'px';
      k.style.color = CFG.activeColor;
      k.style.width = '0px';
      bubble.appendChild(k);
      return k;
    }

    wm.forEach(function(m){
      if(mode === 'highlight') m.pill = mkPill(m);
      if(mode === 'underline') m.underline = mkUnderline(m);
      if(mode === 'karaoke') m.kfill = mkKFill(m);
    });

    // ── Timeline: group entrance/exit + per-word behavior ──
    var anim = CFG.animation || 'none';
    var animDur = CFG.animDur || 0;
    var sel = '#cg-' + gi;
    tl.set(sel, { visibility: 'visible' }, g.s);
    if(anim === 'none' || animDur <= 0){
      tl.set(sel, { opacity: 1, y: 0, scale: 1 }, g.s);
    } else if(anim === 'fade'){
      tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: animDur, ease: 'power2.out', overwrite: 'auto' }, g.s);
    } else if(anim === 'slide'){
      var slidePx = resH * 0.04;
      tl.fromTo(sel, { opacity: 0, y: slidePx }, { opacity: 1, y: 0, duration: animDur, ease: 'power2.out', overwrite: 'auto' }, g.s);
    } else if(anim === 'pop'){
      gEl.style.transformOrigin = (cx) + 'px ' + (cy) + 'px';
      tl.fromTo(sel, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: animDur, ease: 'power2.out', overwrite: 'auto' }, g.s);
    }

    // Per-word color / effects.
    var base = CFG.textColor, active = CFG.activeColor;
    var hlText = CFG.highlightTextColor || CFG.bgColor;
    wm.forEach(function(m){
      var w = m.el;
      if(mode === 'instant'){
        tl.set(w, { color: active }, m.s);
        tl.set(w, { color: base }, m.e);
      } else if(mode === 'crossfade'){
        var cdur = CFG.crossfadeDur || 0.06;
        tl.fromTo(w, { color: base }, { color: active, duration: cdur, ease: 'none', overwrite: 'auto' }, m.s);
        tl.to(w, { color: base, duration: cdur, ease: 'none', overwrite: 'auto' }, Math.max(m.s, m.e - cdur));
      } else if(mode === 'highlight'){
        tl.set(m.pill, { opacity: CFG.hlOpacity }, m.s);
        tl.set(w, { color: hlText }, m.s);
        tl.set(m.pill, { opacity: 0 }, m.e);
        tl.set(w, { color: base }, m.e);
      } else if(mode === 'underline'){
        tl.set(w, { color: active }, m.s);
        tl.set(m.underline, { opacity: 1 }, m.s);
        tl.set(w, { color: base }, m.e);
        tl.set(m.underline, { opacity: 0 }, m.e);
      } else if(mode === 'bounce'){
        var BO = textH * (CFG.bounceStrength || 0.18);
        var half = Math.max((m.e - m.s) / 2, 0.001);
        tl.set(w, { color: active }, m.s);
        tl.to(w, { y: -BO, duration: half, ease: 'sine.out', overwrite: 'auto' }, m.s);
        tl.to(w, { y: 0, duration: half, ease: 'sine.in', overwrite: 'auto' }, m.s + half);
        tl.set(w, { color: base }, m.e);
      } else if(mode === 'scale'){
        // Scale about the word's OWN centre (Canvas scales about the word centre).
        tl.set(w, { color: active, scale: CFG.scaleFactor, transformOrigin: '50% 50%' }, m.s);
        tl.set(w, { color: base, scale: 1, transformOrigin: '50% 50%' }, m.e);
      } else if(mode === 'karaoke'){
        // Base word stays in text color until spoken, then active (past). The
        // fill clone wipes left→right over the word's duration.
        tl.fromTo(m.kfill, { width: 0 }, { width: m.width, duration: Math.max(m.e - m.s, 0.001), ease: 'none', overwrite: 'auto' }, m.s);
        tl.set(w, { color: active }, m.e);
      } else if(mode === 'reveal'){
        w.style.opacity = '0';
        tl.set(w, { opacity: 1, color: active }, m.s);
        tl.set(w, { color: base }, m.e);
      } else {
        tl.set(w, { color: active }, m.s);
        tl.set(w, { color: base }, m.e);
      }
    });

    // Hard kill at group end (Caption Exit Guarantee).
    var exitDur = (anim === 'none' || animDur <= 0) ? 0 : animDur;
    if(exitDur > 0){
      var exitAt = Math.max(g.s, g.e - exitDur);
      tl.to(sel, { opacity: 0, duration: exitDur, ease: 'power2.in', overwrite: 'auto' }, exitAt);
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
