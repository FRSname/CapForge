# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What This Is

CapForge is a desktop subtitle editor: Electron 33 shell → React 19 renderer → Python FastAPI backend. The backend runs WhisperX for transcription and Pillow/FFmpeg for video rendering. Electron spawns the Python process on startup; the renderer talks to it over REST + WebSocket on `127.0.0.1` (preferred port 53421, falls back to an ephemeral port).

## Git Operations

Delegate all git **write** work — `commit`, `merge`, `push`, `branch`, `rebase`, conflict resolution — to the `git-ops` subagent (`Agent(subagent_type: "git-ops", …)`). It follows conventional-commit format, never commits/pushes directly to the default branch (branches first), and confirms before the first push. The read-only `scout` agent must never be used for git writes. Read-only git inspection (`status`, `diff`, `log`) can be run inline or by `scout`.

## Build & Dev Commands

```bash
npm run dev:react          # Vite dev server with HMR — THE live-reload path
npm run dev                # electron . --dev — does NOT start Vite (see trap below)
npm start                  # Production mode (needs build:react first)
npm run build:react        # Production build → out/renderer/

npm run typecheck          # tsc --noEmit -p tsconfig.web.json
npm test                   # vitest run
npm run lint               # eslint src

npm run backend            # uvicorn backend.main:app --host 127.0.0.1 --port 53421
npm run dist:mac           # DMG   (dist:* run build:react first)
npm run dist:win           # NSIS installer
```

**`npm run dev` is a trap**: it launches Electron with `--dev` but does not start Vite, so renderer edits won't appear. Use `npm run dev:react`.

### Testing

- **Frontend**: vitest, ~465 tests. Runs in the **`node` environment, not jsdom** — component tests render via `react-dom/server` to static HTML and assert on markup, so there are no DOM events and no testing of hooks-with-effects. Write new tests to that constraint.
- **Backend**: pytest. `pyproject.toml` sets `testpaths = ["backend/tests"]`, so a bare `pytest` **silently skips `mcp_server/tests`** — pass that path explicitly.
- **CI** (`.github/workflows/ci.yml`): three jobs — frontend (typecheck + vitest + lint), backend (pytest), caption-parity.
- eslint (flat config) + prettier are configured, but **`eslint.config.js` deliberately ignores `electron/**`** — `npm run lint` passing says nothing about the Electron layer.

## Architecture

### Three-Layer Stack

1. **Electron main process** (`electron/`) — vanilla JS. `main.js` creates the window, `python-manager.js` spawns/manages the backend, `runtime-setup.js` handles first-launch Python/model downloads, `preload.js` bridges IPC.
2. **React renderer** (`src/renderer/src/`) — TypeScript + React 19 + Tailwind v4, built by electron-vite.
3. **Python backend** (`backend/`) — FastAPI on uvicorn. `engine/transcriber.py` runs the WhisperX pipeline (transcribe → align → diarize). `exporters/video_render.py` renders caption frames with Pillow and muxes with FFmpeg. `models/schemas.py` defines all Pydantic models.

### Dual preload gotcha (read before adding any `window.subforge.*` API)

`package.json` `main` is **`electron/main.js`**, and it loads **`electron/preload.js`** (vanilla CJS) as the preload. `src/preload/index.ts` is a **types mirror**: electron-vite compiles it to `out/preload/`, which nothing loads. Likewise `src/main/index.ts` is a stub that `require`s `electron/main.js` — the TS migration is half-finished, and only `out/renderer/` is consumed from the electron-vite build.

So adding an API means **three** edits: `ipcMain.handle` in `electron/main.js`, the bridge in `electron/preload.js` (runtime), and the typed signature in `src/preload/index.ts` (renderer types). Editing only the TypeScript file type-checks and silently does nothing at runtime.

### Communication

