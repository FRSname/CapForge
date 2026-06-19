# CapForge Enhanced — AI Video Director (HyperFrames) Plan

**Status:** Proposed · **Branch:** `capforge-enhanced` (worktree at `../CapForge-enhanced`) · **Authored:** 2026-06-19
**Throwaway-friendly:** this whole fork can be discarded with `git worktree remove ../CapForge-enhanced && git branch -D capforge-enhanced`. Build to *feel the direction* fast; don't over-invest before the Phase C demo lands.

---

## Product Thesis

CapForge Enhanced keeps the same app shape (drop a video → transcribe → edit → style → export) but adds one transformative capability:

> **An AI agent that directs the video.** It reads the transcript, understands what's being said, and places animated effects at the right moments — driven by natural-language prompts or its own suggestions.

Canonical demo (the make-or-break milestone): a speaker says *"I use CapForge"*; you tell the agent *"drop our logo whenever they mention the product"*; the agent finds the moment at its exact word timestamp, inserts an animated CapForge logo, verifies placement, and renders the video.

This is achievable because **the hard part already exists**: CapForge shipped an MCP control layer (PR #6, `backend/agent_bridge.py` + `mcp_server/`) where an external Claude already sees the app, renders frames, and does vision QA. Today that agent can only tweak subtitle style. HyperFrames gives it a real creative action space — every animation GSAP can do.

```
WhisperX transcript (the script)  +  MCP agent (the director)  +  HyperFrames (the animation engine)
                                   = AI-directed video compositor
```

---

## Architecture Decision

Earlier framing posed a binary: *HyperFrames as new render core* vs *additive caption layer*. Committing to the full vision collapses that into a cleaner synthesis:

**HyperFrames is the rich render/animation engine. CapForge keeps transcription, project state, and UI. The new first-class primitive is an agent-controlled effects timeline.**

| Layer | Owner | Notes |
| --- | --- | --- |
| Transcription, alignment, diarization | CapForge (WhisperX) — **unchanged** | The timeline backbone the director reasons over. |
| Project / editing / style state | CapForge (`StudioSettings`, groups, `/api/result`) — **extended** | Gains an `effects: EffectClip[]` collection. |
| Captions + effects → video | **HyperFrames** (new) | A generated HyperFrames composition: source video track + caption track + N effect tracks. Rendered via `npx hyperframes render`. |
| Director (places/edits effects) | **MCP agent** (extend existing layer) | New tools give it the effects action space + transcript queries + frame preview. |
| UI | CapForge renderer — **extended** | Existing timeline gains an effects track; a prompt/chat surface drives the agent. |

**Why this synthesis, not pure core-replace:** CapForge's transcription + editing is its moat and works well — re-platforming it onto HyperFrames buys nothing. **Why not pure additive captions:** the vision *needs* effects as first-class timed tracks, which is exactly HyperFrames' native multi-track model (`data-track-index`, sub-comps via `data-composition-src`). So we adopt HyperFrames where it's strong (animated compositing) and keep CapForge where it's strong (transcription/editing).

**Consequence — this fork commits to in-app HyperFrames render**, so the Node-22 dependency is no longer optional (see Risk R1). CapForge's Pillow renderer stays as the "classic / fast caption-only" path and as a fallback when Node is unavailable.

---

## Document Model

The project gains an effects collection; a generator assembles everything into a HyperFrames composition.

```
EffectClip:
  id: str
  type: "logo" | "lower_third" | "kinetic_stat" | "highlight" | "image" | "shape" | "caption_style"
  start: float            # seconds (usually snapped to a word's start)
  duration: float
  track_index: int        # HyperFrames track; visual z via CSS z-index
  anchor: {x, y}          # normalized position
  source_word_id?: str    # the transcript moment that triggered it (provenance for the agent)
  variables: dict         # content + style → HyperFrames data-variable-values (e.g. logo path, text, color)
  created_by: "user" | "agent"
```

**Composition generator** (`backend/exporters/hyperframes_project.py`) writes a HyperFrames project folder:
```
<stem>-hyperframes/
  index.html            # root composition: video base track + caption track + one host div per EffectClip
  transcript.json       # [{text,start,end}] — Phase 0 bridge format
  compositions/         # effect sub-compositions (logo.html, lower-third.html, …)
  assets/               # logos, images the agent/user added
  README.txt
```
Each `EffectClip` becomes a host div: `<div data-composition-id data-composition-src="compositions/<type>.html" data-start data-duration data-track-index data-variable-values='{…}'>`. Captions follow the rules in `~/.claude/skills/hyperframes/references/captions.md` (one group visible, hard `tl.set` kill at `group.end`, entrance-only).

---

## The Agent's Action Space (new MCP tools)

Extend `mcp_server/` + `backend/agent_bridge.py` (same pattern as the existing live-style/`render_frame` tools):

| Tool | Purpose |
| --- | --- |
| `get_transcript()` | Word-level transcript with ids + timings — the script the director reads. |
| `find_moments(query)` | Locate phrases / brand mentions / numbers / CTAs → returns `{word_id, start, end, text}`. |
| `list_effects()` / `add_effect(clip)` / `update_effect(id, …)` / `remove_effect(id)` | CRUD on the effects timeline (immutable updates server-side). |
| `list_effect_types()` | Available effect components + their variable schemas (so the agent fills `variables` correctly). |
| `preview_frame(t)` | Reuse existing `render_frame` + `frame_qa` to verify placement and self-correct. |

The agent loop: `get_transcript` → `find_moments("CapForge")` → `add_effect({type:"logo", start: moment.start, …})` → `preview_frame` → adjust → user renders.

---

## Effect Library

Start small; lean on HyperFrames' registry where possible (`npx hyperframes add <name>`, `catalog --tag caption-style`).

- **caption_style** — captions rendered via HyperFrames (the 15 registry styles: `caption-highlight`, `caption-pill-karaoke`, `caption-kinetic-slam`, …). Immediate visible upgrade over Pillow.
- **logo** — animated image overlay (entrance/exit GSAP), the demo effect.
- **lower_third** — name/title bar, often keyed off diarized speaker.
- **kinetic_stat** — animated number/counter when a statistic is spoken.
- **highlight** — emphasis on a spoken keyword (marker/circle/burst — see `references/css-patterns.md`).
- **image / b_roll** — timed image insert.
- **shape** — arrow/box callout.

Each is a parametrized HyperFrames sub-composition with a declared `data-composition-variables` schema the agent reads via `list_effect_types()`.

---

## UI Evolution (same app, more features)

- **Effects track** on the existing timeline (`hooks/useTimeline.ts`) — render `EffectClip`s as draggable blocks alongside the segment track; click to edit `variables`/position.
- **Agent prompt surface** — a panel/chat where the user directs the agent ("add the logo when they say the product name"). The agent is the already-connectable Claude (Desktop/Code via MCP).
- **Effect inspector** — a StudioCard for the selected effect's variables (mirrors StudioPanel conventions; theme tokens only, no hardcoded colors — see CLAUDE.md Theming).
- Preview: embed HyperFrames `preview` for the rich path, or composite effect thumbnails from `render_frame` over the existing player. (Decide in Phase A.)

---

## Phased Build (vertical-slice-first)

Each phase is runnable. The goal is to reach the **Phase C demo** before investing in breadth.

### Phase 0 — Bridge substrate ✅ DONE (2026-06-19)
Transcript export `[{text,start,end}]` from CapForge's `WordSegment`. New `ExportFormat.HYPERFRAMES` + `backend/exporters/hyperframes_export.py` + registered in `EXPORTERS` (`backend/main.py`, suffix `_hyperframes.json` to avoid the `.json` collision) + "HyperFrames" button in `ExportPanel.tsx`. Unit test `backend/tests/test_hyperframes_export.py`.
- **Done:** 6 new tests pass; full backend suite 57/57 green; output verified against the captions.md spec.
- **Remaining manual check:** live round-trip `npx hyperframes transcribe <file>_hyperframes.json` (needs Node 22); renderer `npm run typecheck` after the worktree's `npm install`.

### Phase A — HyperFrames render path in the fork
**Core ✅ DONE (2026-06-19):** `backend/exporters/hyperframes_project.py` generates a self-contained composition (video base track + separate audio track + caption track) from `TranscriptionResult` + `VideoRenderConfig`, reusing `_build_groups` for parity. Captions follow captions.md (one group at a time, per-word active-color recolor, entrance + hard `tl.set` kill). 10 unit tests. **Proven end-to-end:** `hyperframes lint` 0/0 on the generated folder; `doctor` all-green; `render --quality draft` → valid 1280×720 MP4 with audio; frame grab confirms captions + active-word highlight composited over the source video.
- R1 (Node) is a non-blocker on this dev box (Node 22 + system Chrome + FFmpeg all present).
- **Remaining for Phase A (app wiring):** an endpoint (mirror `/api/render-video` at `main.py:489`) that generates the project and optionally shells `npx hyperframes render` with WS progress; a UI trigger in ExportPanel/CustomRenderPanel. Optional: `validate`/`inspect` in CI; parametrize style via `data-composition-variables`; richer caption styles (pill/karaoke) beyond instant recolor.

### Phase B — Effects data model + manual logo (2–3 days)
Add `EffectClip` to the project model + `effects` to `/api/result`. Build the `logo` sub-composition. Add the UI effects track + inspector. User can manually place a logo and render it composited.
- **Verify:** add a logo at t=X in the UI → render → logo animates at X; persists in project save/load.

### Phase C — Agent places the effect (THE demo) (2–3 days)
Add the MCP tools (`get_transcript`, `find_moments`, `add_effect`, `preview_frame`). Prompt the connected agent: *"add our logo whenever they say CapForge."* Agent finds the moment, adds the effect, verifies via `preview_frame`, user renders.
- **Verify:** end-to-end demo works on a real clip. **This is the go/no-go for the whole fork.**

### Phase D — Effect library + semantic detection (ongoing)
Add lower-third, kinetic-stat, highlight, b-roll. Improve `find_moments` (numbers, CTAs, speaker changes via diarization).
- **Verify:** agent handles "add a counter when they mention a number" and "name bar when a new speaker starts."

### Phase E — Autonomous director (stretch)
Agent scans the full transcript and proposes a complete effect plan; user reviews/approves each as a layer.
- **Verify:** agent proposes N effects on a clip; each is individually accept/reject/editable.

---

## Risks

- **R1 — Node 22 dependency (must resolve before Phase A).** This fork renders in-app via `npx hyperframes`, which needs Node 22 + FFmpeg. CapForge bundles FFmpeg but not Node. Options: (a) bundle a Node 22 runtime in the Electron app (size cost, clean UX), (b) require/detect system Node and gate via `npx hyperframes doctor` (no bundle, friction), (c) explore a packaged/portable HyperFrames. **Decide at Phase A start.** Until resolved, Phase 0 produces files only (no Node needed).
- **R2 — Preview parity.** CapForge's Canvas preview vs HyperFrames' GSAP render can diverge. Mitigate: make HyperFrames the source of truth for the *rich* path and preview via HyperFrames itself / `render_frame` thumbnails, rather than re-implementing GSAP in Canvas.
- **R3 — Render latency.** HyperFrames renders via headless Chrome (slower than Pillow). Use `--quality draft` for iteration; keep Pillow for fast caption-only exports.
- **R4 — Agent reliability.** Effect placement must be verifiable; always close the loop with `preview_frame`/`inspect` so the agent self-corrects rather than guessing.

---

## Allowed APIs (verified — do not invent beyond this)

HyperFrames (sources: `~/.claude/skills/hyperframes/SKILL.md`, `references/captions.md`, `hyperframes-cli/SKILL.md`):
- Transcript format: `[{ "text", "start", "end" }]` — field is **`text`** not `word`; seconds.
- Composition: `data-composition-id`, `data-start`, `data-duration`, `data-track-index`, `data-composition-src`, `data-variable-values`; variables via `data-composition-variables` + `window.__hyperframes.getVariables()`; timeline `{paused:true}` registered in `window.__timelines[id]`.
- CLI: `npx hyperframes init|lint|validate|inspect|preview|render|transcribe|add|catalog|doctor`. Render flags: `--output --format mp4|webm --fps --quality draft|standard|high --variables --variables-file`. Needs Node 22 + FFmpeg.
- Banned: `repeat:-1`, `Math.random`/`Date.now`, `data-end`/`data-layer`, `<template>` on standalone compositions, exit animations before transitions, captions without a hard `tl.set` kill.

CapForge (sources: `backend/models/schemas.py`, `backend/main.py`, `backend/exporters/*`, `backend/agent_bridge.py`, `mcp_server/`):
- `TranscriptionResult.segments[].words[] = WordSegment{word,start,end,score,speaker}`.
- Exporter pattern: pure `export_X(result)->str` + `EXPORTERS` dict (`main.py:551`) + `ExportFormat` enum (`schemas.py:46`) + `/api/export` (`main.py:456`).
- Render precedent for subprocess + WebSocket progress: `render_video` (`main.py:489`).
- MCP/agent extension points: existing tools incl. `render_frame` + `frame_qa` (vision QA) — extend, don't reinvent.

---

## Open Decisions (resolve as we hit them, not upfront)
1. **R1 Node strategy** — bundle vs system-detect. (Phase A blocker.)
2. **Preview approach** — embed HyperFrames preview vs `render_frame` thumbnails over the existing player. (Phase A.)
3. **First caption style** to wire as a HyperFrames `caption_style` effect (highlight / karaoke / plain). (Phase A/B.)
4. **Effect placement UX** — agent-only vs agent+manual drag. (Plan assumes both; manual lands in Phase B.)
