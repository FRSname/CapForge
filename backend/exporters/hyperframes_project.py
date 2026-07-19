"""HyperFrames project generator — Phase A.

Assembles a self-contained HyperFrames composition folder from a CapForge
transcription + style config:

    <stem>-hyperframes/
      index.html        root composition: video base track + caption track
      transcript.json   [{text,start,end}] (Phase 0 bridge format)
      source.<ext>      copy of the source video (if provided)
      README.txt

The caption track reuses CapForge's `_build_groups` so grouping/timing match
the existing Pillow render. The GSAP timeline follows the rules in
`~/.claude/skills/hyperframes/references/captions.md`: one group visible at a
time, an entrance per group, and a hard `tl.set` kill at `group.end`.

This module is intentionally render-engine-agnostic — it only writes files.
Invoking `npx hyperframes render` on the folder is a separate concern.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.exporters.hyperframes_caption_html import caption_block
from backend.exporters.hyperframes_export import export_hyperframes
from backend.exporters.video_render import _build_groups, resolve_font_file
from backend.models.schemas import TranscriptionResult, VideoRenderConfig
from backend.workspace_fs import resolve_in_workspace

logger = logging.getLogger(__name__)

GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

# Scaffold-cache schema version. BUMP THIS whenever the shape of the scaffold
# output changes — i.e. any change to ``_build_index_html`` OR the caption
# runtime it embeds (``hyperframes_caption_html.py``) OR anything else that would
# make an old, byte-identical set of inputs produce a *different* index.html than
# a fresh scaffold would today. The fingerprint cache keys on (fingerprint,
# SCAFFOLD_VERSION); bumping this forces every cached project to re-scaffold so a
# code change to the HTML generator can never serve a stale (old-shape) preview.
SCAFFOLD_VERSION = 5

# Fingerprint sidecar written next to ``index.html`` after a successful scaffold.
# ``ensure_hyperframes_project`` reads it to decide whether the existing scaffold
# still matches the current inputs (and skip re-scaffolding).
SCAFFOLD_FINGERPRINT_FILE = ".capforge-scaffold.json"

# Durable co-author marker written INSIDE the per-source workspace. It is the
# source of truth for "is this project in co-author mode?" so the mode survives a
# backend crash/restart — the in-memory ``current_coauthor`` global is only a fast
# path. Kept as history (rewritten to ``active: false``) on exit, never deleted.
COAUTHOR_MARKER = ".capforge-coauthor.json"


class CoauthorClobberError(RuntimeError):
    """Raised when scaffolding would overwrite an agent-authored ``index.html``
    in a project the co-author marker says is active. Defense in depth: the normal
    control flow never scaffolds over an active co-author project."""


def _marker_path(project_dir) -> Path:
    """Resolve the marker path THROUGH the workspace sandbox — same rules as every
    other write in the co-author workspace, so it can never land outside it."""
    return resolve_in_workspace(Path(project_dir), COAUTHOR_MARKER)


def read_coauthor_marker(project_dir) -> Optional[dict]:
    """Return the parsed co-author marker for ``project_dir``, or ``None`` when it
    is missing or corrupt. Never raises — a missing/unreadable marker just means
    "no durable co-author state here"."""
    try:
        target = _marker_path(project_dir)
    except ValueError:
        return None
    if not target.is_file():
        return None
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_coauthor_marker(
    project_dir, active: bool, *, source: Optional[str] = None
) -> None:
    """Write/overwrite the co-author marker for ``project_dir`` *atomically*.

    ``active`` records whether the project is currently co-authored. On exit
    (``active=False``) the file is REWRITTEN (kept as history), never deleted.
    ``source`` is the absolute source media path; when omitted it is carried over
    from any existing marker so exit doesn't lose provenance.

    ``updated_at`` is stamped on every call. ``entered_at`` is set only when
    *entering* (``active=True``); on exit the prior ``entered_at`` is preserved
    from the existing marker (or omitted when there was none) so a history file
    never reports the exit time as the enter time.

    The write is atomic: the payload is written to a sibling ``.tmp`` file in the
    SAME directory (so ``os.replace`` is atomic on the same filesystem), then
    swapped into place. A crash mid-write therefore leaves either the previous
    valid marker or no marker — never a truncated/corrupt JSON that
    ``read_coauthor_marker`` would degrade to ``None`` (which silently DISABLES
    the clobber guard, the opposite of crash-safe).
    """
    existing = read_coauthor_marker(project_dir)
    if source is None and existing:
        source = existing.get("source")
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "active": bool(active),
        "updated_at": now,
        "source": str(source) if source else "",
    }
    if active:
        payload["entered_at"] = now
    elif existing and existing.get("entered_at"):
        payload["entered_at"] = existing["entered_at"]

    target = _marker_path(project_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Temp sibling resolved THROUGH the same workspace sandbox as the marker, so
    # it can never land outside the project dir.
    tmp = resolve_in_workspace(Path(project_dir), COAUTHOR_MARKER + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, target)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass  # best-effort cleanup; re-raise the original failure
        raise


def _scaffold_fingerprint(
    config: VideoRenderConfig,
    groups: list[dict],
    result: TranscriptionResult,
    source_path: Optional[str],
) -> str:
    """SHA1 over everything that reaches the scaffolded ``index.html``.

    Deterministic and order-stable so identical inputs always hash identically.
    Over-inclusion is deliberate: a spurious re-scaffold is cheap, but a stale
    cache hit serves a WRONG preview. When unsure whether an input reaches the
    HTML, it is folded in here.

    Inputs, in a fixed order:
      * ``config`` — full Pydantic v2 dump (``model_dump_json`` is the canonical
        serializer used elsewhere for this model).
      * ``groups`` — the display groups (already word-split, with per-word
        overrides), serialized with ``sort_keys`` so dict ordering never matters.
      * transcript — only ``text/start/end`` per word (the bridge fields the
        composition/captions consume), never the whole result object.
      * source — path string + file mtime_ns + size, so an edit to the source
        media (re-encode, trim) invalidates the cache. A missing source folds in
        a deterministic sentinel so the hash is still stable.
      * ``SCAFFOLD_VERSION`` — bumping it changes every fingerprint (see the
        constant's contract).
    """
    hasher = hashlib.sha1()

    def _feed(label: str, value: str) -> None:
        # Length-prefixed, labelled fields so distinct inputs can never collide
        # by concatenation (e.g. "a" + "bc" vs "ab" + "c").
        hasher.update(label.encode("utf-8"))
        payload = value.encode("utf-8")
        hasher.update(str(len(payload)).encode("utf-8"))
        hasher.update(b":")
        hasher.update(payload)

    _feed("version", str(SCAFFOLD_VERSION))
    _feed("config", config.model_dump_json())
    _feed("groups", json.dumps(groups, sort_keys=True, default=str))

    words = [
        {"text": w.word, "start": w.start, "end": w.end}
        for seg in result.segments
        for w in seg.words
    ]
    _feed("transcript", json.dumps(words, sort_keys=True, default=str))

    # result.duration reaches the HTML (timeline data-duration / native-caption
    # length) when the caller passes duration=None — the preview path. GSAP_CDN is
    # injected into the <script src> tag. Both are HTML inputs, so fold them in to
    # keep the cache airtight (over-include; a spurious re-scaffold is cheap, a
    # stale hit serves a wrong preview).
    _feed("result_duration", str(result.duration or ""))
    _feed("gsap_cdn", GSAP_CDN)

    if source_path:
        _feed("source_path", str(source_path))
        try:
            st = os.stat(source_path)
            _feed("source_stat", f"{st.st_mtime_ns}:{st.st_size}")
        except OSError:
            # Missing/unreadable source — deterministic sentinel keeps the hash
            # stable while still differing from a present file.
            _feed("source_stat", "missing")
    else:
        _feed("source_path", "")
        _feed("source_stat", "none")

    return hasher.hexdigest()


def _composition_fingerprint(
    config: VideoRenderConfig,
    groups: list[dict],
    result: TranscriptionResult,
    source_path: Optional[str],
    duration: Optional[float],
    caption_html: Optional[str],
) -> str:
    """Full stored fingerprint: the scaffold core plus the remaining inputs that
    also reach ``index.html`` (the composition duration and an agent-authored
    custom caption component). Kept separate from :func:`_scaffold_fingerprint`
    so the core stays the documented, independently testable building block
    while the cache still invalidates on ANY HTML input.
    """
    base = _scaffold_fingerprint(config, groups, result, source_path)
    extra = json.dumps(
        {
            "duration": duration,
            "caption_html": caption_html,
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha1(f"{base}:{extra}".encode("utf-8")).hexdigest()


def _fingerprint_path(project_dir) -> Path:
    """Resolve the fingerprint sidecar THROUGH the workspace sandbox — same rules
    as every other write in the co-author workspace."""
    return resolve_in_workspace(Path(project_dir), SCAFFOLD_FINGERPRINT_FILE)


def read_scaffold_fingerprint(project_dir) -> Optional[dict]:
    """Return the parsed fingerprint sidecar, or ``None`` when missing/corrupt.
    Never raises — a missing/unreadable sidecar just means "cache miss"."""
    try:
        target = _fingerprint_path(project_dir)
    except ValueError:
        return None
    if not target.is_file():
        return None
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_scaffold_fingerprint(project_dir, fingerprint: str) -> None:
    """Atomically write the fingerprint sidecar after a successful scaffold.

    Mirrors :func:`write_coauthor_marker`: a sibling ``.tmp`` in the same dir is
    swapped in with ``os.replace`` so a crash mid-write leaves either the previous
    sidecar or none — never truncated JSON that ``read_scaffold_fingerprint``
    would degrade to ``None`` (a harmless cache miss, but still).
    """
    payload = {
        "fingerprint": fingerprint,
        "scaffold_version": SCAFFOLD_VERSION,
        "written_at": datetime.now(timezone.utc).isoformat(),
    }
    target = _fingerprint_path(project_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = resolve_in_workspace(Path(project_dir), SCAFFOLD_FINGERPRINT_FILE + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, target)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass  # best-effort cleanup; re-raise the original failure
        raise


def clear_scaffold_fingerprint(project_dir) -> None:
    """Best-effort delete of the fingerprint sidecar (ignore missing).

    Called when the scaffold is about to diverge from CapForge's control — e.g.
    on co-author enter, where the agent takes ownership of ``index.html``. With no
    sidecar, the next non-co-author preview is forced to re-scaffold rather than
    serve a stale cache hit against an agent-edited composition.
    """
    try:
        target = _fingerprint_path(project_dir)
    except ValueError:
        return
    try:
        target.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        logger.debug("failed to clear scaffold fingerprint", exc_info=True)


def resolve_output_dir(output_dir: Optional[str], source_path: str) -> str:
    """Return an absolute, user-meaningful output directory for a render.

    The request schemas default ``output_dir`` to the bare string ``"output"``,
    which resolves against the backend process's CWD (inside the packaged app) —
    an opaque place the user can't find. So unless the caller supplies an
    *absolute* path, fall back to the folder that holds the source file, i.e.
    "next to the original". An empty/relative value is always treated as "use the
    source's folder" rather than honoured literally.
    """
    if output_dir and Path(output_dir).is_absolute():
        return output_dir
    return str(Path(source_path).expanduser().resolve().parent)


def hyperframes_workspace(source_path: str) -> str:
    """Canonical *parent* dir for a source file's HyperFrames project scaffold.

    ``export_hyperframes_project`` creates ``<stem>-hyperframes`` inside the dir
    it's given. Passing this same workspace from BOTH the "Open in Studio" path
    and the agent's frame-preview path makes them scaffold into one shared
    project folder, instead of diverging (the Studio served one copy while the
    MCP agent edited/previewed another under a relative ``output/``). The Studio
    serves this folder; when the agent re-scaffolds it the changes show up on a
    Studio refresh.

    Lives under the CapForge data home (honouring ``CAPFORGE_HOME`` for test
    isolation), NOT next to the source: the scaffold is intermediate working
    state, while the rendered video still lands next to the source / chosen
    folder. Keyed by a hash of the absolute source path so same-named files in
    different folders don't collide onto one workspace.
    """
    home = Path(os.environ.get("CAPFORGE_HOME") or Path.home() / ".capforge")
    src = Path(source_path).expanduser().resolve()
    tag = hashlib.sha1(str(src).encode("utf-8")).hexdigest()[:8]
    return str(home / "studio" / tag)

def _resolve_duration(
    result: TranscriptionResult,
    groups: list[dict],
    source_video_path: Optional[str],
    duration: Optional[float],
) -> float:
    """Total composition duration: explicit → result → probe → last caption + 1s."""
    if duration and duration > 0:
        return float(duration)
    if result.duration and result.duration > 0:
        return float(result.duration)
    if source_video_path:
        # Lazy import — only touch ffmpeg when we actually need to probe.
        from backend.exporters.video_render import _find_ffmpeg, _probe_duration

        probed = _probe_duration(_find_ffmpeg(), source_video_path)
        if probed and probed > 0:
            return float(probed)
    return (groups[-1]["end"] + 1.0) if groups else 1.0


def _build_index_html(
    config: VideoRenderConfig,
    groups: list[dict],
    duration: float,
    source_src: str,
    font_face: str,
    caption_sub_src: Optional[str] = None,
) -> str:
    # When a native HyperFrames caption style is selected, captions are a
    # referenced sub-composition that owns its own grouping + timeline; the
    # hand-rolled track + its timeline block are skipped. None = classic path.
    native_captions = caption_sub_src is not None
    width = config.resolution_w
    height = config.resolution_h
    # Classic captions are rendered by the faithful CapForge caption generator
    # (hyperframes_caption_html) so the HyperFrames output matches the panel.
    cap = None if native_captions else caption_block(config, groups)
    captions_css = "" if native_captions else cap["css"]

    # Caption layer lives only on the classic path; native styles own theirs. The
    # faithful CapForge caption renderer (matching the panel) is emitted by
    # hyperframes_caption_html: a static runtime + a per-render CFG/GROUPS payload.
    caption_runtime = "" if native_captions else cap["runtime_js"]
    caption_payload = "" if native_captions else cap["payload_js"]
    caption_build = "" if native_captions else cap["build_call"]
    # Register the timeline for the HyperFrames CLI to drive, and flag the
    # composition render-ready (the CLI's snapshot waits on __renderReady; render
    # polls for __timelines["root"] before capturing).
    register_js = (
        "  window.__timelines = window.__timelines || {};\n"
        '  window.__timelines["root"] = tl;\n'
        "  window.__renderReady = true;\n"
    )
    if native_captions:
        # Native captions own their own sub-composition (and font loading); there
        # is no hand-rolled caption measurement here, so build synchronously.
        timeline_js = (
            "(function(){\n"
            "  var tl = gsap.timeline({ paused: true });\n"
            + register_js
            + "})();"
        )
    else:
        # Classic captions: DEFER all DOM measurement + timeline registration
        # until the caption font has loaded. __capBuild measures glyph advances
        # with canvas measureText(); if it runs before the @font-face decodes
        # (the headless render's cold-cache reality) it bakes fallback-font
        # widths → captions render in the right font but with wrong spacing
        # ("connected words"). The CLI polls for __timelines["root"] before
        # capturing and reads frame count from #root's data-duration, so gating
        # registration on font-ready is safe. See hyperframes_caption_html.py.
        timeline_js = (
            caption_runtime
            + "(function(){\n"
            + caption_payload
            + "  function __capStart(){\n"
            + "    var tl = gsap.timeline({ paused: true });\n"
            + caption_build
            + register_js
            + "  }\n"
            + "  __capWhenFontsReady(CAP_CFG, CAP_GROUPS, __capStart);\n"
            + "})();"
        )

    css = f"""
    {font_face}
    #root {{
      position: relative;
      width: {width}px;
      height: {height}px;
      background: #000;
      overflow: hidden;
    }}
    #src-v {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }}
    {captions_css}
    """

    if native_captions:
        # Reference the installed registry caption component as a sub-composition.
        captions_markup = (
            f'<div data-composition-id="captions" data-composition-src="{caption_sub_src}" '
            f'data-start="0" data-duration="{duration}" data-track-index="1"></div>'
        )
    else:
        captions_markup = (
            '<div class="captions" id="captions">\n'
            f"      {cap['markup']}\n"
            "    </div>"
        )

    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>CapForge — HyperFrames composition</title>
  <style>{css}</style>
</head>
<body>
  <div id="root" data-composition-id="root" data-width="{width}" data-height="{height}" data-start="0" data-duration="{duration}" data-fps="{int(config.fps)}">
    <video id="src-v" src="{source_src}" muted playsinline data-start="0" data-duration="{duration}" data-track-index="0"></video>
    <audio id="src-a" src="{source_src}" data-start="0" data-duration="{duration}" data-track-index="2" data-volume="1"></audio>
    {captions_markup}
    <script src="{GSAP_CDN}"></script>
    <script>{timeline_js}</script>
  </div>
</body>
</html>
"""


