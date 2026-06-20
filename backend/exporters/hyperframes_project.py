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

import html
import json
import shutil
from pathlib import Path
from typing import Optional

from backend.exporters.hyperframes_export import export_hyperframes
from backend.exporters.video_render import _build_groups
from backend.models.schemas import TranscriptionResult, VideoRenderConfig

GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

# Per-group entrance: from-state, duration (s), ease — keyed by config.animation.
_ENTRANCES = {
    "none": ("{ opacity: 0 }", 0.12, "none"),
    "fade": ("{ opacity: 0 }", 0.3, "power2.out"),
    "slide": ("{ opacity: 0, y: 36 }", 0.3, "power3.out"),
    "pop": ("{ opacity: 0, scale: 0.8 }", 0.35, "back.out(1.7)"),
}

_EXIT_DUR = 0.12  # caption exit fade (captions.md Caption Exit Guarantee)

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


def _groups_html(groups: list[dict]) -> str:
    """Pre-rendered caption group elements (hidden via CSS; revealed by the timeline)."""
    blocks: list[str] = []
    for gi, group in enumerate(groups):
        spans = [
            f'<span id="cg-{gi}-w{wj}" class="cw">{html.escape(w["word"].strip())}</span>'
            for wj, w in enumerate(group["words"])
        ]
        blocks.append(
            f'<div id="cg-{gi}" class="cgroup">'
            f'<span id="cb-{gi}" class="cbubble">{" ".join(spans)}</span>'
            f"</div>"
        )
    return "\n      ".join(blocks)


