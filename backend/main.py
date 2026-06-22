"""CapForge Backend — FastAPI server with REST + WebSocket."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import FileResponse

from backend.agent_bridge import (
    remove_discovery,
    resolve_port,
    resolve_token,
    token_matches,
    write_discovery,
)
from backend.engine.errors import explain
from backend.engine.hardware import detect_hardware
from backend.engine.moments import find_semantic_moments, find_transcript_moments
from backend.engine.transcriber import Transcriber, TranscriptionCancelled
from backend.exporters.ass_export import export_ass
from backend.exporters.frame_qa import analyze_layout, render_qa_frame_png
from backend.exporters.hyperframes_export import export_hyperframes
from backend.exporters.hyperframes_project import (
    export_hyperframes_project,
    hyperframes_workspace,
    resolve_output_dir,
)
from backend.exporters.hyperframes_render import (
    HyperframesRenderError,
    render_hyperframes_project,
    snapshot_hyperframes_project,
)
from backend.exporters.json_export import export_json
from backend.exporters.premiere_export import export_subforge
from backend.exporters.srt_standard import export_srt_standard
from backend.exporters.srt_word import export_srt_word
from backend.exporters.vtt_export import export_vtt
from backend.exporters.video_render import RenderCancelled, cancel_render, render_subtitle_video
from backend.models.schemas import (
    EffectClip,
    ExportFormat,
    ExportRequest,
    HyperframesRenderRequest,
    JobStatus,
    ProgressUpdate,
    SaveTemplateRequest,
    SystemInfo,
    TranscribeRequest,
    TranscriptionResult,
    VideoRenderConfig,
    VideoRenderRequest,
)
from backend.effect_templates import (
    apply_template,
    delete_template,
    list_templates,
    save_template,
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
# Agent/user effects timeline (logos, etc.). The HyperFrames render uses this
# when the request doesn't supply its own effects (the agent's placement path).
current_effects: list[EffectClip] = []

# Agent-authored caption component (HTML). Used when caption_style == "custom".
current_custom_caption_html: Optional[str] = None
ws_clients: list[WebSocket] = []

# Renderer-owned UI state (StudioSettings + groups), mirrored here so the agent
# can read what to change. Style/groups live in the renderer, not the backend —
# this is just a cache the renderer pushes to via PUT /api/ui-state.
current_ui_state: Optional[dict] = None

# Commands the agent may relay to the renderer over /ws/control.
AGENT_COMMAND_OPS = {"set_settings", "apply_preset", "set_word_overrides"}

# Per-session token gating the agent-only /api/agent/* endpoints. Minted once at
# import; written to the discovery file on startup so a local MCP server can read it.
AGENT_TOKEN = resolve_token()

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


async def broadcast_event(payload: dict) -> None:
    """Broadcast a non-progress control event (e.g. ``result_updated``).

    Progress messages are plain ``ProgressUpdate`` JSON with no ``type`` field;
    control events carry a ``type`` discriminator so the renderer can route them
    without disturbing the progress UI.
    """
    data = json.dumps(payload)
    disconnected: list[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_text(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in ws_clients:
            ws_clients.remove(ws)


# --- Agent control layer: discovery file + token auth ---

@app.on_event("startup")
async def _write_agent_discovery() -> None:
    """Publish {port, token} so a local MCP server can find and authenticate."""
    try:
        path = write_discovery(resolve_port(), AGENT_TOKEN)
        logger.info("Agent discovery file written: %s (port %s)", path, resolve_port())
    except Exception:
        logger.warning("Could not write agent discovery file", exc_info=True)


@app.on_event("shutdown")
async def _remove_agent_discovery() -> None:
    remove_discovery()


async def require_agent_token(
    x_capforge_agent_token: Optional[str] = Header(None),
) -> None:
    """FastAPI dependency: reject requests without a valid agent token."""
    if not token_matches(x_capforge_agent_token, AGENT_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing agent token")


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


# --- Agent endpoints (token-guarded; drive the live UI) ---

@app.get("/api/agent/result", dependencies=[Depends(require_agent_token)])
async def agent_get_result():
    """Agent read of the current transcript (same source as the UI)."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    return current_result


