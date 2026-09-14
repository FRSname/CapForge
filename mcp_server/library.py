"""Library MCP tools — the *video record*, readable with no window open.

A record is CapForge's durable dossier for one video: where the media lives, the
transcript derived from the last saved session, and every authored field an
agent writes on the way to publishing (title, description, chapters, tags…). It
lives on disk under `$CAPFORGE_HOME/library/<id>/` and is served by the backend,
so these tools answer while the app sits on the drop screen — or while the app's
window is closed and only the backend process is up.

Same shape as `tracks.py`: `TOOLS`, `register(mcp, get_client)`, the client
resolved per call, and **no import of `server`**. Every tool returns a dict; a
failure is an error *dict*, never a raised exception, so the agent reads a
sentence instead of a stack trace (`_library_call`).

The one exception to "read-only, no window needed" is `open_video`: restoring a
record into the app is a command the *renderer* executes, so it needs a window
and confirms through the UI-state mirror, exactly like a caption-track write.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Optional
from uuid import uuid4

from urllib.parse import parse_qs, urlparse

from . import tracks
from .library_errors import (  # noqa: F401 — re-exported for callers and tests
    NOT_RUNNING,
    _ERROR,
    _OK,
    _fail,
    _http_detail,
    _library_call,
)

#: What every tool says when the backend is unreachable. The window may be
#: closed — that is fine for a library read — but the *app* has to be running.

#: A tool's return value carries this when it could not do what was asked.

#: `scratch` is a system field, so a dossier patch may never carry it — except
#: for this exact body, which the plan defines as "promote this scratch record".
PROMOTION_PATCH = {"scratch": False}

ClientFactory = Callable[[], Any]

_get_client: Optional[ClientFactory] = None


def _capforge() -> Any:
    """The live HTTP client, resolved at call time (never cached here)."""
    if _get_client is None:  # pragma: no cover - register() runs at import
        raise RuntimeError("mcp_server.library was never registered on the MCP server")
    return _get_client()


def _now_iso() -> str:
    """Now, ISO-8601 UTC with a `Z` suffix — the record's timestamp format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- Tools ----------------------------------------------------------------

def list_videos(
    status: Optional[str] = None,
    collection: Optional[str] = None,
    q: Optional[str] = None,
    include_scratch: bool = False,
) -> dict:
    """List the videos CapForge knows about — the library, not the open session.

    Works with the app idle and even with its window closed: these are records on
    disk, not the project currently loaded. Each entry is a summary (`id`,
    `title`, `sourcePath`, `duration`, `language`, `status`, `collection_id`,
    `createdAt`, `updatedAt`, `missing_media`) — call `get_video(video_id)` for
    the full dossier and its `rev`.

    `status` filters by where a video is in the pipeline: `imported` →
    `transcribed` → `captioned` → `drafted` → `published`. `q` is a full-text
    search over titles, descriptions and transcript text. `collection` filters by
    series. Scratch records (a quick drag-and-drop the user never saved) are
    hidden unless `include_scratch=True`.
    """
    def _call() -> dict:
        listed = _capforge().library_list({
            "status": status, "collection": collection, "q": q,
            "include_scratch": include_scratch,
        }) or {}
        videos = listed.get("videos") or []
        return {"status": _OK, "count": len(videos), "videos": videos}

    return _library_call(_call)


def search_library(q: str) -> dict:
    """Full-text search the library: titles, descriptions and transcript text.

    A thin alias for `list_videos(q=…)` — use it when you are looking for "the
    video where they talked about X" rather than browsing the pipeline.
    """
    return list_videos(q=q)


def get_video(video_id: Optional[str] = None, path: Optional[str] = None) -> dict:
    """Read one video's full dossier: every authored field plus its `rev`.

    Pass exactly one of `video_id` or `path` (the media file on disk; it is
    matched after resolving symlinks, so any spelling of the same file works).

    The `rev` you get back is what `set_video_meta` needs — it is how CapForge
    refuses a blind overwrite of something the user edited in the meantime.
    `status` is the pipeline stage, derived fresh at read time, never authored.
    """
    if (video_id is None) == (path is None):
        return _fail("Pass exactly one of 'video_id' or 'path'.")

    def _call() -> dict:
        client = _capforge()
        if video_id is not None:
            return {"status": _OK, "video": client.library_get(video_id)}
        found = client.library_find_by_path(path)
        if found is None:
            return _fail(
                f"No library record for {path!r}.",
                hint=(
                    "Check the path, or load the file into CapForge once "
                    "(load_video) — that is what creates the record."
                ),
            )
        return {"status": _OK, "video": found}

    return _library_call(_call)


