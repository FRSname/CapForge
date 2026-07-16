"""CapForge Backend — FastAPI server with REST + WebSocket."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import FileResponse

from backend.agent_bridge import (
    discovery_path,
    remove_discovery,
    resolve_local_token,
    resolve_port,
    resolve_token,
    token_matches,
    write_discovery,
)
from backend.engine.errors import explain
from backend.engine.hardware import detect_hardware
from backend.engine.moments import find_semantic_moments, find_transcript_moments
from backend.engine.system_fonts import list_system_font_families
from backend.engine.transcriber import Transcriber, TranscriptionCancelled
from backend.exporters.ass_export import export_ass
from backend.exporters.frame_qa import analyze_layout, render_qa_frame_png
from backend.exporters.hyperframes_export import export_hyperframes
from backend.exporters.hyperframes_project import (
    clear_scaffold_fingerprint,
    coauthor_project_dir,
    ensure_hyperframes_project,
    export_hyperframes_project,
    hyperframes_workspace,
    read_coauthor_marker,
    resolve_output_dir,
    seed_coauthor_project,
    sync_companions,
    write_coauthor_marker,
)
from backend.exporters.hyperframes_render import (
    HyperframesCancelledError,
    HyperframesRenderError,
    render_hyperframes_project,
    run_hyperframes_cli,
    snapshot_hyperframes_project,
)
from backend.exporters.hyperframes_version import (
    check_cli_compat,
    reset_version_cache,
)
from backend.exporters.json_export import export_json
from backend.exporters.premiere_export import export_subforge
from backend.exporters.srt_standard import export_srt_standard
from backend.exporters.srt_word import export_srt_word
from backend.exporters.vtt_export import export_vtt
from backend.exporters.video_render import RenderCancelled, cancel_render, render_subtitle_video
from backend.models.schemas import (
    ExportFormat,
    ExportRequest,
    HyperframesRenderRequest,
    JobStatus,
    ProgressUpdate,
    RealignRequest,
    RealignResponse,
    SystemInfo,
    TranscribeRequest,
    TranscriptionResult,
    VideoRenderConfig,
    VideoRenderRequest,
)
from backend import workspace_fs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CapForge", version="0.1.0")

# Allow Electron renderer to call us.
#
# allow_origins stays "*" deliberately: the two file-reading endpoints are gated
# by a per-launch token (see LOCAL_TOKEN / require_local_token), not by origin,
# and NO route uses cookies or credentialed CORS (allow_credentials is left at its
# default False). CORS "*" is only unsafe when paired with credentials — which we
# never do. Tightening origins would break the packaged renderer, whose requests
# come from a file:// context (Origin: null) and, in dev, from localhost:5173.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Shared state ---
#
# Concurrency note: current_result, current_coauthor, and
# ws_clients below are plain module globals mutated directly by request/WS
# handlers, with no asyncio.Lock guarding them. This is an accepted invariant,
# not an oversight: CapForge is a single-user, loopback-only app, uvicorn runs
# this backend single-process/single-worker, and every handler that touches
# this state runs coroutines on one asyncio event loop — mutations only
# interleave at `await` points, never preempt mid-statement. Cross-request
# interleaving (e.g. two requests racing to replace current_result) is judged
# low-risk for a local desktop tool with one human driving one session. Do not
# add locking speculatively; if a concrete corrupting interleaving is found,
# write a failing test that demonstrates it before reaching for asyncio.Lock.

transcriber = Transcriber()
current_result: Optional[TranscriptionResult] = None
current_status = ProgressUpdate(status=JobStatus.IDLE, progress=0, message="Ready")

# Agent-authored caption component (HTML). Used when caption_style == "custom".
current_custom_caption_html: Optional[str] = None

# Co-author mode: when True the connected agent owns the HyperFrames project's
# index.html + compositions/ + assets/. CapForge stops regenerating index.html
# (preview/render target the stable workspace as-is) and only refreshes the
# companion files it owns via sync_companions. See docs/plans/hyperframes-open-coauthor.md.
current_coauthor: bool = False
ws_clients: list[WebSocket] = []


def coauthor_active(project_dir) -> bool:
    """Durable check for "is co-author mode on for this project?".

    ``current_coauthor`` is the in-memory fast path but is lost on a backend
    crash/restart. The per-workspace marker written by ``write_coauthor_marker`` is
    the durable truth: if it says active while the global is stale-False, self-heal
    the global so the rest of the request (and later ones) take the co-author path
    and never re-scaffold over the agent's index.html. Rehydration is lazy and
    per-source — there is deliberately no startup scan of all workspaces.
    """
    global current_coauthor
    if current_coauthor:
        return True
    marker = read_coauthor_marker(project_dir)
    if marker is not None and marker.get("active") is True:
        current_coauthor = True  # self-heal the fast path
        return True
    return False

# Cancellation signal for the single in-flight HyperFrames render. Set by
# POST /api/render-cancel; the executor thread polls it and kills the CLI's
# process tree. None between renders. See render_hyperframes_project(cancel_event=).
current_hf_cancel: Optional[threading.Event] = None

# Renderer-owned UI state (StudioSettings + groups), mirrored here so the agent
# can read what to change. Style/groups live in the renderer, not the backend —
# this is just a cache the renderer pushes to via PUT /api/ui-state.
current_ui_state: Optional[dict] = None

# Commands the agent may relay to the renderer over /ws/control.
AGENT_COMMAND_OPS = {"set_settings", "apply_preset", "set_word_overrides"}

# Render-approval gate. An agent-triggered final HyperFrames render must be
# approved by the human in the app before it starts — the agent should preview +
# iterate first. Maps an approval id -> a Future the UI resolves (True=approve,
# False=cancel) via POST /api/render-approval. User-initiated panel renders are
# NOT gated (the user already clicked Render).
pending_render_approvals: dict[str, "asyncio.Future[bool]"] = {}
RENDER_APPROVAL_TIMEOUT = 600.0  # seconds the agent waits for the user to decide

# Per-session token gating the agent-only /api/agent/* endpoints. Minted once at
# import; written to the discovery file on startup so a local MCP server can read it.
AGENT_TOKEN = resolve_token()

# Per-launch token gating the *local media* endpoints (/api/serve-audio,
# /api/video-info). Those stream arbitrary local files to the player, so without
# a gate any local process (or a stray browser page) hitting 127.0.0.1 could read
# them. The Electron launcher mints CAPFORGE_LOCAL_TOKEN per spawn and hands it to
# the renderer over IPC; the renderer passes it as a ?token= query param because
# media elements (<video src>, WaveSurfer url) cannot set request headers. Never
# persisted, never logged. See require_local_token / _is_servable_path below.
LOCAL_TOKEN = resolve_local_token()

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
        except Exception as exc:
            logger.warning("Dropping WS client %r: send failed (%s)", ws, exc)
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
        except Exception as exc:
            logger.warning("Dropping WS client %r: send failed (%s)", ws, exc)
            disconnected.append(ws)
    for ws in disconnected:
        if ws in ws_clients:
            ws_clients.remove(ws)


# --- Agent control layer: discovery file + token auth ---

@app.on_event("startup")
async def _write_agent_discovery() -> None:
    """Publish {port, token} so a local MCP server can find and authenticate."""
    # The local media token must always be present (resolve_local_token mints one
    # if the launcher didn't). Warn loudly if we're clearly Electron-spawned
    # (CAPFORGE_PORT is set) yet the launcher didn't inject CAPFORGE_LOCAL_TOKEN —
    # that means a wiring bug and the renderer would 401 on every media request.
    if not LOCAL_TOKEN:
        raise RuntimeError("CAPFORGE local media token is empty; refusing to start")
    if os.environ.get("CAPFORGE_PORT") and not os.environ.get("CAPFORGE_LOCAL_TOKEN"):
        logger.warning(
            "CAPFORGE_LOCAL_TOKEN missing though launched by Electron; "
            "the renderer will be unable to authenticate media requests"
        )
    try:
        path = write_discovery(resolve_port(), AGENT_TOKEN)
        logger.info("Agent discovery file written: %s (port %s)", path, resolve_port())
    except Exception:
        # Non-fatal: startup must still succeed without the discovery file, but
        # this is the first place to look when "MCP can't connect" is reported —
        # log at error level with the target path so it's diagnosable from
        # backend.log without reproducing the failure.
        logger.error(
            "Could not write agent discovery file (target: %s)",
            discovery_path(),
            exc_info=True,
        )


@app.on_event("shutdown")
async def _remove_agent_discovery() -> None:
    remove_discovery()


async def require_agent_token(
    x_capforge_agent_token: Optional[str] = Header(None),
) -> None:
    """FastAPI dependency: reject requests without a valid agent token."""
    if not token_matches(x_capforge_agent_token, AGENT_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing agent token")


async def require_local_token(
    token: Optional[str] = Query(None),
    x_capforge_local_token: Optional[str] = Header(None),
    x_capforge_agent_token: Optional[str] = Header(None),
) -> None:
    """FastAPI dependency gating the local media endpoints.

    The token arrives as a ``?token=`` query param (media elements can't set
    headers) or, for ``fetch`` callers, the ``X-CapForge-Local-Token`` header.
    The MCP client authenticates with the ``X-CapForge-Agent-Token`` header
    instead — that value is also accepted here so an authorised MCP client
    isn't locked out of these routes. Constant-time compare; a missing token
    never matches.
    """
    provided = token or x_capforge_local_token or x_capforge_agent_token
    if token_matches(provided, LOCAL_TOKEN) or token_matches(provided, AGENT_TOKEN):
        return
    raise HTTPException(status_code=401, detail="Invalid or missing local token")


def _resolve_real(path) -> Optional[Path]:
    """Fully resolve ``path`` (expanduser + realpath, following symlinks) or
    return None if it can't be resolved. Resolving before the allowlist check is
    what stops a symlink inside the workspace from escaping it."""
    try:
        return Path(path).expanduser().resolve()
    except (OSError, RuntimeError, ValueError):
        return None


def _is_servable_path(path: str) -> bool:
    """Allowlist gate for the media endpoints.

    Returns True only when ``path`` is a file the renderer legitimately needs:
      1. the current transcription source (``current_result.audio_path``), or
      2. a file inside that source's HyperFrames workspace.
    Everything else — i.e. an arbitrary filesystem path — is refused. Both sides
    are realpath-resolved so symlinks can't be used to climb out of the
    workspace. This mirrors the containment idea in
    ``workspace_fs.resolve_in_workspace``; that helper takes *relative* paths
    while these endpoints receive *absolute* ones, hence the explicit
    realpath-match / parent-containment check here rather than a direct reuse.
    """
    if current_result is None or not current_result.audio_path:
        return False
    target = _resolve_real(path)
    if target is None:
        return False
    # 1) exact current source file
    source = _resolve_real(current_result.audio_path)
    if source is not None and target == source:
        return True
    # 2) inside the source's HyperFrames workspace
    workspace = _resolve_real(hyperframes_workspace(current_result.audio_path))
    if workspace is not None and (target == workspace or workspace in target.parents):
        return True
    return False


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


@app.get("/api/fonts/system", dependencies=[Depends(require_local_token)])
async def get_system_fonts():
    """Return installed font families that the local renderer can resolve."""
    return {"fonts": await asyncio.to_thread(list_system_font_families)}


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
    if current_hf_cancel is not None:
        current_hf_cancel.set()
    await broadcast_progress(ProgressUpdate(status=JobStatus.IDLE, progress=0, message="Cancelled"))
    return {"status": "cancelled"}


@app.post("/api/render-cancel")
async def render_cancel():
    """Cancel the in-flight HyperFrames render (kills the CLI process tree).

    Distinct from /api/cancel so the renderer can stop a long HyperFrames render
    without also signalling the transcriber. No-op when nothing is rendering.
    """
    if current_hf_cancel is None:
        return {"status": "no_job"}
    current_hf_cancel.set()
    return {"status": "cancelling"}


@app.get("/api/serve-audio", dependencies=[Depends(require_local_token)])
async def serve_audio(path: str):
    """Serve the current source media to the frontend player.

    Auth + path-allowlisted: the caller must present a valid local token and the
    path must be the active transcription source (or a file in its workspace) —
    arbitrary filesystem reads are refused. ``FileResponse`` preserves HTTP Range
    support, which WaveSurfer / the <video> element rely on for seeking."""
    if not _is_servable_path(path):
        raise HTTPException(status_code=403, detail="Path not permitted")
    p = Path(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(p)


@app.get("/api/video-info", dependencies=[Depends(require_local_token)])
async def get_video_info(path: str):
    """Return display width, height, and fps for a video file using ffprobe.
    Accounts for rotation metadata so portrait videos are reported correctly.

    Auth + path-allowlisted identically to /api/serve-audio."""
    import json, subprocess
    if not _is_servable_path(path):
        raise HTTPException(status_code=403, detail="Path not permitted")
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
        logger.warning("video-info failed for %s: %s", p.name, e)
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


@app.put("/api/result", dependencies=[Depends(require_local_token)])
async def update_result(updated: TranscriptionResult):
    """Save edited transcription result (subtitle corrections).

    Auth-gated identically to the media endpoints: ``current_result`` is the
    allowlist anchor for /api/serve-audio, so an unauthenticated PUT here would
    let an attacker repoint that anchor at any file (then read it) or wipe the
    user's transcription. The renderer sends the local token via the
    ``X-CapForge-Local-Token`` header; an authorised agent's token is also
    accepted (see require_local_token)."""
    global current_result
    current_result = updated
    return {"status": "ok", "segments": len(updated.segments)}


@app.post("/api/realign")
async def realign_segments(request: RealignRequest) -> RealignResponse:
    """Re-run WhisperX forced alignment on edited segments.

    Stateless: returns re-timed segments without touching the stored result —
    the renderer owns applying them. The audio path always comes from the
    current transcription (never the client), so this adds no file-read surface.
    """
    if current_status.status not in (JobStatus.IDLE, JobStatus.DONE, JobStatus.ERROR):
        raise HTTPException(status_code=409, detail="A transcription is already in progress")
    if current_result is None or not current_result.audio_path:
        raise HTTPException(status_code=400, detail="No transcription loaded — nothing to align against")
    audio_path = current_result.audio_path
    if not Path(audio_path).is_file():
        raise HTTPException(status_code=400, detail=f"Original media file not found: {audio_path}")
    language = request.language or current_result.language
    if not language:
        raise HTTPException(status_code=400, detail="No language available for alignment")

    loop = asyncio.get_running_loop()
    try:
        segments = await loop.run_in_executor(
            None,
            lambda: transcriber.realign_segments(request.segments, audio_path, language),
        )
    except Exception as e:
        logger.exception("Realign failed")
        friendly = explain(e)
        raise HTTPException(
            status_code=500,
            detail={"title": friendly.title, "hint": friendly.hint, "raw": str(e)},
        )
    return RealignResponse(segments=segments)


# --- Agent endpoints (token-guarded; drive the live UI) ---

# response_model=None: FastAPI otherwise treats the return annotation as the
# response_model and re-coerces the segments-only dict back through
# TranscriptionResult, re-adding the stripped `words`. We return the value verbatim.
@app.get("/api/agent/result", response_model=None, dependencies=[Depends(require_agent_token)])
async def agent_get_result(include_words: bool = True) -> TranscriptionResult | dict[str, Any]:
    """Agent read of the current transcript (same source as the UI).

    ``include_words=false`` returns a segments-only shape (each segment keeps
    ``text``/``start``/``end``/``speaker`` but drops its per-word timing array),
    which kills the LLM token blowout on review/grammar passes over long
    transcripts — see docs/plans/mcp-transcript-editing-ux.md Phase 2.
    """
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    if include_words:
        return current_result
    data = current_result.model_dump()
    for seg in data.get("segments", []):
        seg.pop("words", None)
    return data


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


async def _await_render_approval(meta: dict) -> bool:
    """Ask the connected UI to approve an agent-triggered final render and block
    until the human decides (or we time out). Returns True to proceed, False to
    cancel. Refuses outright if no UI is connected to approve."""
    if not ws_clients:
        raise HTTPException(
            status_code=409,
            detail="Open CapForge to approve the render — no UI is connected.",
        )
    approval_id = uuid.uuid4().hex
    loop = asyncio.get_running_loop()
    fut: "asyncio.Future[bool]" = loop.create_future()
    pending_render_approvals[approval_id] = fut
    await broadcast_event({"type": "render_approval_request", "id": approval_id, **meta})
    try:
        return await asyncio.wait_for(fut, timeout=RENDER_APPROVAL_TIMEOUT)
    except asyncio.TimeoutError:
        return False
    finally:
        pending_render_approvals.pop(approval_id, None)
        await broadcast_event({"type": "render_approval_resolved", "id": approval_id})


@app.post("/api/render-approval")
async def render_approval(body: dict):
    """The renderer (the human) approves or cancels a pending agent render request.

    Loopback UI endpoint (no token) — mirrors PUT /api/ui-state. `body` carries
    `{id, approved}` where `id` came from a `render_approval_request` event.
    """
    approval_id = body.get("id")
    approved = bool(body.get("approved", False))
    fut = pending_render_approvals.get(approval_id) if approval_id else None
    if fut is not None and not fut.done():
        fut.set_result(approved)
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


@app.post("/api/export", dependencies=[Depends(require_local_token)])
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

@app.post("/api/render-video", dependencies=[Depends(require_local_token)])
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

@app.get("/api/hyperframes/status")
async def hyperframes_status(probe: bool = False):
    """Preflight the HyperFrames CLI the backend would drive.

    Reports the detected CLI version and whether it is compatible, so the panel
    can refuse a render up front instead of failing mid-CLI. ``compat_ok`` is a
    tri-state: ``true`` (compatible), ``false`` (too old — ``compat_reasons[0]``
    carries the remediation message), or ``null`` (version unknown / probe failed
    — the render still proceeds, degrading gracefully). Pass ``?probe=1`` to force
    a fresh probe (e.g. right after a re-provision); otherwise the cached read is
    reused. Runs the probe in an executor so the event loop isn't blocked.
    """
    if probe:
        reset_version_cache()
    loop = asyncio.get_running_loop()
    compat = await loop.run_in_executor(None, check_cli_compat)
    return {
        "cli_version": compat["version"],
        "compat_ok": compat["ok"],
        "compat_reasons": compat["reasons"],
    }


@app.post("/api/export-hyperframes", dependencies=[Depends(require_local_token)])
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

    # Human-in-the-loop gate: an agent-triggered FINAL render (use_ui_config is the
    # agent path) must be approved in the app first. The user's own panel render
    # (use_ui_config False) is already a deliberate click and is not gated.
    if request.render and request.use_ui_config:
        approved = await _await_render_approval({
            "quality": request.quality,
            "video_format": request.video_format,
        })
        if not approved:
            return {"status": "cancelled", "project": None, "file": None,
                    "message": "Render cancelled — keep iterating with previews."}

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

    # Publish a cancel signal for this render so POST /api/render-cancel can stop
    # the CLI's process tree mid-flight. Cleared in the finally below.
    global current_hf_cancel
    cancel_event = threading.Event()
    current_hf_cancel = cancel_event

    loop = asyncio.get_running_loop()
    sync_progress = make_sync_progress_callback(loop)

    def on_progress(pct: float, message: str) -> None:
        sync_progress(ProgressUpdate(
            status=JobStatus.RENDERING,
            progress=max(0.0, min(100.0, pct)),
            message=message,
        ))

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
            caption_html=current_custom_caption_html,
        )

    def _coauthor_project() -> str:
        """Resolve the agent-owned project in the stable workspace, refreshing the
        CapForge-owned companions (transcript/captions) WITHOUT regenerating the
        agent's index.html. Seeds a starter project if the agent hasn't one yet."""
        workspace = hyperframes_workspace(current_result.audio_path)
        project_dir = coauthor_project_dir(current_result, workspace)
        if (project_dir / "index.html").exists():
            sync_companions(
                current_result, config, str(project_dir),
                source_video_path=current_result.audio_path,
                custom_groups=custom_groups_dicts,
                caption_html=current_custom_caption_html,
            )
            return str(project_dir)
        return _scaffold(workspace)

    def _work() -> dict:
        # Co-author mode: the agent owns index.html, so render/preview the project
        # as-authored in the stable workspace — never re-scaffold or rmtree it.
        # coauthor_active() consults the durable marker so a backend restart can't
        # silently drop mode and re-scaffold over the agent's work.
        coauthor_dir = coauthor_project_dir(
            current_result, hyperframes_workspace(current_result.audio_path)
        )
        if coauthor_active(coauthor_dir):
            project_dir = _coauthor_project()
            if not request.render:
                return {"project": project_dir, "file": None}
            out_path = str(Path(out_dir) / f"{stem}_hyperframes{ext}")
            file = render_hyperframes_project(
                project_dir, out_path,
                quality=request.quality, video_format=request.video_format,
                fps=config.fps,
                on_progress=on_progress,
                cancel_event=cancel_event,
            )
            return {"project": None, "file": file}

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
                fps=config.fps,
                on_progress=on_progress,
                cancel_event=cancel_event,
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

    except HyperframesCancelledError as e:
        # User-initiated stop — not an error. Return IDLE so the panel resets.
        logger.info("HyperFrames render cancelled by user.")
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.IDLE, progress=0, message="Render cancelled",
            code=e.code,
        ))
        return {"status": "cancelled", "code": e.code, "project": None, "file": None,
                "message": "Render cancelled."}
    except HyperframesRenderError as e:
        # Machine-readable classifier (cli_unavailable/cli_incompatible/timeout/…)
        # rides alongside the existing title/hint/raw fields — additive, not a rename.
        logger.warning("HyperFrames render unavailable/failed [%s]: %s", e.code, e)
        await broadcast_progress(ProgressUpdate(
            status=JobStatus.ERROR, progress=0,
            message="HyperFrames render failed", detail=str(e), code=e.code,
        ))
        raise HTTPException(
            status_code=400,
            detail={
                "title": "HyperFrames render failed",
                "hint": str(e),
                "raw": str(e),
                "code": e.code,
                "remedy": e.remedy,
            },
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
    finally:
        # Drop the cancel signal so a stale event can't abort the next render.
        if current_hf_cancel is cancel_event:
            current_hf_cancel = None


@app.get("/api/agent/find-moments", dependencies=[Depends(require_agent_token)])
async def find_moments_endpoint(query: str):
    """Find transcript moments matching `query` — used to time authored content to spoken words."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    return {"matches": find_transcript_moments(current_result, query)}


