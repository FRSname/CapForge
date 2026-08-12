/**
 * Runs the EMITTED caption runtime (`CAPTION_RUNTIME_JS`) in bare node against a
 * fake DOM + a recording GSAP stub, and dumps what it built as JSON.
 *
 * Why: the HTML/GSAP RSVP renderer's numbers (band, pivot, per-word x, the
 * three-piece pen walk, the reticle rects, the edge-fade ramp, the slide tween)
 * are otherwise only observable inside headless Chromium during a real render —
 * i.e. only by the opt-in parity suite. This harness makes them assertable
 * offline, so `backend/tests/test_rsvp_html_layout.py` can compare them to
 * `backend/exporters/rsvp_layout.py` (the source of truth) computed from the SAME
 * synthetic measurement.
 *
 * The glyph metrics are deliberately synthetic (advance = 0.5 em per char): the
 * point is that both languages consume identical numbers, not that they resemble
 * a real font. Real-font agreement is what the parity suite measures.
 *
 * Usage: node rsvp_html_harness.js <input.json>
 *   input.json = { runtime, cfg, groups, words, time }
 *   stdout     = { tree, calls, metrics }
 */

'use strict'

const { readFileSync } = require('node:fs')

const IN = JSON.parse(readFileSync(process.argv[2], 'utf8'))

// Advance width of one character, as a fraction of the font size.
const CHAR_W_RATIO = 0.5
// Synthetic font metrics, as fractions of the font size. ascent + descent = 1 so
// textH === fontSize; the fontBoundingBox pair deliberately differs from the ink
// pair so the runtime's `spanBaseline` / `gap` terms are actually exercised.
const INK_ASCENT = 0.8
const INK_DESCENT = 0.2
const FONT_ASCENT = 0.9
const FONT_DESCENT = 0.25

let uid = 0

class El {
  constructor(tag) {
    this.tag = tag
    this.uid = uid++
    this.id = ''
    this.className = ''
    this.textContent = ''
    this.style = {}
    this.children = []
    this.parent = null
  }

  appendChild(child) {
    if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child)
    child.parent = this
    this.children.push(child)
    return child
  }

  insertBefore(child, ref) {
    if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child)
    child.parent = this
    const at = ref ? this.children.indexOf(ref) : -1
    if (at < 0) this.children.push(child)
    else this.children.splice(at, 0, child)
    return child
  }

  get firstChild() {
    return this.children[0] || null
  }

  /** Class selectors only ('.cw') — the runtime uses nothing else. */
  queryAll(sel) {
    const cls = sel.replace(/^\./, '')
    const out = []
    const walk = (node) => {
      for (const c of node.children) {
        if (String(c.className).split(/\s+/).includes(cls)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }

  querySelector(sel) {
    return this.queryAll(sel)[0] || null
  }

  querySelectorAll(sel) {
    return this.queryAll(sel)
  }
}

const byId = new Map()

function mkEl(tag, id, className, text) {
  const el = new El(tag)
  if (id) {
    el.id = id
    byId.set(id, el)
  }
  if (className) el.className = className
  if (text != null) el.textContent = text
  return el
}

function fakeCanvasContext() {
  return {
    font: '',
    measureText(text) {
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font)
      const size = m ? parseFloat(m[1]) : 40
      return {
        width: text.length * size * CHAR_W_RATIO,
        actualBoundingBoxAscent: size * INK_ASCENT,
        actualBoundingBoxDescent: size * INK_DESCENT,
        fontBoundingBoxAscent: size * FONT_ASCENT,
        fontBoundingBoxDescent: size * FONT_DESCENT,
      }
    },
  }
}

// ── The fake document: exactly what __capBuild touches ──────────────────
const captionsLayer = mkEl('div', 'captions', 'captions')
IN.groups.forEach((g, gi) => {
  const gEl = mkEl('div', `cg-${gi}`, 'cgroup')
  const bubble = mkEl('span', `cb-${gi}`, 'cbubble')
  gEl.appendChild(bubble)
  IN.words[gi].forEach((word, wj) => {
    bubble.appendChild(mkEl('span', `cg-${gi}-w${wj}`, 'cw', String(word).trim()))
  })
  captionsLayer.appendChild(gEl)
})

global.document = {
  getElementById: (id) => byId.get(id) || null,
  createElement: (tag) =>
    tag === 'canvas' ? { getContext: () => fakeCanvasContext() } : mkEl(tag),
}
global.getComputedStyle = (el) => el.style
global.window = { console: null }

// ── The GSAP stub: records, never animates ──────────────────────────────
const calls = []

function targetOf(t) {
  if (Array.isArray(t)) return t.map(targetOf)
  if (typeof t === 'string') return t
  return t && t.uid != null ? { uid: t.uid } : String(t)
}

const tl = {
  set(target, vars, at) {
    calls.push({ kind: 'set', target: targetOf(target), vars, at })
  },
  to(target, vars, at) {
    calls.push({ kind: 'to', target: targetOf(target), vars, at })
  },
  fromTo(target, from, to, at) {
    calls.push({ kind: 'fromTo', target: targetOf(target), from, to, at })
  },
}

// ── Run the real runtime ────────────────────────────────────────────────
// eslint-disable-next-line no-new-func
new Function('tl', 'CFG', 'GROUPS', `${IN.runtime}\n__capBuild(tl, CFG, GROUPS);`)(
  tl,
  IN.cfg,
  IN.groups
)

function dump(el) {
  return {
    uid: el.uid,
    tag: el.tag,
    id: el.id,
    className: el.className,
    text: el.textContent,
    style: el.style,
    children: el.children.map(dump),
  }
}

process.stdout.write(
  JSON.stringify(
    {
      tree: dump(captionsLayer),
      calls,
      metrics: {
        charWRatio: CHAR_W_RATIO,
        inkAscent: INK_ASCENT,
        inkDescent: INK_DESCENT,
        fontAscent: FONT_ASCENT,
        fontDescent: FONT_DESCENT,
      },
    },
    null,
    1
  )
)
