"""CapForge — Subtitle video renderer.

Renders word-by-word highlighted subtitle overlays as transparent video
using Pillow for frame generation and FFmpeg for encoding.

Shared rendering constants (pad_v, crossfade duration, line_height, etc.)
are defined in src/renderer/src/lib/renderConstants.ts and sent to this
module via the VideoRenderConfig. Do not hardcode new magic numbers here —
add them to renderConstants.ts and pass through render.ts instead.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from backend.models.schemas import (
    JobStatus,
    ProgressUpdate,
    TranscriptionResult,
    VideoRenderConfig,
)

logger = logging.getLogger(__name__)


class RenderCancelled(Exception):
    """Raised when the frontend asks to cancel a running render."""


# Module-level cancel sentinel. `cancel_render()` flips this to True; the
# render loops check it between frames and raise RenderCancelled when set.
# A simple flag is fine here because only one render runs at a time (the
# backend enforces that in `start_transcription` / `render_video`).
_cancel_requested = False


def cancel_render() -> None:
    """Request cancellation of the running render, if any."""
    global _cancel_requested
    _cancel_requested = True


def _reset_cancel() -> None:
    global _cancel_requested
    _cancel_requested = False


def _check_cancel() -> None:
    if _cancel_requested:
        raise RenderCancelled("Render cancelled by user")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _probe_duration(ffmpeg_path: str, media_path: str) -> Optional[float]:
    """Get the duration of a media file using ffprobe (sibling of ffmpeg)."""
    try:
        ffprobe = ffmpeg_path.replace("ffmpeg", "ffprobe")
        if not shutil.which(ffprobe):
            ffprobe = "ffprobe"
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", media_path],
            capture_output=True, text=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if out.returncode == 0 and out.stdout.strip():
            return float(out.stdout.strip())
    except Exception:
        pass
    return None


def _hex_to_rgba(hex_color: str, opacity: float = 1.0) -> tuple[int, int, int, int]:
    """Convert '#RRGGBB' to (R, G, B, A)."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, int(opacity * 255))


def _find_font_candidates(family: str, bold: bool) -> list[str]:
    """Return an ordered list of font file paths to try for the given family.

    Tries fc-match first (reliable on macOS with Homebrew fontconfig and most
    Linux distros), then falls back to searching well-known OS directories.
    """
    import subprocess
    import sys

    # fc-match: the most reliable cross-platform font finder when available.
    try:
        query = f"{family}:bold" if bold else family
        result = subprocess.run(
            ["fc-match", "--format=%{file}", query],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode == 0 and result.stdout.strip():
            path = result.stdout.strip()
            if os.path.isfile(path):
                return [path]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    fam = family.replace(" ", "")
    fam_lower = fam.lower()
    family_lower = family.lower()
    candidates: list[str] = []

    if sys.platform == "darwin":
        mac_dirs = [
            "/Library/Fonts",
            os.path.expanduser("~/Library/Fonts"),
            "/System/Library/Fonts/Supplemental",
            "/System/Library/Fonts",
            "/opt/homebrew/share/fonts",
        ]
        bold_names = [
            f"{family} Bold", f"{fam} Bold", f"{family}-Bold", f"{fam}-Bold",
            f"{family}Bold", f"{fam}Bold",
        ]
        regular_names = [family, fam, f"{family} Regular", f"{fam} Regular"]
        names = (bold_names + regular_names) if bold else (regular_names + bold_names)
        exts = [".ttf", ".otf", ".ttc"]
        for d in mac_dirs:
            for name in names:
                for ext in exts:
                    candidates.append(os.path.join(d, name + ext))
        # macOS system fallbacks: Helvetica is always present; Arial if Office installed
        if bold:
            candidates += [
                "/Library/Fonts/Arial Bold.ttf",
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/Library/Fonts/Arial.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/System/Library/Fonts/Helvetica.ttc",
                "/System/Library/Fonts/HelveticaNeue.ttc",
            ]
        else:
            candidates += [
                "/Library/Fonts/Arial.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/System/Library/Fonts/Helvetica.ttc",
                "/System/Library/Fonts/HelveticaNeue.ttc",
            ]
    else:
        # Windows / Linux
        win_dir = "C:/Windows/Fonts"
        if bold:
            candidates += [
                f"{win_dir}/{fam}bd.ttf", f"{win_dir}/{fam_lower}bd.ttf",
                f"{win_dir}/{fam}b.ttf",  f"{win_dir}/{fam_lower}b.ttf",
                f"{win_dir}/{fam}-Bold.ttf", f"{win_dir}/{fam_lower}-bold.ttf",
            ]
        candidates += [
            f"{win_dir}/{family}.ttf", f"{win_dir}/{family_lower}.ttf",
            f"{win_dir}/{fam}.ttf",    f"{win_dir}/{fam_lower}.ttf",
        ]
        candidates += [
            f"{win_dir}/arialbd.ttf" if bold else f"{win_dir}/arial.ttf",
            f"{win_dir}/arial.ttf",
        ]
        # Linux fallbacks
        linux_dirs = ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts")]
        for d in linux_dirs:
            candidates += [
                os.path.join(d, f"{family}.ttf"), os.path.join(d, f"{fam}.ttf"),
            ]

    return candidates


def _get_font(family: str, size: int, custom_path: str | None = None, bold: bool = True) -> ImageFont.FreeTypeFont:
    """Load a TrueType font by name, falling back gracefully on each platform."""
    # Custom font path takes priority (user-uploaded font from the app).
    if custom_path and os.path.isfile(custom_path):
        try:
            logger.info("Loading custom font: %s", custom_path)
            return ImageFont.truetype(custom_path, size)
        except Exception as e:
            logger.warning("Failed to load custom font %s: %s", custom_path, e)
    elif custom_path:
        logger.warning("Custom font path not found: %s", custom_path)

    for path in _find_font_candidates(family, bold):
        if os.path.isfile(path):
            try:
                font = ImageFont.truetype(path, size)
                logger.info("Loaded font: %s (size=%d)", path, size)
                return font
            except Exception:
                continue

    logger.error(
        "No font found for family=%r bold=%s — falling back to Pillow default. "
        "Install the font or upload a custom .ttf via Settings.",
        family, bold,
    )
    return ImageFont.load_default()


def _find_ffmpeg() -> str:
    """Find ffmpeg executable.

    Priority:
      1. CAPFORGE_FFMPEG env var (set by Electron to the bundled binary)
      2. ffmpeg on PATH
      3. Common Windows install locations
    """
    bundled = os.environ.get("CAPFORGE_FFMPEG")
    if bundled and os.path.isfile(bundled):
        return bundled
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    for candidate in [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
    ]:
        if os.path.isfile(candidate):
            return candidate
    raise FileNotFoundError(
        "FFmpeg not found. Install FFmpeg and ensure it is on your PATH, "
        "or reinstall CapForge so the bundled copy is restored."
    )


# ---------------------------------------------------------------------------
# Word grouping (reused from premiere_export but configurable)
# ---------------------------------------------------------------------------


def _build_groups(result: TranscriptionResult, words_per_group: int) -> list[dict]:
    """Build display groups from all segments with word-level timing.

    Returns list of dicts: { text, start, end, words: [{ word, start, end, active }] }
    """
    groups: list[dict] = []
    for seg in result.segments:
        if not seg.words:
            # No word-level data — treat entire segment as one group
            groups.append({
                "text": seg.text,
                "start": seg.start,
                "end": seg.end,
                "words": [{"word": seg.text, "start": seg.start, "end": seg.end}],
            })
            continue

        for i in range(0, len(seg.words), words_per_group):
            chunk = seg.words[i : i + words_per_group]
            if not chunk:
                continue
            groups.append({
                "text": " ".join(w.word.strip() for w in chunk),
                "start": chunk[0].start,
                "end": chunk[-1].end,
                "words": [
                    {"word": w.word.strip(), "start": w.start, "end": w.end}
                    for w in chunk
                ],
            })
    return groups


# ---------------------------------------------------------------------------
# Frame renderer
# ---------------------------------------------------------------------------


def _draw_rounded_rect(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float, float, float],
    radius: int,
    fill: tuple[int, int, int, int],
) -> None:
    """Draw a rounded rectangle with alpha."""
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=fill)