@app.get("/api/agent/find-semantic-moments", dependencies=[Depends(require_agent_token)])
async def find_semantic_moments_endpoint(kind: str):
    """Detect moments by category (numbers | cta | speaker_change) for timing
    authored content without a literal phrase."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    try:
        return {"matches": find_semantic_moments(current_result, kind)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    """Render ONE frame of the HyperFrames composition (current caption style,
    over the video) at time `t` and return it as PNG.

    A fast single-frame preview (`hyperframes snapshot`, seconds not minutes) so
    the agent can SEE a custom/native caption style without a full render. Uses
    the live mirrored config (same as the agent render path).
    """
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    t = float(req.get("t", 0.0))
    config, ui_groups = _agent_frame_inputs()
    loop = asyncio.get_running_loop()

    def heartbeat(message: str) -> None:
        # Coarse "still capturing" tick from the snapshot subprocess. Sent as a
        # type-discriminated event so it never overwrites current_status.
        asyncio.run_coroutine_threadsafe(
            broadcast_event({"type": "hyperframes_progress", "message": message}), loop
        )

    def _work() -> bytes:
        workspace = hyperframes_workspace(current_result.audio_path)
        project_dir = coauthor_project_dir(current_result, workspace)
        # Co-author mode: preview the agent's OWN index.html — refresh only the
        # companions, never regenerate the composition the agent authored.
        # Durable marker check survives a backend restart mid-session.
        if coauthor_active(project_dir) and (project_dir / "index.html").exists():
            sync_companions(
                current_result, config, str(project_dir),
                source_video_path=current_result.audio_path,
                custom_groups=ui_groups,
                caption_html=current_custom_caption_html,
            )
            return snapshot_hyperframes_project(str(project_dir), t, on_progress=heartbeat)
        # Default: scaffold into the SAME canonical workspace the Studio serves, so
        # a preview re-generates the open Studio's project (not a separate copy).
        # ``ensure_`` skips the full scaffold when config+groups+transcript+source
        # are unchanged (the preview→tweak→preview fast path), and always falls
        # back to a full scaffold on any change.
        scaffolded = ensure_hyperframes_project(
            current_result,
            config,
            workspace,
            source_video_path=current_result.audio_path,
            custom_groups=ui_groups,
            caption_html=current_custom_caption_html,
        )
        return snapshot_hyperframes_project(scaffolded, t, on_progress=heartbeat)

    try:
        png = await loop.run_in_executor(None, _work)
    except HyperframesRenderError as e:
        logger.warning("HyperFrames preview failed [%s]: %s", e.code, e)
        raise HTTPException(
            status_code=400,
            detail={
                "title": "HyperFrames preview failed",
                "hint": str(e),
                "raw": str(e),
                "code": e.code,
                "remedy": e.remedy,
            },
        )
    return Response(content=png, media_type="image/png")


# --- Co-author workspace: sandboxed filesystem for the agent ---

def _coauthor_root() -> Path:
    """The current project's co-author folder — the one the Studio serves and the
    agent authors in. Computed (not required to exist): writes create it."""
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    return coauthor_project_dir(
        current_result, hyperframes_workspace(current_result.audio_path)
    )


@app.get("/api/agent/workspace", dependencies=[Depends(require_agent_token)])
async def agent_workspace():
    """The co-author project path + a shallow listing of the files the agent owns."""
    root = _coauthor_root()
    return {
        "path": str(root),
        "coauthor": coauthor_active(root),
        "tree": workspace_fs.list_tree(root),
    }


@app.get("/api/agent/workspace/file", dependencies=[Depends(require_agent_token)])
async def agent_workspace_read(path: str):
    """Read a workspace file as text (sandboxed)."""
    try:
        return {"path": path, "content": workspace_fs.read_file(_coauthor_root(), path)}
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/agent/workspace/file", dependencies=[Depends(require_agent_token)])
async def agent_workspace_write(body: dict):
    """Write a workspace file (sandboxed: extension allowlist + size cap)."""
    try:
        return workspace_fs.write_file(
            _coauthor_root(), body.get("path", ""), body.get("content", "")
        )
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/agent/workspace/import", dependencies=[Depends(require_agent_token)])
async def agent_workspace_import(body: dict):
    """Copy an external file/folder (a custom effect block + assets) into the
    workspace under compositions/ (sandboxed, filtered, size-capped)."""
    try:
        return workspace_fs.import_path(
            _coauthor_root(), body.get("src", ""), body.get("dest_subdir", "compositions")
        )
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/agent/hyperframes-cli", dependencies=[Depends(require_agent_token)])
async def agent_hyperframes_cli(body: dict):
    """Run an allowlisted HyperFrames CLI subcommand (lint/inspect/compositions/
    info/docs) in the co-author workspace — the agent's dev loop."""
    args = body.get("args") or []
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise HTTPException(status_code=400, detail="args must be a list of strings")
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(
            None, lambda: run_hyperframes_cli(str(_coauthor_root()), args)
        )
    except HyperframesRenderError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Shared co-author logic, called by BOTH the agent-gated `/api/agent/coauthor*`
