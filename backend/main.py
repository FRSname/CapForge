"""CapForge Backend — FastAPI server with REST + WebSocket."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import FileResponse

from backend.engine.errors import explain
from backend.engine.hardware import detect_hardware
from backend.engine.transcriber import Transcriber, TranscriptionCancelled
from backend.exporters.json_export import export_json
from backend.exporters.premiere_export import export_subforge
from backend.exporters.srt_standard import export_srt_standard
from backend.exporters.srt_word import export_srt_word
from backend.exporters.vtt_export import export_vtt
from backend.exporters.video_render import RenderCancelled, cancel_render, render_subtitle_video
from backend.models.schemas import (
    ExportFormat,
    ExportRequest,
    JobStatus,
    ProgressUpdate,
    SystemInfo,
    TranscribeRequest,
    TranscriptionResult,
    VideoRenderRequest,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CapForge", version="0.1.0")

# Allow Electron renderer to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Shared state ---

transcriber = Transcriber()
current_result: Optional[TranscriptionResult] = None
current_status = ProgressUpdate(status=JobStatus.IDLE, progress=0, message="Ready")
ws_clients: list[WebSocket] = []

# Supported languages (ISO 639-1 codes supported by Whisper)
WHISPER_LANGUAGES = {
    "af": "Afrikaans", "am": "Amharic", "ar": "Arabic", "as": "Assamese",
    "az": "Azerbaijani", "ba": "Bashkir", "be": "Belarusian", "bg": "Bulgarian",
    "bn": "Bengali", "bo": "Tibetan", "br": "Breton", "bs": "Bosnian",
    "ca": "Catalan", "cs": "Czech", "cy": "Welsh", "da": "Danish",
    "de": "German", "el": "Greek", "en": "English", "es": "Spanish",
    "et": "Estonian", "eu": "Basque", "fa": "Persian", "fi": "Finnish",
    "fo": "Faroese", "fr": "French", "gl": "Galician", "gu": "Gujarati",
    "ha": "Hausa", "haw": "Hawaiian", "he": "Hebrew", "hi": "Hindi",
    "hr": "Croatian", "ht": "Haitian Creole", "hu": "Hungarian", "hy": "Armenian",
    "id": "Indonesian", "is": "Icelandic", "it": "Italian", "ja": "Japanese",
    "jw": "Javanese", "ka": "Georgian", "kk": "Kazakh", "km": "Khmer",
    "kn": "Kannada", "ko": "Korean", "la": "Latin", "lb": "Luxembourgish",
    "ln": "Lingala", "lo": "Lao", "lt": "Lithuanian", "lv": "Latvian",
    "mg": "Malagasy", "mi": "Maori", "mk": "Macedonian", "ml": "Malayalam",
    "mn": "Mongolian", "mr": "Marathi", "ms": "Malay", "mt": "Maltese",
    "my": "Myanmar", "ne": "Nepali", "nl": "Dutch", "nn": "Nynorsk",
    "no": "Norwegian", "oc": "Occitan", "pa": "Panjabi", "pl": "Polish",
    "ps": "Pashto", "pt": "Portuguese", "ro": "Romanian", "ru": "Russian",
    "sa": "Sanskrit", "sd": "Sindhi", "si": "Sinhala", "sk": "Slovak",
    "sl": "Slovenian", "sn": "Shona", "so": "Somali", "sq": "Albanian",
    "sr": "Serbian", "su": "Sundanese", "sv": "Swedish", "sw": "Swahili",
    "ta": "Tamil", "te": "Telugu", "tg": "Tajik", "th": "Thai",
    "tk": "Turkmen", "tl": "Tagalog", "tr": "Turkish", "tt": "Tatar",
    "uk": "Ukrainian", "ur": "Urdu", "uz": "Uzbek", "vi": "Vietnamese",
    "yi": "Yiddish", "yo": "Yoruba", "zh": "Chinese",
}


# --- WebSocket broadcast ---

async def broadcast_progress(update: ProgressUpdate) -> None:
    """Send progress update to all connected WebSocket clients."""
    global current_status
    current_status = update
    data = update.model_dump_json()
    disconnected: list[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_text(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        ws_clients.remove(ws)


def make_sync_progress_callback(loop: asyncio.AbstractEventLoop):
    """Create a thread-safe progress callback bound to the given event loop."""
    def _callback(update: ProgressUpdate) -> None:
        asyncio.run_coroutine_threadsafe(broadcast_progress(update), loop)
    return _callback


# --- REST Endpoints ---

@app.get("/api/system-info", response_model=SystemInfo)
async def get_system_info():
    """Return detected hardware capabilities and recommendations."""
    return detect_hardware()


@app.get("/api/languages")
async def get_languages():
    """Return all supported languages."""
    return {"languages": WHISPER_LANGUAGES}


@app.get("/api/models")
async def get_models():
    """Return available model sizes."""
    hw = detect_hardware()
    return {
        "available": ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"],
        "recommended": hw.recommended_model.value,
    }


@app.get("/api/status")
async def get_status():
    """Return current job status."""
    return current_status


@app.post("/api/cancel")
async def cancel_job():
    """Cancel the running transcription or video render job.

    The backend has at most one job in flight at a time, so we signal both
    cancel paths and let whichever is actually running pick it up.
    """
    if current_status.status in (JobStatus.IDLE, JobStatus.DONE, JobStatus.ERROR):
        return {"status": "no_job"}
    transcriber.cancel()
    cancel_render()
    await broadcast_progress(ProgressUpdate(status=JobStatus.IDLE, progress=0, message="Cancelled"))
    return {"status": "cancelled"}


@app.get("/api/serve-audio")
async def serve_audio(path: str):
    """Serve an audio file for the frontend player. Only serves files that exist."""
    p = Path(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(p)


@app.get("/api/video-info")
async def get_video_info(path: str):
    """Return display width, height, and fps for a video file using ffprobe.
    Accounts for rotation metadata so portrait videos are reported correctly."""
    import json, subprocess
    p = Path(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    ffprobe = os.environ.get("CAPFORGE_FFPROBE", "ffprobe")
    try:
        out = subprocess.check_output(
            [ffprobe, "-v", "quiet", "-print_format", "json",
             "-show_streams", "-select_streams", "v:0", str(p)],
            stderr=subprocess.DEVNULL, timeout=10,
        )
        data = json.loads(out)
        stream = data.get("streams", [{}])[0]
        width  = stream.get("width")
        height = stream.get("height")

        # Detect rotation. Priority: side_data_list Display Matrix > stream tags.
        # The correct key in ffprobe JSON is "side_data_type", not "type".
        rotation = 0
        for sd in stream.get("side_data_list", []):
            sd_type = sd.get("side_data_type", "") or sd.get("type", "")
            if "Display Matrix" in sd_type:
                try:
                    rotation = int(sd.get("rotation", 0))
                except (ValueError, TypeError):
                    pass
                break

        if rotation == 0:
            # Fallback: Android-style rotate tag in stream tags
            rotate_tag = stream.get("tags", {}).get("rotate", "0")
            try:
                rotation = int(rotate_tag)
            except (ValueError, TypeError):
                pass

        if abs(rotation) in (90, 270):
            width, height = height, width

        fps_raw = stream.get("r_frame_rate", "0/1")
        num, den = (int(x) for x in fps_raw.split("/"))
        fps = round(num / den, 3) if den else 0
        logger.info("video-info %s → %dx%d rotation=%d fps=%.3f", p.name, width, height, rotation, fps)
        return {"width": width, "height": height, "fps": fps}
    except Exception as e:
        logger.warning("video-info failed for %s: %s", path, e)
        return {"width": None, "height": None, "fps": None}


@app.post("/api/transcribe")
async def start_transcription(request: TranscribeRequest):
    """Start a transcription job. Runs in a background thread."""
    global current_result

    if current_status.status not in (JobStatus.IDLE, JobStatus.DONE, JobStatus.ERROR):
        raise HTTPException(status_code=409, detail="A transcription is already in progress")

    if not Path(request.audio_path).is_file():
        raise HTTPException(status_code=400, detail=f"Audio file not found: {request.audio_path}")

    # Reset
    current_result = None
    await broadcast_progress(ProgressUpdate(status=JobStatus.LOADING_MODEL, progress=0, message="Starting…"))

    # Run transcription in thread pool (it's CPU/GPU-bound)
    loop = asyncio.get_running_loop()
    progress_cb = make_sync_progress_callback(loop)
    try:
        result = await loop.run_in_executor(
            None,
            lambda: transcriber.transcribe(request, on_progress=progress_cb),
        )
        current_result = result

        # Auto-export if formats requested
        exported_files: list[str] = []
        if request.export_formats:
            await broadcast_progress(ProgressUpdate(
                status=JobStatus.EXPORTING, progress=95, message="Exporting files…"
            ))
            exported_files = _do_export(result, request.export_formats, request.output_dir, request.audio_path)

        await broadcast_progress(ProgressUpdate(
            status=JobStatus.DONE, progress=100,
            message="Done" + (f" — exported {len(exported_files)} file(s)" if exported_files else ""),
        ))
        return {"status": "ok", "segments": len(result.segments), "exported_files": exported_files}

    except TranscriptionCancelled:
        await broadcast_progress(ProgressUpdate(status=JobStatus.IDLE, progress=0, message="Cancelled"))
        return {"status": "cancelled"}
    except Exception as e:
        logger.exception("Transcription failed")
        friendly = explain(e)
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.ERROR, progress=0,
            message=friendly.title, detail=friendly.hint,
        ))
        raise HTTPException(
            status_code=400 if isinstance(e, FileNotFoundError) else 500,
            detail={"title": friendly.title, "hint": friendly.hint, "raw": str(e)},
        )


@app.get("/api/result")
async def get_result():
    """Return the latest transcription result."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    return current_result


