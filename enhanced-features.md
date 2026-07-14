# CapForge Enhanced — Features & Architecture

This document describes everything the **Enhanced** fork of CapForge adds on top of
the base subtitle editor: the **AI control layer** (drive the running app from a
Claude agent over MCP) and the **HyperFrames engine** (GSAP/HTML video rendering with
effects, native caption styles, and agent-authored looks).

Branch: `capforge-enhanced`. Base CapForge (Electron → React → Python FastAPI) is
unchanged underneath; everything here is additive.

> **Requirement:** the HyperFrames features shell out to the `hyperframes` npm package
> via `npx`, which needs **Node.js 22+** on PATH. The classic Pillow renderer and all
> non-HyperFrames features work without Node.

---

## 1. What's new at a glance

| Area | What it adds |
|---|---|
| **HyperFrames render engine** | A second render path (alongside classic Pillow) that renders captions + effects through the real `npx hyperframes` engine — GSAP animation, HTML/CSS looks. |
| **Effects / AI video director** | A 5-type effects timeline (logo, lower-third, kinetic-stat, highlight, b-roll) placed manually in the UI or by an agent at spoken moments. |
| **Native caption styles** | Opt-in registry caption components (`caption-pill-karaoke`, …) pulled live from the HyperFrames catalog. `classic` stays the default. |
| **Custom (agent-authored) captions** | An agent can write a brand-new caption look in HTML/CSS/GSAP, validated against a contract, rendered by the real engine. |
| **HyperFrames creative library** | The MCP server serves the genuine HyperFrames creative references (caption craft, motion, type, transitions, palettes) to the connected agent, pull-on-demand. *(newest addition)* |
| **Effect packs** | Reusable effects are plain folders (HTML + usage rules + assets) imported into the co-author workspace and wired by the agent — no CapForge-managed template store. |
| **HyperFrames Studio** | "Open in HyperFrames Studio" launches `npx hyperframes preview` in the browser for live inspection/refinement. |
| **Portrait / 4K fit** | Native caption components are fitted to portrait (9:16), 4K, and square canvases. |
| **AI control layer (MCP)** | A local Claude agent operates the *running* app — transcript cleanup, live style/emphasis, effect placement, vision QA — via token-guarded endpoints. One-click "Connect to Claude". |

---

## 2. Architecture: how the pieces connect

Three cooperating layers. The base app is unchanged; the two new layers attach to it.

```
                          ┌──────────────────────────────────────────┐
                          │   Claude agent (Desktop / Code)           │
                          │   + HyperFrames creative library          │
                          └───────────────┬──────────────────────────┘
                                          │ MCP (stdio)
                          ┌───────────────▼──────────────────────────┐
                          │   mcp_server/  (bundled Python)           │
                          │   FastMCP tools + resources               │
                          └───────────────┬──────────────────────────┘
                                          │ REST  /api/agent/*  (token-guarded)
                                          │ + reads ~/.capforge/backend.json
┌───────────────┐  spawns   ┌────────────▼──────────────────────────┐
│ Electron main │──────────▶│   Python FastAPI backend (127.0.0.1)   │
│ (electron/)   │           │   transcribe · render · effects        │
└───────┬───────┘           │   ┌──────────────────────────────────┐ │
        │ IPC               │   │ classic Pillow renderer          │ │
┌───────▼───────┐  WS       │   │ HyperFrames pipeline ── npx ─────┼─┼──▶  hyperframes
│ React renderer│◀──────────│   │   (project gen → render → mux)   │ │      (npm, Node 22+)
│ (Studio UI)   │ /ws/      │   └──────────────────────────────────┘ │
└───────────────┘ progress  └────────────────────────────────────────┘
```

**Key idea:** the agent and the UI operate the **same running backend**. When the agent
changes a word, a style, or an effect via `/api/agent/*`, the backend broadcasts over
`/ws/progress` and the open UI updates live. The agent is not a separate renderer — it
drives the app the user already has open.

### The connection points

- **Discovery file** — on startup the backend writes `~/.capforge/backend.json`
  (`{port, token, pid}`). The MCP server reads it at runtime to find the live app, so
  no port/path is baked into any config.
- **Token auth** — every `/api/agent/*` call carries `X-CapForge-Agent-Token`. The
  token is resolved from env → persisted file → freshly generated (stable across
  restarts).