def _lerp_color(
    c1: tuple[int, int, int, int],
    c2: tuple[int, int, int, int],
    t: float,
) -> tuple[int, int, int, int]:
    """Linear interpolate between two RGBA colours. t=0 → c1, t=1 → c2."""
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))  # type: ignore[return-value]


def _ease_out(t: float) -> float:
    """Quadratic ease-out: fast start, slow finish."""
    t = max(0.0, min(1.0, t))
    return 1.0 - (1.0 - t) ** 2


def _draw_single_word(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: float,
    y: float,
    font: ImageFont.FreeTypeFont,
    color: tuple,
    tracking: float,
    outline_sw: int,
    stroke_rgba: tuple | None,
) -> None:
    """Draw one word (full string when tracking=0, char-by-char otherwise)."""
    if tracking == 0:
        if outline_sw > 0:
            draw.text((x, y), text, font=font, fill=color,
                      stroke_width=outline_sw, stroke_fill=stroke_rgba)
        else:
            draw.text((x, y), text, font=font, fill=color)
    else:
        cx = x
        for ci, ch in enumerate(text):
            if outline_sw > 0:
                draw.text((cx, y), ch, font=font, fill=color,
                          stroke_width=outline_sw, stroke_fill=stroke_rgba)
            else:
                draw.text((cx, y), ch, font=font, fill=color)
            cx += font.getlength(ch)
            if ci < len(text) - 1:
                cx += tracking