def _groups_timing_json(groups: list[dict]) -> str:
    """Compact timing payload the timeline script reads (text already in the DOM)."""
    payload = [
        {
            "s": g["start"],
            "e": g["end"],
            "w": [{"s": w["start"], "e": w["end"]} for w in g["words"]],
        }
        for g in groups
    ]
    return json.dumps(payload, ensure_ascii=False)


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
    enter_from, enter_dur, enter_ease = _ENTRANCES.get(
        config.animation, _ENTRANCES["fade"]
    )
    bg_rgba = _css_rgba(config.bg_color, config.bg_opacity)
    max_width_px = int(config.max_width * width)
    pos_top_pct = round(config.position_y * 100, 3)
    effects_html = _effects_html(effects)
    # Text-effect sizing, derived from canvas height for resolution independence.
    lt_title_px = max(20, int(height * 0.045))
    lt_sub_px = max(14, int(height * 0.030))
    stat_value_px = max(48, int(height * 0.16))
    stat_label_px = max(16, int(height * 0.038))

    # Caption timeline lives only on the classic path; native styles own theirs.
    caption_setup = "" if native_captions else (
        f"  var GROUPS = {_groups_timing_json(groups)};\n"
        f'  var ACTIVE = "{config.active_word_color}";\n'
        f'  var BASE = "{config.text_color}";\n'
    )
    caption_loop = "" if native_captions else (
        "  GROUPS.forEach(function(g, gi){\n"
        '    var sel = "#cb-" + gi;\n'
        '    tl.set(sel, { visibility: "visible" }, g.s);\n'
        f"    tl.fromTo(sel, {enter_from}, "
        f'{{ opacity: 1, y: 0, scale: 1, duration: {enter_dur}, ease: "{enter_ease}", overwrite: "auto" }}, g.s);\n'
        "    g.w.forEach(function(w, wj){\n"
        '      var wsel = "#cg-" + gi + "-w" + wj;\n'
        "      tl.set(wsel, { color: ACTIVE }, w.s);\n"
        "      tl.set(wsel, { color: BASE }, w.e);\n"
        "    });\n"
        f"    var exitAt = Math.max(g.s, g.e - {_EXIT_DUR});\n"
        f'    tl.to(sel, {{ opacity: 0, duration: {_EXIT_DUR}, ease: "power2.in", overwrite: "auto" }}, exitAt);\n'
        '    tl.set(sel, { opacity: 0, visibility: "hidden" }, g.e);\n'
        "  });\n"
    )
    effects_and_register = (
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
        "  window.__timelines = window.__timelines || {};\n"
        '  window.__timelines["root"] = tl;\n'
        "})();"
    )
    timeline_js = (
        "(function(){\n"
        + caption_setup
        + "  var tl = gsap.timeline({ paused: true });\n"
        + caption_loop
        + effects_and_register
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
    .captions {{
      position: absolute;
      left: 0; right: 0;
      top: {pos_top_pct}%;
      text-align: center;
      z-index: 10;
    }}
    /* Each group is taken OUT OF FLOW (absolute) so groups don't stack/wrap into
       a tall block — they all overlap at the same anchor row, one visible at a
       time. translateY(-50%) centers the row on position_y. */
    .cgroup {{
      position: absolute;
      left: 0; right: 0;
      top: 0;
      transform: translateY(-50%);
      text-align: center;
      padding: 0 {config.bg_padding_h}px;
      box-sizing: border-box;
    }}
    /* The visible pill. Animated by GSAP (a child, so its transforms never
       fight .cgroup's centering transform). */
    .cbubble {{
      display: inline-block;
      opacity: 0;
      visibility: hidden;
      max-width: {max_width_px}px;
      text-align: center;
      background: {bg_rgba};
      color: {config.text_color};
      font-family: "{config.font_family}", system-ui, sans-serif;
      font-size: {config.font_size}px;
      font-weight: 400;
      line-height: {config.line_height};
      padding: {config.bg_padding_v}px {config.bg_padding_h}px;
      border-radius: {config.bg_corner_radius}px;
    }}
    .cw {{ color: {config.text_color}; }}
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
            f"      {_groups_html(groups)}\n"
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
  <div id="root" data-composition-id="root" data-width="{width}" data-height="{height}" data-start="0" data-duration="{duration}">
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
    """Copy a custom font into fonts/ and return an @font-face block, or ''."""
    if not config.custom_font_path:
        return ""
    src = Path(config.custom_font_path)
    if not src.exists():
        return ""
    fonts_dir = project_dir / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    dest = fonts_dir / src.name
    shutil.copy(src, dest)  # not copy2 — copystat fails on flagged files (system fonts)
    fmt = "opentype" if src.suffix.lower() == ".otf" else "truetype"
    return (
        f'@font-face {{ font-family: "{config.font_family}"; '
        f'src: url("fonts/{src.name}") format("{fmt}"); font-weight: 400; '
        f"font-display: block; }}"
    )


def _prepare_caption_style(
    config: VideoRenderConfig,
    project_dir: Path,
    transcript_json: str,
    duration: float,
) -> Optional[str]:
    """For a native caption style, install the registry component and inject our
    transcript; return its project-relative src. Returns None for 'classic'.

    The Node-shelling caption module is imported lazily so the classic path has
    no dependency on it.
    """
    style = getattr(config, "caption_style", "classic") or "classic"
    if style == "classic":
        return None
    from backend.exporters.hyperframes_captions import (
        fit_caption_component,
        inject_transcript,
        install_caption_component,
    )

    rel = install_caption_component(str(project_dir), style)
    component_path = project_dir / rel
    inject_transcript(component_path, transcript_json, duration)
    # Native caption components are authored for a fixed (16:9) stage — fit them
    # to CapForge's chosen canvas (portrait/4:5/square/4K) so captions aren't
    # clipped or mis-placed. No-op at the native size.
    fit_caption_component(component_path, config.resolution_w, config.resolution_h)
    return rel


def export_hyperframes_project(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    output_dir: str,
    source_video_path: Optional[str] = None,
    custom_groups: Optional[list[dict]] = None,
    effects: Optional[list[dict]] = None,
    duration: Optional[float] = None,
) -> str:
    """Write a HyperFrames project folder and return its path.

    `custom_groups` (when provided) mirrors `render_subtitle_video` — manually
    edited groups skip auto-grouping. `source_video_path` is copied into the
    project so the composition is self-contained; when omitted, the composition
    still references `source.mp4` for later wiring.
    """
    groups = custom_groups if custom_groups else _build_groups(result, config.words_per_group)
    if not groups:
        raise ValueError("No subtitle data to build a HyperFrames composition")

    stem = Path(result.audio_path).stem or "capforge"
    project_dir = Path(output_dir) / f"{stem}-hyperframes"
    project_dir.mkdir(parents=True, exist_ok=True)

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
        config, project_dir, transcript_json, total_duration
    )

    font_face = _font_face_block(config, project_dir)
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

    return str(project_dir)
