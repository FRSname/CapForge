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
import subprocess
from pathlib import Path
from typing import Optional

from .node_runtime import find_npx

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
    npx = find_npx()
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
    # Resolve to an ABSOLUTE dir: we pass it as both --dir and cwd, so a relative
    # path (e.g. "output/foo-hyperframes") would double-nest — the CLI resolves
    # --dir against cwd → output/foo-hyperframes/output/foo-hyperframes — and the
    # component never lands where we look for it. (This is what failed live.)
    proj = Path(project_dir).resolve()
    rel = component_rel_path(style)
    dest = proj / rel
    if dest.exists():
        return rel  # cached — `add` already ran for this style in this project

    npx = find_npx()
    if not npx:
        raise CaptionStyleError(
            f"Node.js 22+ (npx) is required to use the '{style}' caption style. "
            "Install Node, or use the Classic caption style."
        )
    cmd = [
        npx, "-y", "hyperframes", "add", style,
        "--json", "--no-clipboard", "--dir", str(proj),
    ]
    logger.info("Installing caption style: %s", " ".join(cmd))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(proj))
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


# Registry caption components bake their transcript under one of these names —
# a flat `[{text,start,end}]` array we swap for ours. (pill-karaoke → TRANSCRIPT,
# editorial-emphasis → W.)
_TRANSCRIPT_VARS = ("TRANSCRIPT", "WORDS", "W")

def _has_designed_layout(src: str) -> bool:
    """True when a component carries a hand-authored `var BLOCKS` layout (tied to
    word indices) rather than a plain flat transcript. Such a component can't be
    driven by a simple array swap — it needs a per-style generator, else its
    layout would point at the wrong words."""
    return re.search(r"var\s+BLOCKS\s*=\s*\[", src) is not None


def _retime(src: str, duration: float) -> str:
    """Match a component's clock to our composition (DURATION var + every
    data-duration on its root + background video)."""
    dur = _format_seconds(duration)
    src = re.sub(r"var DURATION = [\d.]+;", f"var DURATION = {dur};", src)
    src = re.sub(r'(data-duration=")[\d.]+(")', rf"\g<1>{dur}\g<2>", src)
    return src


def inject_transcript(component_path: Path, transcript_json: str, duration: float) -> None:
    """Rewrite a flat-transcript caption component's baked array + clock in place.

    `transcript_json` is a JSON array string of `[{"text","start","end"}]` (the
    same payload CapForge writes to transcript.json). Raises `CaptionStyleError`
    if the component carries no recognized transcript array.
    """
    src = component_path.read_text(encoding="utf-8")
    for var in _TRANSCRIPT_VARS:
        src, n = re.subn(
            rf"var\s+{var}\s*=\s*\[[\s\S]*?\];",
            f"var {var} = {transcript_json};",
            src,
            count=1,
        )
        if n:
            break
    else:
        raise CaptionStyleError(
            f"{component_path.name} has no recognized transcript array "
            "(TRANSCRIPT/WORDS/W) — unexpected component format."
        )
    component_path.write_text(_retime(src, duration), encoding="utf-8")


# --- Designed (BLOCKS) components: editorial-emphasis ---------------------

_EMPHASIS_SCALE_MIN = 1.05  # font_size_scale above this counts as "emphasized"


def _word_is_emphasis(word: dict) -> bool:
    """A word the user emphasized (bigger or bold) — these become editorial's
    big serif `e` words. Reads the same per-word overrides the classic renderer
    uses (snake_case: font_size_scale / bold)."""
    ov = word.get("overrides") or {}
    try:
        if float(ov.get("font_size_scale", 1.0)) > _EMPHASIS_SCALE_MIN:
            return True
    except (TypeError, ValueError):
        pass
    return bool(ov.get("bold"))


