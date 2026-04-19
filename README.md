# CapForge

**Automatic subtitle generator with word-by-word alignment, inline editing, and styled video rendering.**

A standalone desktop app built with **Electron + React + TypeScript** on top of a **Python FastAPI** backend powered by [WhisperX](https://github.com/m-bain/whisperX) and NVIDIA CUDA.

## ⬇ Download

| Platform | Installer |
|----------|-----------|
| **Windows** | [CapForge-Setup-0.9.1.exe](https://github.com/FRSname/CapForge/releases) |
| **macOS** | [CapForge-0.9.1.dmg](https://github.com/FRSname/CapForge/releases) |

See [all releases](https://github.com/FRSname/CapForge/releases) for older versions and changelogs.

The installer is ~155 MB. On first launch a setup wizard downloads the embedded Python runtime and the Whisper model (`large-v3-turbo`, ~1.6 GB) into `%APPDATA%\CapForge\`.

---

## Features

- **Word-level timestamps** — every word gets a precise start and end time
- **Speaker diarization** *(optional)* — identifies who said what (via pyannote-audio). Requires a free [Hugging Face access token](https://huggingface.co/settings/tokens) and one-time gating acceptance for [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0).
- **99 languages** with auto-detection
- **GPU auto-detection** — recommends the optimal model size and precision based on your VRAM
- **Inline subtitle editing** — Text view (per-sentence) and Groups view (drag, merge, split, reorder words)
- **Per-word style overrides** — custom color, weight, font, or active-color per word
- **Video / audio preview** — synced waveform, video playback, canvas timeline, live caption overlay
- **Multiple animations** — Fade, Slide, Pop entrance + Highlight, Underline, Bounce, Scale, Karaoke, Reveal word styles
- **Custom Render** — full control over resolution, fps, format, mode, bitrate
- **Quick Render** — one-click MP4 (baked) or MOV (transparent overlay) at source resolution + 40 Mbps
- **Multi-format export** — SRT (word-level & standard), VTT, JSON, CapForge project file
- **Custom fonts & presets** — import `.ttf`/`.otf` and save complete style presets
- **Project save/load** — save transcription + edits + style settings to a `.capforge` file
- **Light & dark themes** — full theme support across UI and canvas timeline

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                Electron Shell                        │
│  electron/main.js · preload.js · python-manager.js  │
│  runtime-setup.js · update-check.js                 │
├─────────────────────────────────────────────────────┤
│             Renderer (Chromium)                      │
│  React 19 + TypeScript + Tailwind v4                │
│  WaveSurfer.js · Canvas timeline · CSS theme tokens │
├──────────────┬──────────────────────────────────────┤
│  REST / WS   │  http://127.0.0.1:53421             │
├──────────────┴──────────────────────────────────────┤
│           Python Backend (FastAPI)                   │
│  WhisperX · pyannote · Pillow · FFmpeg              │
└─────────────────────────────────────────────────────┘
```

Electron spawns the Python backend on startup. The renderer talks to the backend via REST (commands, edits, exports) and WebSocket (live progress for transcription and rendering). Audio and video files are streamed back through `GET /api/serve-audio`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 33 |
| Renderer | React 19, TypeScript 6, Tailwind CSS v4 |
| Build | electron-vite 5 + Vite 7 |
| Audio / Waveform | WaveSurfer.js 7.12 |
| Backend | Python 3.11 (embedded), FastAPI, uvicorn |
| ASR Engine | WhisperX, faster-whisper, CTranslate2 |
| Diarization | pyannote-audio, speechbrain |
| ML Framework | PyTorch 2.6.0 + CUDA 12.4 |
| Video Render | Pillow 11, FFmpeg 8.1 |
| Packaging | electron-builder 25 (NSIS / DMG) |

---

## Getting Started

### Prerequisites

- **Python 3.11** (or 3.10) for the dev backend
- **Node.js 18+**
- **NVIDIA GPU** with CUDA 12.4-compatible driver (≥ 550), or CPU fallback
- **FFmpeg** on PATH (for video rendering in dev mode)

### Setup

```bash
# Clone the repo
git clone https://github.com/FRSname/CapForge.git
cd CapForge

# Python venv for backend dev
python -m venv .venv
.venv\Scripts\activate         # Windows
# source .venv/bin/activate    # Linux / macOS

# Install backend deps — order matters, see DOCS.md "torch install order trap"
pip install whisperx fastapi[standard] uvicorn[standard] websockets pillow
pip uninstall -y torch torchaudio torchvision
pip install torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124

# Node deps
npm install
```

### Run (dev)

```bash
npm run dev:react       # electron-vite dev — Electron + React HMR + backend
npm run typecheck       # tsc --noEmit
npm run backend         # standalone backend (no Electron)
```

### Build / package

```bash
npm run build:react     # build renderer + main + preload
npm run dist:win        # NSIS installer
npm run dist:mac        # DMG
npm run dist:dir        # unpacked build (debug)
```

---

## How It Works

1. **Drop a file** — drag any audio/video into the app, or click to browse
2. **Configure** — pick language (or auto-detect), toggle speaker diarization, adjust model
3. **Transcribe** — WhisperX runs the full pipeline: load → transcribe → align → diarize
4. **Review** — synced video, waveform, and canvas timeline with caption overlay
5. **Edit** — Text view for line-by-line editing, Groups view for merge/split/drag/per-word style overrides
6. **Style** — Custom Settings sidebar: typography, colors, layout, animations
7. **Render or export** — Quick MP4 / MOV, Custom Render with full control, or SRT / VTT / JSON
8. **Save project** — `Ctrl+S` writes a `.capforge` file with everything to resume later

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Space** | Play / Pause |
| **Tab** / **Shift+Tab** | Next / previous segment |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo edits |
| **Ctrl+S** | Save project |
| **Ctrl+O** | Open project |
| **Enter** | Start transcription (file screen) |
| **Escape** | Cancel job |
| **Ctrl+Wheel** (timeline) | Zoom |
| **Wheel** (timeline) | Pan |

---

## Export Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| Word SRT | `.srt` | One word per entry with precise timestamps |
| Standard SRT | `.srt` | One sentence per entry |
| WebVTT | `.vtt` | WebVTT format |
| JSON | `.json` | Full transcription data |
| CapForge | `.capforge` | Project file: transcription + edits + style settings |

---

## Render Options

| Mode | Format | Use case |
|------|--------|----------|
| **Baked** | MP4 (H.264) | Subtitles burned into the source video |
| **Overlay** | MOV (ProRes 4444) or WebM (VP9 alpha) | Transparent subtitle layer for compositing |

Quick Render uses the source resolution + fps + 40 Mbps. Custom Render exposes resolution presets (1080p / 4K / portrait / square), 24–60 fps, and a bitrate selector.

---

## GPU Recommendations

The app auto-detects your GPU and recommends settings:

| VRAM | Model | Compute |
|------|-------|---------|
| ≥ 10 GB | large-v3 | float16 |
| ≥ 6 GB | large | float16 |
| ≥ 4 GB | medium | int8 |
| ≥ 2 GB | small | int8 |
| CPU | base | float32 |

---

## Project Structure

```
CapForge/
├── backend/                    # FastAPI Python backend
│   ├── main.py                 # REST + WebSocket
│   ├── engine/                 # WhisperX pipeline + GPU detection
│   ├── exporters/              # SRT, VTT, JSON, CapForge, video render
│   └── models/schemas.py
├── electron/
│   ├── main.js                 # Electron main process
│   ├── preload.js              # contextBridge (window.subforge)
│   ├── python-manager.js       # backend lifecycle
│   ├── runtime-setup.js        # first-launch installer
│   └── update-check.js         # GitHub release check
├── src/renderer/src/           # React renderer (TypeScript)
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── screens/            # DropZone, Progress, Results
│   │   ├── player/             # AudioPlayer + canvas timeline
│   │   ├── editor/             # SubtitleEditor, GroupEditor, WordStylePopup
│   │   ├── studio/             # StudioPanel, ExportPanel, CustomRenderPanel, …
│   │   └── ui/                 # ColorSwatch, FontPicker, Toggle
│   ├── hooks/                  # useWaveSurfer, useTimeline, useRender, …
│   ├── lib/                    # api, render, project, presets, fonts, groups
│   ├── styles/globals.css      # Tailwind v4 theme tokens (light + dark)
│   └── types/                  # app types + global.d.ts (window.subforge)
├── resources/
│   ├── bin-win/ · bin-mac/     # bundled FFmpeg binaries
│   └── python/                 # embedded Python archives
├── DOCS.md                     # detailed technical documentation
├── DEVELOPMENT_PLAN.md         # roadmap
└── package.json
```

See [DOCS.md](DOCS.md) for the deep architectural and packaging notes.

---

## License

MIT
