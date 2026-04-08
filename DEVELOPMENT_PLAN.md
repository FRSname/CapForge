# CapForge — Development Plan

## Overview

**CapForge** is a standalone desktop app for automatic subtitle generation with word-by-word alignment, built on WhisperX. It replaces the current terminal/venv workflow with a polished Electron GUI backed by a Python engine.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Electron App                    │
│  ┌───────────────────────────────────────────┐  │
│  │         Renderer (HTML/CSS/JS)            │  │
│  │  - File picker / drag-and-drop            │  │
│  │  - Settings panel (model, language, etc.) │  │
│  │  - Progress bar + live log                │  │
│  │  - Subtitle preview + audio player        │  │
│  │  - Export options                         │  │
│  │  - Icons: Octicons (primer.style)         │  │
│  └──────────────────┬────────────────────────┘  │
│                     │ REST + WebSocket           │
│  ┌──────────────────▼────────────────────────┐  │
│  │         Python Backend (FastAPI)          │  │
│  │  - WhisperX transcription engine          │  │
│  │  - Word alignment                         │  │
│  │  - Speaker diarization (optional)         │  │
│  │  - Format converters (SRT, VTT, JSON)     │  │
│  │  - Hardware auto-detection (GPU/CPU)      │  │
│  │  - Model management & auto-selection      │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  Bundled via electron-builder                    │
│  Python env embedded (no user install needed)    │
└──────────────────────────────────────────────────┘
```

### Communication Protocol

| Channel   | Purpose                                      |
|-----------|----------------------------------------------|
| REST API  | Start transcription, get results, export, settings |
| WebSocket | Live progress %, log streaming, status updates |

---

## Phase 1: Standalone GUI App

### 1.1 — Project Scaffolding
- [ ] Initialize Electron project with electron-builder
- [ ] Set up Python backend project (FastAPI + uvicorn)
- [ ] Define project structure (see below)
- [ ] Configure electron-builder to bundle Python environment
- [ ] Set up development workflow (hot-reload for both Electron and Python)

### 1.2 — Python Backend (Core Engine)
- [ ] **Hardware Detection Module**
  - Auto-detect NVIDIA GPU (CUDA availability)
  - Check VRAM amount
  - Determine optimal: device (cuda/cpu), compute_type (float32/float16/int8), model size
  - Expose as `/api/system-info` endpoint
- [ ] **Transcription Engine**
  - Wrap WhisperX into a clean service class
  - Support all ~99 languages with language auto-detect option
  - Model management: download, cache, select based on hardware
  - Progress reporting via WebSocket during transcription
  - Word-level alignment (WhisperX `align()`)
- [ ] **Speaker Diarization Module** (optional toggle)
  - HuggingFace token management (store securely)
  - WhisperX diarization pipeline
  - Assign speaker labels to word segments
- [ ] **Export Module**
  - Word-level SRT (one word per entry with precise timestamps) — for Sub-Machine
  - Standard SRT (sentence-level, grouped)
  - JSON (raw WhisperX output with all alignment data)
  - VTT (WebVTT format)
  - Custom .capforge JSON format (structured data with word-level timestamps)
- [ ] **API Endpoints**
  - `POST /api/transcribe` — Start transcription job
  - `GET /api/status` — Get current job status
  - `GET /api/result` — Get transcription result
  - `POST /api/export` — Export to chosen format(s)
  - `GET /api/system-info` — Hardware capabilities
  - `GET /api/languages` — Supported languages list
  - `GET /api/models` — Available/downloaded models
  - `WS /ws/progress` — Live progress stream

### 1.3 — Electron Frontend (GUI)
- [ ] **Main Window Layout** (Minimalist/Clean design)
  - Top bar: App name + minimal controls
  - Center: Main content area (file selection → progress → results)
  - Sidebar: Settings panel (collapsible)
- [ ] **File Selection Screen**
  - Drag-and-drop zone for audio files
  - "Browse" button as alternative
  - Supported formats: mp3, wav, m4a, flac, ogg, mp4, mkv, avi
  - Show file info (name, duration, size) after selection
- [ ] **Settings Panel**
  - Language selector (dropdown with search, "Auto-detect" default)
  - Model info display (auto-selected, show which model & why)
  - Speaker diarization toggle (with HF token input)
  - Output format checkboxes
  - Output directory selector
- [ ] **Transcription Progress Screen**
  - Progress bar with percentage
  - Live log/status text area
  - Current step indicator (Loading model → Transcribing → Aligning → Diarizing → Done)
  - Cancel button
- [ ] **Results / Preview Screen**
  - Audio waveform player (wavesurfer.js or similar)
  - Subtitle overlay synced to audio playback
  - Word-by-word highlight during playback
  - Editable subtitle text (correct mistakes before export)
  - Export button with format selection

### 1.4 — Packaging & Distribution
- [ ] Bundle Python + dependencies using embedded Python distribution
- [ ] Include pre-downloaded "base" model (optional, or download on first run)
- [ ] CUDA toolkit bundling strategy (or guide user to install NVIDIA drivers)
- [ ] electron-builder config for:
  - Windows .exe installer (NSIS)
  - Portable .zip option
- [ ] Auto-updater (electron-updater)
- [ ] Code signing (optional, prevents Windows SmartScreen warnings)

### 1.5 — Quality & Polish
- [ ] Error handling: meaningful messages for common issues (no GPU, model download fail, corrupt audio)
- [ ] First-run setup wizard (detect hardware, download model, configure defaults)
- [ ] Settings persistence (save user preferences)
- [ ] Light/dark theme toggle
- [ ] Keyboard shortcuts

---

## Project Structure

```
CapForge/
├── electron/                    # Electron main process
│   ├── main.js                  # App entry, window management
│   ├── preload.js               # Context bridge
│   └── python-manager.js        # Spawn/manage Python backend
│
├── renderer/                    # Electron renderer (frontend)
│   ├── index.html
│   ├── css/
│   │   └── styles.css           # Minimalist theme
│   ├── js/
│   │   ├── app.js               # Main app logic
│   │   ├── api.js               # REST/WebSocket client
│   │   ├── file-picker.js       # Drag-and-drop + browse
│   │   ├── settings.js          # Settings panel
│   │   ├── progress.js          # Progress tracking
│   │   ├── preview.js           # Audio player + subtitle sync
│   │   └── export.js            # Export controls
│   └── assets/
│       └── icons/               # Octicons subset
│
├── backend/                     # Python FastAPI backend
│   ├── main.py                  # FastAPI app + WebSocket
│   ├── engine/
│   │   ├── transcriber.py       # WhisperX transcription service
│   │   ├── aligner.py           # Word alignment
│   │   ├── diarizer.py          # Speaker diarization
│   │   └── hardware.py          # GPU/CPU auto-detection
│   ├── exporters/
│   │   ├── srt_word.py          # Word-level SRT
│   │   ├── srt_standard.py      # Sentence-level SRT
│   │   ├── json_export.py       # Raw JSON
│   │   ├── vtt_export.py        # WebVTT
│   │   └── premiere_export.py   # Custom .capforge format
│   ├── models/                  # Data models (Pydantic)
│   │   └── schemas.py
│   └── requirements.txt
│
├── build/                       # Build configs
│   ├── electron-builder.yml
│   └── bundle-python.js         # Script to bundle Python env
│
├── package.json
├── DEVELOPMENT_PLAN.md          # This file
└── README.md
```

---

## Technology Stack

| Layer             | Technology                          |
|-------------------|-------------------------------------|
| Frontend          | Electron + HTML/CSS/JS              |
| Icons             | Octicons (primer.style)             |
| Audio Player      | wavesurfer.js                       |
| Backend           | Python 3.10 + FastAPI + uvicorn     |
| Transcription     | WhisperX (whisperx)                 |
| ML Framework      | PyTorch (CUDA 11.8 / CPU)           |
| Diarization       | pyannote.audio (via WhisperX)       |
| Packaging         | electron-builder + embedded Python  |

---

## Development Milestones

### Milestone 1: Working Backend API
- Python backend with FastAPI
- Transcription, alignment, export working via REST
- Hardware auto-detection
- WebSocket progress reporting

### Milestone 2: Electron Shell + File Handling
- Electron app launches and spawns Python backend
- File selection (drag-and-drop + browse)
- Settings panel functional
- Calls backend API to start transcription

### Milestone 3: Live Progress + Results
- Progress bar + live log via WebSocket
- Results screen with subtitle text display
- Export to all formats working

### Milestone 4: Audio Preview
- Integrated audio player with waveform
- Subtitle overlay synced to playback
- Word-by-word highlighting during preview

### Milestone 5: Packaging & Distribution
- Bundled .exe installer for Windows
- Portable zip option
- First-run setup wizard
- Model download manager

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| GUI framework | Electron + Python backend | Highly customizable UI, web tech flexibility, good for media tools |
| Backend comm | REST + WebSocket hybrid | REST for commands, WS for real-time progress during transcription |
| GPU support | Auto-detect, CPU fallback | Accessible to all users regardless of hardware |
| Languages | All ~99 Whisper languages | Maximum flexibility, no artificial limits |
| Model selection | Auto based on hardware | Users don't need to understand model sizes |
| Diarization | Optional toggle | Available when needed, doesn't complicate simple tasks |
| Premiere integration | Removed | Scope reduced to focus on core transcription features |
| Animation styles | Fully customizable | All styles available: highlight, pop-in, color, grouped, emoji |
| UI style | Minimalist/Clean + Octicons | Professional, approachable, not intimidating |
| Distribution | .exe installer + portable zip | Covers both install-preferred and portable users |
