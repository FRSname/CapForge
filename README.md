# CapForge

![CapForge demo](docs/assets/capforge-anim.gif)

▶ **[Watch the tutorial — how to use CapForge](https://www.youtube.com/watch?v=7xxLt5FEq1E)**

**Captions, a library and an upload package for every video you make — with Claude doing the writing.**

CapForge transcribes a video with word-level timing, lets you correct and style the captions, renders them into the video or as a transparent overlay, and then turns the finished video into a copy-ready YouTube upload package (title, description with chapters, tags, thumbnail) plus a post per social channel. Everything you make lives in a library on your machine. A desktop app built with **Electron + React + TypeScript** on a **Python FastAPI** backend powered by [WhisperX](https://github.com/m-bain/whisperX). Transcription, rendering and the library all run on your machine.

## ⬇ Download

| Platform | Installer |
|----------|-----------|
| **Windows** | [CapForge-Setup-3.0.1.exe](https://github.com/FRSname/CapForge/releases/download/v3.0.1/CapForge-Setup-3.0.1.exe) |
| **macOS** (Apple Silicon) | [CapForge-3.0.1.dmg](https://github.com/FRSname/CapForge/releases/download/v3.0.1/CapForge-3.0.1.dmg) |

See the [changelog](CHANGELOG.md) for what's new, or [all releases](https://github.com/FRSname/CapForge/releases) for older builds. The app checks GitHub for a newer version at startup and tells you when there is one.

On first launch a setup wizard downloads the embedded Python runtime and the Whisper model you pick (Tiny at 75 MB up to Large Turbo at 1.6 GB; Large Turbo is recommended) into the app's data folder. Your library lives in `~/.capforge/` on every platform.

---

## What it does

**Captions.** Drop a video, get word-level timestamps in 99 languages, optionally with speakers. Fix words in the Text view, rearrange caption groups in the Groups view, drag timings on the timeline. Style everything from a sidebar of presets and dials, preview it live, and render an MP4 with the captions burned in or a transparent MOV/WebM overlay for your editor. Add a tab per language and translate the captions onto the original timing.

**Library.** CapForge opens on your videos, in folders, with a poster and a status on every card (imported → transcribed → captioned → drafted → published). Every session saves itself into its record. Drop a folder of recordings to import them all; point a watch folder at your capture drive.

**Publish.** A second workspace beside the caption editor turns the video into an upload: title options, a description with chapters, tags and hashtags, a speaker map, Shorts clip suggestions, thumbnail frames, and translated metadata per language — checked against YouTube's limits as you type. Set up your channels (YouTube, TikTok, Instagram, LinkedIn, X) once and each gets its own tab, metered to that platform. Copy the whole package or one field at a time. CapForge never uploads; you paste.

**Claude.** Connect Claude Desktop or Claude Code with one click in Settings. Seven bundled skills and 61 tools let Claude clean up the transcript, style the captions, translate them, write the description and chapters, find Shorts moments and run a pre-upload check — on the open video or across a whole folder, with no window open for the library parts.

---

## Features

### Transcription and editing

- **Word-level timestamps** in 99 languages with auto-detection; **speaker diarization** with pyannote-audio (needs a free [Hugging Face token](https://huggingface.co/settings/tokens) and gating acceptance for [speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and [segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0))
- **Pick your model** in the first-run wizard or Settings; GPU auto-detection recommends a size and precision for your VRAM
- **Three editor views** — Text (click to edit, search, split/merge), Groups (drag, merge, split, reorder words, speakers) and a read-only Transcript with a chapter gutter
- **Edits never move the words you did not touch** — a correction is retimed inside its own span; a hand-placed timing is pinned
- **Timeline** with draggable caption blocks, a word lane, press-and-hold scrubbing, zoom and pan synced to the waveform
- **Caption tracks in other languages** — a tab per language, translated a sentence at a time onto the original timing, flagged when the source changes

### Styling and rendering

- **Presets and dials** — typography, colours (flat or gradient), background box, layout, animation, reading mode; per-word and per-group overrides by right-click
- **Word styles** — Highlight, Underline, Bounce, Scale, Karaoke, Reveal, with Fade / Slide / Pop entrances; **RSVP** speed-reading mode
- **Captions held across short gaps**, with the last caption held past its final word
- **Preview = render** — the live Canvas preview, the Pillow renderer and the HyperFrames HTML renderer are pinned to each other by parity tests
- **Quick Render** (MP4 baked or MOV overlay at source resolution) and **Custom Render** (resolution, fps, format, bitrate); **HyperFrames** engine for GSAP-animated captions
- **Exports** — SRT (standard and word-level), VTT, ASS with karaoke, JSON, and the `.capforge` project file; per language track
- **Custom fonts**, favorite fonts, and shareable `.cfpreset` files with the font embedded

### Library and Publish

- **Finder-style library** — nested folders, sidebar and path bar, drag to move, grid or list, sort, search by title or file name, multi-select with bulk Move / Remove / Delete, rename in place
- **Import** files, folders and `.capforge` projects in one go (⌘O / Ctrl+O); relink media that moved; an import-only watch folder
- **Records** under `~/.capforge/library/<id>/` — a plain `record.json` and `transcript.json` per video, readable by any tool
- **Publish cards** for title, description, chapters (click to seek, insert at the playhead, suggest from pauses), tags, keywords, hashtags, speakers, summary, Shorts, thumbnail and localized metadata
- **Validators in one place** — YouTube's hard limits and your own house rules are checked by the backend and drawn under the field; text is never cut
- **Channels** in Settings, a **tab per channel** in Publish, "Start from…" to adapt another channel's text, and a copy button on every field
- **Folder settings** — a folder overrides the footer, links and hashtags for all its videos, so an event's descriptions regenerate in one pass
- **Provenance** — a field written by Claude says so and can be reverted; a soft lock keeps the two of you from clobbering each other

### App

- **Startup guide** — coach-mark tours through the library and the editor, and a What's new card after an update (Settings → General → About)
- **Settings dialog** with search (⌘,), **Light / Dark / System** theme, resizable panels that remember their width
- **Autosave** into the library record every 2 s, with a local crash-recovery copy as the fallback
- **Skills editor** — view, edit and install the bundled Claude skills without leaving the app; your edits survive updates

---

## Claude integration

CapForge ships an [MCP server](mcp_server/README.md) that Claude Desktop and Claude Code connect to. Settings → Claude & Skills has a one-click **Connect** for each; restart Claude afterwards.

| | |
|---|---|
| **61 tools** | transcribe, edit words, style captions, render and export; create and translate caption tracks; list, search and read the library; write titles, descriptions, chapters and tags into a record; grab thumbnail frames; manage channels, folders and per-channel posts |
| **7 skills** | `capforge-init` (set up channels by interview) · `capforge-publish` (the upload package) · `capforge-cleanup` (fillers and misheard names, timing untouched) · `capforge-translate` · `capforge-style` · `capforge-clips` (Shorts candidates) · `capforge-preflight` (a read-only pre-upload check) |
| **4 slash commands** | `/breakdown`, `/describe`, `/chapters`, `/batch_publish` |
| **Guide** | `capforge://publish` resources — the publish workflow as topics Claude pulls on demand |

Every write Claude makes is validated by the same rules as the UI and stamped into the record's history. See [mcp_server/README.md](mcp_server/README.md) for the tool reference, batch runs over a folder, and effect packs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Electron shell                        │
│   main.js · preload.js · python-manager.js · skills-store │
├──────────────────────────────────────────────────────────┤
│                  Renderer (Chromium)                      │
│   React 19 + TypeScript + Tailwind v4                     │
│   Library · Editor · Timeline · Studio · Publish          │
├───────────────┬──────────────────────────────────────────┤
│   REST / WS   │   http://127.0.0.1:53421                 │
├───────────────┴──────────────────────────────────────────┤
│              Python backend (FastAPI)                      │
│   WhisperX · pyannote · Pillow · FFmpeg · HyperFrames     │
│   backend/library — records, index, validators, package  │
├──────────────────────────────────────────────────────────┤
│   ~/.capforge/library/<id>/  record.json · transcript    │
└──────────────────────────────────────────────────────────┘
          ▲
          │  /api/agent/*
   mcp_server/  ←  Claude Desktop · Claude Code
```

Electron spawns the backend on startup. The renderer owns the editing session and talks to the backend over REST and a WebSocket for progress. The backend owns the durable per-video record, which the MCP server reads and writes on Claude's behalf — with or without a window open.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 33 |
| Renderer | React 19, TypeScript, Tailwind CSS v4, electron-vite + Vite |
| Audio / waveform | WaveSurfer.js 7 |
| Backend | Python 3.11 (embedded), FastAPI, uvicorn |
| ASR | WhisperX, faster-whisper, CTranslate2 |
| Diarization | pyannote-audio |
| ML | PyTorch 2.6 (CUDA 12.4 on Windows, MPS/CPU on macOS) |
| Rendering | Pillow, FFmpeg, HyperFrames (Node) |
| Library | JSON records + SQLite FTS5 index |
| Agent | MCP server (Python) |
| Packaging | electron-builder (NSIS / DMG) |

---

## Getting started (development)

### Prerequisites

- **Node.js 22.12+**
- **Python 3.11** for the dev backend
- **FFmpeg** on PATH
- **NVIDIA GPU** with a CUDA 12.4 driver (≥ 550) on Windows, or Apple Silicon / CPU

### Setup

```bash
git clone https://github.com/FRSname/CapForge.git
cd CapForge

python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Order matters — see DOCS.md "torch install order trap"
pip install whisperx fastapi[standard] uvicorn[standard] websockets pillow
pip uninstall -y torch torchaudio torchvision
pip install torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124

npm install
```

### Run

```bash
npm run dev:react       # Electron + React with HMR + the backend
npm run backend         # backend alone on 127.0.0.1:53421
```

### Check

```bash
npm run typecheck
npm test                # vitest
npm run lint
pytest                  # backend; add mcp_server/tests for the MCP suite
```

### Package

```bash
npm run dist:win        # NSIS installer
npm run dist:mac        # DMG (npm run release:mac signs and notarizes)
```

---

## How it works

1. **Add to library** — drop files or a folder, or click Transcribe… for one file
2. **Transcribe** — pick the language (or auto-detect), speakers on or off; WhisperX transcribes, aligns and diarizes
3. **Edit** — fix words in Text, shape captions in Groups, drag timings on the timeline
4. **Style** — a preset or your own dials; preview live; add a language tab if you need one
5. **Render or export** — Quick MP4 / MOV, Custom Render, HyperFrames, or SRT / VTT / ASS
6. **Publish** — switch to the Publish workspace, let Claude draft, adjust, copy the package into YouTube Studio and the post into each social app
7. **Come back any time** — the record keeps everything; Export project… writes a `.capforge` file if you want a copy

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Space** / **K** | Play / pause |
| **J** / **L** | Seek ±2 s |
| **← / →** | Step one frame |
| **, / .** | Previous / next caption group |
| **[** / **]** | Previous / next segment |
| **⌘1** / **⌘2** | Text / Groups view |
| **Enter** / **⇧Enter** | Commit, edit next / previous |
| **⌘Enter** | Split segment at cursor |
| **M** (Groups) | Merge with the group below |
| **Enter** (Groups) | Split in half |
| **⌘Z** / **⌘⇧Z** | Undo / redo |
| **⌘S** | Export project (`.capforge`) |
| **⌘O** (library) | Add to library… |
| **⌘,** | Settings |
| **?** | All shortcuts |
| **+ / − / 0** | Zoom in / out / reset |
| **Ctrl+Wheel** | Zoom timeline or video |

On Windows, ⌘ is Ctrl. In the library: click selects, double-click or Enter opens, ⌘A selects all, ⌘⌫ removes.

---

## Export and render

| Export | Extension | Notes |
|--------|-----------|-------|
| Standard SRT / VTT / ASS | `.srt` `.vtt` `.ass` | Sentence cues, ≤ 2 lines × 42 chars, ≤ 7 s; ASS keeps karaoke |
| Word SRT | `.srt` | One word per cue |
| JSON | `.json` | Full word-level data |
| Project | `.capforge` | Transcript, groups, tracks, style |
| Upload package | clipboard | Title, description with chapters, tags, hashtags — per channel and language |

| Render | Format | Use |
|--------|--------|-----|
| **Baked** | MP4 (H.264) | Captions burned into the video |
| **Overlay** | MOV (ProRes 4444, premultiplied) or WebM (VP9 alpha) | Transparent layer for an NLE |
| **HyperFrames** | MP4 | GSAP-animated captions and effect packs |

Quick Render uses the source resolution and fps at 40 Mbps. Custom Render adds resolution presets (1080p / 4K / portrait / square), 24–60 fps and a bitrate selector. All encodes except WebM are tagged BT.709.

---

## GPU recommendations

| VRAM | Model | Compute |
|------|-------|---------|
| ≥ 10 GB | large-v3 | float16 |
| ≥ 6 GB | large | float16 |
| ≥ 4 GB | medium | int8 |
| ≥ 2 GB | small | int8 |
| CPU / Apple Silicon | large-v3-turbo (CPU path; CTranslate2 has no MPS yet) | int8 |

---

## Project structure

```
CapForge/
├── backend/                  # FastAPI backend
│   ├── main.py               # REST + WebSocket routes
│   ├── engine/               # WhisperX pipeline, GPU detection
│   ├── exporters/            # SRT/VTT/ASS/JSON, Pillow render, HyperFrames, RSVP
│   ├── library/              # records, index, validators, package, channels, folders
│   └── models/schemas.py
├── mcp_server/               # MCP server: tools, publish guide, bundled skills
│   ├── server.py · library.py · publish.py · tracks.py · channel_tools.py
│   ├── publish_guide/        # capforge://publish topics
│   └── skills/               # the seven bundled skills
├── electron/                 # main.js, preload.js, python-manager.js, skills-store.js …
├── src/renderer/src/         # React renderer
│   ├── components/
│   │   ├── library/          # the home screen
│   │   ├── editor/ player/   # Text, Groups, Transcript views; player + timeline
│   │   ├── studio/           # style sidebar, export, render
│   │   ├── publish/          # the Publish workspace
│   │   ├── tracks/           # language tabs
│   │   ├── settings/         # the Settings dialog
│   │   └── onboarding/ tour/ # startup guide, tours, What's new
│   ├── hooks/ · lib/         # state and pure logic (unit-tested)
│   └── styles/globals.css    # theme tokens
├── docs/                     # caption-parity.md, caption-tracks.md, hyperframes-integration.md, plans/
├── DOCS.md                   # packaging and runtime notes
└── CHANGELOG.md
```

More: [DOCS.md](DOCS.md) · [docs/caption-parity.md](docs/caption-parity.md) · [docs/caption-tracks.md](docs/caption-tracks.md) · [docs/hyperframes-integration.md](docs/hyperframes-integration.md) · [mcp_server/README.md](mcp_server/README.md)

---

## License

MIT