- **REST** — `backend/main.py` registers ~45 routes; the ones with non-obvious rules:
  - **Local-token gated** (`require_local_token`, 7 routes): `GET /api/fonts/system`, `GET /api/serve-audio`, `GET /api/video-info`, `PUT /api/result`, `POST /api/export`, `POST /api/render-video`, `POST /api/export-hyperframes`. `GET /api/result` is **ungated** — only the PUT is.
  - **Agent-token gated**: all `/api/agent/*` (~19 routes) plus `POST /api/render-frame`.
  - **Deliberately ungated UI mirrors**: `GET|POST /api/coauthor`, `POST /api/coauthor/sync-captions`, and `PUT /api/ui-state` (the write side of the agent-gated `GET /api/agent/ui-state`). The local renderer has no agent token but drives co-author mode from the HyperFrames panel; same loopback trust level as `/api/export-hyperframes`, and the source comments say so. Don't "fix" these by gating them.
- **WebSocket**: `/ws/progress` pushes `ProgressUpdate` events (status + percentage + message).
- **IPC**: renderer ↔ main via `ipcRenderer.invoke()` / `ipcMain.handle()`.
- **MCP** (`mcp_server/` → `/api/agent/*`): ~34 tools. The **transcript-editing trio** has the subtle contract: `update_words` takes `WordEdit`s with an `op` field — `replace` (default), `delete`, or `merge` (absorb a word's timing into the adjacent survivor) — and re-joins segment text through an emptiness filter (`mcp_server/cleanup.py`) so deletes/merges never leave a double space. `get_transcript(segments_only=True)` returns a words-stripped shape (`GET /api/agent/result?include_words=false`) to protect the LLM token budget; that route uses `response_model=None` so FastAPI doesn't re-coerce the stripped dict back through `TranscriptionResult`. `sync_captions` is **co-author-mode only** — outside it the backend returns a clear `409`, because `update_words` already mirrors edits to the live UI on its own. See `docs/plans/mcp-transcript-editing-ux.md`.

### Renderer Structure

- `App.tsx` — owns screen state (`file` | `progress` | `results`), settings, and the always-visible StudioPanel sidebar
- `components/screens/` — DropZoneScreen, ProgressScreen, ResultsScreen, AlignmentNotice
- `components/studio/` — StudioPanel (sidebar), StudioCard, PresetPicker, ExportPanel, ExportFooter, CustomRenderPanel, HyperFramesPanel, RenderProgressModal; `studio/sections/` holds the per-card settings UI (Layout, Typography, Colors, Background, Animation, Reading)
- `components/ui/` — shared primitives, incl. **StudioRow** (slider + numeric input + reset; the pattern to copy for any new setting). Its `max` bounds the *drag*; the opt-in `commitMax` bounds what may be *stored*, so a manually typed value is clamped by the backend's `Field(..., le=…)` limit rather than only by `min`. UI writes bypass `sanitizeSettings`, so on a row with a hard schema ceiling that prop is the only guard against storing a config Pydantic will reject at render time. Express it in the row's own units, and omit it where the slider max is merely a recommended range (`posX` past the frame, etc.).
- `components/editor/` — SubtitleEditor (text view), GroupEditor (groups view), WordStylePopup, GroupPositionPopup
- `components/player/AudioPlayer.tsx` — video/audio player with WaveSurfer waveform, canvas timeline, caption overlay
- `hooks/` — 13 hooks; the load-bearing ones are `useSubtitleOverlay` (Canvas 2D caption preview, must match Pillow), `useTimeline` (zoomable canvas timeline with segment drag + word lane), `useRender`, `useTranscription`, `useSettingsUndo`, `useAutosave`
- `lib/` — pure logic, mostly unit-tested (`project.ts`, `renderConstants.ts`, `safeZones.ts`, `cn.ts` are the gaps): `render.ts` (snake_case bridge), `groups.ts` (grouping + reconciliation + gap closing), `api.ts` (REST client + token plumbing), `project.ts` (save/load/restore), `presets.ts`, `fonts.ts`, `wordTiming.ts`, `wordIds.ts`, `endEdited.ts`, `settingsSanitize.ts`, `renderConstants.ts`, `agentCommands.ts`, `undoStack.ts`, `overlayGeometry.ts`, `timelineMath.ts`, `safeZones.ts`, `settingsSearch.ts`, `shortcuts.ts`

**Right-click a word to open WordStylePopup** (text correction + per-word overrides), **right-click a group row to open GroupPositionPopup**. Both are rendered in *both* `ResultsScreen.tsx` and `GroupEditor.tsx` — popup wiring changes must touch both.

### Preview ↔ Render Parity → [docs/caption-parity.md](docs/caption-parity.md)

**Three** caption renderers must produce visually identical output — Canvas preview (`hooks/useSubtitleOverlay.ts`), Pillow (`video_render.py` `_render_frame()`, the source of truth), and the HTML/GSAP layer (`hyperframes_caption_html.py`). **Changing any rendering formula means updating all three in lockstep.**

There are **two layout modes** (`reading_mode`): the default `'wrap'`, and `'rsvp'` — the Spritz speed-reading mode, a single unwrapped line that slides so the active word's focus glyph stays pinned to a pivot column. It is a *layout* axis orthogonal to `word_transition`, so it is **not** a `word_transition`/`wordStyle` value and is not per-word overridable — never add `'rsvp'` to the `WordTransition` union or `WordStylePopup`. RSVP's shared scalar core is triplicated in `backend/exporters/rsvp.py`, `lib/rsvp.ts` and `RSVP_RUNTIME_JS` (`backend/exporters/hyperframes_rsvp_runtime.py`); those three are twins pinned against one another by the shared JSON fixtures under `backend/tests/fixtures/` (`rsvp_*_cases.json`), plus a Canvas↔Pillow numeric fixture asserted from both sides. Pillow's layout/draw lives in `backend/exporters/rsvp_layout.py` (extracted because `video_render.py` is far past the size ceiling).

**RSVP's unit of layout is a *reel*, not a caption group**: consecutive groups that leave no blank frame between them (`a.end >= b.start`, same position override) are merged into one before any renderer sees them, so the line flows through a group boundary instead of snapping back to its first word. Like gap closing this is a group-list transform with **two** implementations, not three — `backend/exporters/rsvp_reels.py` (applied in `groups_for_render`, which also feeds the HTML layer) and `lib/rsvpReels.ts` (applied in `useSubtitleOverlay`) — pinned by `backend/tests/fixtures/rsvp_reel_cases.json`. `gapCloseThreshold` is therefore what decides how long a reel gets; at 0 the pass is the identity. Reels force two mechanisms that must both stay invisible: a **pixel-neutral cull** of the off-window part of the line (Pillow + Canvas only; the HTML layer's mask already does it) and a **per-reel layout cache** (measuring 900 words per frame is 140ms → 9.7ms with both). See [docs/caption-parity.md](docs/caption-parity.md) → "Continuous flow: reels".