- **Live broadcast** — `/ws/progress` carries both render progress and control events
  (`result_updated`, `effects_updated`, `agent_command`). The renderer's
  `AgentLiveSync` mirrors agent changes back into the UI.
- **HyperFrames is the real engine** — the backend never reimplements HyperFrames; it
  generates a project folder and shells out to `npx -y hyperframes render | snapshot |
  catalog | add | preview`.

---

## 3. The HyperFrames engine integration

### 3.1 How it's connected (not reimplemented)

CapForge stands on the genuine HyperFrames CLI + component registry:

| Operation | Shells out to |
|---|---|
| Render video | `npx -y hyperframes render --quality <q> --format <fmt> --output <path>` |
| Fast 1-frame preview | `npx -y hyperframes snapshot --at <t> --describe false` |
| List caption styles | `npx -y hyperframes catalog --tag caption-style --json` |
| Install a caption style | `npx -y hyperframes add <style>` |
| Live Studio preview | `npx -y hyperframes preview --no-open --port <p> <projectDir>` |

Backend modules (`backend/exporters/`):

- `hyperframes_export.py` — writes the HyperFrames transcript JSON (the timing format).
- `hyperframes_project.py` — `export_hyperframes_project()` builds the `<stem>-hyperframes/`
  folder: `index.html`, transcript, a copy of the source video, `assets/`, and
  `compositions/components/` for caption components.
- `hyperframes_render.py` — `render_hyperframes_project()` runs `npx hyperframes render`
  and streams progress ("Capturing frame X/Y") back through the progress callback;
  `snapshot_hyperframes_project()` does the fast single-frame preview.
- `hyperframes_captions.py` — caption-style install/inject/fit + the custom-caption
  contract and validator.

### 3.2 Render pipeline (end to end)

1. UI or agent triggers a HyperFrames render (`POST /api/export-hyperframes`, or the MCP
   `render_hyperframes` tool).
2. `export_hyperframes_project()` generates the project folder from: transcript groups,
   resolved duration, the selected caption style (classic / native / custom), copied
   fonts, and prepared effect clips (assets copied in).
3. `render_hyperframes_project()` invokes `npx hyperframes render` on the folder; the
   engine captures frames and encodes the video. Progress is reported to ~95%, the final
   ~5% covers encode/mux.
4. The output file path is returned; effects are composited over the captions over the
   source video.

`quality` is `draft | standard | high`; `video_format` selects the container (e.g.
`mp4`). Portrait/4K/square output renders at the requested canvas — native caption
components are fitted to it (see 3.4).

### 3.3 Caption styles — three paths

1. **`classic`** (default) — CapForge's built-in Pillow-parity caption track. No Node
   needed.
2. **Native registry styles** — `list_caption_styles()` queries the live catalog
   (cached per process; curated fallback when Node is absent). `set_caption_style(name)`
   → `install_caption_component()` runs `npx hyperframes add <style>` into the project,
   then `inject_transcript()` swaps the component's `var TRANSCRIPT = [...]` for the real
   words and retimes. Some designed layouts (e.g. `editorial-emphasis`) use richer
   `W`/`BLOCKS` arrays.
3. **Custom (agent-authored)** — see 3.5.

### 3.4 Portrait / 4K / square fit

`fit_caption_component(component_path, target_w, target_h)` updates a native component's
viewport and adds a CSS scale transform so a 1920×1080-authored component fills a
portrait/4K/square frame without being clipped. No-op at native size.

### 3.5 Custom (agent-authored) captions

An agent can invent a brand-new caption look from scratch. The flow:

- `get_custom_caption_contract()` → `{contract, template}` (a working GSAP starter).
- The agent adapts the CSS/entrance, keeps the required structure, and sends it with
  `set_custom_caption_style(html)`.
- `validate_custom_caption()` enforces the contract immediately, returning a specific
  error if anything is missing.

**The contract:**

- Self-contained HTML, transparent background (it overlays the video).
- Root with `data-composition-id` + `data-width`/`data-height` (author at 1920×1080).
- Declare `var TRANSCRIPT = [{text,start,end}, ...]` — CapForge fills in the real words.
- Build the caption DOM from `TRANSCRIPT`.
- Register a **paused** GSAP timeline at `window.__timelines["<id>"]`.
- One group visible at a time; **entrance animation only**; a hard `tl.set` kill at each
  group's end.
- Deterministic + finite: no `Math.random`, no `Date.now`, no `repeat: -1`, no
  `data-end` / `data-layer` (the banned patterns).

