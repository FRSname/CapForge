"""Caption-track MCP tools, plus the confirm-by-poll machinery they generalize.

A **caption track** is a language tab in the open app: the same video, a second
set of captions. The renderer owns them entirely (`src/renderer/src/lib/tracks.ts`)
— it mirrors one compact entry per track through `PUT /api/ui-state`, and the
four tools here *command* it and then confirm by reading that mirror back. No
track rule (staleness, timing, re-flow) is re-implemented on this side, and no
tool mutates backend state directly.

Split out of `server.py` only for the file-size ceiling; these four tools are
registered onto the server's own `FastMCP` instance by `register()` and are
indistinguishable from the ones declared there.

This module deliberately does **not** import `server`: every helper takes the
HTTP client as an argument and `register()` takes a `get_client` callable that
is read at call time, so `server._client` stays the single object a test
monkeypatches.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

# Every write confirms via the UI-state mirror, which the renderer pushes on a
# 300ms debounce. Poll a little faster than that, and give up well before an
# agent would consider the call hung.
CONFIRM_POLL = 0.2
CONFIRM_TIMEOUT = 5.0

#: Mirror keys that make a track entry expensive: the per-group captions and the
#: resolved render body. Stripped from `get_ui_state`, read by `get_track` /
#: `render` / `export` on demand (plan §E).
_TRACK_BODY_KEYS = ("groups", "render")

#: Group states worth an agent's attention — what `stale_only` keeps.
_NEEDS_WORK_STATES = ("stale", "untranslated")

#: A tool's return value carries this when it could not do what was asked.
_ERROR = "error"


class TrackTextEntry(BaseModel):
    """One group's translated caption text, addressed by mirrored group id."""
    group_id: str = Field(description="Group id from create_track / get_track")
    text: str = Field(default="", description="The caption text for that group ('' blanks it)")


ClientFactory = Callable[[], Any]

_get_client: Optional[ClientFactory] = None


def _capforge() -> Any:
    """The live HTTP client, resolved at call time (never cached here)."""
    if _get_client is None:  # pragma: no cover - register() runs at import
        raise RuntimeError("mcp_server.tracks was never registered on the MCP server")
    return _get_client()


# --- Mirror projections ---------------------------------------------------

def mirrored_tracks(state: dict) -> list[dict]:
    """The `tracks` array of the UI-state mirror, tolerating an older renderer."""
    tracks = state.get("tracks") if isinstance(state, dict) else None
    if not isinstance(tracks, list):
        return []
    return [t for t in tracks if isinstance(t, dict)]


def track_inventory(state: dict) -> list[dict]:
    """`{id, label, lang}` per track — what an unknown-id error lists."""
    return [
        {"id": t.get("id"), "label": t.get("label"), "lang": t.get("lang")}
        for t in mirrored_tracks(state)
    ]


def track_summary(entry: dict) -> dict:
    """One mirrored track without its captions or render body (the inventory shape)."""
    return {k: v for k, v in entry.items() if k not in _TRACK_BODY_KEYS}


def strip_track_bodies(state: dict) -> dict:
    """`get_ui_state`'s projection: keep every key, slim every track entry.

    The mirror carries each track's captions *and* its resolved render body;
    returning those from a tool the agent calls constantly would spend the token
    budget on data it did not ask for. `get_track` reads the captions, `render`
    and `export` read the body.
    """
    if not isinstance(state, dict) or "tracks" not in state:
        return state
    return {**state, "tracks": [track_summary(t) for t in mirrored_tracks(state)]}


def is_error(value: Any) -> bool:
    """True for a helper's error dict (never a mirrored track entry)."""
    return isinstance(value, dict) and value.get("status") == _ERROR


