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

- **REST**: `/api/transcribe`, `/api/render-video`, `/api/export`, `/api/result` (GET/PUT), `/api/serve-audio`, `/api/video-info`
- **WebSocket**: `/ws/progress` pushes `ProgressUpdate` events (status + percentage + message)
- **IPC**: Renderer ↔ main process via `ipcRenderer.invoke()` / `ipcMain.handle()` for file system ops

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
- All three use the same formulas for row gap, background box sizing, word positioning, animation curves, and every `word_transition` mode (highlight/instant/crossfade/karaoke/underline/bounce/scale/reveal).
- Shared magic numbers live in `lib/renderConstants.ts` — the backend receives them via the render config (e.g. `crossfade_duration`), so they stay synced automatically.
- **Golden-frame tests**: `backend/tests/test_render_golden.py` pins `_render_frame()` pixel output against PNGs in `backend/tests/golden/` (tolerance-based diff). Regenerate after an intentional formula change with `.venv-dev/bin/python -m backend.tests.gen_golden`, then review the PNGs visually before committing — they define what "correct" looks like.
- **Caption parity tests**: `backend/tests/test_caption_parity.py` diffs the Pillow render against the live HyperFrames snapshot for every word mode + stroke/shadow/multi-line. Opt-in (needs Node 22 + ffmpeg): `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py`.

### TypeScript Config

Three tsconfig files: `tsconfig.json` (root references), `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer). Type-check the renderer with `npm run typecheck`. Path alias `@/*` maps to `src/renderer/src/*`.

## Key Conventions

- **snake_case ↔ camelCase bridge**: The Python backend uses snake_case everywhere. The React frontend uses camelCase. The bridge happens in one place: `src/renderer/src/lib/render.ts` (`buildRenderBody()`). When adding a new setting, update all three: `StudioSettings` interface → `render.ts` config object → `VideoRenderConfig` Pydantic model.
- **StudioSettings**: Single flat interface in `StudioPanel.tsx` holding all subtitle style settings. `STUDIO_DEFAULTS` defines initial values. Passed down as props, never fragmented.
- **Settings undo**: `useSettingsUndo` hook in App.tsx wraps `setSettings` — every UI change is pushed to a ref-based undo stack (50-entry cap, 500ms debounce). Cmd+Z/Cmd+Shift+Z when focus is outside text editors.
- **Segments vs Groups**: `Segment[]` is the source transcription data. Groups are derived display chunks (N words per group) used for preview and render. Groups can be manually edited (merge/split/reorder), tracked by `groupsEdited` flag.
- **Backend port**: Preferred port 53421. `python-manager.js` finds a free port and the renderer gets it via IPC `backend:port`.
- **Custom fonts**: Stored in app data via Electron IPC. The font path is passed to both Canvas (via `@font-face` injection) and the backend (`custom_font_path` field). Bold is achieved by selecting a bold font variant — there is no synthetic bold.
- **Shareable presets (`.cfpreset`)**: A saved preset can be exported to / imported from a single `.cfpreset` file (JSON wrapper: `{ type: 'capforge-preset', version, name, settings, font }`) via IPC `presets:export` / `presets:import` and preload `window.subforge.exportPreset(name)` / `importPreset()`. `electron/preset-io.js` is the source of truth for the format and its pure helpers (`classifyFont`, `buildPresetExport`, `parsePresetImport`, `uniquePresetName`). Font portability: user fonts are embedded as base64 (10MB cap), bundled CapForge fonts are referenced by name only; on import the font is re-materialized/re-resolved to a *local* path and the stored preset's `customFontPath` is rewritten so Canvas and the backend both resolve it. Import is a trust boundary — `parsePresetImport` validates the type tag, gates the version, strips proto-pollution keys, enforces the size cap, and writes fonts basename-only with an extension allowlist. Scope: per-word `custom_font_path` overrides live in project data, not presets, so they are intentionally not shared.
- **Canvas wheel events**: React's `onWheel` is passive and cannot call `preventDefault()`. For zoom/pan on canvas elements, use a native `addEventListener('wheel', handler, { passive: false })` inside a `useEffect` that cleans up on unmount. Always call `draw()` after mutating state refs — React re-render doesn't repaint a canvas.
- **Toasts**: `useToast` context hook provides `toast(message, type)` for success/error/info notifications. Wrap errors in toast calls rather than silently catching.

## Theming

The app supports dark (default) and light themes via `:root.light` CSS class. All colors use CSS custom properties defined in `globals.css` (`--color-text`, `--color-bg`, `--color-surface`, etc.). When adding UI:
- Never hardcode colors like `text-white` or `bg-black` — use `var(--color-text)`, `var(--color-bg)`, etc.
- Tailwind v4 can misparse `text-[var(--color-text)]` (ambiguous color vs font-size) — use inline `style={{ color: 'var(--color-text)' }}` when Tailwind gets confused
- Design system font variables: `--cf-font-ui` (Inter), `--cf-font-display` (Instrument Serif), `--cf-font-mono` (JetBrains Mono)
- Brand orange: `#D4952A`
