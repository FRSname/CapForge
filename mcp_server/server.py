"""CapForge MCP server — Milestone A (live transcript editing).

Run over stdio from an MCP client (Claude Desktop / Claude Code):

    .venv-dev/bin/python -m mcp_server.server

The agent operates the *running* CapForge app: edits go through the token-guarded
/api/agent/* endpoints, and the backend broadcasts so the open UI updates live.
"""

from __future__ import annotations

from typing import Literal, Optional

from mcp.server.fastmcp import FastMCP, Image
from pydantic import BaseModel, Field

from .cleanup import apply_word_edits, remove_fillers
from .client import CapForgeClient
from .knowledge import TopicNotFound, read_index, read_topic

mcp = FastMCP("capforge")
_client = CapForgeClient()


class WordEdit(BaseModel):
    """A single token edit located by segment + word index."""
    segment: int = Field(description="Segment index (from get_transcript)")
    word: int = Field(description="Word index within that segment")
    new: str = Field(default="", description="Replacement word (ignored for op='delete')")
    op: Literal["replace", "delete"] = Field(
        default="replace",
        description=(
            "'replace' swaps the word text; 'delete' removes the token. A merge = a "
            "'replace' on the survivor + a 'delete' on the neighbor in the same edits list."
        ),
    )


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
def get_hyperframes_status() -> dict:
    """Preflight the HyperFrames CLI before rendering.

    Returns `{ cli_version, compat_ok, compat_reasons }`. `compat_ok` is
    tri-state: `true` (compatible), `false` (too old), or `null` (version unknown
    / probe failed — a render still proceeds, degrading gracefully).
    `compat_reasons[0]` is the user-facing remediation message ONLY when
    `compat_ok` is `false`; when `compat_ok` is `null` the reasons list is empty,
    so do not treat it as guidance. Check this before a co-author render so a
    stale CLI surfaces as a clear message instead of a mid-render failure.
    """
    return _client.get_hyperframes_status()


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
    """Replace, delete, or merge words (spelling/homophone fixes, cleanup). Updates live UI.

    Locate words with `get_transcript`, then pass edits:
      - replace: `[{"segment": 0, "word": 3, "new": "their"}]` (op defaults to "replace").
      - delete:  `[{"segment": 0, "word": 4, "op": "delete"}]` — removes the token; its
        time span is absorbed into the adjacent surviving word (no caption gap).
      - merge:   replace the survivor + delete the neighbor in ONE call, e.g.
        `[{"segment": 0, "word": 3, "new": "ChatGPT"}, {"segment": 0, "word": 4, "op": "delete"}]`
        merges "chat GPT" -> "ChatGPT" spanning [first.start, second.end].
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
def preview_hyperframes_frame(t: float) -> Image:
    """Preview ONE HyperFrames frame at time `t` (seconds) — the current caption
    style (native OR your custom one) + placed effects, composited over the video.

    Fast (one frame, not a full render), so use it to SEE and iterate on a caption
    style you authored with set_custom_caption_style, or to check effect placement,
    before committing to render_hyperframes. NOTE: the separate `render_frame` tool
    is the CLASSIC (Pillow) preview and does NOT reflect HyperFrames styles — use
    THIS to see HyperFrames output.
    """
    return Image(data=_client.preview_hyperframes_frame(t), format="png")


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
    """Render the FINAL full-length video (captions + placed effects) with the
    HyperFrames engine. This is slow and produces the deliverable — it is NOT a
    preview. Do NOT call it to "check" how something looks.

    Required workflow before calling this — never skip it:
      1. Iterate on the look with SINGLE-FRAME previews: `preview_hyperframes_frame`
         at a few representative timestamps (use find_moments / find_semantic_moments
         to pick them). Adjust effects / caption style, re-preview, repeat.
      2. Show the user those previews and confirm the effect/animation is what they
         want.
      3. Get the user's EXPLICIT approval to render the final video. If they have
         not clearly said "render it" (or equivalent), stop and ask — do not render.

    CapForge enforces this too: this call pauses until the user approves the render
    in the app (an Approve/Cancel prompt). If the user cancels, it returns a
    cancellation instead of a file — treat that as "keep iterating", not an error.

    Uses the effects currently on the timeline (see list_effects/add_effect) and
    returns the output file path. quality: draft|standard|high. May take a while.

    Co-author durability: co-author mode is persisted in the project workspace and
    survives a CapForge backend restart/crash — you do not need to re-enter it after
    a reconnect. While a co-author project is active, CapForge refuses to re-scaffold
    over your authored index.html, so a render (or any panel refresh) can never
    silently overwrite your work.
    """
    return _client.render_hyperframes(
        {"render": True, "quality": quality, "video_format": video_format, "use_ui_config": True}
    )


# --- Reusable effect templates (cross-project look library) --------------

@mcp.tool()
def list_effect_templates() -> dict:
    """List saved reusable effect templates — looks the user (or you) saved to
    reuse across projects, e.g. a brand logo or a lower-third style. Drop one
    onto the timeline with apply_effect_template.
    """
    return _client.list_effect_templates()


@mcp.tool()
def save_effect_template(name: str, effect_id: str) -> dict:
    """Save an effect already on the timeline as a reusable template `name`.

    Find the effect's id with list_effects. Timing is stripped — a template is a
    reusable *look*, not a placement. For asset effects (logo/b_roll) the image
    is copied into a stable store so the template survives the project being
    deleted. Overwrites an existing template with the same name.
    """
    return _client.save_effect_template(name, effect_id=effect_id)


@mcp.tool()
def apply_effect_template(name: str, start: float, duration: float = 2.0) -> dict:
    """Add a saved template (see list_effect_templates) onto the effects
    timeline at `start` for `duration` seconds. Updates the live UI.
    """
    return _client.apply_effect_template(name, start, duration)


@mcp.tool()
def delete_effect_template(name: str) -> dict:
    """Delete a saved effect template by name."""
    return _client.delete_effect_template(name)


# --- Caption style ------------------------------------------------------

@mcp.tool()
def list_caption_styles() -> dict:
    """List caption styles for the HyperFrames render: 'classic' (CapForge's
    built-in track) + native registry styles (caption-pill-karaoke, etc.).
    """
    return _client.list_caption_styles()


@mcp.tool()
def set_caption_style(name: str) -> dict:
    """Set the caption look for the HyperFrames render. Updates the live UI.

    `name` is 'classic' or a registry style from list_caption_styles, e.g.
    'caption-pill-karaoke'. Native styles install on the next HyperFrames
    render/Studio (needs Node 22+) and bring their own animation + grouping.
    """
    _client.send_command("set_settings", {"patch": {"captionStyle": name}})
    return {"status": "ok"}


# --- HyperFrames creative library ---------------------------------------

@mcp.tool()
def hyperframes_guide(topic: Optional[str] = None) -> str:
    """The HyperFrames creative library — caption craft, motion, type, the
    text-highlight vocabulary (marker sweep, scribble, sketchout, burst),
    transitions, and palettes — the same range a standalone HyperFrames author
    has, bound to CapForge's tools.

    Call with NO topic FIRST: returns the operating model, the custom-caption
    contract, and the topic index. Then call with a `topic` id from that index
    (e.g. "captions", "text-animation", "motion-principles") to pull that
    reference on demand. Consult this BEFORE authoring a custom caption style
    with set_custom_caption_style or when designing effects.
    """
    if not topic:
        return read_index()
    try:
        return read_topic(topic)
    except TopicNotFound as exc:
        return str(exc)


@mcp.resource("hyperframes://library")
def hyperframes_library_resource() -> str:
    """HyperFrames creative library entry: operating model + topic index."""
    return read_index()


@mcp.resource("hyperframes://topic/{topic}")
def hyperframes_topic_resource(topic: str) -> str:
    """One HyperFrames creative topic by id (see the library resource)."""
    try:
        return read_topic(topic)
    except TopicNotFound as exc:
        return str(exc)


# --- Agent-authored custom caption style --------------------------------

@mcp.tool()
def get_custom_caption_contract() -> dict:
    """Get the contract + a working starter template for authoring your OWN
    caption style from scratch (HTML/CSS/GSAP), driven only by CapForge's
    transcript + timing.

    Returns `{contract, template}`. Adapt the template's CSS / entrance animation
    to invent a new look, KEEP the structure (the `var TRANSCRIPT` placeholder,
    the grouping, the paused `window.__timelines[...]` timeline, the hard
    `tl.set` kill, `data-composition-id` + `data-width/height`), then send it with
    `set_custom_caption_style`. CapForge swaps in the real words, fits it to the
    output canvas (portrait/4K/…), and composites it over the video.

    For the creative range to invent a *distinctive* look (motion, type, the
    text-highlight vocabulary, palettes), call `hyperframes_guide` first — start
    with no topic, then pull "captions" and whichever topics fit the look.
    """
    return _client.get_custom_caption_contract()


@mcp.tool()
def set_custom_caption_style(html: str) -> dict:
    """Set a brand-new, agent-authored caption style (full HTML component) for the
    HyperFrames render. Get the contract + starter via get_custom_caption_contract.

    The HTML is validated immediately (transcript array, timeline, composition
    root, no banned patterns) — a clear error comes back if anything's missing.
    Also switches the live caption style to this custom one. Render it with
    render_hyperframes (or open the Studio) to see it. For the design vocabulary
    behind a strong custom look, see `hyperframes_guide`.
    """
    result = _client.set_custom_caption(html)
    _client.send_command("set_settings", {"patch": {"captionStyle": "custom"}})
    return {"status": "ok", **(result if isinstance(result, dict) else {})}


# --- Co-author mode: free-form HyperFrames authoring in CapForge's project ---

@mcp.tool()
def enter_coauthor_mode() -> dict:
    """Take ownership of the HyperFrames project so you can author it freely — like
    a standalone HyperFrames session, but inside CapForge's project.

    On first entry CapForge seeds a complete, working starter (captions + video +
    the current effects) and then STOPS regenerating index.html, so your edits
    persist. Workflow: `get_workspace` to see the project → `write_workspace_file`
    / `import_into_workspace` to author compositions under `compositions/` and wire
    them into `index.html` via `data-composition-src` → `run_hyperframes_cli`
    (lint/inspect) → iterate with `preview_hyperframes_frame` until the user is
    happy → get the user's explicit approval → `render_hyperframes`. Always preview
    and confirm before rendering; the final render is the last step, not a preview.
    Call `hyperframes_guide` for the creative vocabulary. Returns `{ coauthor, path }`.

    Durability: once you enter co-author mode CapForge persists that state in the
    project workspace, so it survives a backend restart/crash — after a reconnect
    you are still in co-author mode and do NOT need to re-enter. As long as the mode
    is active, CapForge refuses to re-scaffold over your `index.html`; scaffolding a
    co-author project is rejected rather than silently overwriting your work.
    """
    return _client.set_coauthor(True)


@mcp.tool()
def exit_coauthor_mode() -> dict:
    """Hand control back to CapForge's generated composition (the panel's caption
    style + effects timeline drive the render again). Your authored files stay on
    disk but are unused until you re-enter co-author mode."""
    return _client.set_coauthor(False)


@mcp.tool()
def sync_captions() -> dict:
    """Refresh the CapForge-owned caption + transcript companions in your co-author
    project, so caption-style or grouping changes made in the CapForge UI flow into
    your composition — without touching your index.html. Reference the captions via
    `data-composition-src` to pick them up. Returns what was refreshed."""
    return _client.sync_captions()


@mcp.tool()
def get_workspace() -> dict:
    """The CapForge-owned HyperFrames project you author in during co-author mode.

    Returns `{ path, coauthor, tree }` — the project folder (the same one the
    Studio serves), whether co-author mode is on, and a shallow file listing. You
    own `index.html`, `compositions/`, and `assets/`; CapForge owns
    `transcript.json`, `source.*`, and the captions sub-composition. Enter the
    mode first with `enter_coauthor_mode`.
    """
    return _client.get_workspace()


@mcp.tool()
def read_workspace_file(path: str) -> dict:
    """Read a text file (HTML/CSS/JS/JSON/MD) from the co-author workspace. `path`
    is relative to the project folder returned by `get_workspace`."""
    return _client.read_workspace_file(path)


@mcp.tool()
def write_workspace_file(path: str, content: str) -> dict:
    """Write or overwrite a text file in the co-author workspace — e.g.
    `compositions/code-block.html`, or `index.html` itself to wire a new
    composition in via `data-composition-src`.

    Sandboxed: the path must stay inside the project and use an allowed web/video
    extension. Author as a standalone HyperFrames composition (transparent stage,
    `data-composition-id` + `data-width/height`, a paused `window.__timelines[...]`
    timeline). Preview with `preview_hyperframes_frame`; render with
    `render_hyperframes`. Call `hyperframes_guide` for the creative vocabulary.
    """
    return _client.write_workspace_file(path, content)


@mcp.tool()
def import_into_workspace(src: str, dest_subdir: str = "compositions") -> dict:
    """Copy an external file or folder — a custom effect block with its assets and
    instructions — into the co-author workspace.

    A folder lands under `compositions/<name>/` preserving its internal layout, so
    its HTML's relative asset references keep working and you can `read_workspace_file`
    its README to follow the instructions. Returns `{ imported, skipped }`
    (disallowed file types are skipped, not fatal). Then reference the block from
    `index.html` via `data-composition-src` and preview it.
    """
    return _client.import_into_workspace(src, dest_subdir)


@mcp.tool()
def run_hyperframes_cli(args: list[str]) -> dict:
    """Run a HyperFrames CLI check in your co-author workspace — your dev loop.

    Allowed subcommands: `lint`, `inspect`, `compositions`, `info`, `docs`
    (e.g. `args=["lint"]`, `args=["inspect", "--at", "2"]`). Rendering and frame
    previews have dedicated tools (`render_hyperframes` / `preview_hyperframes_frame`)
    and project scaffolding is owned by CapForge, so `init`/`publish`/`render`/etc.
    are rejected. Returns `{ ok, exit_code, stdout, stderr, command }`.
    """
    return _client.run_hyperframes_cli(args)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