def _font_face_block(config: VideoRenderConfig, project_dir: Path) -> str:
    """Copy the render font into fonts/ and return an @font-face block, or ''.

    Embeds the SAME file the Pillow renderer rasterizes — resolved via
    ``resolve_font_file`` (custom upload first, else the system file for the
    family). A bundled/system font referenced only by family name is absent on
    the headless render machine and silently falls back, so its glyph advances
    (and thus word spacing) diverge from the preview. Embedding the actual file
    keeps the three renderers measuring one font."""
    resolved = resolve_font_file(
        config.font_family, config.custom_font_path, getattr(config, "bold", True)
    )
    if not resolved:
        return ""
    src = Path(resolved)
    if not src.exists():
        return ""
    fonts_dir = project_dir / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    dest = fonts_dir / src.name
    shutil.copy(src, dest)  # not copy2 — copystat fails on flagged files (system fonts)
    suffix = src.suffix.lower()
    fmt = {".otf": "opentype", ".ttc": "collection"}.get(suffix, "truetype")
    return (
        f'@font-face {{ font-family: "{config.font_family}"; '
        f'src: url("fonts/{src.name}") format("{fmt}"); font-weight: 400; '
        f"font-display: block; }}"
    )


def _word_font_face_blocks(
    config: VideoRenderConfig, groups: list[dict], project_dir: Path
) -> str:
    """@font-face blocks for per-word font overrides, or ''.

    Same mechanism as :func:`_font_face_block`: each distinct per-word
    ``font_family`` / ``bold`` / ``custom_font_path`` override is resolved via
    ``resolve_font_file`` to the exact file Pillow rasterizes for that word and
    embedded so the render browser measures identical glyphs. A per-word
    ``bold: true`` is declared as the SAME family at ``font-weight: 700`` — the
    caption runtime styles those spans weight-700, so this is real face
    matching, never synthetic bold. The ``(main family, 400)`` slot always
    belongs to the main face and is skipped. Resolve/copy failures skip the
    face (the word falls back, like Pillow's own font fallback) — never crash
    the render.
    """
    seen: set[tuple[str, int]] = set()
    blocks: list[str] = []
    for group in groups:
        for w in group.get("words", []):
            ov = w.get("overrides") or {}
            if not any(k in ov for k in ("font_family", "bold", "custom_font_path")):
                continue
            family = ov.get("font_family") or config.font_family
            weight = 700 if ov.get("bold") else 400
            if family == config.font_family and weight == 400:
                continue  # covered by (and must not clobber) the main face
            key = (family, weight)
            if key in seen:
                continue
            seen.add(key)
            custom = ov.get("custom_font_path") or config.custom_font_path
            bold = bool(ov["bold"]) if "bold" in ov else bool(getattr(config, "bold", True))
            resolved = resolve_font_file(family, custom, bold)
            if not resolved:
                continue
            src = Path(resolved)
            if not src.exists():
                continue
            fonts_dir = project_dir / "fonts"
            fonts_dir.mkdir(parents=True, exist_ok=True)
            try:
                # not copy2 — copystat fails on flagged files (system fonts)
                shutil.copy(src, fonts_dir / src.name)
            except OSError:
                continue
            suffix = src.suffix.lower()
            fmt = {".otf": "opentype", ".ttc": "collection"}.get(suffix, "truetype")
            blocks.append(
                f'@font-face {{ font-family: "{family}"; '
                f'src: url("fonts/{src.name}") format("{fmt}"); font-weight: {weight}; '
                f"font-display: block; }}"
            )
    return "\n    ".join(blocks)