def get_video_transcript(video_id: str, segments_only: bool = True) -> dict:
    """Read a library record's stored transcript — no window, no open project.

    Returns `{rev, source, transcript}`. `source` is `"record"`: the transcript
    derived from the last session snapshot saved for this video, which may be
    older than what is on screen if the user is editing it right now. For the
    *live* transcript of the open project use `get_transcript()` instead.

    `segments_only=True` (the default) drops per-word timings — it is what you
    want for writing a description or chapters, and it is a fraction of the
    tokens. Ask for words only when you need word-level timing.

    404s until a session has been saved for the record: transcription happens in
    the app, and the record stores what the app last wrote.
    """
    def _call() -> dict:
        envelope = _capforge().library_transcript(
            video_id, segments_only=segments_only
        ) or {}
        return {"status": _OK, **envelope}

    return _library_call(_call)


def set_video_meta(video_id: str, patch: dict, rev: int) -> dict:
    """Write authored fields onto a video record (title, description, chapters…).

    `patch` replaces whole fields — a list patch is the new list, not an append.
    Read the record first: `rev` must be the one `get_video` returned, or the
    write is refused with `{"reason": "stale_rev", "current": …}` because
    somebody edited it meanwhile. Re-read, re-apply your change, write again.

    Authored fields only (`title`, `title_options`, `description`,
    `short_description`, `chapters`, `tags`, `hashtags`, `keywords`,
    `summary_md`, `highlights`, `quotes`, `tools_mentioned`, `links`, `shorts`,
    `thumbnail`, `speakers`, `collection_id`, `localized`, `publish`,
    `external_refs`). Chapter times are **seconds** and are never re-timed by a
    transcript edit.

    This CANNOT fix transcript text — the transcript is derived from the session
    and is read-only here. Use `open_video(video_id)` and then `update_words`.

    The one system field it accepts is the promotion `{"scratch": false}`, which
    turns a throwaway drop into a kept library video (send it alone).
    """
    if not isinstance(patch, dict) or not patch:
        return _fail("Pass a non-empty 'patch' object of authored fields.")
    if patch == PROMOTION_PATCH:
        return _library_call(
            lambda: {"status": _OK, "video": _capforge().library_promote(video_id)}
        )
    if "scratch" in patch:
        return _fail(
            "'scratch' is a system field: send it alone as {\"scratch\": false} "
            "to promote the record, or drop it from the patch."
        )

    def _call() -> dict:
        record = _capforge().library_patch(video_id, patch, rev)
        return {"status": _OK, "rev": record.get("rev"), "video": record}

    return _library_call(_call)


#: YouTube URL path prefixes whose next segment is the video id.
_YOUTUBE_PATH_PREFIXES = ("/shorts/", "/live/", "/embed/", "/v/")


