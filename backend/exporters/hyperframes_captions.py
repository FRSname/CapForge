"""Install and feed HyperFrames registry caption-style components (Phase 3).

CapForge's default ("classic") caption track is the hand-rolled instant-recolor
renderer in `hyperframes_project.py`. As an opt-in upgrade, the user (or the
connected agent) can pick one of HyperFrames' native registry caption styles —
`caption-pill-karaoke`, `caption-neon-accent`, … Each is a self-contained
sub-composition with its OWN grouping + GSAP timeline and the transcript baked in
as `var TRANSCRIPT = [{text,start,end}]` (verified by inspecting the installed
component; `normalizeWords` there accepts `word||text`).

Integration (proven end-to-end with `lint` + a draft render):
  1. install the component via `npx hyperframes add <style>` (idempotent — skips
     when already present), then
  2. inject our transcript + composition duration into the copied file.
The generated root composition references it with `data-composition-src`.

Node 22+ is required to *install* (same dependency as the HyperFrames render
path). Injection is a pure file rewrite — no Node. The classic path touches none
of this.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Project-relative dir the CLI writes components into (verified via `add --json`:
# written → compositions/components/<style>.html).
_COMPONENT_DIR = "compositions/components"

# Verified registry caption styles (`catalog --tag caption-style --json`,
# hyperframes v0.6.114). Curated fallback for the picker when the live catalog
# can't be queried (Node/npx absent).
_CURATED_STYLES: list[dict] = [
    {"name": "caption-pill-karaoke", "title": "Pill Karaoke"},
    {"name": "caption-neon-accent", "title": "Neon Accent"},
    {"name": "caption-weight-shift", "title": "Weight Shift"},
    {"name": "caption-emoji-pop", "title": "Emoji Pop"},
    {"name": "caption-editorial-emphasis", "title": "Editorial Emphasis"},
    {"name": "caption-parallax-layers", "title": "Parallax Layers"},
    {"name": "caption-glitch-rgb", "title": "Glitch RGB"},
    {"name": "caption-matrix-decode", "title": "Matrix Decode"},
    {"name": "caption-particle-burst", "title": "Particle Burst"},
    {"name": "caption-texture", "title": "Texture"},
    {"name": "caption-clip-wipe", "title": "Clip Wipe"},
    {"name": "caption-kinetic-slam", "title": "Kinetic Slam"},
    {"name": "caption-gradient-fill", "title": "Gradient Fill"},
    {"name": "caption-neon-glow", "title": "Neon Glow"},
    {"name": "caption-highlight", "title": "Highlight"},
]

_styles_cache: Optional[list[dict]] = None


class CaptionStyleError(RuntimeError):
    """Raised when a native caption-style component can't be installed/prepared."""


def component_rel_path(style: str) -> str:
    """Project-relative path the CLI installs a caption component to."""
    return f"{_COMPONENT_DIR}/{style}.html"


def _query_catalog() -> Optional[list[dict]]:
    """Ask the live registry for caption styles, or None if unavailable."""
    npx = shutil.which("npx")
    if not npx:
        return None
    try:
        proc = subprocess.run(
            [npx, "-y", "hyperframes", "catalog", "--tag", "caption-style", "--json"],
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            return None
        items = json.loads(proc.stdout)
        return [{"name": it["name"], "title": it.get("title", it["name"])} for it in items]
    except (json.JSONDecodeError, subprocess.SubprocessError, KeyError, OSError):
        return None


def list_caption_styles() -> list[dict]:
    """Available caption styles for the picker: 'classic' + the registry styles.

    Queries the live catalog once (cached for the process); falls back to the
    curated list when Node/npx is unavailable.
    """
    global _styles_cache
    if _styles_cache is None:
        _styles_cache = _query_catalog() or _CURATED_STYLES
    return [{"name": "classic", "title": "Classic (CapForge)"}, *_styles_cache]


def _format_seconds(value: float) -> str:
    """Trim a float to a compact string (3.0 -> '3', 3.250 -> '3.25')."""
    return f"{float(value):.3f}".rstrip("0").rstrip(".") or "0"


def install_caption_component(project_dir: str, style: str) -> str:
    """Install registry caption component `style` into the project (idempotent).

    Returns its project-relative path. Raises `CaptionStyleError` if npx/Node is
    missing, the install fails, or the style name is unknown.
    """
    rel = component_rel_path(style)
    dest = Path(project_dir) / rel
    if dest.exists():
        return rel  # cached — `add` already ran for this style in this project

    npx = shutil.which("npx")
    if not npx:
        raise CaptionStyleError(
            f"Node.js 22+ (npx) is required to use the '{style}' caption style. "
            "Install Node, or use the Classic caption style."
        )
    cmd = [
        npx, "-y", "hyperframes", "add", style,
        "--json", "--no-clipboard", "--dir", str(project_dir),
    ]
    logger.info("Installing caption style: %s", " ".join(cmd))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(project_dir))
    except FileNotFoundError as exc:  # npx vanished between which() and exec
        raise CaptionStyleError(f"Failed to run HyperFrames: {exc}") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-500:]
        raise CaptionStyleError(f"Could not install caption style '{style}':\n{detail}")
    if not dest.exists():
        raise CaptionStyleError(
            f"Caption style '{style}' did not install to {rel} — is the style name correct?"
        )
    return rel