### 3.6 In-app HyperFrames UI

In the Studio sidebar, the **"HyperFrames ✦"** card (`HyperFramesPanel.tsx`, collapsed
by default):

- **Open in HyperFrames Studio ⧉** — generates the project (no render) and launches
  `npx hyperframes preview` on a free port; Electron (`hyperframes-studio.js`) polls for
  readiness and opens the browser. Inspect/refine the live composition, then render.
- **Render with HyperFrames ✦** — renders captions + effects through the engine.
- **Captions** dropdown — `classic` or any native registry style (from
  `/api/caption-styles`).
- Nested **effects timeline** (see §4).

---

## 4. Effects / AI video director

### 4.1 Effect data model

Frontend `EffectClip` (`src/renderer/src/types/app.ts`) ↔ backend `EffectClip`
(`backend/models/schemas.py`), bridged in `lib/render.ts` (camelCase ↔ snake_case):

| Field | Meaning |
|---|---|
| `id` | clip id |
| `type` | `logo \| lower_third \| kinetic_stat \| highlight \| b_roll` |
| `start`, `duration` | seconds |
| `trackIndex` / `track_index` | timeline track (1 = primary) |
| `anchorX/Y` / `anchor_x/y` | normalized position, 0–1, (0,0) = top-left |
| `sourceWordId` / `source_word_id` | optional link to the spoken word it was placed at |
| `variables` | type-specific config |
| `createdBy` / `created_by` | `user` or `agent` |

### 4.2 The five effect types

| Type | Description | Variables |
|---|---|---|
| `logo` | Animated image overlay (pop in / hold / pop out) | `src` (image path), `width` px |
| `lower_third` | Name/title bar sliding in from the left | `title` (req), `subtitle`, `accent` |
| `kinetic_stat` | Big animated number + label | `value` (req, e.g. "2.4M"), `label`, `accent` |
| `highlight` | Translucent marker swept across a word | `color`, `width`, `height` px |
| `b_roll` | Timed image insert behind the captions | `src` (req), `width`, `fullscreen` |

Effects are honored only on the HyperFrames render path (the Pillow renderer ignores them).

### 4.3 Effects timeline UI

`EffectsPanel.tsx` (`EffectsControls`), nested in the HyperFrames card and lifted to
`App.tsx` so the agent can mirror live-placed effects:

- Quick-add buttons for all 5 types (logo/b-roll open an image picker).
- Per-effect rows with editable start, duration, anchor X/Y, and type-specific fields.
- A "Saved" template picker, and a "★ Save as template" action per effect.
- Type-appropriate default anchors (logo → top-right, lower-third → bottom-left, etc.).

### 4.4 Finding moments (where to place effects)

`backend/engine/moments.py`:

- **`find_moments(query)`** — locate a literal phrase in the transcript (single- or
  multi-token, normalized). Returns `[{text, start, end, word_id}]`.
- **`find_semantic_moments(kind)`** — `numbers` (digits + spelled-out, for a
  kinetic_stat), `cta` (calls to action, e.g. "subscribe"/"link in bio"), or
  `speaker_change` (per diarized speaker, for a lower_third).

### 4.5 Effect packs (reusable effect folders, co-author mode)

There is no CapForge-managed template store. A reusable effect is a plain **effect
pack**: a folder with a top-level `<name>.html` file plus optional `README.md` /
`registry-item.json` usage rules and assets — the HyperFrames-native convention.
The `import_into_workspace` MCP tool copies a pack into the co-author workspace
under `compositions/<name>/` (or `compositions/components/<name>/`); the agent
then reads its usage rules and hand-wires it via `data-composition-src` (blocks)
or snippet paste (components). See `mcp_server/README.md` § Effect packs.

---

## 5. The AI control layer (MCP)

The base MCP control layer ships on `main`; Enhanced extends it heavily with the
effects, caption-style, custom-caption, HyperFrames, and creative-library tools.

### 5.1 How it connects

- **Bundled, no terminal needed.** CapForge ships its own Python runtime (with `mcp` +
  `httpx`) and the `mcp_server/` code.
- **One-click "Connect to Claude"** (Settings → *Claude AI integration*) writes a
  `capforge` server entry into the right client config:
  - **Claude Desktop** → `claude_desktop_config.json` (macOS / Windows standard /
    Windows Store MSIX path / Linux — all installed flavours).
  - **Claude Code** → `~/.claude.json` (with `type: "stdio"`).