def resolve_track(state: dict, track_id: Optional[str]) -> dict:
    """One track's mirrored entry — the active track when `track_id` is None.

    Returns an error dict listing the tracks that *do* exist rather than raising:
    that is what an MCP tool hands back to the agent. Callers test `is_error`.
    """
    tracks = mirrored_tracks(state)
    if not tracks:
        return {
            "status": _ERROR,
            "error": "CapForge has no caption tracks yet.",
            "hint": (
                "Open a video in the app (or use load_video) and wait for "
                "transcription to finish."
            ),
        }
    wanted = track_id or state.get("activeTrackId")
    for entry in tracks:
        if entry.get("id") == wanted:
            return entry
    return {
        "status": _ERROR,
        "error": f"No caption track with id {wanted!r}.",
        "tracks": track_inventory(state),
        "hint": "Pass one of the ids listed here, or omit track_id for the active tab.",
    }


def source_entry(state: dict) -> Optional[dict]:
    """The source (transcript) track's mirrored entry, if one is mirrored."""
    for entry in mirrored_tracks(state):
        if entry.get("isSource"):
            return entry
    return None


def export_track_payload(entry: dict) -> Optional[dict]:
    """`ExportRequest.track` for a translated track; None for the source.

    Built from the track's own mirrored `custom_groups` — the very groups it
    renders — so an exported subtitle file and the burned-in captions can never
    disagree. The source track exports as it always did (no `track` key).
    """
    if entry.get("isSource"):
        return None
    body = entry.get("render") or {}
    groups = body.get("custom_groups") or []
    return {
        "id": entry.get("id"),
        "lang": entry.get("lang"),
        # Pass the words through verbatim: they already carry the renderer's
        # per-word timing, which is what a word-level subtitle format needs.
        "segments": [
            {
                "start": g.get("start"),
                "end": g.get("end"),
                "text": g.get("text", ""),
                "words": g.get("words") or [],
            }
            for g in groups
            if isinstance(g, dict)
        ],
    }


# --- Confirm by poll ------------------------------------------------------

def poll_mirror(
    client: Any,
    matches: Callable[[dict], bool],
    *,
    timeout: float = CONFIRM_TIMEOUT,
    poll: float = CONFIRM_POLL,
) -> tuple[bool, dict]:
    """Poll the UI-state mirror until `matches(state)`, or the deadline passes.

    Returns `(matched, last_state)`. A transport failure is retried until the
    deadline instead of raised: the usual cause is CapForge restarting under a
    long-lived MCP session, and the client re-reads discovery on its own.
    """
    deadline = time.monotonic() + timeout
    state: dict = {}
    while time.monotonic() < deadline:
        time.sleep(poll)
        try:
            state = client.get_ui_state() or {}
        except Exception:
            continue  # backend restarting; the client retries auth itself
        if matches(state):
            return True, state
    return False, state


def confirm_hint(
    state: dict,
    *,
    subject: str = "the command",
    preset: Optional[str] = None,
    known_presets: tuple[str, ...] = (),
) -> str:
    """Why a confirm-by-poll timed out — likeliest cause first."""
    if preset is not None and known_presets:
        if not any(n.strip().lower() == preset.strip().lower() for n in known_presets):
            return f"No preset named {preset!r}. Available: {', '.join(known_presets)}"
    screen = state.get("screen") if isinstance(state, dict) else None
    if screen and screen != "results":
        return (
            f"The app is on the {screen!r} screen. Load a video first — "
            "style commands only apply to an open project."
        )
    return (
        f"The app did not confirm {subject} within {CONFIRM_TIMEOUT:g}s. Check "
        "CapForge is open, then re-read get_ui_state() before rendering."
    )


def send_and_confirm(client: Any, op: str, payload: dict) -> dict:
    """Send a write command and block until the renderer echoes *this* command.

    Every track write carries a tool-minted `command_id`; the renderer applies it
    to its own state and echoes `{lastCommandId, lastCommandStatus,
    lastCommandError}` in the mirror, for every exit including a refusal. Polling
    for our own id is what makes a fire-and-forget command safe to chain — the
    `apply_preset` pattern, but exact instead of inferred.
    """
    command_id = f"c-{uuid.uuid4().hex[:12]}"
    client.send_command(op, {**payload, "command_id": command_id})

    def _echoed(state: dict) -> bool:
        echo = state.get("agent") or {}
        return echo.get("lastCommandId") == command_id

    matched, state = poll_mirror(client, _echoed)
    if not matched:
        return {"status": "unconfirmed", "hint": confirm_hint(state)}
    echo = state.get("agent") or {}
    if echo.get("lastCommandStatus") == "ok":
        return {"status": "ok"}
    return {
        "status": _ERROR,
        "error": echo.get("lastCommandError") or f"CapForge refused the {op} command.",
    }