def _prepare_caption_style(
    config: VideoRenderConfig,
    project_dir: Path,
    groups: list[dict],
    transcript_json: str,
    duration: float,
    caption_html: Optional[str] = None,
) -> Optional[str]:
    """For a native caption style, install the registry component and feed it our
    transcript; return its project-relative src. Returns None for 'classic'.

    Most components are flat-transcript consumers (swap their words array). A few
    are "designed" — they carry a hand-authored layout (`var BLOCKS`) tied to
    word indices and need a per-style generator (e.g. editorial-emphasis, where
    we rebuild the layout from the user's groups + their emphasized words). An
    unrecognized designed component is refused with a clear message rather than
    rendered with a mismatched layout. The Node-shelling caption module is
    imported lazily so the classic path has no dependency on it.
    """
    style = getattr(config, "caption_style", "classic") or "classic"
    if style == "classic":
        return None
    from backend.exporters.hyperframes_captions import (
        CUSTOM_CAPTION_STYLE,
        CaptionStyleError,
        _BLOCKS_GENERATORS,
        _has_designed_layout,
        fit_caption_component,
        inject_transcript,
        install_caption_component,
        write_custom_caption,
    )

    # Agent-authored style: write the supplied component instead of installing a
    # registry one, then drive it with the transcript exactly like a flat style.
    if style == CUSTOM_CAPTION_STYLE:
        if not caption_html:
            raise CaptionStyleError(
                "No custom caption style has been set. Author one with the "
                "set_custom_caption_style agent tool, or pick a built-in style."
            )
        rel = write_custom_caption(str(project_dir), caption_html)
        component_path = project_dir / rel
        inject_transcript(component_path, transcript_json, duration)
        fit_caption_component(component_path, config.resolution_w, config.resolution_h)
        return rel

    rel = install_caption_component(str(project_dir), style)
    component_path = project_dir / rel

    generator = _BLOCKS_GENERATORS.get(style)
    if generator is not None:
        generator(component_path, groups, duration)  # designed layout from groups
    elif _has_designed_layout(component_path.read_text(encoding="utf-8")):
        raise CaptionStyleError(
            f"The '{style}' caption style uses a fixed designed layout that can't "
            "yet adapt to your transcript. Try a different native style (e.g. "
            "Pill Karaoke / Neon Accent) or the Classic caption style."
        )
    else:
        inject_transcript(component_path, transcript_json, duration)

    # Native caption components are authored for a fixed (16:9) stage — fit them
    # to CapForge's chosen canvas (portrait/4:5/square/4K) so captions aren't
    # clipped or mis-placed. No-op at the native size.
    fit_caption_component(component_path, config.resolution_w, config.resolution_h)
    return rel


