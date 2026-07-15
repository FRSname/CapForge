# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

CapForge is a desktop subtitle editor: Electron 33 shell → React 19 renderer → Python FastAPI backend. The backend runs WhisperX for transcription and Pillow/FFmpeg for video rendering. Electron spawns the Python process on startup; the renderer talks to it over REST + WebSocket on `127.0.0.1:53421`.

## Build & Dev Commands

```bash
# Frontend (React + TypeScript + Tailwind v4 via electron-vite)
npm run dev:react          # Dev server with HMR
npm run build:react        # Production build → out/renderer/
npm run typecheck          # tsc --noEmit -p tsconfig.web.json

# Backend (Python FastAPI)
python -m uvicorn backend.main:app --host 127.0.0.1 --port 53421

# Electron
npm start                  # Production mode (requires build:react first)
npm run dev                # Dev mode with --dev flag

# Package (each script runs build:react automatically first)
npm run dist:mac           # DMG
npm run dist:win           # NSIS installer
```

No test suite exists yet. The project has no linter or formatter configured.

## Architecture

### Three-Layer Stack

1. **Electron main process** (`electron/`) — vanilla JS. `main.js` creates the window, `python-manager.js` spawns/manages the backend process, `runtime-setup.js` handles first-launch Python/model downloads, `preload.js` bridges IPC.

2. **React renderer** (`src/renderer/src/`) — TypeScript + React 19 + Tailwind v4. Built by electron-vite. The `src/preload/index.ts` typed preload exposes `window.subforge` API (file dialogs, fonts, presets, project save/load, state persistence).

3. **Python backend** (`backend/`) — FastAPI on uvicorn. `engine/transcriber.py` runs WhisperX pipeline (transcribe → align → diarize). `exporters/video_render.py` renders subtitle overlay frames with Pillow and muxes with FFmpeg. `models/schemas.py` defines all Pydantic models.

### Communication