def build_editorial_blocks(groups: list[dict]) -> tuple[list[dict], list[dict]]:
    """Build editorial-emphasis's `W` (flat words) + `BLOCKS` (layout) from
    CapForge display groups.

    One block per group; each group's words split across up to two lines; words
    the user emphasized are tagged `e` (big Playfair serif), the rest `n`. BLOCKS
    entries reference words by their index in `W` — matching the component's own
    schema (`{line1: [[idx, type], ...], line2: [...] | null}`).
    """
    words: list[dict] = []
    blocks: list[dict] = []
    idx = 0
    for group in groups:
        line: list[list] = []
        for w in group.get("words") or []:
            text = str(w.get("word", "")).strip()
            if not text:
                continue
            words.append({
                "text": text,
                "start": round(float(w.get("start", 0.0)), 3),
                "end": round(float(w.get("end", 0.0)), 3),
            })
            line.append([idx, "e" if _word_is_emphasis(w) else "n"])
            idx += 1
        if not line:
            continue
        if len(line) <= 2:
            blocks.append({"line1": line, "line2": None})
        else:  # split roughly in half so a block is at most two lines
            half = (len(line) + 1) // 2
            blocks.append({"line1": line[:half], "line2": line[half:]})
    return words, blocks


def inject_editorial_blocks(component_path: Path, groups: list[dict], duration: float) -> None:
    """Drive a designed `W`+`BLOCKS` component (editorial-emphasis) with the
    user's transcript + emphasis. Replaces both arrays + the clock in place."""
    src = component_path.read_text(encoding="utf-8")
    words, blocks = build_editorial_blocks(groups)
    if not words:
        raise CaptionStyleError("No caption words to build the editorial layout.")
    src, nw = re.subn(r"var\s+W\s*=\s*\[[\s\S]*?\];", "var W = " + json.dumps(words) + ";", src, count=1)
    src, nb = re.subn(
        r"var\s+BLOCKS\s*=\s*\[[\s\S]*?\];", "var BLOCKS = " + json.dumps(blocks) + ";", src, count=1
    )
    if not (nw and nb):
        raise CaptionStyleError(
            f"{component_path.name} is not the expected editorial-emphasis layout "
            "(missing W/BLOCKS) — component format changed."
        )
    component_path.write_text(_retime(src, duration), encoding="utf-8")


#: style → designed-layout generator (else flat transcript injection is used).
_BLOCKS_GENERATORS = {"caption-editorial-emphasis": inject_editorial_blocks}


# --- Agent-authored custom caption styles --------------------------------
# Instead of a registry style, the connected Claude agent can author a brand-new
# caption component (its own HTML/CSS/GSAP) and CapForge drives it with only the
# transcript + timing. caption_style == CUSTOM_CAPTION_STYLE selects it.

CUSTOM_CAPTION_STYLE = "custom"
CUSTOM_CAPTION_REL = f"{_COMPONENT_DIR}/custom-caption.html"

# Patterns the HyperFrames renderer forbids (non-deterministic / unsupported);
# a custom component carrying any of these would render wrong or non-reproducibly.
_BANNED_PATTERNS = ("Math.random", "Date.now", "repeat: -1", "repeat:-1", "data-end", "data-layer")