def youtube_id_from_url(url: str) -> Optional[str]:
    """The video id inside a YouTube URL, or None for anything else."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    path = parsed.path or ""
    if host == "youtu.be":
        return path.strip("/").split("/")[0] or None
    if host not in ("youtube.com", "music.youtube.com"):
        return None
    watch = parse_qs(parsed.query).get("v", [None])[0]
    if watch:
        return watch
    for prefix in _YOUTUBE_PATH_PREFIXES:
        if path.startswith(prefix):
            return path[len(prefix):].split("/")[0] or None
    return None


def mark_published(
    video_id: str,
    url: str,
    youtube_video_id: Optional[str] = None,
    published_at: Optional[str] = None,
) -> dict:
    """Record that a video went live — the last step of a publish run.

    CapForge does not upload anything (there is no YouTube API here): the user
    publishes, and this writes down where it landed. Setting the URL is what
    moves the record's status to `published`.

    `published_at` defaults to now (ISO-8601 UTC) and an existing timestamp is
    never overwritten by it — a re-run to correct the URL keeps the real
    publication date. `youtube_video_id` is optional: omitted, it is read from
    the URL (`youtu.be/<id>`, `watch?v=<id>`, `/shorts/<id>`, `/live/<id>`);
    a URL it cannot be read from is refused, because `published` status keys
    on the id.
    """
    if not isinstance(url, str) or not url.strip():
        return _fail("Pass the published video's 'url'.")
    # The record's status flips to `published` on `videoId`, not on the URL, so
    # the id is required: an explicit argument, else the one inside the URL.
    resolved_id = youtube_video_id or youtube_id_from_url(url)
    if not resolved_id:
        return _fail(
            "Could not read a YouTube video id from that URL — pass "
            "'youtube_video_id' explicitly."
        )

    def _call() -> dict:
        client = _capforge()
        record = client.library_get(video_id)
        publish = record.get("publish") or {}
        existing = publish.get("youtube") or {}
        youtube = {
            **existing,
            "videoId": resolved_id,
            "url": url,
            # An already-published record keeps its real date; only a first
            # publish (or an explicit argument) stamps one.
            "publishedAt": published_at or existing.get("publishedAt") or _now_iso(),
        }
        merged = {**publish, "youtube": youtube}
        updated = client.library_patch(video_id, {"publish": merged}, record.get("rev"))
        return {
            "status": _OK,
            "rev": updated.get("rev"),
            "publish": updated.get("publish", merged),
        }

    return _library_call(_call)


def find_video_moments(
    video_id: str, query: Optional[str] = None, kind: Optional[str] = None
) -> dict:
    """Find where something is said in a library record's stored transcript.

    Pass exactly one of `query` (literal text, punctuation-insensitive) or `kind`
    (`numbers` | `cta` | `speaker_change` | `pause`). Each match carries
    `{text, start, end, word_id}` — start times you can turn straight into
    chapters, or hand to a clip suggestion.

    `pause` is the chapter-hunting one: a silence of at least a second, reported
    with the word that follows it (`gap` is how long the silence was).

    Reads the record, so it works with no project open; it 404s until a session
    has been saved for the video.
    """
    def _call() -> dict:
        found = _capforge().library_moments(video_id, query=query, kind=kind) or {}
        matches = found.get("matches") or []
        return {"status": _OK, "count": len(matches), "matches": matches}

    return _library_call(_call)


def open_video(video_id: str) -> dict:
    """Open a library record in the CapForge window — restores its saved session.

    Unlike every other tool here, this one needs a **window open**: the app
    restores the record's stored snapshot (transcript, groups, style, caption
    tracks) as if the user had opened the project file, and then becomes the
    live session. Call it before any tool that edits the session —
    `update_words`, `remove_filler_words`, the caption-track tools, `render` —
    on a video you found in the library.

    Refused, with the reason spelled out, when the record has never been saved
    from the app (there is no snapshot to restore), when the id is unknown, or
    when CapForge is running with no window open.

    Returns once the app confirms the record is the active one, so the next tool
    call already sees it.
    """
    client = _capforge()
    command_id = uuid4().hex

    def _send() -> dict:
        client.send_command("open_video", {"record_id": video_id, "command_id": command_id})
        return {"status": _OK}

    sent = _library_call(_send)
    if sent.get("status") != _OK:
        return sent

    def _opened(state: dict) -> bool:
        echo = state.get("agent") or {}
        if echo.get("lastCommandId") != command_id:
            return False
        # A refusal is an answer too: stop polling instead of waiting out the
        # timeout for an activeVideoId the renderer has already declined to set.
        if echo.get("lastCommandStatus") == _ERROR:
            return True
        return state.get("activeVideoId") == video_id

    matched, state = tracks.poll_mirror(client, _opened)
    if not matched:
        return {
            "status": "unconfirmed",
            "hint": tracks.confirm_hint(state, subject="open_video"),
            "video_id": video_id,
        }
    echo = state.get("agent") or {}
    if echo.get("lastCommandStatus") == _ERROR:
        return _fail(
            echo.get("lastCommandError") or "CapForge refused the open_video command.",
            video_id=video_id,
        )
    return {
        "status": _OK,
        "video_id": video_id,
        "next": "the record is the open project — read it with get_transcript()",
    }


#: The eight tools this module contributes, in the order they are registered.
TOOLS = (
    list_videos,
    search_library,
    get_video,
    get_video_transcript,
    set_video_meta,
    mark_published,
    find_video_moments,
    open_video,
)


def register(mcp: Any, get_client: ClientFactory) -> None:
    """Register the library tools on the server's FastMCP instance.

    `get_client` is called per request rather than stored, so the server's own
    `_client` remains the one object that has to exist (or be patched).
    """
    global _get_client
    _get_client = get_client
    for tool in TOOLS:
        mcp.tool()(tool)
