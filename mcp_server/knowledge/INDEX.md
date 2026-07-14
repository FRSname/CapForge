# HyperFrames creative library — for the CapForge agent

You are driving a **running CapForge app** over MCP. This library gives you the same
creative vocabulary a standalone HyperFrames author has — caption craft, motion,
type, the text-highlight family, transitions, palettes — but bound to *CapForge's*
surface, not the standalone CLI.

## Operating model (read this first)

CapForge owns the transcript, the timing, and the render — you operate the
*running app* through the MCP tools. **Never run `hyperframes init`, `publish`, or
`auth`, and never scaffold a project in some other folder** — CapForge already owns
one. There are **two modes**; pick by the task.

### Golden rule — preview first, render only on approval

`render_hyperframes` produces the **final deliverable**; it is slow and it is what
the user walks away with. It is **not** a way to "check" your work. Never render to
see how something looks. Instead:

- **Iterate on single frames.** `preview_hyperframes_frame(t)` is cheap — use it at a
  few representative timestamps (find them with `find_moments` /
  `find_semantic_moments`) to dial in the effect/animation.
- **Confirm with the user.** Show them the previews and make sure the look is what
  they want before you commit.
- **Render only after explicit approval.** Wait until the user clearly says to render
  the final video. CapForge also shows the user an Approve/Cancel prompt when you
  call `render_hyperframes`; a Cancel means "keep iterating", not an error.

### Caption style — match CapForge by default

Whatever caption style/preset the user set in CapForge's panel is the **default**,
and CapForge's seed already reproduces it faithfully. Keep captions looking exactly
like the panel **unless the user explicitly asks for a different caption look**.
Restyling or re-animating captions in HyperFrames is an *opt-in divergence the user
requests* — not your opening move.

### Default mode — CapForge composes

For caption styling, CapForge generates the composition and you steer it. Loop:

1. **Read state** — `get_ui_state` (current style, display groups, presets),
   `get_transcript` (words + timing). Captions render from the *words*.
2. **Design** — pick or invent a look. Two authoring paths:
   - **Native style** — `set_caption_style(name)` from `list_caption_styles`
     (registry components like `caption-pill-karaoke`). Fast, brings its own motion.
   - **Custom style (your canvas)** — `get_custom_caption_contract` →
     `set_custom_caption_style(html)`: author a brand-new caption look in
     HTML/CSS/GSAP that renders through the genuine HyperFrames engine.
   - Need something beyond captions (a bespoke animated moment tied to a spoken
     beat)? `find_moments` / `find_semantic_moments` locate the timing, then
     switch to co-author mode below to build and place it.
3. **See it** — `preview_hyperframes_frame(t)`; `check_layout(t, platform)`. Iterate
   here with the user until they're happy (see the Golden rule above).
4. **Render** — only after the user approves: `render_hyperframes(quality)`.

### Co-author mode — you compose

When the task needs something beyond captions — a bespoke animation (a
code-block reveal, a branded lower-third), or implementing a custom effect
**block or folder a user hands you** — author the HyperFrames project
directly, the way a standalone author would, **but inside CapForge's project**
(this mode is exactly how you do that; do not reach for the standalone CLI):

1. **`enter_coauthor_mode`** — CapForge seeds a complete, working starter
   (captions + video) you then OWN; it stops regenerating `index.html`, so
   your edits persist.
2. **`get_workspace`** — the project folder + file tree. You own `index.html`,
   `compositions/`, and `assets/`. CapForge owns `transcript.json`, `source.*`, and
   the captions sub-composition — pull caption/grouping changes in with
   `sync_captions` (it never touches your `index.html`).
3. **Author** — `write_workspace_file` (e.g. `compositions/code-block.html`)
   and/or `import_into_workspace(path)` for a block plus its assets + instructions;
   then wire it into `index.html` via `data-composition-src`. Each composition
   follows the contract below. Pull `hyperframes_guide` topics for the vocabulary.
4. **Dev loop** — `run_hyperframes_cli(["lint"])` / `["inspect"]` to validate,
   `preview_hyperframes_frame(t)` to SEE it. Iterate with the user until they're
   happy (see the Golden rule above).
5. **Render** — only after the user approves: `render_hyperframes(quality)` renders
   YOUR `index.html`. `exit_coauthor_mode` hands control back to CapForge's generated
   composition.

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