Read [docs/caption-parity.md](docs/caption-parity.md) before touching caption geometry, animation, fonts, per-word/per-group overrides, gap closing, or reading mode. It covers the measurement equivalences, the no-bold-synthesis rule, font-loading order, the RSVP formulas (ORP table, `focusOffset`/`lineX`, the caption band, the single anchor rule, the tracking gap, the reticle's half-open box convention), which settings RSVP ignores, the documented accepted deltas (do not "fix" them), and how to run the golden-frame and parity suites.

### HyperFrames Integration → [docs/hyperframes-integration.md](docs/hyperframes-integration.md)

The bridge to the HyperFrames Node CLI subprocess is hardened separately from caption parity: CLI version gate, structured error hierarchy, the durable co-author marker, the scaffold fingerprint cache (**bump `SCAFFOLD_VERSION` when the scaffold or embedded caption runtime changes shape**), the snapshot picker, and the read-only CLI subcommand allowlist.

### TypeScript Config

Three tsconfig files: `tsconfig.json` (root references), `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer). Type-check the renderer with `npm run typecheck`. Path alias `@/*` → `src/renderer/src/*`.

## Key Conventions

- **snake_case ↔ camelCase bridge**: the backend is snake_case, the frontend camelCase, and the bridge happens in exactly one place — `lib/render.ts` (`buildRenderBody()`). Adding a setting is a **seven-file** change, and skipping any of the last three fails CI or ships a dead control:
  1. `StudioSettings` interface + `DEFAULTS` (`StudioPanel.tsx`)
  2. `render.ts` config object
  3. `VideoRenderConfig` Pydantic model (`schemas.py`)
  4. a `StudioRow` in the right card under `components/studio/sections/` — otherwise there is no UI
  5. `lib/settingsSanitize.ts` — bounds mirroring the Pydantic `Field(...)`
  6. `lib/settingsSearch.ts` — both `CARD_SETTINGS` and `SETTINGS_REGISTRY`, or settings search can't find it
  7. `backend/tests/test_caption_cfg_contract.py` — an always-on partition test: every `VideoRenderConfig` field must be filed in exactly one of `EXPECTED_IN_CAP_CFG` or `INTENTIONALLY_ABSENT`, so an unclassified new field **fails the backend CI job**. It guards the bug class where `caption_cfg` silently dropped style fields.
- **StudioSettings**: one flat interface in `StudioPanel.tsx` holding every caption style setting; passed down as props, never fragmented. Defaults are declared as `const DEFAULTS` and re-exported as `STUDIO_DEFAULTS` — grepping for the latter inside `StudioPanel.tsx` only finds the alias line.
- **StudioSettings units are NOT uniform, and external writers must be sanitized (`lib/settingsSanitize.ts`)**:
  - **0–100, divided by `pct()` in `render.ts`**: `bgOpacity`, `maxWidth`, `posX`, `posY`, `animDuration`, `rsvpPivotX`, `rsvpEdgeFade` (the last two are fractions of the RSVP caption band; their backend `Field` bounds are the /100 versions, `le=1.0` and `le=0.5`).
  - **0–1 fractions, pass through untouched**: `shadowOpacity`, `highlightOpacity`, `rsvpContextOpacity` — the only three marked `fraction: true`.
  - **Plain seconds**: `gapCloseThreshold`, `lastGroupHold`, `rsvpSlideDuration`. Marking these `fraction: true` would re-read a legitimate `2` second hold as `0.02`, or a `1.5`s RSVP slide as `0.015`s.
  - **Unbounded above**: `bounceStrength` is a fraction *of font size* with no upper bound (`Field(0.18, ge=0.0)`), so a value > 1 is legal. It is deliberately **not** `fraction: true` — "fixing" that would corrupt a legitimate `1.5`.
  - **Non-numeric**: `readingMode` (`'wrap' | 'rsvp'` enum), `rsvpFocusColor` (hex, default `#E4851F`), `rsvpReticle` (bool).
  The UI sliders can't get this wrong, but the three writers that bypass them can — the MCP agent (`set_settings`), a preset (`applyPreset`), and a restored project (`restoreFromProjectFile`) — so all three run values through `sanitizeSettings`/`sanitizeSettingValue`, whose bounds mirror the `Field(...)` constraints on `VideoRenderConfig`. A `fraction` field given a value in (1, 100] is read as a percentage (90 → 0.9) rather than clamped to 1.0, because that is the mistake being made. Without this, an agent writing `shadowOpacity: 90` poisons the mirrored config and *every* later render fails validation (422 on `/api/render-video`, 409 on `/api/render-frame`) — and saving that style as a preset makes it permanent, so "change a control to re-mirror" never clears it.
  `settingsSanitize.ts` also has a second, **non-numeric** path (enum / hex colour / bool) for the same three bypass writers. Only the three RSVP non-numeric settings are enrolled (`ENUM_SETTING_VALUES`, `COLOR_SETTINGS`, `BOOLEAN_SETTINGS`); the pre-existing enum/colour settings (`textAlignH`, `wordStyle`, `textColor`, …) are deliberately **not**, because enrolling them would change what an agent's `set_settings` is allowed to write — that belongs in its own change. Note the two readings differ on purpose: a live patch drops an unusable value and leaves the user where they are (`coerceNonNumericSettingValue`), while a preset/project restore substitutes the default.
- **Settings undo**: `useSettingsUndo` (App.tsx) wraps `setSettings`; every UI change is pushed to a ref-based stack. The mechanics — `MAX_HISTORY = 50`, 500ms debounce — live in `lib/undoStack.ts`. Cmd+Z / Cmd+Shift+Z when focus is outside text editors.
- **Word-timing locality (`lib/wordTiming.ts`)**: a manual text correction must never move a word the user didn't touch. CapForge is a *finishing* tool used after the video is cut elsewhere, so captions stay locked to the original audio — the invariant `mcp_server/cleanup.py` states as "Timing is never shifted". `retimeWords()` is the **single** place text→timing reconciliation happens: it LCS-diffs the old word text against the new tokens, so matched words keep byte-identical `start`/`end` plus their `overrides`, and only the changed run is retimed **inside its own span**. An inserted word takes the silent gap between its neighbours when one exists, else carves off the tail of the word before it (at most one neighbour moves); a deleted word's span is absorbed by the previous survivor, mirroring `apply_word_edits()`. **Never re-time words by array index** — that was the original bug (inserting one word shifted every later word onto its neighbour's slot and duplicated the last timing). `/api/realign` (WhisperX forced alignment) rewrites *every* word in a segment and is deliberately a manual button only — never auto-trigger it from an edit handler.
- **Segments vs Groups**: `Segment[]` is the source transcription. Groups are derived display chunks (N words each) used for preview and render; they can be manually edited (merge/split/reorder), tracked by the `groupsEdited` flag. Two group-only fields persist with the project (they ride `studioGroups`) but are intentionally **not** part of presets:
  - `positionOverride` (`position_x`/`position_y`) — set by right-clicking a group row. Position-only changes are **not** boundary edits: they flow through GroupEditor's `onPositionChange` (not `onChange`) and must NEVER flip `groupsEdited`, so automatic re-grouping keeps working. `render.ts` still sends `custom_groups` whenever any group has an override.
  - `endEdited` — "the user placed this `end` by hand", so automatic gap closing and the final-group hold skip it (`lib/endEdited.ts` retrofits it onto pre-`endEdited` projects on restore). Unlike `positionOverride`, an end edit **is** a boundary edit: it flows through `onChange` and does flip `groupsEdited`, including the `↺` reset that hands the group back to the automatic pass.
- **Group membership is reconciled by word identity, never by position (`lib/wordIds.ts`)**: every word carries a session-minted `wid`, and the one place segments flow back into manually-edited groups is `reconcileGroups()` (`lib/groups.ts`), called from `ResultsScreen`'s sync effect. It matches group words to segment words by `wid`, so a word dragged into a non-adjacent group, a reordered group, a merge or a split all survive an edit to the source segments; a group whose word ids are unchanged also keeps its `start`/`end` verbatim, which preserves both a manual timeline drag and the end baked by "Close all gaps". **Never re-slice `segments.flatMap(s => s.words)` by index or word count to refresh groups** — that silently restores document order and is exactly the bug this replaced (`docs/plans/fill-gaps-resets-custom-groups.md`). Ids are minted at every segments write via `commitSegments` → `ensureWordIds`, carried across `retimeWords` and `/api/realign`, adopted onto legacy project groups by text+timing (`adoptWordIds`), and stripped from the `custom_groups` render payload in `render.ts`. Identity is all-or-nothing: if any word lacks a `wid`, `reconcileGroups` falls back to a document-order rebuild rather than half-matching.
- **Backend port**: preferred 53421; `python-manager.js` finds a free port and the renderer gets it via IPC `backend:port`.
- **Custom fonts**: stored in app data via Electron IPC. The path goes to both Canvas (via `@font-face` injection) and the backend (`custom_font_path`). Bold means selecting a bold font variant — there is no synthetic bold.
- **Shareable presets (`.cfpreset`)**: a preset exports to / imports from a single JSON file (`{ type: 'capforge-preset', version, name, settings, font }`) via IPC `presets:export` / `presets:import` (preload: `window.subforge.exportPreset(name)` / `importPreset()`). `electron/preset-io.js` is the source of truth for the format and its pure helpers (`classifyFont`, `buildPresetExport`, `parsePresetImport`, `uniquePresetName`). Font portability: user fonts are embedded as base64 (10MB cap), bundled CapForge fonts are referenced by name only; on import the font is re-materialized to a *local* path and the stored `customFontPath` is rewritten so Canvas and the backend both resolve it. Import is a **trust boundary** — `parsePresetImport` validates the type tag, gates the version, strips proto-pollution keys, enforces the size cap, and writes fonts basename-only with an extension allowlist. Per-word `custom_font_path` overrides live in project data, not presets, so they are intentionally not shared.
- **Canvas wheel events**: React's `onWheel` is passive and cannot `preventDefault()`. For canvas zoom/pan use a native `addEventListener('wheel', handler, { passive: false })` inside a `useEffect` that cleans up on unmount. Always call `draw()` after mutating state refs — a React re-render doesn't repaint a canvas.
- **Toasts**: `useToast` provides `toast(message, type)`. Wrap errors in toast calls rather than silently catching.
- **Local media token**: the 7 gated routes listed under Communication stream/repoint arbitrary local files or trigger a render/export to a client-supplied `output_dir`, so all carry a per-launch `CAPFORGE_LOCAL_TOKEN`. Electron mints it (`crypto.randomBytes(32)`) per spawn, injects it as an env var, and exposes it via IPC `backend:local-token` → `window.subforge.getLocalToken()` (wired in **both** preloads — see the Dual preload gotcha). The renderer calls `api.setLocalToken()` alongside every `setPort`, sending it as `?token=` on `<audio>`/WaveSurfer URLs (which can't set headers) and as the `X-CapForge-Local-Token` header on `fetch`. That header is attached centrally in `api.ts`'s `post()`, so a newly gated POST route gets it for free — don't hand-wire it. `require_local_token` (`main.py`) compares constant-time (`hmac.compare_digest` via `token_matches`) and also accepts `X-CapForge-Agent-Token` — the header the MCP client (`mcp_server/client.py`) sends on every call — so an authorised agent isn't locked out of the gated render/export routes. A second guard, `_is_servable_path`, realpath-resolves the target and serves only `current_result.audio_path` or a file *contained in* its `hyperframes_workspace()` — defeating `../`, symlink, and sibling-prefix traversal even for a token holder. The export/render routes additionally sandbox `output_dir` through `resolve_output_dir()` (`hyperframes_project.py`), so a non-absolute value (a `..` string, or the schema default `"output"`) falls back to the folder next to the source media instead of being honoured literally. uvicorn runs `--no-access-log` so the query-param token never lands in `backend.log`. Never hardcode, persist, or log this token.
- **Overlay MOV alpha convention**: the transparent overlay export writes **premultiplied** alpha in the ProRes 4444 branch of `_render_overlay` (`-vf premultiply=inplace=1`), because ProRes 4444/QuickTime is a premultiplied-alpha convention — straight alpha risks mis-compositing in NLEs. (Premiere may still auto-detect the clip as "Straight Alpha"; users should conform it to Premultiplied.) The WebM overlay branch stays **straight** alpha (VP9/browser convention) — do not touch it. Pinned by `backend/tests/test_overlay_alpha.py`. To simulate an NLE import: `[1:v]unpremultiply=inplace=1[u];[0:v][u]overlay`. **Known non-file failure mode**: a washed-out semi-transparent caption box in Premiere with a *correct* file is Premiere compositing in linear color (sequence "Composite in Linear Color") — verify with a gamma-space ffmpeg composite before touching the encoder (`docs/plans/overlay-opacity-persists-round2.md`).
- **BT.709 color tagging**: every user-facing encode except WebM (overlay MOV, overlay MP4, baked MP4) forces the RGB→YUV conversion to BT.709 limited range (`scale=out_color_matrix=bt709:out_range=tv,format=…`) **and** tags the stream (`_BT709_TAGS`), so NLEs stop guessing. Matrix and tags must always change together — one without the other reintroduces a hue shift on saturated colors (pinned by the saturated-color test in `test_overlay_alpha.py`). In the MOV branch `premultiply` must stay **first** in the `-vf` chain (it operates in RGBA), and the branch also needs `-movflags write_colr` — without it the mov muxer writes no `colr` atom for ProRes at all. Only `color_space` is ffprobe-visible there; re-verify on any FFmpeg upgrade.

## Theming

Dark (default) and light themes via the `:root.light` CSS class. All colors are CSS custom properties in `src/renderer/src/styles/globals.css` (`--color-text`, `--color-bg`, `--color-surface`, …).

- Never hardcode colors like `text-white` or `bg-black` — use `var(--color-text)`, `var(--color-bg)`, etc.
- Tailwind v4 can misparse `text-[var(--color-text)]` (ambiguous color vs font-size) — use inline `style={{ color: 'var(--color-text)' }}` when it does.
- Font variables: `--cf-font-ui` (Inter), `--cf-font-display` (Instrument Serif), `--cf-font-mono` (JetBrains Mono).
- Brand orange is the `--color-brand` token (`#D4952A`).
