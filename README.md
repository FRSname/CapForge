# CapForge

**Automatic subtitle generator with word-by-word alignment, speaker diarization, and built-in video rendering.**

A standalone desktop app built with Electron + Python that turns any audio or video file into precisely timed subtitles — powered by [WhisperX](https://github.com/m-bain/whisperX) and NVIDIA CUDA.

---

## Features

- **Word-level timestamps** — every word gets a precise start and end time
- **Speaker diarization** *(optional)* — identifies who said what (via pyannote-audio). Requires a free [Hugging Face access token](https://huggingface.co/settings/tokens) and one-time gating acceptance for the [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0) models. Skip it if you don't need per-speaker labels.
- **99 languages** — supports all Whisper-supported languages with auto-detection
- **GPU auto-detection** — recommends the optimal model size and precision based on your VRAM
- **Inline editing** — edit subtitles directly in the app with Tab navigation and loop-play
- **Video & audio preview** — synced waveform, video playback, and live subtitle highlighting
- **Multi-format export** — SRT (word-level & standard), VTT, JSON, CapForge (.capforge)
- **Subtitle video rendering** — bake styled subtitles into transparent video overlays (VP9/ProRes/H.264)
- **Custom fonts & presets** — import .ttf/.otf fonts and save rendering presets
- **Project save/load** — save your transcription + settings to a `.capforge` file and resume later

---

## Screenshot

> *Coming soon*

---

## Architecture

```
┌─────────────────────────────────────────────┐
│             Electron Shell                   │
│  main.js · preload.js · python-manager.js   │
├─────────────────────────────────────────────┤
│           Renderer (Chromium)                │
│  Vanilla JS · WaveSurfer.js · Dark Theme    │
├──────────────┬──────────────────────────────┤
│  REST / WS   │  http://127.0.0.1:8000      │
├──────────────┴──────────────────────────────┤
│         Python Backend (FastAPI)             │
│  WhisperX · pyannote · Pillow · FFmpeg      │
└─────────────────────────────────────────────┘
```

Electron spawns the Python backend on startup. The frontend communicates via REST for commands and WebSocket for real-time progress during transcription and rendering.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 33 |
| Frontend | Vanilla JS (ES2020+), WaveSurfer.js 7.12.5 |
| Backend | Python 3.10, FastAPI, uvicorn |
| ASR Engine | WhisperX 3.8.5, faster-whisper 1.2.1, CTranslate2 4.7.1 |
| Diarization | pyannote-audio 4.0.4, speechbrain 1.0.2 |
| ML Framework | PyTorch 2.8.0+cu126, torchaudio 2.8.0+cu126 |
| Video Render | Pillow 11.1, FFmpeg 7.1 |

---

## Getting Started

### Prerequisites

- **Python 3.10**
- **Node.js 18+**
- **NVIDIA GPU** with CUDA support (or CPU fallback — much slower)
- **FFmpeg** on PATH (for video rendering)

### Setup

```bash
# Clone the repo
git clone https://github.com/FRSname/CapForge.git
cd CapForge

# Create Python venv
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux/macOS

# Install CUDA PyTorch
pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu126

# Install Python dependencies
pip install whisperx==3.8.5 speechbrain==1.0.2 fastapi[standard] uvicorn[standard] websockets pillow

# Install Node dependencies
npm install
```

### Run

```bash
npm run dev       # Electron + backend + DevTools
npm start         # Electron + backend (production)
```

---

## How It Works

1. **Drop a file** — drag any audio/video file into the app
2. **Configure** — pick language (or auto-detect), toggle speaker diarization, choose export formats
3. **Transcribe** — WhisperX runs the full pipeline: transcribe → word-align → diarize
4. **Review** — browse results with synced audio/video waveform and live subtitle highlighting
5. **Edit** — press **E** to enter inline edit mode, **Tab** between segments, **Ctrl+Enter** to loop-play
6. **Export** — save to SRT, VTT, JSON, or render a subtitle video overlay
7. **Save project** — **Ctrl+S** saves everything to a `.capforge` file to resume later

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Space** | Play / Pause |
| **E** | Toggle edit mode |
| **Tab** / **Shift+Tab** | Next / previous segment (edit mode) |
| **Ctrl+Enter** | Loop-play current segment |
| **Ctrl+S** | Save edits or save project |
| **Ctrl+O** | Open project |
| **Enter** | Start transcription (file screen) |
| **Escape** | Cancel job / exit edit mode |

---

## Export Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| Word SRT | `.srt` | One word per entry with precise timestamps |
| Standard SRT | `.srt` | One sentence per entry |
| JSON | `.json` | Full transcription data |
| WebVTT | `.vtt` | WebVTT format |
| CapForge | `.capforge` | Structured JSON with word-level data and grouped word clusters |

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
├── backend/
│   ├── main.py              # FastAPI server — REST + WebSocket
│   ├── engine/
│   │   ├── transcriber.py   # WhisperX pipeline
│   │   └── hardware.py      # GPU auto-detection
│   ├── exporters/           # SRT, VTT, JSON, CapForge, video render
│   └── models/
│       └── schemas.py       # Pydantic data models
├── electron/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Secure IPC bridge
│   └── python-manager.js    # Python backend lifecycle
├── renderer/
│   ├── index.html           # UI (3 screens + settings sidebar)
│   ├── css/styles.css       # Dark theme
│   └── js/
│       ├── app.js           # All frontend logic
│       └── api.js           # REST + WebSocket client
├── package.json
├── DOCS.md                  # Detailed technical documentation
└── DEVELOPMENT_PLAN.md      # Roadmap
```

---

## License

MIT
