"""CapForge MCP server — Milestone A (live transcript editing).

Run over stdio from an MCP client (Claude Desktop / Claude Code):

    .venv-dev/bin/python -m mcp_server.server

The agent operates the *running* CapForge app: edits go through the token-guarded
/api/agent/* endpoints, and the backend broadcasts so the open UI updates live.
"""

from __future__ import annotations

from typing import Optional

from mcp.server.fastmcp import FastMCP, Image
from pydantic import BaseModel, Field

from .cleanup import apply_word_edits, remove_fillers
from .client import CapForgeClient

mcp = FastMCP("capforge")
_client = CapForgeClient()


class WordEdit(BaseModel):
    """A single token replacement located by segment + word index."""
    segment: int = Field(description="Segment index (from get_transcript)")
    word: int = Field(description="Word index within that segment")
    new: str = Field(description="Replacement word")


class WordEmphasis(BaseModel):
    """Per-word style override located by group + word index (from get_ui_state)."""
    group: int = Field(description="Group index (from get_ui_state.groups)")
    word: int = Field(description="Word index within that group")
    overrides: dict = Field(
        description=(
            "snake_case overrides, e.g. {\"font_size_scale\": 1.4}, "
            "{\"word_transition\": \"bounce\"}, {\"active_word_color\": \"#FF3366\"}, "
            "{\"scale_factor\": 1.3}"
        )
    )


# --- Read tools -----------------------------------------------------------

@mcp.tool()
def get_status() -> dict:
    """Current backend job status (idle / transcribing / rendering / …)."""
    return _client.get_status()


@mcp.tool()
def get_transcript() -> dict:
    """Return the current transcript with segment + word indices.

    Captions render from the *words*, so use these indices with `update_words`
    to make a fix that actually appears on screen.
    """
    result = _client.get_result()
    segments = []
    for si, seg in enumerate(result.get("segments", [])):
        segments.append({
            "index": si,
            "start": seg["start"],
            "end": seg["end"],
            "text": seg["text"],
            "speaker": seg.get("speaker"),
            "words": [
                {"index": wi, "word": w["word"], "start": w["start"], "end": w["end"]}
                for wi, w in enumerate(seg.get("words", []))
            ],
        })
    return {"language": result.get("language"), "segments": segments}


# --- Write tools (live UI update) ----------------------------------------

@mcp.tool()
def update_words(edits: list[WordEdit]) -> dict:
    """Replace specific words (e.g. spelling/homophone fixes). Updates live UI.

    Locate words with `get_transcript`, then pass edits like
    `[{"segment": 0, "word": 3, "new": "their"}]`.
    """
    result = _client.get_result()
    updated, count = apply_word_edits(result, [e.model_dump() for e in edits])
    _client.put_result(updated)
    return {"status": "ok", "words_changed": count}


@mcp.tool()
def remove_filler_words(extra_fillers: Optional[list[str]] = None) -> dict:
    """Remove disfluencies (um, uh, er, …) from the captions. Updates live UI.

    Timestamps are preserved (no resync). Pass `extra_fillers` to add words like
    "like" or "you know" that aren't removed by default.
    """
    result = _client.get_result()
    fillers = None
    if extra_fillers:
        from .cleanup import DEFAULT_FILLERS
        fillers = list(DEFAULT_FILLERS) + list(extra_fillers)
    updated, removed = remove_fillers(result, fillers)
    _client.put_result(updated)
    return {"status": "ok", "words_removed": removed}


# --- Job tools ------------------------------------------------------------

@mcp.tool()
def transcribe(
    audio_path: str,
    language: Optional[str] = None,
    diarize: bool = False,
    output_dir: str = "output",
) -> dict:
    """Start transcription of a media file. Blocks until done (can take minutes)."""
    payload = {
        "audio_path": audio_path,
        "language": language,
        "enable_diarization": diarize,
        "output_dir": output_dir,
    }
    return _client.transcribe(payload)


@mcp.tool()
def export(formats: list[str], output_dir: str = "output") -> dict:
    """Export the current transcript (e.g. ["srt_word", "ass", "json"])."""
    return _client.export({"formats": formats, "output_dir": output_dir})


# --- Style & emphasis (live UI) ------------------------------------------