- **REST**: `/api/transcribe`, `/api/render-video`, `/api/export`, `/api/result` (GET; PUT is token-gated), `/api/serve-audio`, `/api/video-info`. The last three are gated by the per-launch local media token (see Key Conventions) — they read/repoint arbitrary local files. `/api/agent/*` is separately gated by the agent token.
- **WebSocket**: `/ws/progress` pushes `ProgressUpdate` events (status + percentage + message)
- **IPC**: Renderer ↔ main process via `ipcRenderer.invoke()` / `ipcMain.handle()` for file system ops
- **MCP agent transcript-editing contract** (`mcp_server/` tools → `/api/agent/*`): three tools a Claude agent uses to edit a transcript in the running app. `update_words` takes a list of `WordEdit`s carrying an `op` field — `replace` (default), `delete`, or `merge` (absorb a word's timing into the adjacent surviving word); it re-joins segment text with an emptiness filter (`mcp_server/cleanup.py:44`) so deletes/merges never leave a double space. `get_transcript(segments_only=True)` returns a words-stripped shape (`GET /api/agent/result?include_words=false`) to avoid blowing the LLM token budget on long transcripts — the route uses `response_model=None` so FastAPI doesn't re-coerce the stripped dict back through `TranscriptionResult`. `sync_captions` is **co-author-mode only**: outside it the backend returns a clear `409` (not an opaque `FileNotFoundError`→400) because `update_words` already mirrors edits to the live UI on its own. See `docs/plans/mcp-transcript-editing-ux.md`.

### Renderer Structure

- `App.tsx` — owns screen state (`file` | `progress` | `results`), settings, and the always-visible StudioPanel sidebar
- `components/screens/` — DropZoneScreen, ProgressScreen, ResultsScreen
- `components/studio/` — StudioPanel (settings sidebar), StudioRow, StudioCard, PresetPicker, ExportPanel, CustomRenderPanel
- `components/editor/` — SubtitleEditor (text view), GroupEditor (groups view), WordStylePopup (per-word overrides)
- `components/player/AudioPlayer.tsx` — video/audio player with WaveSurfer waveform, canvas timeline, subtitle overlay
- `hooks/useSubtitleOverlay.ts` — Canvas 2D subtitle preview renderer (must match backend's Pillow rendering)
- `hooks/useTimeline.ts` — canvas-based zoomable timeline with segment drag
- `lib/render.ts` — builds the snake_case render config from React StudioSettings for the backend
- `lib/groups.ts` — word grouping logic (split segments into N-word display groups)
- `lib/presets.ts` — serialize/deserialize presets to/from StudioSettings

### Preview ↔ Render Parity

There are **three** caption renderers that must produce visually identical output, and changing any rendering formula means updating **all three in lockstep**:
1. Canvas preview — `src/renderer/src/hooks/useSubtitleOverlay.ts` (what the user sees in-app)
2. Pillow render — `backend/exporters/video_render.py` `_render_frame()` (the classic exported video; the source of truth)
3. HTML/CSS/GSAP caption layer — `backend/exporters/hyperframes_caption_html.py` (what the HyperFrames engine renders for co-author mode + native captions). It ports the Canvas geometry/animation into a config-driven JS runtime so HyperFrames captions match the panel exactly.

Key equivalences:
- Canvas `measureText().width` ↔ PIL `font.getlength()` (NOT `textbbox` — that strips side bearings). The HTML runtime measures with the same canvas `measureText('Ayg')` approach.
- **No bold synthesis**: Pillow cannot fake-bold a regular TTF. The Bold toggle was removed — users pick a font variant directly (e.g. `Inter-Bold.ttf`). All three renderers use `font-weight: normal` / the font file as-is (the HTML layer embeds it via `@font-face`).
- **Font parity for the HTML layer (word-spacing correctness)**: the HTML caption layer has no CSS word spacing — every word is `position:absolute` and placed by a JS cursor (`wx += measureWord() + measureText(' ')`). So spacing is only correct if the render browser measures the *right* font at the *right* time. Two invariants keep it honest: (1) `_font_face_block` (`hyperframes_project.py`) embeds the **exact file Pillow rasterizes** via `resolve_font_file()` (`video_render.py`) — even for bundled/system fonts the user picked by name, which the headless render machine otherwise lacks; (2) `__capWhenFontsReady` (`hyperframes_caption_html.py`) **defers `__capBuild` + `__timelines` registration until `document.fonts` loads** (raced against a 3s timeout), because measuring before the `@font-face` decodes bakes fallback-font widths → captions render in the right glyphs but mis-spaced ("connected words"). The CLI polls for `window.__timelines["root"]` and reads frame count from `#root`'s `data-duration`, so deferring registration is safe.
- All three use the same formulas for row gap, background box sizing, word positioning, animation curves, and every `word_transition` mode (highlight/instant/crossfade/karaoke/underline/bounce/scale/reveal/none).
- **Per-word overrides are part of the contract**: the HTML payload carries a per-word `"o"` object (`_WORD_OVERRIDE_KEYS` in `hyperframes_caption_html.py` — exactly the keys Pillow honors; `custom_font_path` deliberately excluded, per-word fonts are embedded server-side via the same `resolve_font_file()` mechanism as the main font). `highlight_animation: 'jump'|'slide'` is implemented in all three; slide lerps the pill from the previous word's rect with `t_ease = 1-(1-clamp(raw_t*2.5))²` and is **row-local** (never slides across a line break).
- **Per-group position overrides are part of the contract too**: a group dict may carry `position_x`/`position_y` (sparse fractions 0–1 on the `CustomGroup` schema; absent/None = use the config's global position) that move that group's caption anchor in all three renderers. The HTML payload carries them as a sparse per-group `"pos"` object alongside the per-word `"o"`. Pinned by the `group_pos_top` golden frame and `test_group_position_parity`.
- **GSAP ease naming trap**: the shared quadratic curve `1-(1-t)²` is GSAP `power1.out` (`power1` = quad, `power2` = cubic). Group enter/exit and the highlight slide all use `power1.*` — "upgrading" them to `power2` reintroduces a real mid-animation divergence the parity suite catches.
- **DOM span vertical placement**: the browser puts a span's baseline at half-leading + FONT ascent (`spanBaseline()` in the runtime), NOT at the ink ascent — using ink ascent renders text ~8px off for fonts whose ascent+descent ≠ 1em (CaviarDreams). Pillow anchors on the font ascender line, so `font_size_scale` override words additionally shift by the scaled-vs-base ascender→ink gap delta — Canvas and the HTML runtime both reproduce that (`gapBase`/`m.gap`).
- Shared magic numbers live in `lib/renderConstants.ts` — the backend receives them via the render config (e.g. `crossfade_duration`), so they stay synced automatically.
- **Accepted deltas** (documented, do not "fix"): stroke join geometry (Canvas `round` vs PIL miter vs CSS), the shadow-blur kernel (Pillow `GaussianBlur(radius=blur/2)` matches the CSS/canvas spec sigma), and mid-entry frames of animations over a translucent bg box — the browser flattens group opacity while Canvas/Pillow stack per-element alpha, so overlapping translucent pixels legitimately differ for the few entry/exit frames.
- **HyperFrames snapshots**: the CLI (≥ 0.7.25) saves extra unrequested frames (auto end-of-timeline). `snapshot_hyperframes_project()` picks the PNG whose `frame-NN-at-<t>s.png` filename time is closest to the requested `t` — never "newest file".
- **Golden-frame tests**: `backend/tests/test_render_golden.py` pins `_render_frame()` pixel output against PNGs in `backend/tests/golden/` (tolerance-based diff). Regenerate after an intentional formula change with `.venv-dev/bin/python -m backend.tests.gen_golden`, then review the PNGs visually before committing — they define what "correct" looks like.
- **Caption parity tests**: `backend/tests/test_caption_parity.py` diffs the Pillow render against the live HyperFrames snapshot for every word mode + stroke/shadow/multi-line, plus per-word overrides, highlight slide, mid-entry group ease, and 1080p/portrait resolutions. Each comparison also asserts the caption **bounding-box extents** agree within 3px per edge (catches few-px drift the loose mean/notable tolerances hide). Opt-in (needs Node 22 + ffmpeg): `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py`.

### HyperFrames Integration (connection-layer contract)

The bridge to the HyperFrames Node CLI subprocess is hardened separately from the caption-parity contract above. These are the invariants that keep it reliable across CLI version drift, backend crashes, and the preview loop:

- **CLI version gate** (`backend/exporters/hyperframes_version.py`): `MIN_SUPPORTED = "0.7.21"` is the floor — `check_cli_compat()` refuses to render below it (`HyperframesVersionError`) and only *warns* when the probe fails (unknown version proceeds). `SNAPSHOT_EXTRA_FRAME_SINCE = "0.7.25"` is the version from which the CLI auto-saves an extra end-of-timeline frame (why the snapshot picker exists). Bump `MIN_SUPPORTED` only alongside a green parity run at the new pin; the weekly `parity-nightly.yml` job tests `@latest` but is **never a required check**.
- **Structured errors** (`hyperframes_render.py`): all failures subclass `HyperframesRenderError` — `HyperframesUnavailableError` (no bundled Node/CLI), `HyperframesVersionError` (below the gate), `HyperframesTimeoutError` (render/snapshot exceeded its deadline; process tree killed), `HyperframesCancelledError` (user cancelled via the `cancel_event`). Catch the base class; surface `.detail` (stderr tail) to the user.
- **Durable co-author marker** (`COAUTHOR_MARKER = ".capforge-coauthor.json"`, `hyperframes_project.py`): the on-disk source of truth for "is this project co-authored?" so the mode survives a backend crash/restart — the in-memory `current_coauthor` global is only a fast path. Written atomically, resolved *through* the workspace sandbox (`resolve_in_workspace`), kept as history (`active: false`) on exit, never deleted. Guards `CoauthorClobberError`: scaffolding refuses to overwrite an agent-authored `index.html` while the marker says active. A missing/corrupt marker degrades to `None` (= "not co-authored"), so writes must never leave truncated JSON.
- **Scaffold fingerprint** (`SCAFFOLD_FINGERPRINT_FILE = ".capforge-scaffold.json"`, `SCAFFOLD_VERSION`): sidecar next to `index.html` letting `ensure_hyperframes_project()` skip re-scaffolding when inputs are unchanged (the preview-loop cache). The cache keys on `(fingerprint, SCAFFOLD_VERSION)` — **bump `SCAFFOLD_VERSION` whenever `_build_index_html` or the caption runtime it embeds changes shape**, or an old byte-identical input set will serve a stale-shape preview.
- **Snapshot picker** (`hyperframes_render.py`): picks the PNG whose `frame-NN-at-<t>s.png` filename time is closest to the requested `t`; falls back to newest `st_mtime` **only** for pre-`0.7.25` CLI filenames that lack the `-at-<t>s` suffix. Never pick a snapshot by mtime otherwise (the CLI writes the extra frame *after* the requested one).
- **CLI subcommand allowlist**: the co-author agent may only run read-only dev-loop subcommands — `CLI_ALLOWED_SUBCOMMANDS = {lint, inspect, compositions, info, docs}`. Render/snapshot/networked/stateful commands have dedicated endpoints, never the passthrough.
- **Effect packs (no template library)**: reusable effects are plain folders (`<name>.html` + optional `README.md`/`registry-item.json` + assets), not a CapForge-managed store — the MCP `import_into_workspace` tool copies one into `compositions/<name>/` (or `compositions/components/<name>/`), and the co-author agent reads its usage rules and wires it by hand via `data-composition-src`; see `mcp_server/README.md`.

### TypeScript Config

Three tsconfig files: `tsconfig.json` (root references), `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer). Type-check the renderer with `npm run typecheck`. Path alias `@/*` maps to `src/renderer/src/*`.

## Key Conventions

- **snake_case ↔ camelCase bridge**: The Python backend uses snake_case everywhere. The React frontend uses camelCase. The bridge happens in one place: `src/renderer/src/lib/render.ts` (`buildRenderBody()`). When adding a new setting, update all three: `StudioSettings` interface → `render.ts` config object → `VideoRenderConfig` Pydantic model.
- **StudioSettings**: Single flat interface in `StudioPanel.tsx` holding all subtitle style settings. `STUDIO_DEFAULTS` defines initial values. Passed down as props, never fragmented.
- **Settings undo**: `useSettingsUndo` hook in App.tsx wraps `setSettings` — every UI change is pushed to a ref-based undo stack (50-entry cap, 500ms debounce). Cmd+Z/Cmd+Shift+Z when focus is outside text editors.
- **Segments vs Groups**: `Segment[]` is the source transcription data. Groups are derived display chunks (N words per group) used for preview and render. Groups can be manually edited (merge/split/reorder), tracked by `groupsEdited` flag. A group can also carry a `positionOverride` (`position_x`/`position_y` fractions — set via right-click on a group row in the Groups editor). Position-only changes are **not** boundary edits: they flow through GroupEditor's `onPositionChange` (not `onChange`) and must NEVER flip `groupsEdited`, so automatic re-grouping keeps working; `render.ts` still sends `custom_groups` to the backend whenever any group has an override. Overrides persist with the project (they ride the group objects in `studioGroups`) but are intentionally not part of presets.
- **Backend port**: Preferred port 53421. `python-manager.js` finds a free port and the renderer gets it via IPC `backend:port`.
- **Custom fonts**: Stored in app data via Electron IPC. The font path is passed to both Canvas (via `@font-face` injection) and the backend (`custom_font_path` field). Bold is achieved by selecting a bold font variant — there is no synthetic bold.
- **Shareable presets (`.cfpreset`)**: A saved preset can be exported to / imported from a single `.cfpreset` file (JSON wrapper: `{ type: 'capforge-preset', version, name, settings, font }`) via IPC `presets:export` / `presets:import` and preload `window.subforge.exportPreset(name)` / `importPreset()`. `electron/preset-io.js` is the source of truth for the format and its pure helpers (`classifyFont`, `buildPresetExport`, `parsePresetImport`, `uniquePresetName`). Font portability: user fonts are embedded as base64 (10MB cap), bundled CapForge fonts are referenced by name only; on import the font is re-materialized/re-resolved to a *local* path and the stored preset's `customFontPath` is rewritten so Canvas and the backend both resolve it. Import is a trust boundary — `parsePresetImport` validates the type tag, gates the version, strips proto-pollution keys, enforces the size cap, and writes fonts basename-only with an extension allowlist. Scope: per-word `custom_font_path` overrides live in project data, not presets, so they are intentionally not shared.
- **Canvas wheel events**: React's `onWheel` is passive and cannot call `preventDefault()`. For zoom/pan on canvas elements, use a native `addEventListener('wheel', handler, { passive: false })` inside a `useEffect` that cleans up on unmount. Always call `draw()` after mutating state refs — React re-render doesn't repaint a canvas.
- **Toasts**: `useToast` context hook provides `toast(message, type)` for success/error/info notifications. Wrap errors in toast calls rather than silently catching.
- **Local media token**: `/api/serve-audio`, `/api/video-info`, `PUT /api/result`, `POST /api/export`, `POST /api/render-video`, and `POST /api/export-hyperframes` stream/repoint arbitrary local files or trigger a render/export to a client-supplied `output_dir`, so they are all gated by a per-launch `CAPFORGE_LOCAL_TOKEN`. Electron mints it (`crypto.randomBytes(32)`) per spawn, injects it as an env var, and exposes it to the renderer via IPC `backend:local-token` → `window.subforge.getLocalToken()` (wired in **both** preloads — see [Dual preload gotcha]). The renderer calls `api.setLocalToken()` alongside every `setPort`; it sends the token as `?token=` on `<audio>`/WaveSurfer URLs (which can't set headers) and as the `X-CapForge-Local-Token` header on `fetch` (e.g. the `PUT /api/result`, and every POST via `api.ts`'s `post()`). Backend (`require_local_token` in `main.py`) compares constant-time (`hmac.compare_digest` via `token_matches`) and also accepts `X-CapForge-Agent-Token` — the header the MCP client (`mcp_server/client.py`) authenticates every call with — so an authorised agent isn't locked out of the gated export/render routes. A second guard, `_is_servable_path`, realpath-resolves the target and only serves `current_result.audio_path` or a file *contained in* its `hyperframes_workspace()` — defeating `../`, symlink, and sibling-prefix traversal even for a token holder. The export/render routes additionally sandbox their client-supplied `output_dir` through `resolve_output_dir()` (`hyperframes_project.py`) — a non-absolute value (e.g. a `..` traversal string, or the schema default `"output"`) falls back to the folder next to the source media instead of being honoured literally. uvicorn runs with `--no-access-log` so the query-param token never lands in `backend.log`. Never hardcode, persist, or log this token.

## Theming

The app supports dark (default) and light themes via `:root.light` CSS class. All colors use CSS custom properties defined in `globals.css` (`--color-text`, `--color-bg`, `--color-surface`, etc.). When adding UI:
- Never hardcode colors like `text-white` or `bg-black` — use `var(--color-text)`, `var(--color-bg)`, etc.
- Tailwind v4 can misparse `text-[var(--color-text)]` (ambiguous color vs font-size) — use inline `style={{ color: 'var(--color-text)' }}` when Tailwind gets confused
- Design system font variables: `--cf-font-ui` (Inter), `--cf-font-display` (Instrument Serif), `--cf-font-mono` (JetBrains Mono)
- Brand orange: `#D4952A`