- **Robust launch** — the entry runs the bundled python via `-c` with an explicit
  `sys.path.insert(0, <projectDir>)` bootstrap, so the package resolves even where the
  client ignores `cwd`/`PYTHONPATH` (Windows embeddable python freezes `sys.path`; the
  Store build virtualizes config paths). Paths embed safely via `JSON.stringify`.
- **Manual fallback** — "Copy config manually" for hand-pasting.

> The MCP server finds the running app via `~/.capforge/backend.json` at runtime, so the
> app just needs to be **open with a transcript loaded** for the edit tools to work.
> Because delivery rides the bundled server, **already-connected users get new tools with
> the next app build — no re-connect needed.**

### 5.2 All MCP tools

Defined in `mcp_server/server.py` (FastMCP). Grouped:

**Read**
| Tool | Description |
|---|---|
| `get_status` | Backend job status (idle / transcribing / rendering / …). |
| `get_transcript` | Transcript with segment + word indices (captions render from words). |

**Transcript edits (live UI)**
| Tool | Description |
|---|---|
| `update_words` | Replace specific words by segment+word index (spelling/homophones). |
| `remove_filler_words` | Drop disfluencies (um, uh, …); timestamps preserved; `extra_fillers` optional. |

**Jobs**
| Tool | Description |
|---|---|
| `transcribe` | Start transcription of a media file (blocks until done). |
| `export` | Export the transcript (e.g. `srt_word`, `ass`, `json`). |

**Style & emphasis (live UI)**
| Tool | Description |
|---|---|
| `get_ui_state` | Current renderer settings (camelCase) + display groups + preset names. |
| `set_style` | Patch global subtitle style (e.g. `{"fontSize": 84}`, `{"wordStyle": "highlight"}`). |
| `apply_preset` | Apply a built-in preset (YouTube Bold, TikTok Pop, …). |
| `emphasize` | Per-word overrides by group+word (size/animation/color). |

**Vision QA**
| Tool | Description |
|---|---|
| `render_frame` | Classic (Pillow) subtitle frame at time `t` as an image. |
| `preview_hyperframes_frame` | Fast single HyperFrames frame at `t` (native/custom caption + effects). |
| `check_layout` | Mechanical layout read: caption bbox, edge touch, platform safe-zone advisories. |

**Effects / AI video director**
| Tool | Description |
|---|---|
| `find_moments` | Find spoken moments matching a phrase (where to place effects). |
| `find_semantic_moments` | Find moments by kind: `numbers` / `cta` / `speaker_change`. |
| `list_effect_types` | The 5 effect types and the variables each accepts. |
| `list_effects` | Effect clips currently on the timeline. |
| `add_effect` | Place an effect at `start` for `duration` (with per-type content + anchor). |
| `remove_effect` | Remove an effect by id. |
| `render_hyperframes` | Render captions + placed effects via HyperFrames → output path. |

**Effect packs (co-author workspace import)**
| Tool | Description |
|---|---|
| `import_into_workspace` | Import an effect pack (folder: top-level `<name>.html` + optional README/registry-item.json + assets) into the co-author workspace, layout preserved. |

**Caption style**
| Tool | Description |
|---|---|
| `list_caption_styles` | `classic` + native registry styles. |
| `set_caption_style` | Set the caption look (classic / `caption-pill-karaoke` / …). |

**Custom (agent-authored) caption**
| Tool | Description |
|---|---|
| `get_custom_caption_contract` | Contract + starter template for authoring a caption style from scratch. |
| `set_custom_caption_style` | Set a brand-new agent-authored caption style (full HTML); validated on the way in. |

**HyperFrames creative library** *(newest)*
| Tool | Description |
|---|---|
| `hyperframes_guide` | The HyperFrames creative library. Call with no topic for the operating model + topic index, then a topic id to pull on demand. |

Resources: `hyperframes://library` (entry) and `hyperframes://topic/{id}` (one topic).

### 5.3 The HyperFrames creative library (`mcp_server/knowledge/`)

The connected agent isn't the Claude that has the HyperFrames *skills* installed — over
MCP it would otherwise only see tool docstrings. This library closes that gap.