@mcp.tool()
def get_ui_state() -> dict:
    """Current renderer style + display groups + available preset names.

    Returns `{settings, groups, presets}`. Use `settings` (camelCase keys) with
    `set_style`, `presets` with `apply_preset`, and `groups` (with word indices)
    with `emphasize`.
    """
    return _client.get_ui_state()


@mcp.tool()
def set_style(patch: dict) -> dict:
    """Change global subtitle style. Updates the live UI.

    `patch` uses camelCase StudioSettings keys (see `get_ui_state().settings`),
    e.g. {"fontSize": 84}, {"posY": 70}, {"textColor": "#FFFFFF"},
    {"wordStyle": "highlight"}, {"animationType": "pop"}. Unknown keys are ignored.
    """
    _client.send_command("set_settings", {"patch": patch})
    return {"status": "ok"}


@mcp.tool()
def apply_preset(name: str) -> dict:
    """Apply a built-in style preset by name (see `get_ui_state().presets`).

    Names include: YouTube Bold, TikTok Pop, Minimal White, Highlight Pill,
    Karaoke Neon, Subtitles (Clean), Reveal Dark.
    """
    _client.send_command("apply_preset", {"name": name})
    return {"status": "ok"}


@mcp.tool()
def emphasize(edits: list[WordEmphasis]) -> dict:
    """Style individual words (make keywords bigger / different animation/color).

    Locate words with `get_ui_state().groups`, then pass edits like
    `[{"group": 0, "word": 2, "overrides": {"font_size_scale": 1.4,
       "word_transition": "bounce", "active_word_color": "#FF3366"}}]`.
    Updates the live preview and survives to render.
    """
    _client.send_command("set_word_overrides", {"edits": [e.model_dump() for e in edits]})
    return {"status": "ok", "words_styled": len(edits)}


# --- Vision QA -----------------------------------------------------------

@mcp.tool()
def render_frame(t: float, composite: bool = True) -> Image:
    """Render the subtitle frame at time `t` (seconds) and return it as an image
    so you can SEE the result and critique the design.

    composite=True (default) overlays the captions on the actual video frame —
    use it to check text-over-face and contrast. composite=False returns the
    transparent overlay only. Reflects the live style, so call it after
    set_style / apply_preset / emphasize to see your change.
    """
    return Image(data=_client.get_frame(t, composite), format="png")


@mcp.tool()
def check_layout(t: float, platform: str = "off") -> dict:
    """Mechanical layout read at time `t`: caption bounding box, whether it
    touches the frame edge, and (platform = tiktok/reels/shorts) advisory
    safe-zone violations. Safe zones are guidance, not errors — text may sit
    over them intentionally. Use `render_frame` for visual judgment.
    """
    return _client.check_layout(t, platform)


# --- Effects (AI video director) -----------------------------------------

@mcp.tool()
def find_moments(query: str) -> dict:
    """Find transcript moments (word timings) matching a phrase — e.g. a brand
    or product name. Returns matches with `start`/`end` seconds and `word_id`.

    Use this to decide WHERE to place an effect: find the spoken moment, then
    call add_effect with its `start`.
    """
    return _client.find_moments(query)


@mcp.tool()
def find_semantic_moments(kind: str) -> dict:
    """Find moments by category instead of a literal phrase.

    kind: "numbers" (spoken/written numbers — for a kinetic_stat), "cta" (calls
    to action like "subscribe" / "link in bio"), or "speaker_change" (each new
    diarized speaker — for a lower_third). Returns matches with `start`/`end`
    seconds and `word_id` (plus `speaker` for speaker_change).
    """
    return _client.find_semantic_moments(kind)