def _write_companions(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    project_dir: Path,
    groups: list[dict],
    source_video_path: Optional[str],
    caption_html: Optional[str],
    duration: Optional[float],
) -> tuple[str, str, float, Optional[str]]:
    """Write the CapForge-owned companion files into ``project_dir`` and return
    ``(source_src, transcript_json, total_duration, caption_sub_src)``.

    "Companions" are everything the agent should never hand-maintain: the copied
    source media, ``transcript.json``, and (for a non-classic style) the caption
    sub-composition. Deliberately does NOT write ``index.html`` — both the full
    export and the co-author ``sync_companions`` path share this so caption/
    transcript regeneration can never diverge between them.
    """
    # Source media — copy in so the project is self-contained.
    if source_video_path and Path(source_video_path).exists():
        ext = Path(source_video_path).suffix or ".mp4"
        source_src = f"source{ext}"
        # copy (not copy2): copy2's copystat fails on files with special flags.
        shutil.copy(source_video_path, project_dir / source_src)
    else:
        source_src = "source.mp4"

    total_duration = _resolve_duration(result, groups, source_video_path, duration)

    transcript_json = export_hyperframes(result)
    (project_dir / "transcript.json").write_text(transcript_json, encoding="utf-8")

    caption_sub_src = _prepare_caption_style(
        config, project_dir, groups, transcript_json, total_duration, caption_html
    )
    return source_src, transcript_json, total_duration, caption_sub_src