def custom_caption_template() -> str:
    """A correct, minimal, restyle-ready caption component for the agent to adapt.

    Follows the HyperFrames caption contract end-to-end: transparent stage, a
    `var TRANSCRIPT` placeholder CapForge swaps for the real words, simple
    grouping, a paused GSAP timeline with an entrance per group and a hard
    `tl.set` kill at each group's end (one group visible at a time). The agent
    keeps this structure and rewrites the CSS / entrance to invent a new look.
    """
    return """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1920, height=1080" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
    #cap-root { position: relative; width: 1920px; height: 1080px; background: transparent;
                font-family: "Inter", system-ui, sans-serif; }
    /* ↓↓↓ RESTYLE THIS to invent a new look (colors, font, layout, motion). ↓↓↓ */
    .cap-group { position: absolute; left: 0; right: 0; bottom: 140px; text-align: center;
                 opacity: 0; visibility: hidden; }
    .cap-word { display: inline-block; margin: 0 10px; font-size: 78px; font-weight: 800;
                color: #ffffff; text-shadow: 0 4px 20px rgba(0, 0, 0, 0.55); }
    /* ↑↑↑ RESTYLE ABOVE. Keep the structure/ids/timeline below intact. ↑↑↑ */
  </style>
</head>
<body>
  <div id="cap-root" data-composition-id="custom-caption"
       data-width="1920" data-height="1080" data-start="0" data-duration="8">
    <div id="cap-stage"></div>
  </div>
  <script>
    // CapForge replaces this array with the real transcript (text + timing).
    var TRANSCRIPT = [
      { "text": "Your", "start": 0.0, "end": 0.4 },
      { "text": "caption", "start": 0.4, "end": 0.8 },
      { "text": "style", "start": 0.8, "end": 1.3 }
    ];
    var WORDS_PER_GROUP = 3;

    // Group the flat transcript into display chunks.
    var GROUPS = [];
    for (var i = 0; i < TRANSCRIPT.length; i += WORDS_PER_GROUP) {
      var slice = TRANSCRIPT.slice(i, i + WORDS_PER_GROUP);
      GROUPS.push({ words: slice, start: slice[0].start, end: slice[slice.length - 1].end });
    }

    // Build the caption DOM.
    var stage = document.getElementById("cap-stage");
    GROUPS.forEach(function (g, gi) {
      var el = document.createElement("div");
      el.className = "cap-group";
      el.id = "cap-g" + gi;
      g.words.forEach(function (w) {
        var span = document.createElement("span");
        span.className = "cap-word";
        span.textContent = w.text;
        el.appendChild(span);
      });
      stage.appendChild(el);
    });

    // Paused timeline: one group visible at a time, entrance only, hard kill at end.
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    GROUPS.forEach(function (g, gi) {
      var sel = "#cap-g" + gi;
      tl.set(sel, { visibility: "visible" }, g.start);
      tl.fromTo(sel, { opacity: 0, y: 30 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", overwrite: "auto" }, g.start);
      tl.set(sel, { opacity: 0, visibility: "hidden" }, g.end);  // hard kill (captions.md)
    });
    window.__timelines["custom-caption"] = tl;
  </script>
</body>
</html>
"""


#: The rules an agent-authored caption component must follow (returned to the
#: agent alongside the template).
CUSTOM_CAPTION_CONTRACT = [
    "Self-contained HTML; transparent background (it overlays the video).",
    "Root element with data-composition-id + data-width/data-height (author at 1920x1080).",
    "Declare `var TRANSCRIPT = [{text,start,end}, ...]` — CapForge replaces it with the real words.",
    "Build the caption DOM from TRANSCRIPT (do your own grouping if you like).",
    'Register a PAUSED GSAP timeline at window.__timelines["<id>"].',
    "One group visible at a time; entrance animation only; a hard tl.set kill at each group's end.",
    "No Math.random / Date.now / repeat:-1, no data-end / data-layer (deterministic + finite).",
]


def custom_caption_contract() -> dict:
    """Contract + starter template for authoring a caption style from scratch."""
    return {"contract": CUSTOM_CAPTION_CONTRACT, "template": custom_caption_template()}


def validate_custom_caption(html: str) -> None:
    """Reject an agent-authored caption component that breaks the contract, with a
    specific message so the agent can fix it. Checks the must-haves: a transcript
    array to inject, a registered paused timeline, a composition root, and no
    banned (non-deterministic / unsupported) patterns."""
    if not html or "<" not in html:
        raise CaptionStyleError("Custom caption HTML is empty or not HTML.")
    if not any(re.search(rf"var\s+{v}\s*=\s*\[", html) for v in _TRANSCRIPT_VARS):
        raise CaptionStyleError(
            "Custom caption must declare a transcript array CapForge can fill — "
            "`var TRANSCRIPT = [{text,start,end}, ...]` (a placeholder is fine)."
        )
    if "window.__timelines" not in html:
        raise CaptionStyleError(
            'Custom caption must register a paused GSAP timeline at '
            'window.__timelines["<id>"].'
        )
    if "data-composition-id" not in html:
        raise CaptionStyleError(
            "Custom caption root must carry data-composition-id (+ data-width/height)."
        )
    for bad in _BANNED_PATTERNS:
        if bad in html:
            raise CaptionStyleError(
                f"Custom caption uses a banned pattern '{bad}'. HyperFrames needs "
                "deterministic, finite animations (no Math.random / Date.now / "
                "repeat:-1, and no data-end / data-layer)."
            )


def write_custom_caption(project_dir: str, html: str) -> str:
    """Validate + write an agent-authored caption component into the project.
    Returns its project-relative path."""
    validate_custom_caption(html)
    dest = Path(project_dir) / CUSTOM_CAPTION_REL
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(html, encoding="utf-8")
    return CUSTOM_CAPTION_REL
