# CapForge — Project Documentation

> Auto subtitle generator with word-by-word alignment, inline editing, video preview, and styled video rendering.
> Built as a standalone desktop app: **Electron + React + TypeScript** frontend + **Python FastAPI** backend + **WhisperX** engine.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Tech Stack](#tech-stack)
4. [How It Works — End to End](#how-it-works--end-to-end)
5. [Backend Deep Dive](#backend-deep-dive)
6. [Renderer Deep Dive (React)](#renderer-deep-dive-react)
7. [Electron Shell](#electron-shell)
8. [Theming](#theming)
9. [Render Pipeline](#render-pipeline)
10. [Project Files (.capforge)](#project-files-capforge)
11. [API Reference](#api-reference)
12. [Export Formats](#export-formats)
13. [Running the Project](#running-the-project)
14. [Packaging & Distribution](#packaging--distribution)
15. [Lessons Learned](#lessons-learned)
16. [Currently Shipping Versions](#currently-shipping-versions)
17. [Future Milestones](#future-milestones)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   Electron Shell                        │
│  electron/main.js — window, IPC, menus                 │
│  electron/preload.js — contextBridge → window.subforge │
│  electron/python-manager.js — spawn & lifecycle        │
│  electron/runtime-setup.js — first-launch installer    │
│  electron/update-check.js — GitHub release polling     │
├────────────────────────────────────────────────────────┤
│              Renderer (Chromium / React 19)             │
│  src/renderer/src/App.tsx — top-level shell + routing   │
│  components/screens/* — DropZone / Progress / Results   │
│  components/player/AudioPlayer — video + waveform + tl  │
│  components/editor/* — SubtitleEditor + GroupEditor     │
│  components/studio/* — StudioPanel + cards              │
│  hooks/* — useWaveSurfer, useTimeline, useRender, …     │
│  lib/api.ts — typed REST + WebSocket client             │
│  styles/globals.css — Tailwind v4 + theme tokens        │
├──────────────┬─────────────────────────────────────────┤
│   REST/WS    │  http://127.0.0.1:53421                 │
├──────────────┴─────────────────────────────────────────┤
│              Python Backend (FastAPI)                   │
│  backend/main.py — REST endpoints, WS broadcast        │
│  backend/engine/transcriber.py — WhisperX pipeline     │
│  backend/engine/hardware.py — GPU auto-detection       │
│  backend/exporters/* — SRT, VTT, JSON, CapForge, video │
│  backend/models/schemas.py — Pydantic models           │
├────────────────────────────────────────────────────────┤
│              WhisperX + CUDA                            │
│  whisperx → faster-whisper → ctranslate2 (cuDNN v9)    │
│  pyannote-audio (diarization) → speechbrain            │
│  PyTorch 2.6.0+cu124 → CUDA 12.4                       │
└────────────────────────────────────────────────────────┘
```

**Communication pattern**

- Electron spawns the Python backend as a child process on startup.
- Renderer talks to backend via **REST** (transcribe, edit, export, render) and **WebSocket** (live progress).
- Backend serves audio/video back to the renderer via `GET /api/serve-audio` (FastAPI auto-detects MIME).
- WaveSurfer.js renders waveforms and drives playback. For video files, an HTML5 `<video>` element is passed as WaveSurfer's `media` source; the canvas timeline + caption overlay are kept in sync via the WaveSurfer `timeupdate` event.

---

## Project Structure

```
CapForge/
├── backend/
│   ├── main.py                  # FastAPI app — all endpoints + WS
│   ├── requirements.txt
│   ├── engine/
│   │   ├── hardware.py          # GPU detection + model recommendations
│   │   └── transcriber.py       # WhisperX pipeline (transcribe → align → diarize)
│   ├── exporters/
│   │   ├── json_export.py
│   │   ├── srt_word.py
│   │   ├── srt_standard.py
│   │   ├── vtt_export.py
│   │   ├── premiere_export.py   # .capforge / Premiere MOGRT helpers
│   │   └── video_render.py      # FFmpeg pipe + Pillow caption rasterizer
│   └── models/schemas.py        # All Pydantic models + enums
├── electron/
│   ├── main.js                  # Electron main process (window, IPC)
│   ├── preload.js               # contextBridge → window.subforge (incl. webUtils)
│   ├── python-manager.js        # Spawns/manages Python uvicorn process
│   ├── runtime-setup.js         # First-launch wizard (Python + torch + model)
│   └── update-check.js          # GitHub release polling
├── src/renderer/src/            # React + TypeScript renderer
│   ├── App.tsx                  # Top-level shell, project I/O, screen routing
│   ├── main.tsx                 # createRoot
│   ├── components/
│   │   ├── SettingsPanel.tsx
│   │   ├── TitleBar/TitleBar.tsx
│   │   ├── screens/
│   │   │   ├── DropZoneScreen.tsx
│   │   │   ├── ProgressScreen.tsx
│   │   │   └── ResultsScreen.tsx
│   │   ├── player/
│   │   │   └── AudioPlayer.tsx       # video + waveform + canvas timeline
│   │   ├── editor/
│   │   │   ├── SubtitleEditor.tsx    # Text view (per-sentence)
│   │   │   ├── GroupEditor.tsx       # Groups view (drag/merge/split words)
│   │   │   └── WordStylePopup.tsx    # per-word style overrides
│   │   ├── studio/
│   │   │   ├── StudioPanel.tsx       # right sidebar — owns useRender + outputDir
│   │   │   ├── StudioCard.tsx
│   │   │   ├── StudioRow.tsx
│   │   │   ├── ExportPanel.tsx       # quick render + SRT/VTT + output picker
│   │   │   ├── CustomRenderPanel.tsx # full render controls
│   │   │   └── PresetPicker.tsx
│   │   └── ui/
│   │       ├── ColorSwatch.tsx
│   │       ├── FontPicker.tsx
│   │       └── Toggle.tsx
│   ├── hooks/
│   │   ├── useTranscription.ts       # POST /api/transcribe + WS progress
│   │   ├── useRender.ts              # POST /api/render-video + WS progress
│   │   ├── useWaveSurfer.ts
│   │   ├── useTimeline.ts            # canvas timeline draw + interactions
│   │   ├── useSubtitleOverlay.ts     # caption canvas overlay
│   │   ├── useVideoZoom.ts           # ctrl+wheel video zoom
│   │   └── useUndoRedo.ts
│   ├── lib/
│   │   ├── api.ts                    # Typed REST + WS client
│   │   ├── render.ts                 # buildRenderBody + RenderOverrides
│   │   ├── project.ts                # .capforge file shape + helpers
│   │   ├── presets.ts                # style preset persistence
│   │   ├── fonts.ts                  # font import/load
│   │   └── groups.ts                 # buildStudioGroups (chunking)
│   ├── styles/globals.css            # Tailwind v4 + design tokens
│   └── types/
│       ├── app.ts                    # Segment, WordSegment, TranscriptionResult
│       └── global.d.ts               # window.subforge typings
├── resources/
│   ├── bin-win/                      # bundled ffmpeg / ffprobe (Windows)
│   ├── bin-mac/                      # bundled ffmpeg / ffprobe (macOS)
│   └── python/                       # embedded Python archives
├── electron.vite.config.ts
├── tsconfig.web.json
├── package.json
├── DEVELOPMENT_PLAN.md
└── DOCS.md                           # ← This file
```

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Desktop Shell | Electron | 33.x | Window, native dialogs, IPC |
| Renderer Framework | React | 19.x | UI |
| Renderer Language | TypeScript | 6.x | Type safety |
| Styling | Tailwind CSS | 4.x | Utility classes + design tokens |
| Build | electron-vite + Vite | 5.x / 7.x | Renderer dev/build with HMR |
| Audio/Waveform | WaveSurfer.js | 7.12 | Waveform, playback, seek |
| Video | HTML5 `<video>` | Native | Video preview (WaveSurfer media) |
| Backend | FastAPI | 0.115+ | REST API + WebSocket |
| Runtime | Python | 3.11 (embedded) | Required by WhisperX/PyTorch |
| ASR Engine | WhisperX | 3.8.5+ | Transcription + word alignment |
| ASR Core | faster-whisper | 1.2.x | CTranslate2-based Whisper inference |
| CTranslate2 | ctranslate2 | 4.7.x | Optimized inference runtime (cuDNN v9) |
| Diarization | pyannote-audio | 4.0.x | Speaker identification |
| Audio ML | speechbrain | 1.0.2 | Audio feature extraction for pyannote |
| ML Framework | PyTorch | 2.6.0+cu124 | GPU tensor ops |
| Audio Backend | torchaudio | 2.6.0+cu124 | Audio loading/decoding |
| Video Render | Pillow + FFmpeg | 11.x / 8.1 | Caption rasterization + encode pipe |
| Process Mgmt | tree-kill | 1.2.2 | Clean child process termination |

---

## How It Works — End to End

### 1. App startup

```
Electron starts → runtime-setup.js checks %APPDATA%\CapForge\runtime\.state.json:
  - If runtime is not ready, the first-launch wizard window runs.
  - Otherwise python-manager.js spawns:
      <managed-python>\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port <PORT>
  - <PORT> defaults to 53421 (IANA dynamic range, low collision risk).
    If busy, an OS-assigned ephemeral port is used instead — see
    findFreePort() in python-manager.js.
  - cwd = process.resourcesPath/app.asar.unpacked (real backend folder)
  - PATH prepended with resources/bin so whisperx finds bundled ffmpeg

main.js polls GET /api/status until 200 (max 30 s), then createWindow() loads
the renderer (React app) at file:// in production or the Vite dev server in dev.

Renderer reads window.subforge.getBackendPort() for the port and the api.ts
module connects WebSocket → ws://127.0.0.1:<PORT>/ws/progress on demand.
```

### 2. File selection (DropZoneScreen)

- User drops a file or clicks to browse (native Electron file dialog via IPC).
- For drag-and-drop, the preload bridges Electron's `webUtils.getPathForFile(file)` (since `File.path` was removed in Electron 32+).
- The path is validated against the allowed extension list, and `App.tsx` advances to the Progress screen.

### 3. Transcription (ProgressScreen)

```
useTranscription() POSTs to /api/transcribe with:
  { audio_path, language, enable_diarization, hf_token, output_dir, export_formats }

Backend runs in a thread pool (loop.run_in_executor):
  Step 1: Load WhisperX model (cached after first load)
  Step 2: model.transcribe()
  Step 3: load_align_model() + align() → word timestamps
  Step 4: (optional) DiarizationPipeline → speaker labels
  Step 5: Export to requested formats

Each step broadcasts a ProgressUpdate via WebSocket → progress bar updates.

POST returns: { status: "ok", segments: N, exported_files: [...] }
useTranscription then GETs /api/result for the full TranscriptionResult.
```

### 4. Results & preview (ResultsScreen)

- **Video files** (mp4, mkv, webm, mov, avi, m4v): `<video>` element + WaveSurfer (with the video as `media`) + canvas timeline + caption overlay — all in lock-step.
- **Audio files**: WaveSurfer loads the audio via `url`; the caption preview area shows the configured aspect ratio against a neutral backdrop.
- The ResultsScreen has two editor views:
  - **Text view** — per-sentence segments with inline editing (`SubtitleEditor`).
  - **Groups view** — display groups with drag/merge/split/reorder and per-word style overrides (`GroupEditor`).
- The **StudioPanel** sidebar exposes Typography, Colors, Layout, Fine-tune, Animation, and Export / Custom Render cards.

### 5. Editing

- **Text view**: each segment is `contentEditable`. `useUndoRedo` tracks per-keystroke state via `pushUndo` (Ctrl+Z / Ctrl+Shift+Z).
- **Groups view**: words can be dragged between groups, groups can be merged/split, edges can be dragged on the canvas timeline. Manual edits flip a `groupsEdited` flag — when set, the render payload uses `custom_groups` instead of re-chunking from the source segments.
- **Per-word styles**: clicking a word opens `WordStylePopup` for color/weight/font/active-color overrides; the rendering pipeline picks them up.

### 6. Render or export

- `useRender` is the shared render controller, owned by `StudioPanel` and passed down to both `ExportPanel` and `CustomRenderPanel`. It opens the WS connection, applies a 200 ms grace period to ignore stale `current_status` replays, and treats the HTTP response as the authoritative completion signal.
- `ExportPanel` provides:
  - **Quick Render** — one-click MP4 baked or MOV transparent overlay at source resolution + fps + 40 Mbps
  - **SRT / VTT** export buttons
  - **Output folder picker** ("Same as source" derives `dirname(audioPath)` on the frontend)
- `CustomRenderPanel` provides full controls — resolution preset, fps preset, format, mode, bitrate.

### 7. Save / open project

- **Ctrl+S** → `App.tsx` calls `projectIORef.current.gather()` to serialize transcription + studio settings + groups (if edited) → writes `.capforge` JSON via `window.subforge.saveProject(...)`.
- **Ctrl+O** → `App.tsx` reads the file → `projectIORef.current.restore(file)` rehydrates state and jumps to the Results screen.
- See [Project Files (.capforge)](#project-files-capforge).

---

## Backend Deep Dive

### main.py — The API Server

**State management** — module-level globals:

```python
transcriber = Transcriber()                       # caches loaded model
current_result: Optional[TranscriptionResult]     # latest finished result
current_status = ProgressUpdate(...)              # last progress emit
ws_clients: list[WebSocket] = []                  # connected WS clients
```

**Progress broadcasting** — the Transcriber/renderer run in a thread pool via `run_in_executor`. They call a sync callback that bridges to the asyncio loop:

```python
def sync_progress_callback(update):
    loop = asyncio.get_running_loop()
    loop.create_task(broadcast_progress(update))
```

When a new client connects to `/ws/progress`, the handler immediately sends `current_status` so late connections don't miss the current state. The frontend's `useRender` deals with the resulting "stale done" race by ignoring WS messages within the first 200 ms of a render.

**File serving** — `GET /api/serve-audio?path=...` returns a `FileResponse`. **Never** set `media_type` manually — FastAPI's auto-detection from the extension works for every supported format. Hardcoding `audio/mpeg` once broke wav/mp4 in an early milestone.

### transcriber.py — WhisperX pipeline

Pipeline steps with cancellation checkpoints:

1. **Load model** — `whisperx.load_model()`, cached across calls
2. **Transcribe** — `model.transcribe(audio, batch_size=N, language=...)`
3. **Align** — `whisperx.load_align_model()` + `whisperx.align()` → word-level timestamps
4. **Diarize** (optional) — `DiarizationPipeline` from `whisperx.diarize`
5. **Build result** — convert raw dict to `TranscriptionResult`

Batch size based on VRAM: `≥10 GB → 32`, `≥6 GB → 16`, `<6 GB → 8`.
Memory: alignment model is `del`'d + `gc.collect()` + `torch.cuda.empty_cache()` after use.

### hardware.py — GPU auto-detection

Reads CUDA + GPU name + VRAM, recommends model size + compute type. Uses `getattr(props, "total_memory", None) or getattr(props, "total_mem", 0)` to handle PyTorch attribute renames across versions.

### exporters/video_render.py — Render pipeline

```
ffmpeg decode → rawvideo (rgb24) →┐
                                  ├─ Pillow caption rasterizer (per frame) → encoded video
ffmpeg encode (libx264 / libvpx-vp9 / prores_ks) ← rgb24 pipe
```

Two modes:

- **Baked**: scale to target resolution, decode as rgb24, draw captions over frames, encode (libx264 + AAC into MP4).
- **Overlay**: render an alpha-channel video containing only captions (VP9 in WebM, or ProRes 4444 in MOV) — composite later in NLE.

Cancellation is checked between frames via `_check_cancel()`. The HTTP `POST /api/render-video` blocks until the render finishes (success or cancel), so the frontend treats the response as the source of truth for "done".

### schemas.py — Data models

Key models:

- **TranscribeRequest** — `audio_path`, `language`, `enable_diarization`, `hf_token`, `output_dir`, `export_formats`, `model_size`, `compute_type`, `batch_size`
- **TranscriptionResult** — `segments: list[Segment]`, `language`, `audio_path`, `duration`
- **Segment** — `id`, `start`, `end`, `text`, `words: list[WordSegment]`, `speaker`
- **WordSegment** — `word`, `start`, `end`, `score`, `speaker`, optional style overrides
- **ProgressUpdate** — `step: JobStatus`, `pct: float`, `message`
- **JobStatus** — `idle`, `loading_model`, `transcribing`, `aligning`, `diarizing`, `exporting`, `rendering`, `done`, `error`
- **RenderRequest** — payload accepted by `/api/render-video` (resolution, fps, format, mode, bitrate, segments / custom_groups, style settings)
- **ExportFormat** — `srt_word`, `srt_standard`, `json`, `vtt`, `subforge`

---

## Renderer Deep Dive (React)

### App.tsx

Owns top-level state: which screen is active, the latest `TranscriptionResult`, the `projectIORef` used by ResultsScreen for save/open. Wires keyboard shortcuts (Ctrl+S / Ctrl+O / Escape) and renders the TitleBar.

### Hooks

- **useTranscription** — orchestrates `POST /api/transcribe`, opens WS, calls `GET /api/result` on success.
- **useRender** — orchestrates `POST /api/render-video`. Returns `{ status, progress, message, elapsed, busy, startRender, cancelRender, reset }`. **HTTP response drives completion**, not the WS, to avoid the cached `current_status` "done" replay.
- **useWaveSurfer** — wraps WaveSurfer.js v7. For video files, accepts a `videoEl` and uses it as the `media` source.
- **useTimeline** — canvas timeline (ruler + segment blocks + playhead). Reads CSS variables (`--color-bg`, `--color-surface`, `--color-amber`, `--color-accent`, …) so it tracks the active theme; a MutationObserver on `<html>`'s class triggers a redraw on theme toggle.
- **useSubtitleOverlay** — draws the caption preview on a canvas overlay above the video, using the same StudioSettings the render pipeline uses (preview-accurate styling).
- **useVideoZoom** — ctrl+wheel zoom + drag-pan in the video preview area, independent of timeline zoom.
- **useUndoRedo** — generic undo stack for segment edits.

### Lifted state pattern

`StudioPanel` owns the `outputDir` state and the `useRender` controller, and passes them down to `ExportPanel` and `CustomRenderPanel`. This way:

- Both panels can trigger renders, but only one shared progress UI exists in the sidebar.
- "Same as source" output is derived once via `dirname(audioPath)` and used uniformly for quick exports, custom renders, and SRT/VTT.

### lib/api.ts

Typed wrapper around `fetch` + WebSocket. Exposes `api.transcribe`, `api.exportResult`, `api.renderVideo`, `api.getResult`, `api.getVideoInfo`, `api.audioUrl(path)`, `api.connectProgress(callback)`, etc. Reconnects WS on close (2 s back-off).

### lib/render.ts

`buildRenderBody(settings, groups, groupsEdited, overrides, outputDir)` produces the `/api/render-video` payload. Overrides allow `useRender` to be called with partial settings (e.g., quick-render only sets `renderMode`/`format`/`resolution`/`fps`/`bitrate`). Also exports `dirname(filePath)` used for the "Same as source" derivation.

### lib/project.ts

```ts
interface ProjectFile {
  version:             number
  selectedFilePath:    string
  outputDir:           string
  transcriptionResult: TranscriptionResult
  studioSettings:      StudioSettings
  customGroupsEdited:  boolean
  studioGroups:        Segment[] | null
}
```

`PROJECT_VERSION` is bumped any time the file shape changes; load handles forward-compat by spreading defaults.

### Content Security Policy

```
default-src 'self';
connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* blob:;
media-src   'self' http://127.0.0.1:* blob:;
style-src   'self' 'unsafe-inline';
script-src  'self';
```

`blob:` in `connect-src` is required because WaveSurfer fetches blob URLs internally.

---

## Electron Shell

### main.js

- Creates `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`.
- Spawns Python backend via `PythonBackend` class (after the runtime-setup wizard if needed).
- IPC handlers: `dialog:openFile`, `dialog:openDir`, `backend:port`, `project:save`, `project:open`, `font:import`, …
- Menu accelerators forwarded to the renderer for Ctrl+S / Ctrl+O / Escape.

### preload.js

Exposes `window.subforge` via `contextBridge`:

- `getPathForFile(file)` → `webUtils.getPathForFile` — drag-drop file path resolution (Electron 32+ removed `File.path`)
- `pickAudioFile()`, `pickOutputDir()` → native dialogs
- `getBackendPort()` → returns the resolved port (53421 by default; ephemeral if busy)
- `saveProject(payload)`, `openProject()` → `.capforge` I/O
- `importFont(path)` → copies into `%APPDATA%\CapForge\fonts\` and returns absolute path

### python-manager.js

- `findPython()` order: managed runtime (`%APPDATA%\CapForge\runtime\python\python.exe`) → `.venv/Scripts/python.exe` (dev) → system `python`.
- Resolves a free port (preferring **53421**, in IANA dynamic range) via `findFreePort()`. Falls back to an OS-assigned ephemeral port if busy — prevents the 30s "Backend did not start" hang when another CapForge instance or dev server is already bound.
- Spawns `python -m uvicorn backend.main:app --host 127.0.0.1 --port <resolved>` with `cwd` pointing at the real on-disk `backend/` folder (`process.resourcesPath/app.asar.unpacked` in packaged builds).
- Env: `CAPFORGE_FFMPEG`, `CAPFORGE_FFPROBE`, `CAPFORGE_MODEL_DIR`, `HF_HOME`, `HUGGINGFACE_HUB_CACHE`, `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1`.
- Uses `tree-kill` for clean termination on app quit.
- Pipes stdout/stderr into `%APPDATA%\CapForge\logs\backend.log` (rotated at 5 MB).

### runtime-setup.js

First-launch wizard. See [Packaging & Distribution](#packaging--distribution).

### update-check.js

Polls `https://api.github.com/repos/FRScz/capforge/releases/latest` 5 s after launch. If newer, opens a non-blocking dialog; Download opens the asset URL externally (no auto-install).

---

## Theming

`src/renderer/src/styles/globals.css` defines design tokens with Tailwind v4's `@theme {}`:

- Surfaces: `--color-bg`, `--color-base`, `--color-surface`, `--color-surface-2`, `--color-surface-3`
- Borders: `--color-border`, `--color-border-2`, `--color-border-3`
- Text: `--color-text`, `--color-text-2`, `--color-text-3`
- Accent: `--color-accent`, `--color-accent-2`, `--color-accent-glow`, `--color-accent-subtle`
- Amber (timeline): `--color-amber`, `--color-amber-2`, `--color-amber-subtle`
- Status: `--color-success`, `--color-warning`, `--color-danger`

Light theme is a `:root.light { … }` override of the same variables. Toggling adds/removes `class="light"` on `<html>`.

Canvases (timeline + caption overlay) read these tokens via `getComputedStyle(document.documentElement).getPropertyValue(name)` each draw, and a MutationObserver redraws on class change so colors switch live.

---

## Render Pipeline

The shared `useRender` controller is the single render entry point. Both `ExportPanel` (quick render) and `CustomRenderPanel` (full controls) call `startRender(overrides, outputDir)` on the same controller, so:

- One progress bar in the sidebar — independent of which button triggered the render.
- A 200 ms grace period after `startRender` ignores stale WS `current_status` replays (the backend always sends `current_status` to new clients on connect; that can include a previous `done` from the last transcription).
- `await api.renderVideo(body)` is the source of truth for completion. If WS misses an update or sends a stale one, the HTTP response still resolves cleanly when the render actually finishes (or rejects on error).

Output dir behavior: empty `outputDir` is treated as "Same as source" — the renderer derives `dirname(audioPath)` on the frontend and explicitly passes it. The backend rejects empty `output_dir` for safety, so SRT/VTT export uses a similar `buildExportParams` helper that omits the field only when it's set.

---

## Project Files (`.capforge`)

JSON file produced by Ctrl+S:

```jsonc
{
  "version": 3,
  "selectedFilePath":    "C:\\path\\to\\source.mp4",
  "outputDir":           "C:\\path\\to\\output",
  "transcriptionResult": { /* full TranscriptionResult */ },
  "studioSettings":      { /* full StudioSettings */ },
  "customGroupsEdited":  true,
  "studioGroups":        [ /* Segment[] — only if customGroupsEdited */ ]
}
```

`App.tsx` reconstructs everything on open: screen jumps to Results, `transcriptionResult` is restored, and `ResultsScreen.projectIORef.restore()` rehydrates studio settings and groups.

---

## API Reference

### REST endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/system-info` | Hardware detection + model recommendations |
| `GET`  | `/api/languages` | All 99 supported Whisper languages |
| `GET`  | `/api/models` | Available + recommended model sizes |
| `GET`  | `/api/status` | Current job status |
| `GET`  | `/api/result` | Latest transcription result (full) |
| `PUT`  | `/api/result` | Save edited transcription result |
| `GET`  | `/api/serve-audio?path=...` | Serve audio/video file (range-supported) |
| `GET`  | `/api/video-info?path=...` | Source video metadata (width, height, fps, rotation) |
| `POST` | `/api/transcribe` | Start transcription job |
| `POST` | `/api/render-video` | Render styled subtitle video (baked or overlay) |
| `POST` | `/api/export` | Export result to file(s) |
| `POST` | `/api/cancel` | Cancel running transcription |

### WebSocket

| Path | Description |
|------|-------------|
| `ws://127.0.0.1:<port>/ws/progress` | Live progress for transcription **and** rendering. `<port>` resolved via `getBackendPort()` (default 53421). |

**ProgressUpdate payload:**

```json
{
  "step": "rendering",
  "pct": 45.0,
  "message": "Rendered frame 540/1200",
  "detail": null
}
```

`step` values: `idle`, `loading_model`, `transcribing`, `aligning`, `diarizing`, `exporting`, `rendering`, `done`, `error`.

> **WS replay caveat:** when a client connects, the server immediately sends `current_status` so late connections can sync. If the previous job ended with `done`, a fresh client receives `done` instantly. Any new render flow should ignore WS messages within the first 200 ms (see `useRender`).

---

## Export Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| `srt_word` | `.srt` (or `_word.srt`) | One word per SRT entry with precise timestamps |
| `srt_standard` | `.srt` (or `_standard.srt`) | One sentence/segment per SRT entry |
| `json` | `.json` | Full `TranscriptionResult` as JSON |
| `vtt` | `.vtt` | WebVTT format |
| `subforge` | `.capforge` | Custom JSON with word-level data + auto-grouped word clusters for Premiere Pro MOGRT pipeline |

When both `srt_word` and `srt_standard` are exported, filenames get `_word.srt` / `_standard.srt` suffixes to avoid collision.

---

## Running the Project

### Prerequisites

- **Python 3.11** (or 3.10) for the dev backend
- **Node.js 18+** with npm
- **NVIDIA GPU** with CUDA 12.4-compatible driver (≥ 550), or CPU fallback

### Setup

```bash
# 1. Clone
git clone https://github.com/FRSname/CapForge.git
cd CapForge

# 2. Python venv
python -m venv .venv
.venv\Scripts\activate

# 3. Install backend deps — order matters, see "torch install order trap"
pip install whisperx fastapi[standard] uvicorn[standard] websockets pillow
pip uninstall -y torch torchaudio torchvision
pip install torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124

# 4. Install Node deps
npm install

# 5. Run
npm run dev:react       # electron-vite dev — Electron + React HMR + backend
npm run typecheck       # tsc --noEmit
npm run backend         # standalone backend (no Electron)
```

### Scripts (package.json)

```
npm run dev:react       →  electron-vite dev      (HMR for renderer)
npm run dev             →  electron . --dev       (legacy launcher)
npm run start           →  electron .             (production)
npm run build:react     →  electron-vite build    (renderer + main + preload)
npm run typecheck       →  tsc --noEmit -p tsconfig.web.json
npm run backend         →  uvicorn backend.main:app
npm run dist            →  electron-builder       (current platform)
npm run dist:win        →  NSIS installer
npm run dist:mac        →  DMG
npm run dist:dir        →  unpacked debug build
```

> **Heads up:** if `npm run dev:react` crashes immediately with `Cannot read properties of undefined (reading 'whenReady')`, your shell has `ELECTRON_RUN_AS_NODE=1` set (which forces Electron into pure-Node mode). Run `unset ELECTRON_RUN_AS_NODE` first.

---

## Packaging & Distribution

CapForge ships as a single NSIS installer (`CapForge-Setup-<version>.exe`) built with electron-builder. The installer itself is ~155 MB; on first launch a setup wizard downloads the Python package set and Whisper model to `%APPDATA%\CapForge\`.

### Build artifacts

- `appId`: `cz.frscz.capforge`, publisher `FRScz`
- `package.json` → `build.files` bundles `electron/**`, the built renderer (under `out/`), and `backend/**/*.py`
- `build.extraResources`:
  - `resources/bin-win/` → `resources/bin/` (ffmpeg 8.1 full-shared: ffmpeg.exe, ffprobe.exe, libav*.dll, swresample, swscale, ~235 MB)
  - `resources/python/python-embed.zip` → `resources/python/` (Python 3.11 embeddable, ~11 MB)
  - `Fonts/**/*.{ttf,otf,woff,woff2}` → `Fonts/`
- `build.asarUnpack`: `backend/**/*` — **critical**, see "asar trap" below
- NSIS config: per-user install, user-chosen folder, desktop + Start-menu shortcut, `deleteAppDataOnUninstall: false`

### First-run runtime bootstrap (`electron/runtime-setup.js`)

Runs once on first launch (or whenever `RUNTIME_VERSION` is bumped). All data lands under `%APPDATA%\CapForge\`:

```
%APPDATA%\CapForge\
├── runtime\
│   ├── python\               ← extracted embedded Python 3.11
│   │   ├── python.exe
│   │   ├── python311._pth    ← patched: "import site" uncommented
│   │   └── Lib\site-packages\
│   └── .state.json           ← { version, gpu, completed, torchVariant }
├── models\                    ← Whisper + alignment model cache (HF_HOME)
├── fonts\                     ← user-imported font files
├── presets.json
├── app-state.json             ← window bounds, last preset, last paths
└── logs\backend.log           ← rotated at 5 MB, one `.1` backup
```

Setup steps, in order:

1. **GPU detection** — `nvidia-smi --query-gpu=name --format=csv,noheader`
2. **Extract Python** — PowerShell `Expand-Archive` of bundled `python-embed.zip`
3. **Patch `python311._pth`** — write `python311.zip\n.\nLib\\site-packages\n\nimport site\n` so site-packages actually loads
4. **Bootstrap pip** — download `get-pip.py` from `bootstrap.pypa.io`, run with embedded Python
5. **Install WhisperX + FastAPI stack** from PyPI (pulls CPU torch transitively)
6. **GPU path only**: uninstall the CPU torch/torchaudio/torchvision that whisperx pulled in, then reinstall from the cu124 index with **pinned versions** (see "torch install order trap")
7. **Download Whisper model** — `whisperx.load_model("large-v3-turbo", "cpu", compute_type="int8", download_root=modelDir)` to force the ~1.6 GB download with HF progress forwarded to the wizard UI
8. Write `.state.json` with `completed: true`

Progress for every step is streamed to the setup window via IPC (`setup:progress`).

---

## Lessons Learned

These all cost real debugging time. Keep them here so the next version doesn't step on the same rakes.

### A. The asar trap — Python can't read files inside `app.asar`

**Symptom:** Installer runs clean, wizard completes, then on launch the backend crashes immediately with either `spawn python.exe ENOENT` or `ModuleNotFoundError: No module named 'backend'`.

**Cause:** electron-builder packs the whole app into `resources/app.asar` — a virtual filesystem only Node's asar-aware loader understands. An external Python interpreter has no idea what asar is. Two things break at once:

1. The spawn's `cwd` of `__dirname/..` resolves to a path *inside* `app.asar`. That path doesn't exist on the real filesystem, so Windows `CreateProcess` fails with ENOENT — and Node misleadingly attributes the error to the child exe.
2. Even with a valid cwd, Python can't import `backend.main` because `backend/` lives inside the asar archive.

**Fix (both sides of the problem):**
- In `package.json` → `"build"`: add `"asarUnpack": ["backend/**/*"]`. electron-builder will then also extract a real on-disk copy to `resources/app.asar.unpacked/backend/`.
- In `python-manager.js`: set `cwd` to `process.resourcesPath/app.asar.unpacked` (the real folder that now contains `backend/`).
- Do **not** use `PYTHONPATH` to point at this location — embedded Python ignores `PYTHONPATH` entirely whenever a `._pth` file exists. Instead rely on `.` being in `python311._pth`: whatever we set as cwd is on `sys.path`, so `backend.main:app` resolves cleanly.

### B. The torch install order trap

**Symptom:** GPU was detected fine during the wizard and the wizard reported installing the CUDA torch variant, but at runtime `torch.cuda.is_available()` returns `False`.

**Cause:** If torch is installed *first* from the CUDA index and whisperx is installed *afterwards* from PyPI, pip's resolver sees whisperx's `torch` requirement, finds a newer version on PyPI (CPU-only wheels), and **silently upgrades your CUDA torch back to CPU**.

**Fix:** reverse the order:
1. Install `whisperx` + FastAPI + the rest of the backend stack first. Whisperx will drag in a CPU torch — that's fine, treat it as disposable.
2. `pip uninstall -y torch torchaudio torchvision`
3. `pip install torch==X.Y.Z torchaudio==X.Y.Z torchvision==X.Y.Z --index-url https://download.pytorch.org/whl/cu124`

Pinning exact versions is mandatory.

### C. The `--extra-index-url` trap

**Symptom:** Wizard reports installing CUDA torch, but the backend log shows `torch=2.11.0+cpu`.

**Cause:** Adding `--extra-index-url https://pypi.org/simple` so transitive deps could resolve makes pip pick the **highest version available across all indexes**. The cu124 index tops out at `torch 2.6.0+cu124`; PyPI already has newer CPU wheels, which win.

**Fix:** drop `--extra-index-url`. The pytorch cu124 index mirrors all the transitive deps torch needs, and pinning forces pip to find the exact wheel on the cu124 index.

### D. The `--no-deps --force-reinstall` trap

**Symptom:** Wizard fails mid-installation with `ModuleNotFoundError: Could not import module 'Pipeline'` from transformers.

**Cause:** `--no-deps` skips torch's own dep chain, which makes the solver believe torch's deps are already satisfied. The next thing that triggers an import of `transformers.pipelines` crashes because something downstream is mismatched.

**Fix:** don't use `--no-deps`. Use a clean uninstall followed by a normal `pip install` with pinned versions.

### E. The torch/torchvision ABI mismatch trap

**Symptom:** `RuntimeError: operator torchvision::nms does not exist` when whisperx loads its alignment model.

**Cause:** Only torch + torchaudio were uninstalled/reinstalled. `torchvision` is ABI-locked to the exact torch build it was compiled against; CPU torchvision against cu124 torch = broken custom ops.

**Fix:** always treat `torch`, `torchaudio`, and `torchvision` as one atomic set — uninstall all three, reinstall all three with matching versions.

### F. The "what version actually exists" trap

**Symptom:** `ERROR: Could not find a version that satisfies the requirement torch==2.8.0 (from versions: 2.4.0+cu124, …, 2.6.0+cu124)`.

**Cause:** Each CUDA index lags PyPI by several minor versions, and the exact set changes over time.

**Fix:** let pip's own error output tell you what versions are actually on the index, then pin to the newest one it lists. At the time of writing, cu124 → `torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0`.

### G. `RUNTIME_VERSION` — the "bump this when the recipe changes" integer

`runtime-setup.js` keeps a small integer `RUNTIME_VERSION`. `isRuntimeReady()` only returns `true` if the on-disk `.state.json` matches the current version. Any time the install recipe changes — Python version, package pin, `._pth` patch, new step — bump this number. Next launch on every user's machine will wipe the runtime and reinstall cleanly.

### H. `isRuntimeReady()` self-heal

If `.state.json` claims the runtime is installed but `python.exe` is missing (antivirus quarantined it, user nuked the folder), the old code happily tried to spawn a nonexistent binary. `isRuntimeReady()` now deletes the stale `.state.json` in this case, forcing the next launch through the wizard.

### I. Windows Smart App Control blocks the unsigned uninstaller

**Symptom:** Uninstall from Add/Remove Programs silently fails, and Windows Security pops up "Part of this app has been blocked — can't confirm who published Un_N.exe".

**Cause:** NSIS writes a freshly generated uninstaller stub (`Un_N.exe`) to the install folder when you click Uninstall. Because it isn't code-signed, Smart App Control refuses to load it.

**Workarounds:**
- Right-click the installer → Properties → Unblock before running.
- Delete the install folder manually (`%LOCALAPPDATA%\Programs\CapForge\`) and remove the `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\CapForge` registry key.
- Real fix: buy a code signing certificate and configure `win.certificateFile` in `package.json`.

### J. Don't hardcode `media_type="audio/mpeg"`

Never hardcode `media_type="audio/mpeg"` on `FileResponse`. FastAPI's auto-detection from the file extension works for every format CapForge supports. Hardcoding broke WAV/MP4 in an earlier milestone.

### K. The drag-drop `File.path` removal (Electron 32+)

**Symptom:** Drag-and-drop into the app silently does nothing; clicking "Browse" works.

**Cause:** Electron 32 removed `File.path` for security. The `drop` handler was reading `e.dataTransfer.files[0].path`, which is now `undefined`.

**Fix:** Bridge `webUtils.getPathForFile(file)` through preload (`window.subforge.getPathForFile`) and call it from the drop handler. Falls back to a friendly toast if it's still missing.

### L. WS replay race in `useRender`

**Symptom:** Render UI flips to "Render complete" instantly, before any frames are encoded. Output file appears later.

**Cause:** When a new client connects to `/ws/progress`, the server immediately sends `current_status`. After a previous transcription, that status is still `done`. The freshly opened render WS connection received `done` immediately and the controller flipped to complete.

**Fix (in `useRender`):**
1. Drive completion from the HTTP response (`await api.renderVideo(body)`), not the WS.
2. Ignore WS updates within the first 200 ms after `startRender`.

### M. `ELECTRON_RUN_AS_NODE=1` in the shell

**Symptom:** `npm run dev:react` crashes immediately with `Cannot read properties of undefined (reading 'whenReady')`. Stack trace contains `node:electron/js2c/node_init`.

**Cause:** The Electron binary checks `ELECTRON_RUN_AS_NODE` and runs as plain Node if it's set — no `app` API, no GUI.

**Fix:** `unset ELECTRON_RUN_AS_NODE` before running, or remove it from your shell profile.

### N. Vite peer-dep cascade for electron-vite

`electron-vite@5` requires Vite 7. `@vitejs/plugin-react@6` requires Vite 8 internals. Pin:

```json
"vite": "^7.0.0",
"@vitejs/plugin-react": "^5.0.0",
"electron-vite": "^5.0.0"
```

`--legacy-peer-deps` works as a bypass but masks the real conflict — pin the versions instead.

---

## Currently Shipping Versions

### Python runtime (installed on first launch)

```
# Pinned — cu124 index tops out at 2.6.0
torch==2.6.0+cu124
torchaudio==2.6.0+cu124
torchvision==0.21.0+cu124

# Unpinned — latest compatible from PyPI
whisperx
fastapi[standard]
uvicorn[standard]
websockets
pydantic>=2.0
pillow
```

Install indexes:
- CPU users: `https://download.pytorch.org/whl/cpu`
- NVIDIA users: `https://download.pytorch.org/whl/cu124` (driver ≥ 550 required)

Default Whisper model downloaded during setup: `large-v3-turbo` (~1.6 GB, near-v3 quality at ~4× speed).

### Bundled native binaries (`resources/bin-win/`)

```
ffmpeg 8.1 full-shared build
├── ffmpeg.exe, ffprobe.exe
├── libavcodec-62, libavdevice-62, libavfilter-11, libavformat-62, libavutil-60
└── libswresample-6, libswscale-9
```

Codecs verified in use: `libx264`, `libvpx-vp9`, `prores_ks`, `aac`.

### Node / Electron

```json
{
  "dependencies": {
    "tree-kill": "^1.2.2",
    "wavesurfer.js": "^7.12.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.1.8",
    "electron-vite": "^5.0.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "tailwindcss": "^4.2.2",
    "typescript": "^6.0.2",
    "vite": "^7.0.0"
  }
}
```

---

## Future Milestones

- **Code signing** — buy an EV or standard code signing certificate so Smart App Control stops blocking the installer and uninstaller.
- **Cancel button for video render** — backend already supports it via `cancel_render()` / `_check_cancel()`; wire it into the shared `useRender` controller's `cancelRender` so the cancel button in the sidebar actually cancels mid-render.
- **Mid-install cancellation** — drop a `.installing` sentinel file so interrupted installs are detected and cleaned up on next launch.
- **Macro-style presets** — group studio settings into named "looks" with thumbnail previews.
- **Batch transcription** — was removed from the React migration as it didn't fit the current flow; revisit if a real use case appears.

---

*Last updated: April 17, 2026*