@app.put("/api/result")
async def update_result(updated: TranscriptionResult):
    """Save edited transcription result (subtitle corrections)."""
    global current_result
    current_result = updated
    return {"status": "ok", "segments": len(updated.segments)}


@app.post("/api/export")
async def export_result(request: ExportRequest):
    """Export the latest transcription result to the requested formats."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result to export")

    output_dir = request.output_dir
    files = _do_export(current_result, request.formats, output_dir, current_result.audio_path)
    return {"status": "ok", "files": files}


# --- WebSocket ---

@app.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    """WebSocket endpoint for live progress updates."""
    await websocket.accept()
    ws_clients.append(websocket)
    # Send current status immediately
    await websocket.send_text(current_status.model_dump_json())
    try:
        while True:
            # Keep connection alive; client can send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in ws_clients:
            ws_clients.remove(websocket)


# --- Video render endpoint ---

@app.post("/api/render-video")
async def render_video(request: VideoRenderRequest):
    """Render a transparent subtitle overlay video from the current transcription."""
    global current_result

    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")

    if current_status.status in (
        JobStatus.LOADING_MODEL, JobStatus.TRANSCRIBING, JobStatus.ALIGNING,
        JobStatus.DIARIZING, JobStatus.RENDERING, JobStatus.ENCODING,
    ):
        raise HTTPException(status_code=409, detail="Another job is in progress")

    await broadcast_progress(ProgressUpdate(
        status=JobStatus.RENDERING, progress=0, message="Starting video render…"
    ))

    loop = asyncio.get_running_loop()
    progress_cb = make_sync_progress_callback(loop)
    try:
        custom_groups_dicts = None
        if request.custom_groups:
            custom_groups_dicts = [g.model_dump() for g in request.custom_groups]

        output_path = await loop.run_in_executor(
            None,
            lambda: render_subtitle_video(
                current_result,
                request.config,
                request.output_dir,
                on_progress=progress_cb,
                source_video_path=current_result.audio_path if request.config.render_mode == "baked" else None,
                custom_groups=custom_groups_dicts,
            ),
        )

        await broadcast_progress(ProgressUpdate(
            status=JobStatus.DONE, progress=100, message=f"Video rendered: {output_path}"
        ))
        return {"status": "ok", "file": output_path}

    except RenderCancelled:
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.IDLE, progress=0, message="Cancelled"
        ))
        return {"status": "cancelled"}
    except Exception as e:
        logger.exception("Video render failed")
        friendly = explain(e)
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.ERROR, progress=0,
            message=friendly.title, detail=friendly.hint,
        ))
        raise HTTPException(
            status_code=400 if isinstance(e, FileNotFoundError) else 500,
            detail={"title": friendly.title, "hint": friendly.hint, "raw": str(e)},
        )


# --- Export helpers ---

EXPORTERS = {
    ExportFormat.SRT_WORD: (export_srt_word, ".srt"),
    ExportFormat.SRT_STANDARD: (export_srt_standard, ".srt"),
    ExportFormat.JSON: (export_json, ".json"),
    ExportFormat.VTT: (export_vtt, ".vtt"),
    ExportFormat.SUBFORGE: (export_subforge, ".capforge"),
}

# Suffix overrides to avoid collision when both SRT formats are requested
_SRT_SUFFIXES = {
    ExportFormat.SRT_WORD: "_word.srt",
    ExportFormat.SRT_STANDARD: "_standard.srt",
}


def _do_export(
    result: TranscriptionResult,
    formats: list[ExportFormat],
    output_dir: str,
    audio_path: str,
) -> list[str]:
    """Write exported files and return list of output paths."""
    os.makedirs(output_dir, exist_ok=True)
    stem = Path(audio_path).stem
    both_srt = ExportFormat.SRT_WORD in formats and ExportFormat.SRT_STANDARD in formats
    written: list[str] = []

    for fmt in formats:
        exporter_fn, default_ext = EXPORTERS[fmt]
        if both_srt and fmt in _SRT_SUFFIXES:
            ext = _SRT_SUFFIXES[fmt]
        else:
            ext = default_ext
        out_path = Path(output_dir) / f"{stem}{ext}"
        content = exporter_fn(result)
        out_path.write_text(content, encoding="utf-8")
        written.append(str(out_path))
        logger.info("Exported: %s", out_path)

    return written


# --- Entry point for development ---

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
