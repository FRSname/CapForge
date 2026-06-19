# CapForge Enhanced — HyperFrames Studio, Reusable Templates & Native Captions

**Status:** Phases 1–3 SHIPPED (2026-06-19) · **Branch:** `capforge-enhanced` (worktree `../CapForge-enhanced`) · **Authored:** 2026-06-19
**Parent plan:** [`hyperframes-integration.md`](./hyperframes-integration.md) (Phases 0–E). This is the next slice: the *"level-up" entry point* + a *cross-project reusable effect library* + *HyperFrames' native caption styles*.

### Build log
- **Phase 1 — Open in HyperFrames Studio** ✅ `fe9d71b` (+ card grouping `7ec5ab0`). Electron-managed `npx hyperframes preview` server (free port, tree-killed on quit), `studio:open/stop` IPC, `window.subforge.openStudio`, `useRender.openStudio`, and a dedicated **HyperFrames ✦** sidebar card (Open Studio + Render + Effects). Typechecks clean; live click-through is manual.
- **Phase 2 — Reusable effect templates** ✅ `bb8f4cb`. `~/.capforge`-backed store (`backend/effect_templates.py`, timing stripped, assets copied in); open `/api/effect-templates` CRUD + guarded `…/apply`; MCP `save/list/apply/delete_effect_template`; UI "Apply template…" picker + per-effect "★ Save as template". 121 tests.
- **Phase 3 — Native caption styles** ✅ `592024b`. `caption_style` (default `classic`); `backend/exporters/hyperframes_captions.py` (install via `npx add`, inject transcript, list styles); generator references the component as a sub-composition; `GET /api/caption-styles`; "Captions" picker; MCP `list/set_caption_style`. Proven end-to-end (lint 0/0 + render + frame grab). 122 tests, golden updated.
- **Phase 4 — felt demo:** the live in-app run (Studio → connect Claude → place + save + apply + native captions → render) remains manual (needs the app + whisperx venv + a connected agent). Portrait/4k fit for native styles is a follow-up.

---

## The Vision (reframed from the request)

CapForge stays the **simple, fast** tool: drop a video → transcribe → caption → export. Nothing about that changes.

On top of it, a clearly-marked **"level up"** path:

> When the user wants more than captions, they **open the project in the HyperFrames Studio** (a local webapp), **connect Claude** to direct effects and styles, and **save anything they like as a reusable template** — a logo, a lower-third look, a transition, a color treatment — so it carries across future videos.

Three concrete capabilities realize this:

1. **"Open in HyperFrames Studio" button** — scaffolds the HyperFrames project from the current transcript and opens the local Studio (`npx hyperframes preview`) so the user can *see and refine* what's being built. (Phase 1)
2. **Reusable effect-template library** — "I made this with the agent; save it so we can reuse it." Backend-owned, cross-project, reachable by both the UI and the connected Claude. (Phase 2)
3. **Native HyperFrames caption styles** — yes, we can use them (`caption-pill-karaoke`, `caption-neon-accent`, …) as an opt-in upgrade over the hand-rolled caption track. (Phase 3)

This is additive. The Pillow caption render and today's HyperFrames effect render both stay.

---

## Phase 0 — Documentation Discovery ✅ (consolidated; do not re-derive)

### Allowed APIs — HyperFrames CLI (verified against `hyperframes v0.6.114`, this dev box)