# --- Tools ----------------------------------------------------------------

def create_track(
    lang: str,
    label: Optional[str] = None,
    copy_style_from: Optional[str] = None,
) -> dict:
    """Add a translated caption track (a language tab) to the open project.

    The new track starts as a *skeleton*: one blank caption per source group,
    inheriting the source's timing and style. Nothing is translated for you —
    the returned `groups` pair each new group id with the source text to
    translate, which is exactly the shape `set_track_text` wants back.

    SIDE EFFECT: the app switches to the new tab, so the active track — what
    `get_ui_state`, `render_frame` and `render` describe when you pass no
    `track_id` — is now this one.

    `lang` is an ISO code ("pl", "de", "pt-BR"). `label` overrides the tab name
    (default: the language's English name). `copy_style_from` is another track's
    id whose style to copy (default: the source's).

    Refused when the transcript's words carry no ids yet — a track that cannot be
    linked to the source could never be told it went stale. Make an edit (or
    reopen the project) and try again.

    The loop, end to end:
      1. translate the `groups` text you get back, group by group;
      2. `set_track_text(track_id, entries)` to write the translations;
      3. `check_layout(t=0, track_id=…, scan=True)` to find captions that overflow;
      4. shorten the offending translations — same meaning, fewer characters;
      5. re-write them with `set_track_text` and re-scan until the scan is clean.
    """
    client = _capforge()
    track_id = f"t-{uuid.uuid4().hex[:12]}"
    payload: dict[str, Any] = {"track_id": track_id, "lang": lang}
    if label:
        payload["label"] = label
    if copy_style_from:
        payload["copy_style_from"] = copy_style_from

    outcome = send_and_confirm(client, "create_track", payload)
    if outcome["status"] != "ok":
        return {**outcome, "track_id": track_id, "lang": lang}

    state = client.get_ui_state() or {}
    entry = resolve_track(state, track_id)
    if is_error(entry):
        return entry
    source = source_entry(state) or {}
    source_groups = [g for g in (source.get("groups") or []) if isinstance(g, dict)]

    # The new track is one blank group per source group, in order, so pairing by
    # index is what hands the agent "this id gets a translation of that line".
    groups = []
    for i, group in enumerate(entry.get("groups") or []):
        source_text = source_groups[i].get("text", "") if i < len(source_groups) else ""
        groups.append({
            "id": group.get("id"),
            "start": group.get("start"),
            "end": group.get("end"),
            "text": source_text,
        })

    return {
        "status": "ok",
        "track_id": track_id,
        "label": entry.get("label"),
        "lang": entry.get("lang"),
        "groups": groups,
        "next": "translate each group's text, then set_track_text(track_id, entries)",
    }


def set_track_text(track_id: str, entries: list[TrackTextEntry]) -> dict:
    """Write translated captions onto a track, group by group. Updates the live UI.

    Wholesale replacement per group:
    `[{"group_id": "t-9f3…:12", "text": "czerwony samochód"}]` replaces that
    caption's entire text. Word timings inside the group are derived
    proportionally by character count across the group's existing span, so the
    captions stay locked to the source audio.

    This is NOT `update_words`: that edits the *source transcript* word by word
    for spelling fixes. Blank text ("") means a blank caption and leaves the
    group counted as untranslated.

    Group ids come from `create_track` or `get_track`. A single unknown id
    rejects the whole batch — nothing is written — so ids and texts stay in step.
    Returns the track's counters afterwards: `staleCount` (written before the
    source words behind them changed), `untranslatedCount` (still blank) and
    `reflowNeeded` (the source was re-chunked — see `get_track`).
    """
    client = _capforge()
    outcome = send_and_confirm(client, "set_track_text", {
        "track_id": track_id,
        "entries": [e.model_dump() for e in entries],
    })
    if outcome["status"] != "ok":
        return {**outcome, "track_id": track_id}

    entry = resolve_track(client.get_ui_state() or {}, track_id)
    if is_error(entry):
        return entry
    return {
        "status": "ok",
        "track_id": track_id,
        "written": len(entries),
        "staleCount": entry.get("staleCount"),
        "untranslatedCount": entry.get("untranslatedCount"),
        "reflowNeeded": entry.get("reflowNeeded"),
    }


