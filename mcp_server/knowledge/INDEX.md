# HyperFrames creative library — for the CapForge agent

You are driving a **running CapForge app** over MCP. This library gives you the same
creative vocabulary a standalone HyperFrames author has — caption craft, motion,
type, the text-highlight family, transitions, palettes — but bound to *CapForge's*
surface, not the standalone CLI.

## Operating model (read this first)

**You do NOT scaffold a HyperFrames project or run the `hyperframes` CLI.** CapForge
owns the project, the transcript, the timing, and the render. You operate it through
the MCP tools. The standalone-skill steps about `design.md`, `hf init`, prompt
expansion, multi-scene composition, narration/TTS, and `hf render` **do not apply** —
CapForge already did the transcription and owns the timeline. Use this library only
for the *creative* decisions: how a caption looks and moves, where an effect lands.

Your loop:

1. **Read state** — `get_ui_state` (current style, display groups, presets),
   `get_transcript` (words + timing). Captions render from the *words*.
2. **Design** — pick or invent a look. Two authoring paths:
   - **Native style** — `set_caption_style(name)` from `list_caption_styles`
     (registry components like `caption-pill-karaoke`). Fast, brings its own motion.
   - **Custom style (your canvas)** — `get_custom_caption_contract` →
     `set_custom_caption_style(html)`. This is where this library pays off: author a
     brand-new look in HTML/CSS/GSAP. **It renders through the genuine HyperFrames
     engine**, so anything in this library is fair game.
3. **Effects** — `find_moments` / `find_semantic_moments` to locate a spoken beat,
   then `add_effect` (logo, lower_third, kinetic_stat, highlight, b_roll). Use the
   motion/transition topics below to choose enter/exit feel.
4. **See it** — `preview_hyperframes_frame(t)` (one frame, fast) to judge a custom
   style or effect placement; `check_layout(t, platform)` for mechanical bounds.
   Iterate before committing.
5. **Render** — `render_hyperframes(quality)`.

## The caption contract (non-negotiable for `set_custom_caption_style`)

Your custom HTML must satisfy CapForge's validator — these are mechanics, the
*creativity* is everything else:

- Self-contained HTML, transparent background (it overlays the video).
- Root with `data-composition-id` + `data-width`/`data-height` (author at 1920×1080;
  CapForge fits it to the real canvas — portrait/4K/square).
- Declare `var TRANSCRIPT = [{text,start,end}, ...]` — CapForge swaps in the real words.
- Build the caption DOM from `TRANSCRIPT` (do your own grouping).
- Register a **paused** GSAP timeline at `window.__timelines["<id>"]`.
- One group visible at a time; **entrance animation only**; a hard `tl.set` kill at
  each group's end.
- Deterministic + finite: no `Math.random`, no `Date.now`, no `repeat: -1`, no
  `data-end` / `data-layer`.

`captions.md` below is the full reference this contract is derived from — read it
before inventing a new caption look.

## Knowledge index

Fetch any topic with `hyperframes_guide(topic="<id>")` (or the
`hyperframes://<id>` resource). Pull on demand — don't read everything up front.

| topic id | what it covers |
|---|---|
| `captions` | Caption timing, grouping, one-group-visible, the hard-kill rule — the source of the contract above. **Start here for any custom caption.** |
| `text-animation` | Animating text per word/char: reveals, marker sweeps, scribble, sketchout, burst — the highlight vocabulary. |
| `dynamic-techniques` | Animated text-highlighting techniques (marker sweep, hand-drawn circle, burst lines, scribble). |
| `motion-principles` | Easing, timing, anticipation, overshoot — making motion feel intentional, not default. |
| `gsap-easing` | GSAP easing curves + stagger for word entrances. |
| `gsap-timeline` | GSAP paused-timeline + labels structure — mirrors the caption contract. |
| `gsap-perf` | Compositor-friendly transforms + performance. |
| `animation-techniques` | General animation technique catalog. |
| `typography` | Type scale, weight, tracking, legibility for on-video text. |
| `css-patterns` | Reusable CSS (gradients, strokes, shadows, glass, masks) for caption styling. |
| `audio-reactive` | Beat sync / pulse / glow driven by audio — for emphasis hits. |
| `transitions` | Catalog of scene/element transitions — use for group-to-group + effect enter/exit. |
| `transitions-css` | The full CSS transition families (dissolve, push, cover, blur, scale, 3d, …). |
| `visual-styles` | 8 named visual style presets to anchor a caption look. |
| `palettes` | Nine curated color systems (neon, dark-premium, editorial, …). |
| `house-style` | Default look/feel conventions + palette guidance. |

---

*Provenance: vendored from the HyperFrames skills (`hyperframes`, `hyperframes-animation`)
installed at author time. Creative reference content is reproduced as-is; the operating
model above is CapForge-specific. Keep in sync if the upstream skills change materially.*