- **`hyperframes preview [DIR]`** — "Start the studio for previewing compositions." Long-lived local server.
  - `--port=<port>` (default **3002**), `--no-open` (suppress the CLI's own browser open), `--open` (default true), `--force-new` (new server even if one runs for this project), `--list` (list active servers, exit), `--kill-all` (kill all, exit), `--browser-path`.
- **`hyperframes catalog`** — browse registry. `--type block|component`, `--tag <tag>` (e.g. `captions`, `caption-style`, `transition`, `social`, `text`), `--json` (machine-readable), `--human-friendly` (interactive picker).
- **`hyperframes add <NAME>`** — install a block/component into the project. `<NAME>` is a registry item **or a tag** (a tag installs all blocks with it, e.g. `captions`). `--dir=<dir>`, `--json` (machine-readable: **written files + the include snippet**), `--no-clipboard`.
- **`hyperframes render`** — already wired (`hyperframes_render.py`): `--quality draft|standard|high`, `--format mp4|webm`, `--output`, `--fps`. Needs Node 22 + FFmpeg.
- **Verified caption-style components** (from `catalog --tag caption-style --json`): `caption-pill-karaoke` (Pill Karaoke), `caption-neon-accent` (Neon Accent), `caption-weight-shift` (Weight Shift), `caption-emoji-pop` (Emoji Pop), `caption-editorial-emphasis` (Editorial Emphasis), … (full set returned by the catalog; **do not invent names — read the catalog**).
- **Banned** (from parent plan / captions.md): `repeat:-1`, `Math.random`/`Date.now`, `data-end`/`data-layer`, exit-before-transition, captions without a hard `tl.set` kill. Registry caption components already obey these — **don't fight or re-implement them.**

### Allowed APIs — CapForge (verified file:line)

- Project generation: `export_hyperframes_project(result, config, output_dir, source_video_path, custom_groups, effects, duration)` → `str` project dir (`backend/exporters/hyperframes_project.py:499`). Index assembly: `_build_index_html` (`:328`); caption track: `_groups_html` (`:121`) + `_groups_timing_json` (`:137`); asset copy helper: `_copy_asset` (`:150`).
- Endpoint that already returns a project folder without rendering: `POST /api/export-hyperframes` with `render:false` → `{project, file:null}` (`backend/main.py:563`). Effects fall back to server-side `current_effects` (`:607`).
- Effects timeline + live mirror: `current_effects`; `GET /api/effects` (open, `:664`), `GET/POST/PUT/DELETE /api/agent/effects` (`:670`+), `broadcast_event({"type":"effects_updated"})` (`:681`), renderer mirror via `AgentLiveSync` + `mapEffect`.
- `EffectClip` schema (`backend/models/schemas.py:198`): `id, type, start, duration, track_index, anchor_x, anchor_y, source_word_id, variables, created_by`. Frontend `EffectClip`/`EffectType` (`src/renderer/src/types/app.ts:62`).
- MCP action space (`mcp_server/server.py`): `add_effect` (`:310`), `list_effects`/`remove_effect`, `find_moments`/`find_semantic_moments`, `render_hyperframes` (`:377`), `apply_preset` (`:159`). Client methods in `mcp_server/client.py`.
- Persistence precedents: Electron presets at `userData/presets.json` + IPC `presets:list/load/save/delete` (`electron/main.js:526`, `electron/preload.js:42`); **backend already persists to `~/.capforge/`** (`backend/agent_bridge.py:39`); `shell.openExternal` in use (`electron/update-check.js:151`); subprocess + lifecycle pattern in `electron/python-manager.js` (free-port pick, `spawn`, kill on quit).
- Backend is configured by Electron via `CAPFORGE_*` env vars (`electron/python-manager.js:150`), spawned with a free `CAPFORGE_PORT`.
- **Dual preload gotcha** (memory `project_dual_preload_gotcha`): a new `window.subforge.*` method needs BOTH `electron/preload.js` (runtime, vanilla) *and* `src/preload/index.ts` (types) + the `SubforgeApi` type.

---

## Phase 1 — "Open in HyperFrames Studio" button

**Goal:** one click turns the current transcript into a HyperFrames project and opens the local Studio webapp in the browser. The smallest, most visceral "feel the direction" win — and the literal first thing the request asks for.

### What to implement (copy these patterns, don't invent)

1. **Studio server manager — `electron/hyperframes-studio.js`** (new). *Copy the lifecycle shape from `electron/python-manager.js`*: pick a free port (reuse its free-port helper), `spawn(npx, ['-y','hyperframes','preview','--no-open','--port',port, projectDir], {env})`, scan stdout for the ready/URL line, resolve `http://localhost:<port>`, keep the child handle, and **kill it on `app.will-quit`** (and on re-open use `--force-new` or kill the prior one). Expose `openStudio(projectDir)` and `stopStudio()`.
2. **IPC + preload (BOTH files).** `ipcMain.handle('studio:open', …)` / `'studio:stop'` in `electron/main.js`; add `openStudio`/`stopStudio` to `electron/preload.js` (runtime) *and* `src/preload/index.ts` + `SubforgeApi` type. After `openStudio` resolves a URL, open it with `shell.openExternal(url)` (already imported — `update-check.js:151`).
3. **Renderer button.** Add an **"Open in HyperFrames Studio"** button near "Render with HyperFrames ✦" (`CustomRenderPanel.tsx:193`). Handler: `await api.exportHyperframes({ render:false, use_ui_config:true, output_dir })` → `{project}` (`api.ts:240`), then `await window.subforge.openStudio(project)`. Reuse `useToast` for progress/errors.
4. **Node gate.** `preview` needs Node 22 (Risk R1). *Mirror* `hyperframes_render._resolve_npx` (`:33`): on `ENOENT`/missing npx, toast "Install Node.js 22+ to open the HyperFrames Studio" instead of crashing.

### Documentation references
`electron/python-manager.js` (spawn + free-port + kill-on-quit) · `hyperframes preview --help` (flags above) · `electron/update-check.js:151` (`shell.openExternal`) · `electron/preload.js:42-52` (IPC method pattern) · `backend/main.py:563` (`render:false` returns project dir) · memory `project_dual_preload_gotcha`.

### Verification checklist
- [ ] With a transcript loaded, clicking the button opens `http://localhost:<port>` in the browser showing the composition (video + captions).
- [ ] `npx hyperframes preview --list` shows the running server while the app is open.
- [ ] Quitting CapForge kills the server (`--list` then shows none) — no orphaned Node process.
- [ ] No Node installed → friendly toast, no crash.
- [ ] `npm run typecheck` (renderer) + node/preload typecheck clean.

### Anti-pattern guards
- **Do NOT spawn `preview` from the Python backend** — it would orphan on app quit. Manage it in Electron main, beside `python-manager.js`.
- **Do NOT hardcode port 3002** — pick a free port like `python-manager.js`.
- **Do NOT pass `--open`** — let Electron own the browser-open so it's one consistent surface (and works with `--browser-path` later if we embed).
- **Do NOT block the IPC forever** — time-box the "server ready" wait and surface a clear error.

---

## Phase 2 — Reusable effect-template library

**Goal:** "I created an effect I like (often via the Claude agent) — save it so we can reuse it across projects." A named template store, **backend-owned** (so the connected agent can save/apply too), **cross-project** (survives the throwaway project folders).

### Why backend-owned (not Electron `userData`)
The user's own workflow is *"I tell the agent: save this effect."* The agent reaches the app over REST/MCP, **not** Electron IPC — so the store must live where the backend (and thus MCP) can read/write it. Use the existing `~/.capforge/` home (`agent_bridge.py:39`).

### What to implement
1. **`backend/effect_templates.py`** (new). A template = an `EffectClip` with timing stripped (`name`, `type`, `track_index`, `anchor_x/y`, `variables`; **no** `id`/`start`/`duration`/`source_word_id`). Functions (all **immutable** — read → new dict → write):
   - `save_template(name, effect) -> Template` — and for asset-backed types (`logo`, `b_roll`) **copy the asset into `~/.capforge/templates/assets/`** (reuse the `_copy_asset` idea from `hyperframes_project.py:150`) so the template doesn't point at a throwaway project path.
   - `list_templates() -> list`, `apply_template(name, start, duration?) -> EffectClip` (fresh `id`, `created_by` preserved-or-`user`), `delete_template(name)`.
   - Persist to `~/.capforge/effect-templates.json`.
2. **Endpoints (`backend/main.py`).** Open `GET /api/effect-templates` (renderer list). Token-guarded `POST /api/agent/effect-templates` (save), `DELETE /api/agent/effect-templates/{name}`, `POST /api/agent/effect-templates/{name}/apply` (adds to `current_effects` + `broadcast_event({"type":"effects_updated"})` so it appears live).
3. **MCP tools (`mcp_server/server.py` + `client.py`).** `save_effect_template(name, effect_id)` (snapshot an existing clip) **or** inline-by-fields like `add_effect`; `list_effect_templates()`; `apply_effect_template(name, start)`; `delete_effect_template(name)`. Update the README tools table.
4. **UI (`EffectsPanel.tsx`).** Per-effect "Save as template…" (name prompt) and an **"Apply template ▾"** picker that lists `GET /api/effect-templates` and adds the chosen one at the current playhead. No new preload needed — this is REST via `api.ts`.

### Documentation references
`mcp_server/server.py:310` (`add_effect` field shape) · `backend/main.py:676` (effects endpoints + `effects_updated` broadcast) · `backend/agent_bridge.py:39` (`~/.capforge` home) · `backend/exporters/hyperframes_project.py:150` (`_copy_asset`) · `EffectsPanel.tsx` (panel + `mapEffect` live mirror) · common/coding-style immutability rule.

### Verification checklist
- [ ] Agent: `save_effect_template("Acme logo", <logo effect>)` → restart backend → `list_effect_templates()` still returns it (proves disk persistence) and the logo image is in `~/.capforge/templates/assets/`.
- [ ] `apply_effect_template("Acme logo", start=3.0)` adds a clip to the timeline that appears **live** in the EffectsPanel (existing broadcast + mirror).
- [ ] UI "Save as template" then "Apply template" round-trips on a *new* project (cross-project reuse).
- [ ] Unit tests: save/list/apply/delete + asset copy + immutability (original effect unchanged).

### Anti-pattern guards
- **Do NOT store templates in Electron `userData`** — the agent/MCP can't reach it.
- **Do NOT store the project-relative or original asset path** — project folders are throwaway; copy the asset into the template store.
- **Do NOT mutate the JSON or the passed effect in place** — read → new structure → write (coding-style immutability).
- **Do NOT duplicate "current effects" state into the template store** — templates are timing-less prototypes, distinct from `current_effects`.

---

## Phase 3 — Native HyperFrames caption styles

**Goal:** answer "can we use HyperFrames' nice caption styles?" → **yes**, as an opt-in upgrade. Keep `classic` (today's instant-recolor track + golden-frame parity) as the default; offer registry styles for the rich path.

### What to implement
1. **Schema.** Add `caption_style: str = "classic"` to `VideoRenderConfig` (`backend/models/schemas.py`) + the camelCase bridge in `src/renderer/src/lib/render.ts` (`captionStyle` → `caption_style`).
2. **Generator (`hyperframes_project.py`).** When `caption_style != "classic"`: run `npx hyperframes add <caption_style> --json --dir <project>` (install the component; cache so repeat installs are cheap), then emit the component's host element fed by `transcript.json` **instead of** `_groups_html` + `_groups_timing_json` + the caption timeline block. When `"classic"`, the current path is **unchanged**.
3. **Discovery for the picker.** Small `GET /api/caption-styles` that shells `catalog --tag caption-style --json` (cache the result), or ship a curated static list of the verified names. UI: a **"Caption style"** picker (StudioCard near caption settings) = `classic` + registry styles.
4. **Agent tool.** `set_caption_style(name)` MCP tool (pairs with existing `apply_preset`) so the connected Claude can swap caption looks; `list` the valid names.

### Documentation references
`hyperframes add --help` / `catalog --help` (verified flags above) · verified style names in Phase 0 · `hyperframes_project.py:328` (`_build_index_html` — the caption track to branch) · parent plan's captions.md rules · `VideoRenderConfig` schema + `render.ts` snake/camel bridge.

### Verification checklist
- [ ] `npx hyperframes catalog --tag caption-style --json` enumerates the styles the picker offers (names match exactly).
- [ ] Generating with `caption_style="caption-pill-karaoke"` → project `lint`s **0/0** and `render --quality draft` shows pill-karaoke captions over the video.
- [ ] `caption_style="classic"` (default) path is byte-for-byte unchanged — **golden-frame tests still pass**, no Pillow-path regression.
- [ ] `set_caption_style` from MCP swaps the look on the next render.

### Anti-pattern guards
- **Do NOT re-implement the registry component's CSS/JS** — install it via `add` (the entire point of "use HyperFrames' built-in styles").
- **Do NOT change the default** — `classic` stays default so the fast/parity path and golden frames are untouched.
- **Do NOT invent caption-style names** — only those `catalog` returns.
- **Do NOT strip the registry component's hard `tl.set` kill / entrance rules** — they already follow captions.md.

---

## Phase 4 — Verification & felt-direction demo

1. **Suites green:** full backend + MCP test suite; renderer + node/preload typecheck.
2. **Grep guards:**
   - No `hyperframes', 'preview'` spawn inside `backend/` (must be Electron-managed).
   - No `userData` path in `backend/effect_templates.py` (must be `~/.capforge`).
   - No caption-style string literal in `hyperframes_project.py` that isn't sourced from the catalog/config.
   - No hardcoded `3002` in the studio manager (free port).
3. **End-to-end felt demo (the go/no-go):**
   load clip → transcribe → **Open in HyperFrames Studio** (browser shows it) → connect Claude → *"make the logo pop when they say CapForge and use pill-karaoke captions"* → *"save that logo as a template"* → new project → *"apply my Acme-logo template"* → render. Confirm each step in the live app.
4. **Docs/memory:** update `hyperframes-integration.md` status; refresh memory `project_hyperframes_integration`.

---

## Sequencing & open forks (resolve as we hit them)

- **Recommended order:** Phase 1 first (smallest, most visceral, the literal first ask) → Phase 2 (the reuse loop the user described in most detail) → Phase 3 (the "can we use it?" yes).
- **Fork A — Studio surface:** open the local URL in the **system browser** (recommended: trivial, matches "opens localhost webapp", zero new UI) vs an **embedded in-app webview/BrowserWindow** (more native feel, more work; `preview --browser-path` supports a custom browser). Start with the system browser; revisit embedding only if it feels disjoint.
- **Fork B — Caption styles:** **opt-in picker, `classic` default** (recommended; protects golden-frame parity) vs replacing the hand-rolled track outright. Plan assumes opt-in.
- **Fork C — Template granularity:** effect-clip templates (Phase 2) vs also saving *style/caption presets* as templates. Phase 2 covers effects; caption-style choice is already captured by Phase 3's `caption_style`, and global style presets already exist (`presets.json`). Revisit a unified "look book" only if the user wants one surface.