def coauthor_project_dir(result: TranscriptionResult, output_dir: str) -> Path:
    """The project folder ``export_hyperframes_project`` creates inside ``output_dir``.

    Co-author mode resolves this so it can target the agent's actual project (the
    one the Studio serves) for sync/preview/render, instead of re-scaffolding.
    """
    stem = Path(result.audio_path).stem or "capforge"
    return Path(output_dir) / f"{stem}-hyperframes"


def seed_coauthor_project(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    workspace: str,
    *,
    source_video_path: Optional[str] = None,
    custom_groups: Optional[list[dict]] = None,
    caption_html: Optional[str] = None,
    duration: Optional[float] = None,
    force_scaffold: bool = False,
) -> str:
    """One-time scaffold for co-author mode: a complete, working starter project
    the agent then owns.

    Identical output to a normal export — the only difference is the contract
    around it: once seeded, CapForge stops regenerating ``index.html`` and only
    refreshes companions via ``sync_companions``, so the agent's edits survive.
    ``force_scaffold`` is forwarded so the intentional initial seed can (re)write
    the starter ``index.html`` even under an active co-author marker.
    """
    return export_hyperframes_project(
        result, config, workspace,
        source_video_path=source_video_path,
        custom_groups=custom_groups,
        caption_html=caption_html,
        duration=duration,
        force_scaffold=force_scaffold,
    )


