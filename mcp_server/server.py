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
def get_transcript(segments_only: bool = False) -> dict:
    """Return the current transcript with segment + word indices.

    Captions render from the *words*, so use these indices with `update_words`
    to make a fix that actually appears on screen.

    Pass `segments_only=True` for a review/grammar/spell pass — it returns just
    `{index, start, end, text, speaker}` per segment (no `words[]`), which is far
    cheaper on long transcripts. Then re-read with the default (full) form only
    when you need word indices to call `update_words`.
    """
    if segments_only:
        result = _client.get_result(words=False)
        segments = [
            {
                "index": si,
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"],
                "speaker": seg.get("speaker"),
            }
            for si, seg in enumerate(result.get("segments", []))
        ]
        return {"language": result.get("language"), "segments": segments}
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
    style (native OR your custom one), composited over the video.

    Fast (one frame, not a full render), so use it to SEE and iterate on a caption
    style you authored with set_custom_caption_style, or on a co-authored
    composition, before committing to render_hyperframes. NOTE: the separate
    `render_frame` tool is the CLASSIC (Pillow) preview and does NOT reflect
    HyperFrames styles — use THIS to see HyperFrames output.
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


# --- Transcript moments -----------------------------------------------

@mcp.tool()
def find_moments(query: str) -> dict:
    """Find transcript moments (word timings) matching a phrase — e.g. a brand
    or product name. Returns matches with `start`/`end` seconds and `word_id`.

    Use this to decide WHEN something you author should appear: find the spoken
    moment, then time your composition to its `start`.
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
def render_hyperframes(quality: str = "draft", video_format: str = "mp4") -> dict:
    """Render the FINAL full-length video (the captions over the video, or your
    co-authored composition) with the HyperFrames engine. This is slow and
    produces the deliverable — it is NOT a preview. Do NOT call it to "check"
    how something looks.

    Required workflow before calling this — never skip it:
      1. Iterate on the look with SINGLE-FRAME previews: `preview_hyperframes_frame`
         at a few representative timestamps (use find_moments / find_semantic_moments
         to pick them). Adjust the caption style / composition, re-preview, repeat.
      2. Show the user those previews and confirm the look is what they want.
      3. Get the user's EXPLICIT approval to render the final video. If they have
         not clearly said "render it" (or equivalent), stop and ask — do not render.

    CapForge enforces this too: this call pauses until the user approves the render
    in the app (an Approve/Cancel prompt). If the user cancels, it returns a
    cancellation instead of a file — treat that as "keep iterating", not an error.

    Returns the output file path. quality: draft|standard|high. May take a while.

    Co-author durability: co-author mode is persisted in the project workspace and
    survives a CapForge backend restart/crash — you do not need to re-enter it after
    a reconnect. While a co-author project is active, CapForge refuses to re-scaffold
    over your authored index.html, so a render (or any panel refresh) can never
    silently overwrite your work.
    """
    return _client.render_hyperframes(
        {"render": True, "quality": quality, "video_format": video_format, "use_ui_config": True}
    )


# --- Caption style ------------------------------------------------------

@mcp.tool()
def list_caption_styles() -> dict:
    """List caption styles for the HyperFrames render: 'classic' (CapForge's
    built-in track) + native registry styles (caption-pill-karaoke, etc.).
    """
    return _client.list_caption_styles()


@mcp.tool()
def set_caption_style(name: str) -> dict:
    """Set the caption look for the HyperFrames render. Updates the style dropdown
    in the UI, but NOT the live Canvas preview panel — that always draws the
    classic style and cannot render registry styles.

    `name` is 'classic' or a registry style from list_caption_styles, e.g.
    'caption-pill-karaoke'. Native styles install on the next HyperFrames
    render/Studio (needs Node 22+) and bring their own animation + grouping.
    The style only becomes visible via `preview_hyperframes_frame`, the
    HyperFrames Studio, or a HyperFrames render — never end a turn believing
    something visible happened from this call alone.
    """
    _client.send_command("set_settings", {"patch": {"captionStyle": name}})
    return {
        "status": "ok",
        "applied": name,
        "visible_after": "hyperframes_preview_or_render",
        "hint": (
            "No change appears in the live preview panel — registry styles only "
            "render via HyperFrames. Call preview_hyperframes_frame(t) or ask the "
            "user to Render with HyperFrames / open the Studio."
        ),
    }


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
    with set_custom_caption_style or when designing a co-authored composition.
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
    Also switches the style dropdown in the UI to this custom one — but NOT the
    live Canvas preview panel, which cannot render it. The style only becomes
    visible via `preview_hyperframes_frame`, the HyperFrames Studio, or
    render_hyperframes; never end a turn believing something visible happened
    from this call alone. For the design vocabulary behind a strong custom
    look, see `hyperframes_guide`.
    """
    result = _client.set_custom_caption(html)
    _client.send_command("set_settings", {"patch": {"captionStyle": "custom"}})
    return {
        "status": "ok",
        "visible_after": "hyperframes_preview_or_render",
        "hint": (
            "No change appears in the live preview panel — custom styles only "
            "render via HyperFrames. Call preview_hyperframes_frame(t) or ask the "
            "user to Render with HyperFrames / open the Studio."
        ),
        **(result if isinstance(result, dict) else {}),
    }