- **What** — a curated, *verbatim* slice of the genuine HyperFrames creative references:
  `captions`, `text-animation` (marker sweep / scribble / sketchout / burst),
  `dynamic-techniques`, `motion-principles`, three GSAP adapters (`gsap-easing`,
  `gsap-timeline`, `gsap-perf`), `animation-techniques`, `typography`, `css-patterns`,
  `audio-reactive`, `transitions` + `transitions-css`, `visual-styles`, `palettes`,
  `house-style`.
- **Rebound to CapForge** — `knowledge/INDEX.md` is a CapForge entry that *replaces* the
  standalone CLI/project workflow ("don't `hf init` or run the CLI — drive the running
  app via these MCP tools") and restates the custom-caption contract. The CLI /
  scaffolding / TTS / multi-scene-composition material from the upstream skills is
  deliberately dropped.
- **Delivery** — pull-on-demand (progressive disclosure): `hyperframes_guide()` returns
  the operating model + topic index; `hyperframes_guide(topic)` returns one reference.
  The `TOPICS` manifest in `knowledge.py` is the single source of truth and the
  allowlist (a topic arg can't escape the directory).
- **Wiring** — `get_custom_caption_contract` / `set_custom_caption_style` docstrings
  point the agent at the guide so it consults the vocabulary before inventing a look.
- **Packaging** — the `.md` files ship via `mcp_server/knowledge/**/*.md` in the
  electron-builder `files` list.

---

## 6. Typical end-to-end flows

**Agent cleans + styles a transcript (live):**
`get_transcript` → `remove_filler_words` / `update_words` → `get_ui_state` →
`apply_preset` or `set_style` → `emphasize` keywords → `render_frame` to verify. The
open UI updates live throughout.

**Agent directs a video (effects + custom caption):**
`hyperframes_guide()` → pull `captions` + a motion topic → `set_custom_caption_style`
(or `set_caption_style`) → `find_semantic_moments("numbers")` → `add_effect(kinetic_stat,…)`
→ `preview_hyperframes_frame(t)` to judge → `render_hyperframes("standard")`.

**User in the UI:**
Build effects in the EffectsControls timeline → pick a caption style → *Open in
HyperFrames Studio* to inspect → *Render with HyperFrames ✦*.

---

## 7. Where everything lives

| Path | Role |
|---|---|
| `mcp_server/server.py` | All MCP tools + resources (FastMCP). |
| `mcp_server/client.py` | HTTP client to the backend agent endpoints. |
| `mcp_server/cleanup.py` | Pure transcript transforms (word edits, filler removal). |
| `mcp_server/discovery.py` | Reads `~/.capforge/backend.json` (port + token). |
| `mcp_server/knowledge.py` + `knowledge/` | HyperFrames creative library (manifest + vendored refs). |
| `backend/agent_bridge.py` | Discovery file + token auth. |
| `backend/exporters/hyperframes_*.py` | Project gen, render, snapshot, caption styles. |
| `backend/workspace_fs.py` | Co-author workspace sandbox + effect-pack import (`import_path()`). |
| `backend/engine/moments.py` | Literal + semantic moment finding. |
| `electron/claude-connect.js` | One-click Connect to Claude (config writers). |
| `electron/hyperframes-studio.js` | Launches/stops the `npx hyperframes preview` server. |
| `src/renderer/src/components/studio/HyperFramesPanel.tsx` | "HyperFrames ✦" card. |
| `src/renderer/src/components/studio/EffectsPanel.tsx` | Effects timeline UI. |
| `src/renderer/src/components/player/SafeZoneOverlay.tsx` | TikTok/Reels/Shorts preview guides. |
| `docs/plans/hyperframes-integration.md` | The integration plan (phases 0–D). |
| `docs/plans/hyperframes-studio-and-templates.md` | Studio/templates/captions plan (phases 1–3). |

---

## 8. Tests

- **MCP server:** `mcp_server/tests/` — transcript transforms (`test_cleanup.py`) and the
  creative library (`test_knowledge.py`: manifest↔file integrity, traversal rejection,
  no orphan files, index references every topic).
- **Backend:** `backend/tests/` — `test_hyperframes_{project,render,export,captions}.py`,
  `test_workspace_fs.py` (co-author workspace + effect-pack import), `test_moments.py`,
  plus the base golden-frame tests.
- **Frontend:** `src/renderer/src/lib/project.test.ts` (effects persistence) and the
  connect helpers in `electron/claude-connect.test.js`.

Run the MCP + backend Python tests with the dev venv, e.g.
`PYTHONPATH=. <venv>/bin/python -m pytest mcp_server backend -q`.