def _draw_word_list(
    draw: ImageDraw.ImageDraw,
    word_metrics: list[dict],
    font: ImageFont.FreeTypeFont,
    current_time: float,
    config: VideoRenderConfig,
    tracking: int,
    effective_space_w: float,
    bbox: tuple,
    center_x: float,
    center_y: float,
    outline_sw: int,
    word_transition: str,
    anim_alpha: float,
    img: Image.Image,
    pill_draw: ImageDraw.ImageDraw | None = None,
) -> None:
    """Draw all words at the given centre position with the chosen word animation."""
    text_h = bbox[3] - bbox[1]
    total_w = sum(wm["width"] for wm in word_metrics)
    total_w += effective_space_w * max(0, len(word_metrics) - 1)

    text_color_base   = _hex_to_rgba(config.text_color,        anim_alpha)
    active_color_base = _hex_to_rgba(config.active_word_color, anim_alpha)
    stroke_rgba = _hex_to_rgba(config.stroke_color, anim_alpha) if outline_sw > 0 else None

    CROSSFADE_DUR      = 0.06
    bounce_strength    = getattr(config, "bounce_strength",       0.18)
    scale_factor       = getattr(config, "scale_factor",          1.25)
    highlight_radius   = getattr(config, "highlight_radius",      16)
    highlight_padding_x = getattr(config, "highlight_padding_x", getattr(config, "highlight_padding", 6))
    highlight_padding_y = getattr(config, "highlight_padding_y", getattr(config, "highlight_padding", 6))
    highlight_opacity  = getattr(config, "highlight_opacity",     0.85)
    highlight_anim     = getattr(config, "highlight_animation",   "jump")
    ul_thickness       = getattr(config, "underline_thickness",   4)
    ul_color_hex       = getattr(config, "underline_color",       "")
    BOUNCE_PX          = text_h * bounce_strength
    SCALE_FACTOR       = scale_factor

    x = center_x - total_w / 2
    y = center_y - text_h / 2 - bbox[1]  # offset by font ascent

    # Pre-compute each word's left-edge x so highlight slide can interpolate.
    word_x_positions: list[float] = []
    wx = x
    for wm in word_metrics:
        word_x_positions.append(wx)
        wx += wm["width"] + effective_space_w

    # Draw sliding highlight BEFORE words so it sits behind the text.
    # Highlight is per-active-word, so per-word overrides for the active word's
    # effective transition + sub-settings apply here.
    active_idx = next((i for i, wm in enumerate(word_metrics)
                       if wm["start"] <= current_time < wm["end"]), -1)
    active_ov  = (word_metrics[active_idx].get("overrides") or {}) if active_idx >= 0 else {}
    effective_transition = active_ov.get("word_transition") or word_transition

    if effective_transition == "highlight" and active_idx >= 0:
        w_hl_pad_x  = float(active_ov.get("highlight_padding_x", highlight_padding_x))
        w_hl_pad_y  = float(active_ov.get("highlight_padding_y", highlight_padding_y))
        w_hl_radius = int(active_ov.get("highlight_radius", highlight_radius))
        w_hl_opac   = float(active_ov.get("highlight_opacity", highlight_opacity))
        h_pad   = max(w_hl_pad_x, outline_sw + 2)
        h_pad_v = max(w_hl_pad_y, outline_sw + 2)
        h_rad   = w_hl_radius
        hl_alpha = anim_alpha * w_hl_opac

        if True:
            hl_off_x = float(active_ov.get("pos_offset_x", 0))
            hl_off_y = float(active_ov.get("pos_offset_y", 0))
            target_x = word_x_positions[active_idx] + hl_off_x
            target_w = word_metrics[active_idx]["width"]

            if highlight_anim == "slide" and active_idx > 0:
                prev_x = word_x_positions[active_idx - 1]
                prev_w = word_metrics[active_idx - 1]["width"]
                wm_cur = word_metrics[active_idx]
                word_dur  = max(wm_cur["end"] - wm_cur["start"], 0.001)
                raw_t     = (current_time - wm_cur["start"]) / word_dur
                # fast ease-out: most of the slide happens in first 40% of the word
                t_ease    = 1.0 - (1.0 - min(max(raw_t * 2.5, 0.0), 1.0)) ** 2
                hl_x = prev_x + (target_x - prev_x) * t_ease
                hl_w = prev_w + (target_w - prev_w) * t_ease
            else:
                hl_x = target_x
                hl_w = target_w

            hl_rgba = _hex_to_rgba(config.active_word_color, hl_alpha)
            # If a dedicated pill_draw was supplied, render the pill there so the
            # caller can composite it under the text shadow (without the pill
            # itself contributing to the shadow alpha).
            _draw_rounded_rect(
                pill_draw if pill_draw is not None else draw,
                (hl_x - h_pad,
                 center_y - text_h / 2 - h_pad_v + hl_off_y,
                 hl_x + hl_w + h_pad,
                 center_y + text_h / 2 + h_pad_v + hl_off_y),
                h_rad, hl_rgba,
            )

    # Small font cache for per-word scaled fonts: (size, bold) → font
    _font_cache: dict[tuple, ImageFont.FreeTypeFont] = {}

    for i, wm in enumerate(word_metrics):
        is_active = wm["start"] <= current_time < wm["end"]

        # --- per-word activation progress (0→1 as word plays) ---
        word_dur  = max(wm["end"] - wm["start"], 0.001)
        word_prog = min(max((current_time - wm["start"]) / word_dur, 0.0), 1.0) if is_active else 0.0

        # --- per-word overrides ---
        ov = wm.get("overrides") or {}
        w_text_color    = _hex_to_rgba(ov["text_color"],        anim_alpha) if "text_color"        in ov else text_color_base
        w_active_color  = _hex_to_rgba(ov["active_word_color"], anim_alpha) if "active_word_color"  in ov else active_color_base
        w_scale         = float(ov.get("font_size_scale", 1.0))
        w_bold          = bool(ov["bold"]) if "bold" in ov else config.bold
        w_font_family   = ov.get("font_family") or config.font_family
        w_font_path     = ov.get("custom_font_path") or getattr(config, "custom_font_path", None)
        w_word_trans    = ov.get("word_transition") or word_transition
        # Per-word position nudge (additive — does not affect layout of next words)
        w_off_x         = float(ov.get("pos_offset_x", 0))
        w_off_y         = float(ov.get("pos_offset_y", 0))
        # Per-word transition sub-settings
        w_bounce        = float(ov.get("bounce_strength",     bounce_strength))
        w_scale_fac     = float(ov.get("scale_factor",        scale_factor))
        w_ul_thick      = int(ov.get("underline_thickness",   ul_thickness))
        w_ul_color      = ov.get("underline_color")
        if w_ul_color is None or w_ul_color == "":
            w_ul_color = ul_color_hex
        w_bounce_px     = text_h * w_bounce
        needs_new_font  = (w_scale != 1.0 or w_bold != config.bold or w_font_family != config.font_family)
        if needs_new_font:
            base_size = font.size if hasattr(font, "size") else config.font_size
            cache_key = (w_font_family, round(base_size * w_scale), w_bold)
            if cache_key not in _font_cache:
                _font_cache[cache_key] = _get_font(w_font_family, cache_key[1], w_font_path, w_bold)
            w_font = _font_cache[cache_key]
            w_bbox = draw.textbbox((0, 0), "Ayg", font=w_font)
            w_text_h = w_bbox[3] - w_bbox[1]
        else:
            w_font   = font
            w_bbox   = bbox
            w_text_h = text_h

        # --- colour ---
        if w_word_trans == "crossfade":
            fade_in  = min(max((current_time - wm["start"]) / CROSSFADE_DUR, 0.0), 1.0)
            fade_out = min(max((wm["end"] - current_time)   / CROSSFADE_DUR, 0.0), 1.0)
            color = _lerp_color(w_text_color, w_active_color, fade_in * fade_out)
        elif w_word_trans in ("highlight", "underline", "karaoke", "bounce", "scale"):
            color = w_text_color
        elif w_word_trans == "reveal":
            if current_time < wm["start"]:
                # word not yet spoken — skip drawing entirely
                x += wm["width"]
                if i < len(word_metrics) - 1:
                    x += effective_space_w
                continue
            color = w_active_color if is_active else w_text_color
        else:  # instant
            color = w_active_color if is_active else w_text_color

        word_x = x + w_off_x
        word_y = y - (w_text_h - text_h) / 2 + w_off_y  # vertically centre scaled words on the baseline

        # ------------------------------------------------------------------ #
        # BOUNCE — shift active word upward
        # ------------------------------------------------------------------ #
        if w_word_trans == "bounce" and is_active:
            import math
            bounce_t = math.sin(word_prog * math.pi)
            word_y = y - w_bounce_px * bounce_t - (w_text_h - text_h) / 2 + w_off_y
            color = w_active_color

        if w_word_trans == "highlight" and is_active:
            hl_text_hex = getattr(config, "highlight_text_color", "") or config.bg_color
            color = _hex_to_rgba(hl_text_hex, anim_alpha)

        if w_word_trans == "scale" and is_active:
            # Render at the scaled font size directly — avoids anti-aliasing
            # artifacts from double-rasterisation and matches Canvas ctx.scale().
            base_size = font.size if hasattr(font, "size") else config.font_size
            sc_size = max(1, round(base_size * w_scale_fac))
            sc_key = (w_font_family, sc_size, w_bold)
            if sc_key not in _font_cache:
                _font_cache[sc_key] = _get_font(w_font_family, sc_size, w_font_path, w_bold)
            sc_font = _font_cache[sc_key]
            sc_bbox = draw.textbbox((0, 0), "Ayg", font=sc_font)
            sc_text_h = sc_bbox[3] - sc_bbox[1]
            if tracking == 0:
                sc_word_w = sc_font.getlength(wm["word"])
            else:
                sc_word_w = sum(sc_font.getlength(ch) for ch in wm["word"]) + tracking * max(0, len(wm["word"]) - 1)

            # Centre the scaled word on the same position as the unscaled word
            word_cx = word_x + wm["width"] / 2
            word_cy = center_y + w_off_y
            sc_x = word_cx - sc_word_w / 2
            sc_y = word_cy - sc_text_h / 2 - sc_bbox[1]

            sc_stroke = _hex_to_rgba(config.stroke_color, anim_alpha) if outline_sw > 0 else None
            _draw_single_word(
                draw, wm["word"], sc_x, sc_y,
                sc_font, w_active_color, tracking, outline_sw, sc_stroke,
            )
            x += wm["width"]
            if i < len(word_metrics) - 1:
                x += effective_space_w
            continue

        if w_word_trans == "karaoke":
            # Already-spoken words stay in active color; future words in text color.
            is_past = current_time >= wm["end"]
            base_color = w_active_color if is_past else w_text_color
            _draw_single_word(draw, wm["word"], word_x, word_y,
                              w_font, base_color, tracking, outline_sw, stroke_rgba)
            if is_active and word_prog > 0:
                pad = outline_sw + 2
                tmp_w = int(wm["width"]) + pad * 2
                tmp_h = int(w_text_h) + pad * 2
                tmp = Image.new("RGBA", (max(tmp_w, 1), max(tmp_h, 1)), (0, 0, 0, 0))
                tmp_draw = ImageDraw.Draw(tmp)
                tmp_stroke = _hex_to_rgba(config.stroke_color, anim_alpha) if outline_sw > 0 else None
                _draw_single_word(
                    tmp_draw, wm["word"], pad, pad - w_bbox[1],
                    w_font, w_active_color, tracking, outline_sw, tmp_stroke,
                )
                fill_w = int(tmp_w * word_prog)
                mask = Image.new("L", (max(tmp_w, 1), max(tmp_h, 1)), 0)
                ImageDraw.Draw(mask).rectangle([0, 0, fill_w, tmp_h], fill=255)
                orig_alpha = tmp.getchannel("A")
                combined = Image.frombytes(
                    "L",
                    (max(tmp_w, 1), max(tmp_h, 1)),
                    bytes(min(a, m) for a, m in zip(orig_alpha.tobytes(), mask.tobytes())),
                )
                tmp.putalpha(combined)
                img.paste(tmp, (int(word_x) - pad, int(word_y + w_bbox[1]) - pad), tmp)
            x += wm["width"]
            if i < len(word_metrics) - 1:
                x += effective_space_w
            continue

        if w_word_trans == "underline" and is_active:
            bar_h    = max(1, w_ul_thick)
            ul_off_y = int(ov.get("underline_offset_y", getattr(config, "underline_offset_y", 2)))
            ul_w_px  = int(ov.get("underline_width",    getattr(config, "underline_width",    0)))
            bar_y    = center_y + w_text_h / 2 + ul_off_y + w_off_y
            ul_hex   = w_ul_color if w_ul_color else config.active_word_color
            bar_rgba = _hex_to_rgba(ul_hex, anim_alpha)
            bar_width = ul_w_px if ul_w_px > 0 else wm["width"]
            bar_x     = word_x + (wm["width"] - bar_width) / 2 if ul_w_px > 0 else word_x
            draw.rectangle(
                [bar_x, bar_y, bar_x + bar_width, bar_y + bar_h],
                fill=bar_rgba,
            )
            color = w_active_color

        _draw_single_word(draw, wm["word"], word_x, word_y,
                          w_font, color, tracking, outline_sw, stroke_rgba)

        x += wm["width"]
        if i < len(word_metrics) - 1:
            x += effective_space_w