# --- Co-author mode: free-form HyperFrames authoring in CapForge's project ---

@mcp.tool()
def enter_coauthor_mode() -> dict:
    """Take ownership of the HyperFrames project so you can author it freely — like
    a standalone HyperFrames session, but inside CapForge's project.

    On first entry CapForge seeds a complete, working starter (captions + video)
    and then STOPS regenerating index.html, so your edits
    persist. Workflow: `get_workspace` to see the project → `write_workspace_file`
    to author compositions from scratch under `compositions/` and wire them into
    `index.html` via `data-composition-src` → `run_hyperframes_cli` (lint/inspect)
    → iterate with `preview_hyperframes_frame` until the user is happy → get the
    user's explicit approval → `render_hyperframes`. Always preview and confirm
    before rendering; the final render is the last step, not a preview.

    Reusing an effect pack instead of authoring from scratch: `import_into_workspace`
    a folder (the effect's HTML + its README/registry-item.json usage rules +
    assets) → `read_workspace_file` the README or the snippet's own comment header
    to learn how it wants to be wired → for a **block** (standalone sub-composition,
    own dimensions/duration), reference it from `index.html` with
    `<div data-composition-src="compositions/<name>/<name>.html"
    data-composition-id="…" data-start data-duration data-track-index data-width
    data-height>`; for a **component** (a snippet with no own dimensions), paste
    its HTML into your composition's markup, its CSS into `<style>`, and its JS
    before the timeline instead of wiring a `data-composition-src` — merge its
    exposed GSAP timeline calls into yours. When hand-merging a component, give
    its element IDs a 2-3 letter prefix so they don't collide with your own.
    Then `preview_hyperframes_frame` and confirm before rendering, same as above.
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
    style drives the render again). Your authored files stay on disk but are
    unused until you re-enter co-author mode."""
    return _client.set_coauthor(False)


@mcp.tool()
def sync_captions() -> dict:
    """Refresh the CapForge-owned caption + transcript companions in your co-author
    project, so caption-style or grouping changes made in the CapForge UI flow into
    your composition — without touching your index.html. Reference the captions via
    `data-composition-src` to pick them up. Returns what was refreshed.

    Co-author mode ONLY — enter with `enter_coauthor_mode` first. You do NOT need
    this after `update_words`: transcript edits already update the live CapForge UI
    on their own. Calling it outside co-author mode returns a clear 409, not a fix."""
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
    """Copy an external **effect pack** into the co-author workspace: a folder
    containing a top-level `<name>.html` effect file, plus optional usage rules
    (`README.md` / `registry-item.json`) and optional assets. A single file may
    also be imported directly (no folder required).

    A folder lands under `<dest_subdir>/<name>/` preserving its internal layout, so
    its HTML's relative asset references keep working and you can `read_workspace_file`
    its README (or the snippet's own comment header) to follow the instructions.
    Use the default `dest_subdir="compositions"` for a **block** (a standalone
    sub-composition with its own dimensions/duration — reference it from
    `index.html` via `data-composition-src`); pass
    `dest_subdir="compositions/components"` for a **component** (a snippet with no
    own dimensions — its HTML/CSS/JS get pasted/merged into your composition
    instead of wired with `data-composition-src`). Returns `{ imported, skipped }`
    (disallowed file types are skipped, not fatal; importing a directory with no
    `.html` file anywhere is rejected). Then preview it.
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
