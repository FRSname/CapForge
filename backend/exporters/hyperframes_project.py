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
import html
import json
import logging
import os
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
SCAFFOLD_VERSION = 2

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
    effects: Optional[list[dict]],
    duration: Optional[float],
    caption_html: Optional[str],
) -> str:
    """Full stored fingerprint: the scaffold core plus the remaining inputs that
    also reach ``index.html`` (effects markup/timeline, the composition duration,
    and an agent-authored custom caption component). Kept separate from
    :func:`_scaffold_fingerprint` so the core stays the documented, independently
    testable building block while the cache still invalidates on ANY HTML input.
    """
    base = _scaffold_fingerprint(config, groups, result, source_path)
    extra = json.dumps(
        {
            "effects": effects,
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

_DEFAULT_LOGO_WIDTH_FRAC = 0.18  # logo width as a fraction of canvas width when unset
_ACCENT = "#D4952A"  # CapForge brand orange — default accent for text effects

# Per-effect-type entrance/exit. Each set animates the effect's INNER element so
# the outer .fx keeps positioning (centering transforms never fight the motion —
# the same split that fixed caption drift).
_FX_ANIM: dict[str, dict] = {
    "logo": {
        "from": {"opacity": 0, "scale": 0.8},
        "to": {"opacity": 1, "scale": 1},
        "exit": {"opacity": 0, "scale": 0.95},
        "edur": 0.4, "xdur": 0.25, "ease": "back.out(1.7)",
    },
    "lower_third": {
        "from": {"opacity": 0, "x": -40},
        "to": {"opacity": 1, "x": 0},
        "exit": {"opacity": 0, "x": -28},
        "edur": 0.45, "xdur": 0.3, "ease": "power3.out",
    },
    "kinetic_stat": {
        "from": {"opacity": 0, "scale": 0.6, "y": 18},
        "to": {"opacity": 1, "scale": 1, "y": 0},
        "exit": {"opacity": 0, "scale": 0.9},
        "edur": 0.5, "xdur": 0.25, "ease": "back.out(2)",
    },
    # Marker sweep: scaleX from the left edge (transformOrigin set via GSAP so it
    # survives GSAP overwriting the inline transform-origin).
    "highlight": {
        "from": {"opacity": 0, "scaleX": 0, "transformOrigin": "left center"},
        "to": {"opacity": 1, "scaleX": 1, "transformOrigin": "left center"},
        "exit": {"opacity": 0},
        "edur": 0.4, "xdur": 0.2, "ease": "power2.out",
    },
    # B-roll insert: gentle zoom-settle, sits behind the captions (z-index 5).
    "b_roll": {
        "from": {"opacity": 0, "scale": 1.06},
        "to": {"opacity": 1, "scale": 1},
        "exit": {"opacity": 0, "scale": 1.0},
        "edur": 0.5, "xdur": 0.3, "ease": "power2.out",
    },
}


def _css_rgba(hex_color: str, opacity: float) -> str:
    """Convert '#RRGGBB' (+ opacity) to a CSS rgba() string."""
    h = (hex_color or "#000000").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    except (ValueError, IndexError):
        r, g, b = 0, 0, 0
    return f"rgba({r}, {g}, {b}, {max(0.0, min(1.0, opacity)):.3f})"


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


def _copy_asset(
    src: object, project_dir: Path, copied: set[str]
) -> Optional[str]:
    """Copy an asset into assets/ (once) and return its project-relative path,
    or None if the source is missing."""
    if not src or not Path(str(src)).exists():
        return None
    src_path = Path(str(src))
    if src_path.name not in copied:
        assets_dir = project_dir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, assets_dir / src_path.name)
        copied.add(src_path.name)
    return f"assets/{src_path.name}"


def _build_effect_inner(
    ftype: str,
    variables: dict,
    x: float,
    y: float,
    canvas_w: int,
    canvas_h: int,
    project_dir: Path,
    copied: set[str],
) -> Optional[tuple[str, str, str]]:
    """Build one effect's (outer_style, inner_class, inner_html), or None to skip.

    `outer_style` positions the wrapper (incl. its centering transform); the
    inner element is what the timeline animates. Returns None when required
    content is missing (e.g. a logo with no image, an empty text effect).
    """
    if ftype == "logo":
        rel = _copy_asset(variables.get("src") or variables.get("logo_path"), project_dir, copied)
        if rel is None:
            return None  # nothing to show without an image
        width = variables.get("width")
        if not isinstance(width, (int, float)) or width <= 0:
            width = int(_DEFAULT_LOGO_WIDTH_FRAC * canvas_w)
        outer_style = (
            f"left: {x}%; top: {y}%; width: {int(width)}px; "
            "transform: translate(-50%, -50%);"
        )
        inner = f'<img src="{rel}" style="width: 100%; display: block;" />'
        return outer_style, "fx-logo", inner

    if ftype == "lower_third":
        title = str(variables.get("title") or variables.get("text") or "").strip()
        if not title:
            return None
        subtitle = str(variables.get("subtitle") or "").strip()
        accent = str(variables.get("accent") or _ACCENT)
        outer_style = f"left: {x}%; top: {y}%; transform: translateY(-50%);"
        sub_html = (
            f'<div class="fx-lower-sub">{html.escape(subtitle)}</div>' if subtitle else ""
        )
        inner = (
            f'<div class="fx-lower-bar" style="background: {accent};"></div>'
            f'<div class="fx-lower-text">'
            f'<div class="fx-lower-title">{html.escape(title)}</div>{sub_html}'
            f"</div>"
        )
        return outer_style, "fx-lower", inner

    if ftype == "kinetic_stat":
        value = str(variables.get("value") or variables.get("text") or "").strip()
        if not value:
            return None
        label = str(variables.get("label") or "").strip()
        accent = str(variables.get("accent") or _ACCENT)
        outer_style = f"left: {x}%; top: {y}%; transform: translate(-50%, -50%);"
        label_html = (
            f'<div class="fx-stat-label">{html.escape(label)}</div>' if label else ""
        )
        inner = (
            f'<div class="fx-stat-value" style="color: {accent};">{html.escape(value)}</div>'
            f"{label_html}"
        )
        return outer_style, "fx-stat", inner

    if ftype == "highlight":
        # A highlighter marker swept across a spoken word. Translucent so the
        # word stays legible; sized in px (defaults relative to the canvas).
        color = variables.get("color")
        color = str(color) if color else _css_rgba(str(variables.get("accent") or _ACCENT), 0.45)
        width = variables.get("width")
        if not isinstance(width, (int, float)) or width <= 0:
            width = int(0.22 * canvas_w)
        height = variables.get("height")
        if not isinstance(height, (int, float)) or height <= 0:
            height = max(24, int(0.055 * canvas_h))
        # Outer anchored by the marker's left edge so the sweep starts where placed.
        outer_style = f"left: {x}%; top: {y}%; transform: translate(0, -50%);"
        inner = (
            f'<div class="fx-hl-bar" style="width: {int(width)}px; '
            f'height: {int(height)}px; background: {color};"></div>'
        )
        return outer_style, "fx-highlight", inner

    if ftype == "b_roll":
        rel = _copy_asset(variables.get("src"), project_dir, copied)
        if rel is None:
            return None
        if variables.get("fullscreen"):
            outer_style = "left: 0; top: 0; width: 100%; height: 100%;"
            img_style = "width: 100%; height: 100%; object-fit: cover; display: block;"
        else:
            width = variables.get("width")
            if not isinstance(width, (int, float)) or width <= 0:
                width = int(0.5 * canvas_w)
            outer_style = (
                f"left: {x}%; top: {y}%; width: {int(width)}px; "
                "transform: translate(-50%, -50%);"
            )
            img_style = "width: 100%; height: auto; display: block;"
        inner = f'<img src="{rel}" style="{img_style}" />'
        return outer_style, "fx-broll", inner

    return None  # unknown type


def _prepare_effects(
    effects: Optional[list[dict]], project_dir: Path, canvas_w: int, canvas_h: int
) -> list[dict]:
    """Copy effect assets in and return render-ready effect dicts.

    Dispatches per `type` (logo / lower_third / kinetic_stat / highlight /
    b_roll). Effects with an unknown type or missing required content are
    skipped. Each prepared effect carries its own enter/exit animation so the
    timeline stays type-agnostic.
    """
    if not effects:
        return []
    prepared: list[dict] = []
    copied: set[str] = set()
    for i, fx in enumerate(effects):
        ftype = fx.get("type", "logo")
        if ftype not in _FX_ANIM:
            continue
        variables = fx.get("variables") or {}
        x = round(float(fx.get("anchor_x", 0.5)) * 100, 3)
        y = round(float(fx.get("anchor_y", 0.5)) * 100, 3)
        built = _build_effect_inner(
            ftype, variables, x, y, canvas_w, canvas_h, project_dir, copied
        )
        if built is None:
            continue
        outer_style, inner_class, inner_html = built
        start = float(fx.get("start", 0.0))
        duration = float(fx.get("duration", 2.0))
        anim = _FX_ANIM[ftype]
        prepared.append({
            "id": f"fx-{i}",
            "s": start,
            "e": start + duration,
            "style": outer_style,
            "cls": inner_class,
            "inner": inner_html,
            "ef": anim["from"], "et": anim["to"], "xt": anim["exit"],
            "ed": anim["edur"], "xd": anim["xdur"], "ee": anim["ease"],
        })
    return prepared


def _effects_html(effects: list[dict]) -> str:
    """Pre-rendered effect wrappers (hidden via CSS; revealed by the timeline).

    Outer `.fx` is positioned; the inner element is the animation target — the
    same position/motion split used for captions so transforms never collide.
    """
    return "\n      ".join(
        f'<div id="{fx["id"]}" class="fx" style="{fx["style"]}">'
        f'<div id="{fx["id"]}-i" class="fx-inner {fx["cls"]}">{fx["inner"]}</div>'
        f"</div>"
        for fx in effects
    )


def _build_index_html(
    config: VideoRenderConfig,
    groups: list[dict],
    duration: float,
    source_src: str,
    font_face: str,
    effects: list[dict],
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
    effects_html = _effects_html(effects)
    # Text-effect sizing, derived from canvas height for resolution independence.
    lt_title_px = max(20, int(height * 0.045))
    lt_sub_px = max(14, int(height * 0.030))
    stat_value_px = max(48, int(height * 0.16))
    stat_label_px = max(16, int(height * 0.038))

    # Caption layer lives only on the classic path; native styles own theirs. The
    # faithful CapForge caption renderer (matching the panel) is emitted by
    # hyperframes_caption_html: a static runtime + a per-render CFG/GROUPS payload.
    caption_runtime = "" if native_captions else cap["runtime_js"]
    caption_payload = "" if native_captions else cap["payload_js"]
    caption_build = "" if native_captions else cap["build_call"]
    effects_js = (
        f"  var EFFECTS = {json.dumps([{k: fx[k] for k in ('id', 's', 'e', 'ef', 'et', 'xt', 'ed', 'xd', 'ee')} for fx in effects])};\n"
        "  EFFECTS.forEach(function(fx){\n"
        '    var outer = "#" + fx.id;\n'
        '    var inner = "#" + fx.id + "-i";\n'
        '    tl.set(outer, { visibility: "visible" }, fx.s);\n'
        '    var to = Object.assign({}, fx.et, { duration: fx.ed, ease: fx.ee, overwrite: "auto" });\n'
        "    tl.fromTo(inner, fx.ef, to, fx.s);\n"
        "    var fxExit = Math.max(fx.s, fx.e - fx.xd);\n"
        '    var ex = Object.assign({}, fx.xt, { duration: fx.xd, ease: "power2.in", overwrite: "auto" });\n'
        "    tl.to(inner, ex, fxExit);\n"
        '    tl.set(outer, { visibility: "hidden" }, fx.e);\n'
        "    tl.set(inner, { opacity: 0 }, fx.e);\n"
        "  });\n"
    )
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
            + effects_js
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
            + effects_js
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
    /* Effects: outer .fx positions (incl. centering transform), .fx-inner is the
       animation target — position/motion split, same as captions. */
    .fx {{ position: absolute; visibility: hidden; z-index: 5; pointer-events: none; }}
    .fx-inner {{ opacity: 0; }}
    .fx-lower {{
      display: flex; align-items: stretch; gap: 14px; max-width: 46%;
      background: rgba(12, 12, 14, 0.78);
      padding: 14px 22px 14px 14px; border-radius: 10px;
      font-family: "{config.font_family}", system-ui, sans-serif;
    }}
    .fx-lower-bar {{ width: 5px; border-radius: 3px; flex: 0 0 auto; }}
    .fx-lower-title {{ color: #fff; font-size: {lt_title_px}px; font-weight: 700; line-height: 1.15; white-space: nowrap; }}
    .fx-lower-sub {{ color: rgba(255, 255, 255, 0.72); font-size: {lt_sub_px}px; margin-top: 3px; white-space: nowrap; }}
    .fx-stat {{ text-align: center; font-family: "{config.font_family}", system-ui, sans-serif; }}
    .fx-stat-value {{ font-size: {stat_value_px}px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; text-shadow: 0 4px 24px rgba(0, 0, 0, 0.45); }}
    .fx-stat-label {{ color: #fff; font-size: {stat_label_px}px; font-weight: 600; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.08em; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5); }}
    .fx-highlight {{ display: inline-block; }}
    .fx-hl-bar {{ border-radius: 4px; }}
    .fx-broll {{ line-height: 0; }}
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
    {effects_html}
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
    effects: Optional[list[dict]] = None,
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
        effects=effects,
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


def export_hyperframes_project(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    output_dir: str,
    source_video_path: Optional[str] = None,
    custom_groups: Optional[list[dict]] = None,
    effects: Optional[list[dict]] = None,
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
    effects_render = _prepare_effects(
        effects, project_dir, config.resolution_w, config.resolution_h
    )
    index_html = _build_index_html(
        config, groups, total_duration, source_src, font_face, effects_render,
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
            config, groups, result, source_video_path, effects, duration, caption_html
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
    effects: Optional[list[dict]] = None,
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
            config, groups, result, source_video_path, effects, duration, caption_html
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
        effects=effects,
        duration=duration,
        caption_html=caption_html,
        force_scaffold=force_scaffold,
    )
    logger.info("scaffold run in %.1fms", (time.perf_counter() - t0) * 1000)
    return path