def get_track(
    track_id: Optional[str] = None,
    stale_only: bool = False,
    start: Optional[float] = None,
    end: Optional[float] = None,
) -> dict:
    """Read one caption track's groups: ids, timings, text, and how each relates
    to the source. Defaults to the active track.

    Each group carries a `state`:
      - `clean` — written from source words it still matches;
      - `untranslated` — blank, nothing written yet;
      - `stale` — the source words behind it were edited after the translation
        was written, so it may no longer say what the source says. The repair is
        to re-write that group with `set_track_text`, which re-records the link.
    `sourceText` is the source's current wording for the group — translate from
    that. `previousText` is a translation a re-flow carried over as context.

    Track-level `reflowNeeded` is a different problem: the source was
    **re-chunked** (groups merged/split, or words-per-group changed), so this
    track's captions no longer line up with the source's boundaries at all. No
    individual group is marked for it. `reflow_track(track_id)` is the repair:
    it rebuilds the skeleton from the current source, keeps the text of every
    group whose source words are unchanged, and hands the rest back blank.

    `stale_only=True` returns only the groups needing work (stale +
    untranslated); `start`/`end` (seconds) keep the groups overlapping that
    window. Words are never returned — the captions are the unit here.
    """
    state = _capforge().get_ui_state() or {}
    entry = resolve_track(state, track_id)
    if is_error(entry):
        return entry

    groups = [g for g in (entry.get("groups") or []) if isinstance(g, dict)]
    if stale_only:
        groups = [g for g in groups if g.get("state") in _NEEDS_WORK_STATES]
    if start is not None:
        groups = [g for g in groups if (g.get("end") or 0.0) >= start]
    if end is not None:
        groups = [g for g in groups if (g.get("start") or 0.0) <= end]

    return {"track": track_summary(entry), "groups": groups}


def reflow_track(track_id: str) -> dict:
    """Rebuild a translated track's caption skeleton from the current source
    grouping — the repair for `reflowNeeded` (see `get_track`).

    Mechanical, not a translation. A new group whose source words exactly match
    an old one keeps its text; every other group comes back BLANK, carrying the
    overlapping old translations as `previousText` so you can re-write from them.
    The source track is not touched, and group ids change — use the ones this
    returns.

    Returns the track's new counters plus the blank groups; fill them with
    `set_track_text`.
    """
    client = _capforge()
    outcome = send_and_confirm(client, "reflow_track", {"track_id": track_id})
    if outcome["status"] != "ok":
        return {**outcome, "track_id": track_id}

    entry = resolve_track(client.get_ui_state() or {}, track_id)
    if is_error(entry):
        return entry
    blank = [
        {
            "id": g.get("id"),
            "start": g.get("start"),
            "end": g.get("end"),
            "sourceText": g.get("sourceText"),
            "previousText": g.get("previousText"),
        }
        for g in (entry.get("groups") or [])
        if isinstance(g, dict) and not (g.get("text") or "").strip()
    ]
    return {
        "status": "ok",
        "track_id": track_id,
        "groupCount": entry.get("groupCount"),
        "staleCount": entry.get("staleCount"),
        "untranslatedCount": entry.get("untranslatedCount"),
        "reflowNeeded": entry.get("reflowNeeded"),
        "blank": blank,
    }


#: The four tools this module contributes, in the order they are registered.
TOOLS = (create_track, set_track_text, get_track, reflow_track)


def register(mcp: Any, get_client: ClientFactory) -> None:
    """Register the caption-track tools on the server's FastMCP instance.

    `get_client` is called per request rather than stored, so the server's own
    `_client` remains the one object that has to exist (or be patched).
    """
    global _get_client
    _get_client = get_client
    for tool in TOOLS:
        mcp.tool()(tool)