@mcp.tool()
def list_effect_types() -> dict:
    """List available effect types and the variables each accepts."""
    pos = ["start (s)", "duration (s)", "anchor_x (0-1)", "anchor_y (0-1)"]
    return {
        "types": [
            {
                "type": "logo",
                "description": "Animated image overlay — pops in, holds, pops out.",
                "fields": pos,
                "variables": {"src": "absolute path to image", "width": "px (optional)"},
            },
            {
                "type": "lower_third",
                "description": "Name/title bar that slides in from the left. "
                "Pair with find_semantic_moments('speaker_change').",
                "fields": pos,
                "variables": {
                    "title": "name (required)",
                    "subtitle": "role/handle (optional)",
                    "accent": "#hex accent bar color (optional)",
                },
            },
            {
                "type": "kinetic_stat",
                "description": "Big animated number + label that pops in. "
                "Pair with find_semantic_moments('numbers').",
                "fields": pos,
                "variables": {
                    "value": "the number, e.g. '2.4M' (required)",
                    "label": "caption under the number (optional)",
                    "accent": "#hex number color (optional)",
                },
            },
            {
                "type": "highlight",
                "description": "Translucent highlighter marker swept across a "
                "spoken word for emphasis. Place at the word's position.",
                "fields": pos,
                "variables": {
                    "color": "css color (optional; default translucent accent)",
                    "width": "px (optional)",
                    "height": "px (optional)",
                },
            },
            {
                "type": "b_roll",
                "description": "Timed image insert that sits behind the captions. "
                "Sized at an anchor, or fullscreen cover.",
                "fields": pos,
                "variables": {
                    "src": "absolute path to image (required)",
                    "width": "px (optional; ignored when fullscreen)",
                    "fullscreen": "true to cover the whole frame (optional)",
                },
            },
        ]
    }


@mcp.tool()
def list_effects() -> dict:
    """List the effect clips currently on the timeline."""
    return _client.get_effects()


# Type-appropriate default anchors (normalized, 0,0 = top-left) used when the
# caller doesn't specify a position.
_DEFAULT_ANCHORS = {
    "logo": (0.82, 0.2),          # top-right
    "lower_third": (0.06, 0.82),  # lower-left
    "kinetic_stat": (0.5, 0.4),   # upper-center
    "highlight": (0.4, 0.5),      # centered-ish, over caption text
    "b_roll": (0.5, 0.5),         # centered
}


@mcp.tool()
def add_effect(
    start: float,
    duration: float = 2.0,
    type: str = "logo",
    src: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    value: Optional[str] = None,
    label: Optional[str] = None,
    color: Optional[str] = None,
    accent: Optional[str] = None,
    fullscreen: bool = False,
    anchor_x: Optional[float] = None,
    anchor_y: Optional[float] = None,
    source_word_id: Optional[str] = None,
) -> dict:
    """Place an animated effect at `start` for `duration` seconds.

    Content by type (see list_effect_types):
      - logo: `src` (absolute image path), optional `width` px.
      - lower_third: `title` (required), optional `subtitle`, `accent`.
      - kinetic_stat: `value` (required, e.g. "2.4M"), optional `label`, `accent`.
      - highlight: optional `color`, `width`, `height` px (a marker sweep).
      - b_roll: `src` (required), optional `width`, `fullscreen=True`.

    Position via anchor_x/anchor_y (0-1, 0,0 = top-left); omit for a sensible
    per-type default. Pair with find_moments / find_semantic_moments to place at
    spoken words; pass that moment's word_id as `source_word_id` for provenance.
    """
    if type == "logo":
        variables = {"src": src, "width": width}
    elif type == "lower_third":
        variables = {"title": title, "subtitle": subtitle, "accent": accent}
    elif type == "kinetic_stat":
        variables = {"value": value, "label": label, "accent": accent}
    elif type == "highlight":
        variables = {"color": color, "accent": accent, "width": width, "height": height}
    elif type == "b_roll":
        variables = {"src": src, "width": width, "fullscreen": fullscreen or None}
    else:
        variables = {}
    variables = {k: v for k, v in variables.items() if v is not None}

    def_x, def_y = _DEFAULT_ANCHORS.get(type, (0.5, 0.5))
    effect = {
        "type": type,
        "start": start,
        "duration": duration,
        "track_index": 1,
        "anchor_x": def_x if anchor_x is None else anchor_x,
        "anchor_y": def_y if anchor_y is None else anchor_y,
        "source_word_id": source_word_id,
        "variables": variables,
        "created_by": "agent",
    }
    return _client.add_effect(effect)


@mcp.tool()
def remove_effect(effect_id: str) -> dict:
    """Remove an effect clip by id (see list_effects for ids)."""
    return _client.remove_effect(effect_id)


@mcp.tool()
def render_hyperframes(quality: str = "draft", video_format: str = "mp4") -> dict:
    """Render the video (captions + placed effects) with the HyperFrames engine.

    Uses the effects currently on the timeline (see list_effects/add_effect) and
    returns the output file path. quality: draft|standard|high. May take a while.
    """
    return _client.render_hyperframes(
        {"render": True, "quality": quality, "video_format": video_format, "use_ui_config": True}
    )


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