def _native_dims(src: str) -> tuple[int, int]:
    """Read a caption component's authored canvas size (it's designed for a fixed
    stage, e.g. 1920×1080). Falls back through data-* → viewport → 1920×1080."""
    mw = re.search(r'data-width="(\d+)"', src)
    mh = re.search(r'data-height="(\d+)"', src)
    if mw and mh:
        return int(mw.group(1)), int(mh.group(1))
    vp = re.search(r'width=(\d+),\s*height=(\d+)', src)
    if vp:
        return int(vp.group(1)), int(vp.group(2))
    return 1920, 1080


def fit_caption_component(component_path: Path, target_w: int, target_h: int) -> None:
    """Make a registry caption component fill a `target_w`×`target_h` frame.

    Registry caption components are authored for a fixed stage (typically
    1920×1080) with absolute-pixel internal layout. HyperFrames renders a
    sub-composition at its OWN body size, unscaled (verified: a 1920×1080
    component drops top-left into a 1080×1920 frame, clipped). So for any
    non-native canvas we:
      1. set the component's body/viewport to the target size, and
      2. fit its natively-authored content to the frame with a single CSS
         transform on the composition root (`[data-composition-id]`): scale to
         the target *width* and anchor the caption band to the bottom
         (bottom-center origin). The component's own JS/layout runs untouched in
         native coordinates — CSS just scales the rendered result.

    Component-agnostic (no per-style internal-constant surgery) and a no-op when
    the target already matches the native stage (keeps that path byte-stable).
    Proven end-to-end (portrait 1080×1920: captions full-width, bottom-anchored,
    karaoke intact).
    """
    src = component_path.read_text(encoding="utf-8")
    native_w, native_h = _native_dims(src)
    if (target_w, target_h) == (native_w, native_h):
        return  # native stage — leave the proven path exactly as-is

    scale = round(target_w / native_w, 6)
    src = re.sub(
        r'<meta name="viewport"[^>]*/?>',
        f'<meta name="viewport" content="width={target_w}, height={target_h}" />',
        src,
        count=1,
    )
    # Appended !important rules override the component's own canvas + root box
    # without depending on its exact CSS formatting.
    override = (
        f"\nhtml, body {{ width: {target_w}px !important; height: {target_h}px !important; }}\n"
        f"[data-composition-id] {{ position: absolute !important; left: 50% !important; "
        f"bottom: 0 !important; top: auto !important; "
        f"width: {native_w}px !important; height: {native_h}px !important; "
        f"transform: translateX(-50%) scale({scale}) !important; "
        f"transform-origin: bottom center !important; }}\n"
    )
    if "</style>" in src:
        src = src.replace("</style>", override + "</style>", 1)
    else:  # defensive — every shipped caption component has a <style>, but don't crash
        src = src.replace("</head>", f"<style>{override}</style>\n</head>", 1)
    component_path.write_text(src, encoding="utf-8")


def inject_transcript(component_path: Path, transcript_json: str, duration: float) -> None:
    """Rewrite a caption component's baked-in TRANSCRIPT + clock in place.

    `transcript_json` is a JSON array string of `[{"text","start","end"}]` (the
    same payload CapForge writes to transcript.json). Raises `CaptionStyleError`
    if the component doesn't carry a TRANSCRIPT array to replace.
    """
    src = component_path.read_text(encoding="utf-8")
    src, n = re.subn(
        r"var TRANSCRIPT = \[[\s\S]*?\];",
        f"var TRANSCRIPT = {transcript_json};",
        src,
        count=1,
    )
    if n == 0:
        raise CaptionStyleError(
            f"{component_path.name} has no TRANSCRIPT array — unexpected component format."
        )
    dur = _format_seconds(duration)
    # Match the component clock to our composition (DURATION var + every
    # data-duration on the component's root + its background video).
    src = re.sub(r"var DURATION = [\d.]+;", f"var DURATION = {dur};", src)
    src = re.sub(r'(data-duration=")[\d.]+(")', rf"\g<1>{dur}\g<2>", src)
    component_path.write_text(src, encoding="utf-8")