def sync_companions(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    project_dir: str,
    *,
    source_video_path: Optional[str] = None,
    custom_groups: Optional[list[dict]] = None,
    caption_html: Optional[str] = None,
    duration: Optional[float] = None,
) -> dict:
    """Refresh ONLY the CapForge-owned files in a co-author project — never
    ``index.html``.

    Rewrites ``transcript.json``, re-copies the source, and (when the caption
    style uses a sub-composition) regenerates ``compositions/captions...`` so
    caption-style/grouping edits made in the CapForge UI flow into the agent's
    project on a Studio refresh. Classic captions live inline in the agent-owned
    ``index.html`` and are intentionally not touched. Returns what was refreshed.
    """
    project = Path(project_dir)
    if not project.is_dir():
        raise FileNotFoundError(f"Co-author project not found: {project}")
    groups = custom_groups if custom_groups else _build_groups(result, config.words_per_group)
    if not groups:
        raise ValueError("No subtitle data to refresh")
    source_src, _transcript_json, _total, caption_sub_src = _write_companions(
        result, config, project, groups, source_video_path, caption_html, duration
    )
    return {
        "transcript": "transcript.json",
        "source": source_src,
        # None for classic: captions live in the agent-owned index.html.
        "captions": caption_sub_src,
    }


_COMPOSITION_SRC_RE_TEMPLATE = r'data-composition-src\s*=\s*["\'](?:\./)?{rel}["\']'