@app.put("/api/agent/result", dependencies=[Depends(require_agent_token)])
async def agent_put_result(updated: TranscriptionResult):
    """Agent write of the transcript. Broadcasts ``result_updated`` so the open
    renderer picks up the change live."""
    global current_result
    current_result = updated
    await broadcast_event({"type": "result_updated", "source": "agent"})
    return {"status": "ok", "segments": len(updated.segments)}


# --- UI-state mirror (renderer → backend cache → agent) ---

@app.put("/api/ui-state")
async def put_ui_state(state: dict):
    """Renderer mirrors its StudioSettings + groups here (no token — loopback UI)."""
    global current_ui_state
    current_ui_state = state
    return {"status": "ok"}


@app.get("/api/agent/ui-state", dependencies=[Depends(require_agent_token)])
async def agent_get_ui_state():
    """Agent read of the current renderer UI state (style + groups + presets)."""
    if current_ui_state is None:
        raise HTTPException(status_code=404, detail="No UI state available — open a transcription")
    return current_ui_state


@app.post("/api/agent/command", dependencies=[Depends(require_agent_token)])
async def agent_command(cmd: dict):
    """Relay a style/emphasis command to the renderer over /ws/control.

    Fire-and-forget: the renderer applies it to its own state (the source of
    truth for style); the agent can re-read /api/agent/ui-state to confirm.
    """
    op = cmd.get("op")
    if op not in AGENT_COMMAND_OPS:
        raise HTTPException(status_code=400, detail=f"Unknown command op: {op!r}")
    await broadcast_event({"type": "agent_command", "op": op, "payload": cmd.get("payload", {})})
    return {"status": "ok"}


# --- Vision QA: single-frame render so the agent can SEE its output ---

