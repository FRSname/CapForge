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

# Package
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

The Canvas preview (`useSubtitleOverlay.ts`) and the Python renderer (`video_render.py`) must produce visually identical output. Key equivalences:
- Canvas `measureText().width` ↔ PIL `font.getlength()` (NOT `textbbox` — that strips side bearings)
- Canvas font string `"bold 64px Arial"` ↔ PIL `ImageFont.truetype(path, size)` + bold threshold at weight >= 700
- Both use the same formulas for row gap, background box sizing, word positioning, and animation curves

### TypeScript Config

Three tsconfig files: `tsconfig.json` (root references), `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer). Type-check the renderer with `npm run typecheck`.

## Key Conventions

- **snake_case ↔ camelCase bridge**: The Python backend uses snake_case everywhere. The React frontend uses camelCase. The bridge happens in one place: `src/renderer/src/lib/render.ts` (`buildRenderBody()`).
- **StudioSettings**: Single flat interface in `StudioPanel.tsx` holding all subtitle style settings. Passed down as props, never fragmented.
- **Segments vs Groups**: `Segment[]` is the source transcription data. Groups are derived display chunks (N words per group) used for preview and render. Groups can be manually edited (merge/split/reorder), tracked by `groupsEdited` flag.
- **Backend port**: Preferred port 53421. `python-manager.js` finds a free port and the renderer gets it via IPC `backend:port`.
- **Custom fonts**: Stored in app data via Electron IPC. The font path is passed to both Canvas (via `@font-face` injection) and the backend (`custom_font_path` field).