# endpoints (MCP) and the ungated `/api/coauthor*` endpoints (the trusted local
# renderer, which only holds the backend port — not the agent token).

def _coauthor_status() -> dict:
    if current_result is None:
        return {"coauthor": current_coauthor, "path": None}
    root = _coauthor_root()
    return {"coauthor": coauthor_active(root), "path": str(root)}


async def _coauthor_enter() -> dict:
    """Seed a starter project (if none) the caller then owns, and flip mode on."""
    global current_coauthor
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    config, ui_groups = _agent_frame_inputs()
    workspace = hyperframes_workspace(current_result.audio_path)
    project_dir = coauthor_project_dir(current_result, workspace)
    # Write the durable marker BEFORE the resource it protects. If we crash after
    # this line but before/within the scaffold, a restart still reports co-author
    # active (coauthor_active() rehydrates from the marker) and _coauthor_project()
    # then sees no index.html and scaffolds cleanly — nothing to clobber.
    write_coauthor_marker(project_dir, True, source=current_result.audio_path)
    current_coauthor = True
    if not (project_dir / "index.html").exists():
        loop = asyncio.get_running_loop()
        # force_scaffold=True: this is the ONE intentional initial scaffold.
        await loop.run_in_executor(None, lambda: seed_coauthor_project(
            current_result, config, workspace,
            source_video_path=current_result.audio_path,
            custom_groups=ui_groups,
            caption_html=current_custom_caption_html,
            force_scaffold=True,
        ))
    # The agent now owns index.html and will diverge it. Drop the scaffold
    # fingerprint (including any the seed just wrote) so a later non-co-author
    # preview can never serve a stale cache hit against the agent's edits — it
    # will re-scaffold cleanly instead.
    clear_scaffold_fingerprint(project_dir)
    return {"coauthor": True, "path": str(project_dir)}