def detect_coauthor_caption_mismatch(
    index_html_text: str,
    style_name: str,
    caption_rel: Optional[str],
) -> Optional[str]:
    """Detect the co-author "silent caption style" gap (see CLAUDE.md HyperFrames
    Integration / docs/plans/caption-style-visibility-feedback.md Phase 3.5).

    In co-author mode the agent owns ``index.html`` and CapForge only refreshes
    companions via ``sync_companions`` — it never edits ``index.html``. So if a
    registry/custom caption style was selected (``caption_rel`` non-None, the
    installed component's project-relative path from ``sync_companions``'s
    ``captions`` key) but the agent's ``index.html`` never *actually wires it in*
    (no ``data-composition-src="<caption_rel>"`` attribute — a stray mention in a
    comment or string doesn't count), the installed component sits on disk unused
    and the render silently falls back to whatever caption layer (if any) the
    agent already authored inline. Returns a human-readable warning in that case,
    else ``None`` (classic style, or the style IS wired in).

    Matches the attribute specifically (regex on ``data-composition-src="..."``,
    tolerating a leading ``./`` and single/double quotes) rather than a bare
    substring check, so a leftover ``<!-- TODO: wire caption-x.html -->`` comment
    can't accidentally suppress a real warning.

    Pure/side-effect-free: does not read or write files, does not touch
    ``index.html`` — callers pass in the text they already have.
    """
    if not caption_rel:
        return None
    pattern = _COMPOSITION_SRC_RE_TEMPLATE.format(rel=re.escape(caption_rel))
    if re.search(pattern, index_html_text):
        return None
    return (
        "Co-author project controls its own captions — the selected style "
        f"'{style_name}' is installed at {caption_rel} but not referenced by "
        "index.html. Ask the agent to wire it in, or exit co-author mode."
    )