def _agent_frame_inputs() -> tuple[VideoRenderConfig, Optional[list]]:
    """Resolve the (config, custom_groups) the renderer last mirrored."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    render = (current_ui_state or {}).get("render")
    if not render or "config" not in render:
        raise HTTPException(
            status_code=409,
            detail="No render config mirrored yet — open the results screen in CapForge",
        )
    config = VideoRenderConfig(**render["config"])
    return config, render.get("custom_groups")


@app.post("/api/render-frame", dependencies=[Depends(require_agent_token)])
async def agent_render_frame(req: dict):
    """Render the subtitle frame at time ``t`` as a PNG the agent can view.

    Uses the live mirrored style. ``composite`` (default true) overlays the
    captions on the actual video frame so the agent can judge text-over-face
    and contrast; false returns the transparent overlay only.
    """
    config, custom_groups = _agent_frame_inputs()
    t = float(req.get("t", 0.0))
    composite = bool(req.get("composite", True))
    source = current_result.audio_path if composite else None
    loop = asyncio.get_running_loop()
    png = await loop.run_in_executor(
        None,
        lambda: render_qa_frame_png(current_result, config, t, composite, custom_groups, source),
    )
    return Response(content=png, media_type="image/png")


@app.post("/api/agent/check-layout", dependencies=[Depends(require_agent_token)])
async def agent_check_layout(req: dict):
    """Mechanical layout read at ``t``: caption bbox, frame-edge contact, and
    advisory safe-zone violations (platform: tiktok/reels/shorts/off)."""
    config, custom_groups = _agent_frame_inputs()
    t = float(req.get("t", 0.0))
    platform = str(req.get("platform", "off"))
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, lambda: analyze_layout(current_result, config, t, custom_groups, platform)
    )


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


# --- HyperFrames composition endpoint ---

@app.post("/api/export-hyperframes")
async def export_hyperframes_endpoint(request: HyperframesRenderRequest):
    """Generate a HyperFrames composition from the current result; optionally render it.

    Mirrors /api/render-video: runs in an executor, broadcasts progress over
    /ws/progress, and resolves only when the work finishes.
    """
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")

    if current_status.status in (
        JobStatus.LOADING_MODEL, JobStatus.TRANSCRIBING, JobStatus.ALIGNING,
        JobStatus.DIARIZING, JobStatus.RENDERING, JobStatus.ENCODING,
    ):
        raise HTTPException(status_code=409, detail="Another job is in progress")

    # Resolve caption styling + groups. With use_ui_config (the agent's render
    # path) use what the renderer last mirrored so the output matches the live
    # UI; otherwise use the config/groups carried in the request (panel path).
    config = request.config
    custom_groups_dicts = (
        [g.model_dump() for g in request.custom_groups] if request.custom_groups else None
    )
    if request.use_ui_config:
        config, ui_groups = _agent_frame_inputs()
        if ui_groups is not None:
            custom_groups_dicts = ui_groups

    await broadcast_progress(ProgressUpdate(
        status=JobStatus.RENDERING, progress=0, message="Building HyperFrames composition…"
    ))

    loop = asyncio.get_running_loop()
    sync_progress = make_sync_progress_callback(loop)

    def on_progress(pct: float, message: str) -> None:
        sync_progress(ProgressUpdate(
            status=JobStatus.RENDERING,
            progress=max(0.0, min(100.0, pct)),
            message=message,
        ))

    # Prefer effects supplied in the request (frontend panel); otherwise fall
    # back to the server-side timeline the agent populates via /api/agent/effects.
    effects_source = request.effects if request.effects is not None else current_effects
    effects_dicts = [e.model_dump() for e in effects_source] if effects_source else None

    # Resolve where the user actually wants the output: an absolute dir they
    # chose, or — for an empty/relative value like the schema default "output" —
    # the folder next to the source file. Never the opaque backend CWD.
    out_dir = resolve_output_dir(request.output_dir, current_result.audio_path)
    stem = Path(current_result.audio_path).stem or "capforge"
    ext = ".webm" if request.video_format == "webm" else ".mp4"

    def _scaffold(into: str) -> str:
        return export_hyperframes_project(
            current_result,
            config,
            into,
            source_video_path=current_result.audio_path,
            custom_groups=custom_groups_dicts,
            effects=effects_dicts,
            caption_html=current_custom_caption_html,
        )

    def _work() -> dict:
        if not request.render:
            # Open-in-Studio: scaffold into the canonical per-source workspace so
            # the Studio and the MCP agent's frame preview share ONE project
            # folder. The Studio serves this dir; the agent re-scaffolds the same
            # dir, so its edits surface on a Studio refresh instead of diverging.
            project_dir = _scaffold(hyperframes_workspace(current_result.audio_path))
            return {"project": project_dir, "file": None}

        # Render-to-file: scaffold into a throwaway temp dir so the user's folder
        # isn't littered with the intermediate composition — only the finished
        # video lands in out_dir. The temp dir is removed once rendering is done.
        scratch = tempfile.mkdtemp(prefix="capforge-hf-")
        try:
            project_dir = _scaffold(scratch)
            out_path = str(Path(out_dir) / f"{stem}_hyperframes{ext}")
            file = render_hyperframes_project(
                project_dir, out_path,
                quality=request.quality, video_format=request.video_format,
                on_progress=on_progress,
            )
            return {"project": None, "file": file}
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    try:
        result = await loop.run_in_executor(None, _work)
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.DONE, progress=100,
            message=("HyperFrames render ready" if request.render else "HyperFrames project ready"),
        ))
        return {"status": "ok", **result}

    except HyperframesRenderError as e:
        logger.warning("HyperFrames render unavailable/failed: %s", e)
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.ERROR, progress=0,
            message="HyperFrames render failed", detail=str(e),
        ))
        raise HTTPException(
            status_code=400,
            detail={"title": "HyperFrames render failed", "hint": str(e), "raw": str(e)},
        )
    except Exception as e:
        logger.exception("HyperFrames export failed")
        friendly = explain(e)
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.ERROR, progress=0,
            message=friendly.title, detail=friendly.hint,
        ))
        raise HTTPException(
            status_code=500,
            detail={"title": friendly.title, "hint": friendly.hint, "raw": str(e)},
        )


# --- Agent effects endpoints ---

@app.get("/api/effects")
async def get_effects_public():
    """Read the current effects timeline (open endpoint for the renderer's live mirror)."""
    return {"effects": [e.model_dump() for e in current_effects]}


@app.get("/api/agent/effects", dependencies=[Depends(require_agent_token)])
async def get_effects():
    """Return the current effects timeline."""
    return {"effects": [e.model_dump() for e in current_effects]}


@app.post("/api/agent/effects", dependencies=[Depends(require_agent_token)])
async def add_effect(effect: EffectClip):
    """Append an effect clip (id auto-generated if absent). Returns the stored effect."""
    global current_effects
    current_effects = [*current_effects, effect]
    await broadcast_event({"type": "effects_updated"})
    return {"status": "ok", "effect": effect.model_dump(), "count": len(current_effects)}


@app.put("/api/agent/effects", dependencies=[Depends(require_agent_token)])
async def replace_effects(effects: list[EffectClip]):
    """Replace the entire effects timeline."""
    global current_effects
    current_effects = list(effects)
    await broadcast_event({"type": "effects_updated"})
    return {"status": "ok", "count": len(current_effects)}


@app.delete("/api/agent/effects/{effect_id}", dependencies=[Depends(require_agent_token)])
async def remove_effect(effect_id: str):
    """Remove an effect clip by id."""
    global current_effects
    before = len(current_effects)
    current_effects = [e for e in current_effects if e.id != effect_id]
    await broadcast_event({"type": "effects_updated"})
    return {"status": "ok", "removed": before - len(current_effects), "count": len(current_effects)}


@app.get("/api/agent/find-moments", dependencies=[Depends(require_agent_token)])
async def find_moments_endpoint(query: str):
    """Find transcript moments matching `query` — used to place effects at spoken words."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    return {"matches": find_transcript_moments(current_result, query)}


@app.get("/api/agent/find-semantic-moments", dependencies=[Depends(require_agent_token)])
async def find_semantic_moments_endpoint(kind: str):
    """Detect moments by category (numbers | cta | speaker_change) for placing
    kinetic-stat / lower-third effects without a literal phrase."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    try:
        return {"matches": find_semantic_moments(current_result, kind)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- Reusable effect templates (cross-project look library) ---
# Store CRUD is open (loopback app-data the user owns; the renderer carries no
# agent token) — consistent with the open /api/effects + /api/render-* posture.
# Only the apply path, which mutates the live timeline, sits under /api/agent.

@app.get("/api/effect-templates")
async def list_effect_templates_endpoint():
    """Saved reusable effect templates (used by the renderer + the agent)."""
    return {"templates": list_templates()}


@app.post("/api/effect-templates")
async def save_effect_template_endpoint(req: SaveTemplateRequest):
    """Save an effect as a reusable template — `effect` inline, or `effect_id`
    to snapshot a clip already on the timeline."""
    if req.effect is not None:
        effect = req.effect.model_dump()
    elif req.effect_id:
        match = next((e for e in current_effects if e.id == req.effect_id), None)
        if match is None:
            raise HTTPException(status_code=404, detail=f"No effect with id {req.effect_id!r}")
        effect = match.model_dump()
    else:
        raise HTTPException(status_code=400, detail="Provide `effect` or `effect_id`")
    try:
        template = save_template(req.name, effect)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "template": template}


@app.delete("/api/effect-templates/{name}")
async def delete_effect_template_endpoint(name: str):
    """Delete a saved template by name."""
    return {"status": "ok", "removed": delete_template(name)}


@app.post("/api/agent/effect-templates/{name}/apply", dependencies=[Depends(require_agent_token)])
async def apply_effect_template_endpoint(name: str, start: float = 0.0, duration: float = 2.0):
    """Instantiate a saved template onto the live effects timeline at `start`."""
    global current_effects
    try:
        clip = apply_template(name, start, duration)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    current_effects = [*current_effects, clip]
    await broadcast_event({"type": "effects_updated"})
    return {"status": "ok", "effect": clip.model_dump(), "count": len(current_effects)}


@app.get("/api/caption-styles")
async def caption_styles_endpoint():
    """Available caption styles: 'classic' + registry styles (+ the agent's custom
    style when one has been authored)."""
    from backend.exporters.hyperframes_captions import list_caption_styles
    styles = list_caption_styles()
    if current_custom_caption_html:
        styles.append({"name": "custom", "title": "Custom (agent)"})
    return {"styles": styles}


@app.get("/api/custom-caption-contract")
async def custom_caption_contract_endpoint():
    """The contract + a starter template for authoring a caption style from scratch."""
    from backend.exporters.hyperframes_captions import custom_caption_contract
    return custom_caption_contract()


@app.post("/api/agent/custom-caption", dependencies=[Depends(require_agent_token)])
async def set_custom_caption(payload: dict):
    """Store an agent-authored caption component (HTML). Validated here so the
    agent gets immediate, specific feedback before it ever renders."""
    from backend.exporters.hyperframes_captions import (
        CaptionStyleError,
        validate_custom_caption,
    )
    global current_custom_caption_html
    html = payload.get("html")
    if not isinstance(html, str):
        raise HTTPException(status_code=400, detail="Provide `html` (string).")
    try:
        validate_custom_caption(html)
    except CaptionStyleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    current_custom_caption_html = html
    return {"status": "ok", "bytes": len(html)}


@app.get("/api/agent/custom-caption", dependencies=[Depends(require_agent_token)])
async def get_custom_caption():
    """Return the stored custom caption HTML (or null) — lets the agent read back
    what it set / iterate on it."""
    return {"html": current_custom_caption_html}


@app.post("/api/agent/preview-hyperframes-frame", dependencies=[Depends(require_agent_token)])
async def preview_hyperframes_frame(req: dict):
    """Render ONE frame of the HyperFrames composition (current caption style +
    placed effects, over the video) at time `t` and return it as PNG.

    A fast single-frame preview (`hyperframes snapshot`, seconds not minutes) so
    the agent can SEE a custom/native caption style or an effect placement without
    a full render. Uses the live mirrored config (same as the agent render path).
    """
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    t = float(req.get("t", 0.0))
    config, ui_groups = _agent_frame_inputs()
    effects_dicts = [e.model_dump() for e in current_effects] if current_effects else None
    loop = asyncio.get_running_loop()

    def _work() -> bytes:
        # Scaffold into the SAME canonical workspace the Studio serves, so a
        # preview re-generates the open Studio's project (not a separate copy).
        project_dir = export_hyperframes_project(
            current_result,
            config,
            hyperframes_workspace(current_result.audio_path),
            source_video_path=current_result.audio_path,
            custom_groups=ui_groups,
            effects=effects_dicts,
            caption_html=current_custom_caption_html,
        )
        return snapshot_hyperframes_project(project_dir, t)

    try:
        png = await loop.run_in_executor(None, _work)
    except HyperframesRenderError as e:
        logger.warning("HyperFrames preview failed: %s", e)
        raise HTTPException(
            status_code=400,
            detail={"title": "HyperFrames preview failed", "hint": str(e), "raw": str(e)},
        )
    return Response(content=png, media_type="image/png")


# --- Export helpers ---

EXPORTERS = {
    ExportFormat.SRT_WORD: (export_srt_word, ".srt"),
    ExportFormat.SRT_STANDARD: (export_srt_standard, ".srt"),
    ExportFormat.JSON: (export_json, ".json"),
    ExportFormat.VTT: (export_vtt, ".vtt"),
    ExportFormat.ASS: (export_ass, ".ass"),
    ExportFormat.SUBFORGE: (export_subforge, ".capforge"),
    # Distinct suffix so it never collides with the plain JSON export's ".json".
    ExportFormat.HYPERFRAMES: (export_hyperframes, "_hyperframes.json"),
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
    uvicorn.run("backend.main:app", host="127.0.0.1", port=53421, reload=True)