async def _coauthor_set(enable: bool) -> dict:
    global current_coauthor
    if not enable:
        current_coauthor = False
        # Flip the durable marker to inactive (kept as history — never delete it,
        # and never touch the agent's index.html).
        if current_result is not None:
            project_dir = coauthor_project_dir(
                current_result, hyperframes_workspace(current_result.audio_path)
            )
            write_coauthor_marker(project_dir, False, source=current_result.audio_path)
        return {"coauthor": False}
    return await _coauthor_enter()


async def _coauthor_sync_captions() -> dict:
    if current_result is None:
        raise HTTPException(status_code=404, detail="No transcription result available")
    project_dir = coauthor_project_dir(
        current_result, hyperframes_workspace(current_result.audio_path)
    )
    # Guard up front, before any filesystem work: sync_captions only makes sense
    # for a co-author project. Without this, a non-co-author call falls through to
    # sync_companions and dies with a generic FileNotFoundError→400 that reads like
    # a bug. Transcript edits already reach the live UI via update_words' own
    # result_updated broadcast — see docs/plans/mcp-transcript-editing-ux.md Phase 3.
    if not coauthor_active(project_dir):
        raise HTTPException(
            status_code=409,
            detail=(
                "Not in co-author mode — transcript edits already updated the live "
                "UI via update_words; sync_captions is only for co-author projects."
            ),
        )
    config, ui_groups = _agent_frame_inputs()
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, lambda: sync_companions(
            current_result, config, str(project_dir),
            source_video_path=current_result.audio_path,
            custom_groups=ui_groups, caption_html=current_custom_caption_html,
        ))
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/agent/coauthor", dependencies=[Depends(require_agent_token)])
async def get_coauthor():
    """Whether co-author mode is on, plus the project path the agent owns."""
    return _coauthor_status()