def export_hyperframes_project(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    output_dir: str,
    source_video_path: Optional[str] = None,
    custom_groups: Optional[list[dict]] = None,
    duration: Optional[float] = None,
    caption_html: Optional[str] = None,
    force_scaffold: bool = False,
) -> str:
    """Write a HyperFrames project folder and return its path.

    `custom_groups` (when provided) mirrors `render_subtitle_video` — manually
    edited groups skip auto-grouping. `source_video_path` is copied into the
    project so the composition is self-contained; when omitted, the composition
    still references `source.mp4` for later wiring. `caption_html` is the
    agent-authored component used when `config.caption_style == "custom"`.

    `force_scaffold` must be True to (re)scaffold over a project whose co-author
    marker is active — the ONE legitimate case is the intentional initial seed in
    the co-author enter path. Without it, an existing `index.html` under an active
    marker raises :class:`CoauthorClobberError` rather than clobbering the agent's
    authored composition.
    """
    groups = custom_groups if custom_groups else _build_groups(result, config.words_per_group)
    if not groups:
        raise ValueError("No subtitle data to build a HyperFrames composition")

    project_dir = coauthor_project_dir(result, output_dir)
    project_dir.mkdir(parents=True, exist_ok=True)

    # Clobber guard: never silently overwrite an agent-authored index.html when
    # the durable marker says the project is being co-authored.
    if not force_scaffold and (project_dir / "index.html").exists():
        marker = read_coauthor_marker(project_dir)
        if marker is not None and marker.get("active") is True:
            raise CoauthorClobberError(
                "Co-author project detected; scaffolding would overwrite "
                "agent-authored index.html. Exit co-author mode first or pass force."
            )

    source_src, transcript_json, total_duration, caption_sub_src = _write_companions(
        result, config, project_dir, groups, source_video_path, caption_html, duration
    )

    font_face = _font_face_block(config, project_dir)
    word_faces = _word_font_face_blocks(config, groups, project_dir)
    if word_faces:
        font_face = f"{font_face}\n    {word_faces}" if font_face else word_faces
    index_html = _build_index_html(
        config, groups, total_duration, source_src, font_face,
        caption_sub_src,
    )
    (project_dir / "index.html").write_text(index_html, encoding="utf-8")

    (project_dir / "README.txt").write_text(
        "CapForge → HyperFrames composition\n\n"
        "Preview:  npx hyperframes preview\n"
        "Validate: npx hyperframes lint && npx hyperframes validate\n"
        "Inspect:  npx hyperframes inspect\n"
        "Render:   npx hyperframes render --quality draft\n\n"
        "Requires Node.js 22+ and FFmpeg.\n",
        encoding="utf-8",
    )

    # Record the fingerprint so ``ensure_hyperframes_project`` can skip an
    # identical re-scaffold. Best-effort: a failure here just forces the next
    # preview to re-scaffold (the safe direction), never a stale hit.
    try:
        fingerprint = _composition_fingerprint(
            config, groups, result, source_video_path, duration, caption_html
        )
        write_scaffold_fingerprint(project_dir, fingerprint)
    except (OSError, ValueError):
        logger.debug("failed to write scaffold fingerprint", exc_info=True)

    return str(project_dir)


def ensure_hyperframes_project(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    output_dir: str,
    source_video_path: Optional[str] = None,
    custom_groups: Optional[list[dict]] = None,
    duration: Optional[float] = None,
    caption_html: Optional[str] = None,
    force_scaffold: bool = False,
) -> str:
    """Scaffold-cached wrapper around :func:`export_hyperframes_project`.

    Same signature and return value (the project dir path). When a previous
    scaffold's fingerprint still matches the current inputs, ``SCAFFOLD_VERSION``
    is unchanged, AND ``index.html`` exists, this returns the existing project
    WITHOUT re-scaffolding (fonts re-embedded, HTML rebuilt) — the fast path for
    the agent's preview→tweak→preview loop. Any mismatch (or a missing/corrupt
    sidecar) falls through to a full scaffold.

    Correctness over speed: the fingerprint over-includes every input that
    reaches the HTML, so a spurious re-scaffold is possible but a stale hit is
    not. NOT used in co-author mode — that path is ``sync_companions``-only and
    the agent owns ``index.html``.
    """
    t0 = time.perf_counter()
    project_dir = coauthor_project_dir(result, output_dir)
    groups = custom_groups if custom_groups else _build_groups(result, config.words_per_group)

    if groups:
        current_fp = _composition_fingerprint(
            config, groups, result, source_video_path, duration, caption_html
        )
        stored = read_scaffold_fingerprint(project_dir)
        if (
            stored is not None
            and stored.get("fingerprint") == current_fp
            and stored.get("scaffold_version") == SCAFFOLD_VERSION
            and (project_dir / "index.html").is_file()
        ):
            logger.info(
                "scaffold skipped (cache hit) in %.1fms", (time.perf_counter() - t0) * 1000
            )
            return str(project_dir)

    path = export_hyperframes_project(
        result,
        config,
        output_dir,
        source_video_path=source_video_path,
        custom_groups=custom_groups,
        duration=duration,
        caption_html=caption_html,
        force_scaffold=force_scaffold,
    )
    logger.info("scaffold run in %.1fms", (time.perf_counter() - t0) * 1000)
    return path