def _render_frame(
    config: VideoRenderConfig,
    font: ImageFont.FreeTypeFont,
    group: Optional[dict],
    current_time: float,
) -> Image.Image:
    """Render a single frame as RGBA PIL Image."""
    img = Image.new("RGBA", (config.resolution_w, config.resolution_h), (0, 0, 0, 0))

    if group is None:
        return img

    # ---------------------------------------------------------------------------
    # Animation — compute per-frame alpha and y-slide offset
    # ---------------------------------------------------------------------------
    animation      = getattr(config, "animation",          "none")
    anim_dur       = getattr(config, "animation_duration", 0.12)
    word_transition = getattr(config, "word_transition",   "instant")

    age       = current_time - group["start"]   # seconds since group appeared
    remaining = group["end"]   - current_time   # seconds until group disappears

    entry_t = _ease_out(age       / anim_dur) if anim_dur > 0 else 1.0
    exit_t  = _ease_out(remaining / anim_dur) if anim_dur > 0 else 1.0
    phase_t = min(entry_t, exit_t)             # 0 at edges, 1 in the middle

    anim_alpha   = 1.0
    slide_offset = 0.0

    if animation == "fade":
        anim_alpha = phase_t
    elif animation == "slide":
        anim_alpha   = phase_t
        slide_px     = config.resolution_h * 0.04
        entry_slide  = slide_px * (1.0 - entry_t)
        exit_slide   = slide_px * (1.0 - exit_t) * -1.0
        slide_offset = entry_slide if entry_t < 1.0 else exit_slide
    elif animation == "pop":
        anim_alpha = phase_t

    # ---------------------------------------------------------------------------
    # Layout metrics (shared across normal + pop paths)
    # ---------------------------------------------------------------------------
    draw = ImageDraw.Draw(img)

    outline_sw        = config.stroke_width
    tracking          = config.tracking
    extra_word_spacing = config.word_spacing

    def _measure_word(text: str) -> float:
        if tracking == 0:
            return font.getlength(text)
        w = 0.0
        for ci, ch in enumerate(text):
            w += font.getlength(ch)
            if ci < len(text) - 1:
                w += tracking
        return w

    words = group["words"]
    effective_space_w = font.getlength(" ") + extra_word_spacing

    def _measure_with_font(text: str, f: ImageFont.FreeTypeFont) -> float:
        if tracking == 0:
            return f.getlength(text)
        ww = 0.0
        for ci, ch in enumerate(text):
            ww += f.getlength(ch)
            if ci < len(text) - 1:
                ww += tracking
        return ww

    all_metrics: list[dict] = []
    for w in words:
        ov = w.get("overrides") or {}
        w_scale = float(ov.get("font_size_scale", 1.0))
        w_bold  = bool(ov["bold"]) if "bold" in ov else config.bold
        if w_scale != 1.0 or w_bold != config.bold:
            ov_font = _get_font(config.font_family, round(config.font_size * w_scale),
                                getattr(config, "custom_font_path", None), w_bold)
            ww = _measure_with_font(w["word"], ov_font)
        else:
            ww = _measure_word(w["word"])
        all_metrics.append({"word": w["word"], "width": ww, "start": w["start"], "end": w["end"],
                             "overrides": ov if ov else None})

    bbox    = draw.textbbox((0, 0), "Ayg", font=font)
    text_h  = bbox[3] - bbox[1]
    line_height = getattr(config, "line_height", 1.2)
    row_gap = text_h * (line_height - 1)

    stroke_pad    = outline_sw
    bg_width_extra  = getattr(config, "bg_width_extra",  0)
    bg_height_extra = getattr(config, "bg_height_extra", 0)
    text_offset_x   = getattr(config, "text_offset_x",   0)
    text_offset_y   = getattr(config, "text_offset_y",   0)
    text_align_h    = getattr(config, "text_align_h",    "center")
    text_align_v    = getattr(config, "text_align_v",    "middle")
    position_x      = getattr(config, "position_x",      0.5)
    num_lines       = max(1, getattr(config, "lines",     1))

    # Split into rows
    max_width_frac = getattr(config, "max_width", 0.9)
    max_w_px = config.resolution_w * max_width_frac
    rows: list[list[dict]] = []
    if num_lines <= 1:
        # Greedy word-wrap: if total width exceeds max_width, break into rows
        total_w = sum(m["width"] for m in all_metrics) + effective_space_w * max(0, len(all_metrics) - 1)
        if total_w > max_w_px and len(all_metrics) > 1:
            row: list[dict] = []
            row_w = 0.0
            for m in all_metrics:
                add_w = (effective_space_w + m["width"]) if row else m["width"]
                if row and row_w + add_w > max_w_px:
                    rows.append(row)
                    row = [m]
                    row_w = m["width"]
                else:
                    row.append(m)
                    row_w += add_w
            if row:
                rows.append(row)
        else:
            rows = [all_metrics]
    else:
        per_row = max(1, -(-len(all_metrics) // num_lines))  # ceil div
        for r in range(num_lines):
            sl = all_metrics[r * per_row:(r + 1) * per_row]
            if sl:
                rows.append(sl)

    row_widths = []
    for row in rows:
        rw = sum(m["width"] for m in row) + effective_space_w * max(0, len(row) - 1)
        row_widths.append(rw)
    max_row_w = max(row_widths)

    total_text_h = len(rows) * text_h + (len(rows) - 1) * row_gap
    bg_w = max_row_w + config.bg_padding_h * 2 + stroke_pad * 2 + bg_width_extra
    bg_h = total_text_h + config.bg_padding_v * 2 + stroke_pad * 2 + bg_height_extra

    center_x = config.resolution_w * position_x
    center_y = config.resolution_h * config.position_y + slide_offset

    # Slack between bg and text grows when bg_*_extra > 0; alignment shifts text
    # within that slack. Center/middle = no shift (current behavior).
    align_shift_x = (-bg_width_extra  / 2) if text_align_h == "left"   else \
                    ( bg_width_extra  / 2) if text_align_h == "right"  else 0
    align_shift_y = (-bg_height_extra / 2) if text_align_v == "top"    else \
                    ( bg_height_extra / 2) if text_align_v == "bottom" else 0

    def _draw_all_rows(tgt_draw: "ImageDraw.ImageDraw", tgt_img: "Image.Image", cx: float, cy: float,
                       pill_draw: "ImageDraw.ImageDraw | None" = None) -> None:
        top_y = cy - total_text_h / 2 + text_h / 2 + align_shift_y + text_offset_y
        for ri, row in enumerate(rows):
            row_cx = cx + align_shift_x + text_offset_x
            row_cy = top_y + ri * (text_h + row_gap)
            _draw_word_list(tgt_draw, row, font, current_time, config,
                            tracking, effective_space_w, bbox,
                            row_cx, row_cy,
                            outline_sw, word_transition, anim_alpha, tgt_img,
                            pill_draw=pill_draw)

    # ---------------------------------------------------------------------------
    # Pop: render at reduced scale into a temp surface, paste centred
    # ---------------------------------------------------------------------------
    if animation == "pop" and entry_t < 1.0:
        scale = 0.85 + 0.15 * entry_t
        tmp = Image.new("RGBA", (config.resolution_w, config.resolution_h), (0, 0, 0, 0))
        tmp_draw = ImageDraw.Draw(tmp)

        bg_rgba = _hex_to_rgba(config.bg_color, config.bg_opacity * anim_alpha)
        if config.bg_opacity > 0:
            _draw_rounded_rect(tmp_draw,
                               (center_x - bg_w / 2, center_y - bg_h / 2,
                                center_x + bg_w / 2, center_y + bg_h / 2),
                               config.bg_corner_radius, bg_rgba)
        _draw_all_rows(tmp_draw, tmp, center_x, center_y)

        # Affine transform centred on (center_x, center_y), matching Canvas
        # ctx.translate(cx,cy) → ctx.scale(s,s) → ctx.translate(-cx,-cy).
        # The inverse affine maps destination → source: scale by 1/s around the
        # subtitle centre so the pop shrinks toward the subtitle, not the frame centre.
        inv = 1.0 / scale
        # coefficients for Image.transform AFFINE: (a, b, c, d, e, f)
        # dst(x,y) ← src(a*x + b*y + c, d*x + e*y + f)
        a = inv
        e = inv
        c = center_x * (1 - inv)
        f = center_y * (1 - inv)
        scaled = tmp.transform(
            (config.resolution_w, config.resolution_h),
            Image.AFFINE, (a, 0, c, 0, e, f),
            resample=Image.LANCZOS,
        )
        img.paste(scaled, (0, 0), scaled)
        return img

    # ---------------------------------------------------------------------------
    # Normal draw (none / fade / slide, or pop exit phase)
    # ---------------------------------------------------------------------------
    bg_rgba = _hex_to_rgba(config.bg_color, config.bg_opacity * anim_alpha)
    if config.bg_opacity > 0:
        _draw_rounded_rect(draw,
                           (center_x - bg_w / 2, center_y - bg_h / 2,
                            center_x + bg_w / 2, center_y + bg_h / 2),
                           config.bg_corner_radius, bg_rgba)

    # Render the highlight pill and the text into separate layers so the
    # composite order can be: bg → pill → text-shadow → text. That way the
    # text's drop shadow falls *on top of* the pill (matching the canvas
    # preview, which only attaches `ctx.shadowBlur` to per-word draw calls).
    pill_layer = Image.new("RGBA", (config.resolution_w, config.resolution_h), (0, 0, 0, 0))
    pill_draw  = ImageDraw.Draw(pill_layer)
    text_layer = Image.new("RGBA", (config.resolution_w, config.resolution_h), (0, 0, 0, 0))
    text_draw  = ImageDraw.Draw(text_layer)
    _draw_all_rows(text_draw, text_layer, center_x, center_y, pill_draw=pill_draw)

    # Pill goes down first (no shadow — matches preview behavior).
    img.alpha_composite(pill_layer)

    shadow_enabled = getattr(config, "shadow_enabled", False)
    if shadow_enabled:
        shadow_color   = getattr(config, "shadow_color",   "#000000")
        shadow_opacity = float(getattr(config, "shadow_opacity",  0.8))
        shadow_blur    = int(getattr(config, "shadow_blur",     8))
        offset_x       = int(getattr(config, "shadow_offset_x", 3))
        offset_y       = int(getattr(config, "shadow_offset_y", 3))

        # Shadow alpha is built from the TEXT layer only (excludes the pill).
        alpha = text_layer.getchannel("A")
        if shadow_blur > 0:
            # Canvas `ctx.shadowBlur` uses a browser-specific kernel that is
            # roughly 2× the Gaussian sigma. Dividing by 2 is the best
            # approximation; the remaining discrepancy is most visible at
            # blur 1-4px with thin weights. Full parity would require
            # matching the exact browser kernel, which varies across engines.
            alpha = alpha.filter(ImageFilter.GaussianBlur(radius=shadow_blur / 2.0))
        if shadow_opacity < 1.0:
            alpha = alpha.point(lambda p: int(p * shadow_opacity))

        # Shift the alpha mask (single 'L' channel) onto a same-size canvas at
        # (offset_x, offset_y). Shifting the colored RGBA via paste-with-mask
        # would square the alpha at anti-aliased edges and gut the shadow.
        shifted_alpha = Image.new("L", img.size, 0)
        shifted_alpha.paste(alpha, (offset_x, offset_y))

        h = shadow_color.lstrip("#")
        h_r, h_g, h_b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        shadow_layer = Image.new("RGBA", img.size, (h_r, h_g, h_b, 0))
        shadow_layer.putalpha(shifted_alpha)

        img.alpha_composite(shadow_layer)

    # Text goes on top of its own shadow.
    img.alpha_composite(text_layer)

    return img


# ---------------------------------------------------------------------------
# Video encoder
# ---------------------------------------------------------------------------


def render_subtitle_video(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    output_dir: str,
    on_progress: Optional[Callable[[ProgressUpdate], None]] = None,
    source_video_path: Optional[str] = None,
    custom_groups: Optional[list[dict]] = None,
) -> str:
    """Render subtitle video — overlay (transparent) or baked onto source.

    Returns the path to the output video file.
    """
    _reset_cancel()
    ffmpeg_path = _find_ffmpeg()

    os.makedirs(output_dir, exist_ok=True)
    stem = Path(result.audio_path).stem

    is_baked = config.render_mode == "baked"

    if is_baked:
        ext = ".mp4"
    elif config.output_format == "webm":
        ext = ".webm"
    elif config.output_format == "mp4":
        ext = ".mp4"
    else:
        ext = ".mov"

    suffix = "_subtitled" if is_baked else "_subtitles"
    output_path = str(Path(output_dir) / f"{stem}{suffix}{ext}")

    if custom_groups:
        groups = custom_groups
    else:
        groups = _build_groups(result, config.words_per_group)
    if not groups:
        raise ValueError("No subtitle data to render")

    # Use the actual media duration so the full video is rendered, not just
    # up to the last subtitle. Fall back to result.duration, then to subtitles.
    duration = (
        _probe_duration(ffmpeg_path, result.audio_path)
        or result.duration
        or groups[-1]["end"] + 1.0
    )
    font = _get_font(config.font_family, config.font_size, getattr(config, 'custom_font_path', None), bold=config.bold)

    def _report(msg: str, pct: float, status: JobStatus = JobStatus.RENDERING) -> None:
        if on_progress:
            on_progress(ProgressUpdate(
                status=status, progress=pct, message=msg
            ))

    _report("Starting render…", 0)

    import threading

    if is_baked:
        return _render_baked(
            ffmpeg_path, source_video_path, output_path, config, groups,
            duration, font, _report,
        )
    else:
        return _render_overlay(
            ffmpeg_path, output_path, config, groups, duration, font, _report,
        )


def _render_overlay(
    ffmpeg_path: str,
    output_path: str,
    config: VideoRenderConfig,
    groups: list[dict],
    duration: float,
    font: ImageFont.FreeTypeFont,
    report: Callable[[str, float], None],
) -> str:
    """Render transparent overlay (webm / mov / mp4)."""
    import threading

    total_frames = int(duration * config.fps)

    if config.output_format == "webm":
        ffmpeg_cmd = [
            ffmpeg_path, "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", f"{config.resolution_w}x{config.resolution_h}",
            "-r", str(config.fps),
            "-i", "pipe:0",
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-auto-alt-ref", "0",
            "-b:v", "2M",
            "-deadline", "realtime",
            "-cpu-used", "8",
            "-row-mt", "1",
            "-an",
            output_path,
        ]
    elif config.output_format == "mp4":
        ffmpeg_cmd = [
            ffmpeg_path, "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", f"{config.resolution_w}x{config.resolution_h}",
            "-r", str(config.fps),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "medium",
            "-b:v", config.video_bitrate,
            "-pix_fmt", "yuv420p",
            "-an",
            output_path,
        ]
    else:
        ffmpeg_cmd = [
            ffmpeg_path, "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", f"{config.resolution_w}x{config.resolution_h}",
            "-r", str(config.fps),
            "-i", "pipe:0",
            "-c:v", "prores_ks",
            "-profile:v", "4444",
            "-pix_fmt", "yuva444p10le",
            "-vendor", "apl0",
            "-threads", "0",
            "-an",
            output_path,
        ]

    logger.info("FFmpeg overlay command: %s", " ".join(ffmpeg_cmd))

    stderr_chunks: list[bytes] = []

    def _drain_stderr(stream):
        try:
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    break
                stderr_chunks.append(chunk)
        except Exception:
            pass

    proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    stderr_thread = threading.Thread(target=_drain_stderr, args=(proc.stderr,), daemon=True)
    stderr_thread.start()

    report("Rendering frames…", 5)

    import os
    from concurrent.futures import ThreadPoolExecutor, as_completed

    # Pre-build a frame→group lookup list so worker threads don't need to search
    frame_groups: list[Optional[dict]] = []
    gi = 0
    for fn in range(total_frames):
        t = fn / config.fps
        while gi < len(groups) and groups[gi]["end"] < t:
            gi += 1
        if gi < len(groups) and groups[gi]["start"] <= t:
            frame_groups.append(groups[gi])
        else:
            frame_groups.append(None)

    # Number of parallel workers: use half the CPU cores (Pillow is CPU-bound
    # but also does GIL-releasing work via libjpeg/zlib; 4 workers typically
    # gives 2–3× speedup on modern CPUs without thrashing).
    n_workers = max(1, min(os.cpu_count() or 2, 8) // 2)
    BATCH = n_workers * 4  # frames per batch submitted to the pool
    report_interval = max(1, total_frames // 50)

    # Pre-render the blank frame — reused for every frame with no active group.
    # This avoids re-rendering a transparent RGBA image thousands of times
    # during gaps between subtitle groups.
    blank_bytes = _render_frame(config, font, None, 0.0).tobytes()

    def _render_one(fn: int) -> tuple[int, bytes]:
        if frame_groups[fn] is None:
            return fn, blank_bytes
        t = fn / config.fps
        img = _render_frame(config, font, frame_groups[fn], t)
        return fn, img.tobytes()

    try:
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            frame_num = 0
            while frame_num < total_frames:
                _check_cancel()
                batch_end = min(frame_num + BATCH, total_frames)
                futures = {pool.submit(_render_one, fn): fn for fn in range(frame_num, batch_end)}
                # Collect results in order
                results: dict[int, bytes] = {}
                for fut in as_completed(futures):
                    _check_cancel()
                    fn, raw = fut.result()
                    results[fn] = raw
                for fn in range(frame_num, batch_end):
                    proc.stdin.write(results[fn])
                    if fn % report_interval == 0:
                        pct = 5 + (fn / total_frames) * 90
                        report(f"Rendering frame {fn}/{total_frames}…", min(pct, 95))
                frame_num = batch_end

        proc.stdin.close()
        report("Encoding video (finalizing)…", 96, JobStatus.ENCODING)
        proc.wait(timeout=1800)
        stderr_thread.join(timeout=5)

        if proc.returncode != 0:
            stderr_text = b"".join(stderr_chunks).decode(errors="replace")
            raise RuntimeError(f"FFmpeg failed (code {proc.returncode}): {stderr_text[:500]}")

    except Exception:
        proc.kill()
        raise

    report(f"Video saved: {output_path}", 100)
    logger.info("Rendered overlay video: %s", output_path)
    return output_path


def _render_baked(
    ffmpeg_path: str,
    source_video_path: Optional[str],
    output_path: str,
    config: VideoRenderConfig,
    groups: list[dict],
    duration: float,
    font: ImageFont.FreeTypeFont,
    report: Callable[[str, float], None],
) -> str:
    """Render subtitles baked onto the source video as H.264 MP4."""
    import json
    import threading

    if not source_video_path or not os.path.isfile(source_video_path):
        raise FileNotFoundError(
            f"Source video not found for baked render: {source_video_path}"
        )

    # Probe source video to get its native resolution and fps
    ffprobe_path = shutil.which("ffprobe")
    if not ffprobe_path:
        # Derive from ffmpeg path
        ffprobe_path = str(Path(ffmpeg_path).parent / Path(ffmpeg_path).name.replace("ffmpeg", "ffprobe"))
    probe_cmd = [
        ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-select_streams", "v:0",
        source_video_path,
    ]
    try:
        probe_result = subprocess.run(
            probe_cmd, capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        probe_data = json.loads(probe_result.stdout)
        stream = probe_data["streams"][0]
        src_w = int(stream["width"])
        src_h = int(stream["height"])
    except Exception as e:
        logger.warning("Could not probe source video, using config resolution: %s", e)
        src_w = config.resolution_w
        src_h = config.resolution_h

    # Target resolution is what the user chose in the UI
    out_w = config.resolution_w
    out_h = config.resolution_h

    fps = config.fps
    total_frames = int(duration * fps)

    report("Decoding source video…", 2)

    # Scale source video to fit target resolution (letterbox with black padding)
    scale_filter = (
        f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease,"
        f"pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2:color=black"
    )

    # Decoder: read source video scaled to target resolution as raw RGB frames
    decode_cmd = [
        ffmpeg_path, "-y",
        "-i", source_video_path,
        "-vf", scale_filter,
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{out_w}x{out_h}",
        "-r", str(fps),
        "-an",
        "pipe:1",
    ]

    # Encoder: write composited frames as H.264 MP4 with audio from source
    encode_cmd = [
        ffmpeg_path, "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{out_w}x{out_h}",
        "-r", str(fps),
        "-i", "pipe:0",
        "-i", source_video_path,
        "-map", "0:v",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-preset", "medium",
        "-b:v", config.video_bitrate,
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_path,
    ]

    logger.info("FFmpeg decode command: %s", " ".join(decode_cmd))
    logger.info("FFmpeg encode command: %s", " ".join(encode_cmd))

    stderr_chunks_dec: list[bytes] = []
    stderr_chunks_enc: list[bytes] = []

    def _drain(stream, buf):
        try:
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    break
                buf.append(chunk)
        except Exception:
            pass

    decode_proc = subprocess.Popen(
        decode_cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    encode_proc = subprocess.Popen(
        encode_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    threading.Thread(target=_drain, args=(decode_proc.stderr, stderr_chunks_dec), daemon=True).start()
    threading.Thread(target=_drain, args=(encode_proc.stderr, stderr_chunks_enc), daemon=True).start()

    report("Compositing subtitles onto video…", 5)

    frame_size = out_w * out_h * 3  # rgb24
    group_idx = 0
    report_interval = max(1, total_frames // 50)

    try:
        for frame_num in range(total_frames):
            _check_cancel()
            raw = decode_proc.stdout.read(frame_size)
            if not raw or len(raw) < frame_size:
                # Source video ended before expected duration
                break

            t = frame_num / fps

            # Find active subtitle group
            while group_idx < len(groups) and groups[group_idx]["end"] < t:
                group_idx += 1

            active_group = None
            if group_idx < len(groups) and groups[group_idx]["start"] <= t:
                active_group = groups[group_idx]

            # Build source frame as PIL image
            src_frame = Image.frombytes("RGB", (out_w, out_h), raw)

            if active_group is not None:
                # Render subtitle overlay (RGBA) at target resolution
                sub_frame = _render_frame(config, font, active_group, t)
                # Composite: paste subtitle on source using alpha
                src_frame.paste(sub_frame, (0, 0), sub_frame)

            # Write composited RGB frame to encoder
            encode_proc.stdin.write(src_frame.tobytes())

            if frame_num % report_interval == 0:
                pct = 5 + (frame_num / total_frames) * 90
                report(
                    f"Rendering frame {frame_num}/{total_frames}…",
                    min(pct, 95),
                )

        decode_proc.stdout.close()
        encode_proc.stdin.close()
        report("Encoding video (finalizing)…", 96, JobStatus.ENCODING)
        decode_proc.wait(timeout=60)
        encode_proc.wait(timeout=1800)

        if encode_proc.returncode != 0:
            stderr_text = b"".join(stderr_chunks_enc).decode(errors="replace")
            raise RuntimeError(f"FFmpeg encode failed (code {encode_proc.returncode}): {stderr_text[:500]}")

    except Exception:
        decode_proc.kill()
        encode_proc.kill()
        raise

    report(f"Video saved: {output_path}", 100)
    logger.info("Rendered baked subtitle video: %s", output_path)
    return output_path