@app.post("/api/agent/coauthor", dependencies=[Depends(require_agent_token)])
async def set_coauthor(body: dict):
    """Enter or exit co-author mode (agent). Entering seeds a complete, working
    starter project the agent then OWNS; CapForge then stops regenerating
    index.html and only refreshes companions. Exiting hands control back."""
    return await _coauthor_set(bool(body.get("enable", True)))


@app.post("/api/agent/coauthor/sync-captions", dependencies=[Depends(require_agent_token)])
async def coauthor_sync_captions():
    """Refresh ONLY the CapForge-owned companions (transcript + the captions
    sub-composition) in the co-author project — never the agent's index.html."""
    return await _coauthor_sync_captions()


# Ungated UI mirrors — the local renderer (no agent token) drives co-author mode
# from the HyperFrames panel. Same loopback trust level as /api/export-hyperframes.

@app.get("/api/coauthor")
async def ui_get_coauthor():
    return _coauthor_status()


@app.post("/api/coauthor")
async def ui_set_coauthor(body: dict):
    """Enter/exit co-author mode from the CapForge UI (see set_coauthor)."""
    return await _coauthor_set(bool(body.get("enable", True)))


@app.post("/api/coauthor/sync-captions")
async def ui_coauthor_sync_captions():
    """Refresh the CapForge-owned caption + transcript companions from the UI."""
    return await _coauthor_sync_captions()


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
    """Write exported files and return list of output paths.

    ``output_dir`` is resolved through ``resolve_output_dir`` (same sandbox as
    the HyperFrames export path): a non-absolute or otherwise unusable value
    falls back to the folder next to the source media rather than being
    honoured literally, so a client can't write outside a directory the user
    actually chose.
    """
    output_dir = resolve_output_dir(output_dir, audio_path)
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
