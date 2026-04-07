# SubForge — Project Documentation

> Auto subtitle generator with word-by-word alignment, inline editing, and video/audio preview.  
> Built as a standalone desktop app: **Electron** frontend + **Python FastAPI** backend + **WhisperX** engine.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Tech Stack](#tech-stack)
4. [How It Works — End to End](#how-it-works--end-to-end)
5. [Backend Deep Dive](#backend-deep-dive)
6. [Frontend Deep Dive](#frontend-deep-dive)
7. [Electron Shell](#electron-shell)
8. [Key Solutions & Lessons Learned](#key-solutions--lessons-learned)
9. [Dependency Stack (Exact Versions)](#dependency-stack-exact-versions)
10. [API Reference](#api-reference)
11. [Export Formats](#export-formats)
12. [Running the Project](#running-the-project)
13. [Future Milestones](#future-milestones)

---

## Architecture Overview

```
┌───────────────────────────────────────────────────┐
│                  Electron Shell                    │
│  electron/main.js — window, IPC, file dialogs     │
│  electron/preload.js — contextBridge (secure IPC)  │
│  electron/python-manager.js — spawn & manage       │
│                    Python backend                  │
├───────────────────────────────────────────────────┤
│              Renderer (Chromium)                    │
│  renderer/index.html — 3 screens (file/progress/   │
│                        results)                    │
│  renderer/js/app.js — all UI logic, WaveSurfer,    │
│                       edit mode, subtitle sync     │
│  renderer/js/api.js — REST + WebSocket client      │
│  renderer/css/styles.css — dark theme              │
│  renderer/js/wavesurfer.min.js — WaveSurfer v7     │
├──────────────┬────────────────────────────────────┤
│   REST/WS    │  http://127.0.0.1:8000             │
├──────────────┴────────────────────────────────────┤
│              Python Backend (FastAPI)               │
│  backend/main.py — REST endpoints, WS broadcast    │
│  backend/engine/transcriber.py — WhisperX pipeline │
│  backend/engine/hardware.py — GPU auto-detection   │
│  backend/models/schemas.py — Pydantic models       │
│  backend/exporters/* — SRT, VTT, JSON, SubForge   │
├───────────────────────────────────────────────────┤
│              WhisperX + CUDA                        │
│  whisperx 3.8.5 → faster-whisper → ctranslate2    │
│  pyannote-audio (diarization) → speechbrain        │
│  PyTorch 2.8.0+cu126 → CUDA → RTX A4000 16GB      │
└───────────────────────────────────────────────────┘
```

**Communication pattern:**
- Electron spawns the Python backend as a child process on startup.
- Frontend (renderer) talks to backend via **REST** (transcribe, export, edit) and **WebSocket** (live progress).
- Backend serves audio/video files back to the frontend via `GET /api/serve-audio`.
- WaveSurfer.js renders waveforms and drives playback; for video files, an HTML5 `<video>` element is passed as WaveSurfer's `media` source.

---

## Project Structure

```
SubForge/
├── backend/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app — all endpoints + WS
│   ├── requirements.txt
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── hardware.py          # GPU detection + model recommendations
│   │   └── transcriber.py       # WhisperX pipeline (transcribe → align → diarize)
│   ├── exporters/
│   │   ├── __init__.py
│   │   ├── json_export.py       # Full JSON dump
│   │   ├── srt_word.py          # Word-level SRT (one word per entry)
│   │   ├── srt_standard.py      # Sentence-level SRT
│   │   ├── vtt_export.py        # WebVTT
│   │   └── premiere_export.py   # .subforge custom format for Premiere Pro
│   └── models/
│       ├── __init__.py
│       └── schemas.py           # All Pydantic models + enums
├── electron/
│   ├── main.js                  # Electron main process (window, IPC)
│   ├── preload.js               # Secure IPC bridge to renderer
│   └── python-manager.js        # Spawns/manages Python uvicorn process
├── renderer/
│   ├── index.html               # Full UI (3 screens + settings sidebar)
│   ├── css/
│   │   └── styles.css           # Dark theme (GitHub-inspired)
│   └── js/
│       ├── app.js               # All frontend logic (~760 lines)
│       ├── api.js               # REST + WebSocket client class
│       └── wavesurfer.min.js    # WaveSurfer.js v7.12.5 (bundled)
├── .venv/                       # Python virtual environment
├── output/                      # Default export directory
├── package.json
├── DEVELOPMENT_PLAN.md
└── DOCS.md                      # ← This file
```

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Desktop Shell | Electron | 33.x | Window management, native dialogs, IPC |
| Frontend | Vanilla JS | ES2020+ | No framework — IIFE module in app.js |
| Audio/Waveform | WaveSurfer.js | 7.12.5 | Waveform rendering, playback, seek |
| Video | HTML5 `<video>` | Native | Video preview (WaveSurfer uses it as media) |
| Backend | FastAPI | 0.115+ | REST API + WebSocket |
| Runtime | Python | 3.10 | Required by WhisperX/PyTorch |
| ASR Engine | WhisperX | 3.8.5 | Transcription + word alignment |
| ASR Core | faster-whisper | 1.2.1 | CTranslate2-based Whisper inference |
| CTranslate2 | ctranslate2 | 4.7.1 | Optimized inference runtime (cuDNN v9) |
| Diarization | pyannote-audio | 4.0.4 | Speaker identification |
| Audio ML | speechbrain | 1.0.2 | Audio feature extraction for pyannote |
| ML Framework | PyTorch | 2.8.0+cu126 | GPU tensor ops |
| Audio Backend | torchaudio | 2.8.0+cu126 | Audio loading/decoding |
| GPU | NVIDIA CUDA | Driver 581.15 | GPU acceleration |
| Process Mgmt | tree-kill | 1.2.2 | Clean child process termination |

---

## How It Works — End to End

### 1. App Startup

```
Electron starts → python-manager.js spawns:
  .venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

python-manager.js polls GET /api/status until it returns 200 (max 30s timeout).
Once ready → createWindow() → load renderer/index.html.
Renderer calls window.subforge.getBackendPort() via IPC to get port.
api.js connects WebSocket to ws://127.0.0.1:8000/ws/progress.
```

### 2. File Selection (Screen 1)

- User drops a file or clicks to browse (native Electron file dialog via IPC)
- Frontend validates extension against `ALLOWED_EXTENSIONS` list
- `selectedFilePath` is set (absolute path on disk)

### 3. Transcription (Screen 2)

```
Frontend POSTs to /api/transcribe with:
  { audio_path, language, enable_diarization, hf_token, output_dir, export_formats }

Backend runs in thread pool (loop.run_in_executor):
  Step 1: Load WhisperX model (cached after first load)
  Step 2: whisperx.load_audio() + model.transcribe()
  Step 3: whisperx.load_align_model() + whisperx.align() → word timestamps
  Step 4: (optional) DiarizationPipeline → speaker labels
  Step 5: Export to requested formats

Each step broadcasts ProgressUpdate via WebSocket → renderer shows progress bar.

POST returns: { status: "ok", segments: N, exported_files: [...] }
Frontend then calls GET /api/result to fetch the full TranscriptionResult.
```

### 4. Results & Preview (Screen 3)

- **Video files** (mp4, mkv, webm, avi, mov): `<video>` element is shown, WaveSurfer uses it as `media` — video + waveform + playback all in sync
- **Audio files**: WaveSurfer loads audio via `url` and renders waveform
- Segments rendered as clickable rows; words have individual click-to-seek
- Real-time subtitle highlighting (word-active, segment-active CSS classes)
- Live subtitle text display synced to playback position

### 5. Inline Editing

- Press **E** to enter edit mode (or click Edit button)
- Segment text becomes `contentEditable`; modified segments get a dot indicator
- **Tab** / **Shift+Tab** navigates between segments and auto-plays each
- **Ctrl+Enter** loop-plays current segment
- **Save** reads edited DOM → updates `transcriptionResult` → `PUT /api/result`
- **Discard** re-fetches original from `GET /api/result`
- **Ctrl+S** shortcut saves

### 6. Export

- User selects formats in Settings sidebar (checkboxes)
- Clicks "Export Files" → `POST /api/export` with formats + output_dir
- Backend writes files, returns list of paths
- Frontend shows exported file list

---

## Backend Deep Dive

### main.py — The API Server

**State management** — simple module-level globals:
```python
transcriber = Transcriber()          # Reusable, caches model
current_result: Optional[TranscriptionResult] = None  # Last result
current_status = ProgressUpdate(...)  # Current job status
ws_clients: list[WebSocket] = []     # Connected WS clients
```

**Progress broadcasting** — the Transcriber runs in a thread pool via `run_in_executor`. It calls a sync callback which bridges to the async event loop:
```python
def sync_progress_callback(update):
    loop = asyncio.get_running_loop()
    loop.create_task(broadcast_progress(update))
```

**File serving** — `GET /api/serve-audio?path=...` returns a `FileResponse`. FastAPI auto-detects MIME type. Works for both audio and video files.

> **Important:** We do NOT set `media_type` manually — an earlier bug hardcoded `audio/mpeg` which broke wav/mp4 playback.

### transcriber.py — WhisperX Pipeline

Pipeline steps with cancellation checkpoints:
1. **Load model** — `whisperx.load_model()`, cached (skipped if same size already loaded)
2. **Transcribe** — `model.transcribe(audio, batch_size=N, language=...)`
3. **Align** — `whisperx.load_align_model()` + `whisperx.align()` → word-level timestamps
4. **Diarize** (optional) — `DiarizationPipeline` from `whisperx.diarize` (NOT top-level `whisperx`)
5. **Build result** — Convert raw dict to `TranscriptionResult` Pydantic model

**Batch size selection** based on VRAM:
- ≥10 GB → 32
- ≥6 GB → 16
- <6 GB → 8

**Memory management** — alignment model is `del`'d + `gc.collect()` + `torch.cuda.empty_cache()` after use.

### hardware.py — GPU Auto-Detection

Detects CUDA, reads GPU name + VRAM, recommends model size + compute type:
- ≥10 GB VRAM → large-v3 + float16
- ≥6 GB → large + float16
- ≥4 GB → medium + int8
- ≥2 GB → small + int8
- CPU fallback → base + float32

**VRAM access** uses `getattr(props, "total_memory", None) or getattr(props, "total_mem", 0)` — different PyTorch versions use different attribute names.

### schemas.py — Data Models

Key models:
- **TranscribeRequest** — `audio_path`, `language`, `enable_diarization`, `hf_token`, `output_dir`, `export_formats`
- **TranscriptionResult** — `segments: list[Segment]`, `language`, `audio_path`, `duration`
- **Segment** — `start`, `end`, `text`, `words: list[WordSegment]`, `speaker`
- **WordSegment** — `word`, `start`, `end`, `score`, `speaker`
- **ProgressUpdate** — `status: JobStatus`, `progress: float`, `message`
- **ExportFormat** — enum: `srt_word`, `srt_standard`, `json`, `vtt`, `subforge`

---

## Frontend Deep Dive

### app.js — Single IIFE Module (~760 lines)

**Screen management** — Three screens: `file`, `progress`, `results`. Switching via `showScreen(name)` which toggles `.active` class.

**Video vs Audio detection:**
```javascript
const VIDEO_EXTENSIONS = ["mp4", "mkv", "webm", "avi", "mov"];

function isVideoFile(path) {
  const ext = path.split(".").pop().toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}
```

**Media player initialization:**
- **Video**: Shows `<video>` element, passes it to WaveSurfer as `media` option → WaveSurfer controls playback through the video element, waveform stays synced
- **Audio**: Hides video, WaveSurfer loads audio via `url` option (default HTMLMediaElement backend)

**Subtitle sync** — On WaveSurfer `timeupdate`, `highlightCurrentSubtitle(currentTime)`:
1. Finds matching segment → displays in `.subtitle-live`
2. Toggles `.word-active` on individual word spans
3. Toggles `.segment-active` on matching segment rows

**Edit mode** — `enterEditMode()` / `exitEditMode()`:
- Sets `contentEditable = "true"` on `.segment-text` elements
- Tracks modifications via `onSegmentInput` → marks rows with `.segment-modified`
- Tab navigation between segments with auto-play
- `saveEdits()` reads DOM text → rebuilds `transcriptionResult.segments` → `PUT /api/result`

### api.js — REST + WebSocket Client

- Class `SubForgeAPI` with `_get()`, `_post()`, `_put()` helpers
- `audioUrl(filePath)` → `http://127.0.0.1:{port}/api/serve-audio?path={encoded}`
- `connectProgress(callback)` — WebSocket with auto-reconnect on close (2s delay)
- Global instance: `const api = new SubForgeAPI()`

### Content Security Policy

```
default-src 'self';
connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* blob:;
media-src 'self' http://127.0.0.1:* blob:;
style-src 'self' 'unsafe-inline';
```

- `blob:` in `connect-src` — required because WaveSurfer internally fetches blob URLs
- `media-src` — allows loading audio/video from the backend

---

## Electron Shell

### main.js
- Creates `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`
- Spawns Python backend via `PythonBackend` class
- Registers IPC handlers: `dialog:openFile`, `dialog:openDir`, `backend:port`
- `--dev` flag opens DevTools

### preload.js
- Exposes `window.subforge` via `contextBridge`:
  - `pickAudioFile()` → native file dialog
  - `pickOutputDir()` → native directory dialog
  - `getBackendPort()` → backend port number

### python-manager.js
- Finds `.venv/Scripts/python.exe` (falls back to system `python`)
- Spawns: `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`
- Polls `GET /api/status` until 200 (30s timeout)
- Uses `tree-kill` for clean process termination on app quit

---

## Key Solutions & Lessons Learned

### 1. Module Shadowing — venv Named `whisperx/`

**Problem:** The Python virtual environment was originally in a folder called `whisperx/`, which shadowed the actual `whisperx` pip package. `import whisperx` imported the venv folder instead.

**Fix:** Renamed venv to `.venv/`. Updated `python-manager.js` to look for `.venv/Scripts/python.exe`.

### 2. CPU-Only PyTorch Installed

**Problem:** `pip install torch` without the CUDA index installed CPU-only torch. GPU never used.

**Fix:** Install from the CUDA index:
```
pip install torch torchaudio torchvision --index-url https://download.pytorch.org/whl/cu126
```

Also fixed `hardware.py` — older PyTorch uses `total_mem`, newer uses `total_memory`.

### 3. cuDNN v8 DLL Missing Crash

**Problem:** `cudnn_ops_infer64_8.dll` not found. WhisperX's old deps required cuDNN v8, but the system only had cuDNN v9 (bundled with newer CUDA toolkit).

**Fix:** Upgrade to libraries that use cuDNN v9:
- `ctranslate2 >= 4.7.1`
- `faster-whisper >= 1.2.1`
- `whisperx >= 3.8.5`

### 4. Dependency Hell — PyTorch + speechbrain Conflict

**Problem:** `whisperx 3.8.5` pulled `pyannote-audio 4.0.4` which required `torch >= 2.8.0`. But `speechbrain 1.1.0` had a runtime bug with `torchaudio.list_audio_backends()` (removed in torchaudio 2.11). Installing latest torch (2.11) triggered the speechbrain bug.

**Final working stack:**
```
torch==2.8.0+cu126
torchaudio==2.8.0+cu126
torchvision==0.23.0+cu126
speechbrain==1.0.2
whisperx==3.8.5
ctranslate2==4.7.1
faster-whisper==1.2.1
pyannote-audio==4.0.4
```

**Key insight:** Pin torch to 2.8.0 (not latest) and speechbrain to 1.0.2 (not 1.1.0). This avoids the torchaudio API removal issue.

### 5. DiarizationPipeline Import Path Changed

**Problem:** `whisperx.DiarizationPipeline` no longer exists in whisperx 3.8.5. It moved to a submodule.

**Fix:**
```python
# Old (broken):
from whisperx import DiarizationPipeline

# New (correct):
from whisperx.diarize import DiarizationPipeline
```

### 6. Frontend Data Mismatch — Segments Count vs Array

**Problem:** `POST /api/transcribe` returned `{"segments": 42}` (count), but the frontend expected `{"segments": [...]}` (full array).

**Fix:** After transcription succeeds, frontend makes a separate `GET /api/result` to fetch the full `TranscriptionResult` with the actual segments array.

### 7. Audio Playback Not Working — MIME Type Hardcoded

**Problem:** `FileResponse(p, media_type="audio/mpeg")` hardcoded MP3 MIME type. For WAV/MP4/etc files, the browser got a wrong content type and refused to decode.

**Fix:** Remove the `media_type` parameter. Let FastAPI auto-detect:
```python
return FileResponse(p)  # FastAPI infers MIME from file extension
```

### 8. Audio Still Not Playing — WaveSurfer WebAudio + CSP

**Problem:** Even after the MIME fix, audio still didn't play. WaveSurfer's `backend: "WebAudio"` creates a custom `WebAudioPlayer` that internally calls `fetch()` on `blob:` URLs. The CSP `connect-src` didn't include `blob:`, so the second fetch was silently blocked.

**Fix:**
1. Removed `backend: "WebAudio"` — use default HTMLMediaElement backend (uses `<audio>` element whose src loading is governed by `media-src`, which already had `blob:`)
2. Added `blob:` to `connect-src` in CSP as safety net

### 9. Video Preview Support

**Problem:** When transcribing from video files (mp4, mkv, webm), users wanted to see the video, not just hear audio.

**Solution:** WaveSurfer v7 supports `media` option — pass an external `<video>` element as the media source. WaveSurfer controls playback through it, keeping waveform + video + subtitle sync all working.

```javascript
// For video
videoPlayer.src = audioSrc;
wavesurfer = WaveSurfer.create({
  container: "#waveform",
  media: videoPlayer,  // WaveSurfer uses this for playback
  // ... styling options
});

// For audio (no video element)
wavesurfer = WaveSurfer.create({
  container: "#waveform",
  url: audioSrc,  // WaveSurfer handles its own audio element
  // ... styling options
});
```

The `serve-audio` endpoint works for both audio and video files — `FileResponse` auto-detects MIME.

---

## Dependency Stack (Exact Versions)

### Python (.venv)

```
torch==2.8.0+cu126
torchaudio==2.8.0+cu126
torchvision==0.23.0+cu126
whisperx==3.8.5
faster-whisper==1.2.1
ctranslate2==4.7.1
pyannote-audio==4.0.4
speechbrain==1.0.2
fastapi[standard]
uvicorn[standard]
websockets
pydantic>=2.0
```

**Install command for CUDA torch:**
```bash
pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu126
```

### Node.js (package.json)

```json
{
  "dependencies": {
    "tree-kill": "^1.2.2",
    "wavesurfer.js": "^7.12.5"
  },
  "devDependencies": {
    "electron": "^33.0.0"
  }
}
```

### Hardware Tested On

- **GPU:** NVIDIA RTX A4000 — 16,375 MB VRAM
- **CUDA driver:** 581.15
- **OS:** Windows

---

## API Reference

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/system-info` | Hardware detection + model recommendations |
| `GET` | `/api/languages` | All 99 supported Whisper languages |
| `GET` | `/api/models` | Available + recommended model sizes |
| `GET` | `/api/status` | Current job status |
| `GET` | `/api/result` | Latest transcription result (full) |
| `PUT` | `/api/result` | Save edited transcription result |
| `GET` | `/api/serve-audio?path=...` | Serve audio/video file for frontend player |
| `POST` | `/api/transcribe` | Start transcription job |
| `POST` | `/api/export` | Export result to file(s) |
| `POST` | `/api/cancel` | Cancel running transcription |

### WebSocket

| Path | Description |
|------|-------------|
| `ws://127.0.0.1:8000/ws/progress` | Live progress updates during transcription |

**ProgressUpdate payload:**
```json
{
  "status": "transcribing",
  "progress": 45.0,
  "message": "Transcribing audio…",
  "detail": null
}
```

**JobStatus values:** `idle`, `loading_model`, `transcribing`, `aligning`, `diarizing`, `exporting`, `done`, `error`

---

## Export Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| `srt_word` | `.srt` (or `_word.srt`) | One word per SRT entry with precise timestamps |
| `srt_standard` | `.srt` (or `_standard.srt`) | One sentence/segment per SRT entry |
| `json` | `.json` | Full `TranscriptionResult` as JSON |
| `vtt` | `.vtt` | WebVTT format |
| `subforge` | `.subforge` | Custom JSON with word-level data + auto-grouped word clusters for Premiere Pro MOGRT pipeline |

When both `srt_word` and `srt_standard` are exported, filenames get `_word.srt` / `_standard.srt` suffixes to avoid collision.

---

## Running the Project

### Prerequisites

- **Python 3.10** with `.venv` set up
- **Node.js 18+** with npm
- **NVIDIA GPU** with CUDA support (or CPU fallback)

### Setup

```bash
# 1. Clone
git clone https://github.com/FRSname/Subtittles-auto-generator.git
cd Subtittles-auto-generator

# 2. Python venv
python -m venv .venv
.venv\Scripts\activate

# 3. Install CUDA PyTorch first
pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu126

# 4. Install Python deps
pip install whisperx==3.8.5 speechbrain==1.0.2 fastapi[standard] uvicorn[standard] websockets

# 5. Install Node deps
npm install

# 6. Run
npm run dev       # Electron + backend + DevTools
npm start         # Electron + backend (no DevTools)
```

### Scripts (package.json)

```
npm run dev       →  electron . --dev     (opens DevTools)
npm start         →  electron .           (production mode)
npm run backend   →  python -m uvicorn backend.main:app (standalone backend)
```

---

## Future Milestones

- **Milestone 5 — Packaging:** Bundle as standalone installer (electron-builder). Embed Python + .venv.
- **Milestone 6 — Premiere Pro Plugin:** Use .subforge export format to drive animated subtitle MOGRTs via ExtendScript or CEP panel.

---

*Last updated: April 7, 2026*
