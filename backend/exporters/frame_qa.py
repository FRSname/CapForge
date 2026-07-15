"""Single-frame QA rendering for the MCP vision loop.

Renders one subtitle frame — optionally composited over the source video frame —
so a Claude agent can SEE its output and critique design (text over the
speaker's face, contrast, crowding). Reuses the exact render path
(`_render_frame`) so what the agent sees matches the final render.
"""

from __future__ import annotations

import io
import subprocess
from typing import Optional

from PIL import Image

from backend.exporters.video_render import (
    _build_groups,
    _find_ffmpeg,
    _get_font,
    _render_frame,
    fill_group_gaps,
)
from backend.models.schemas import TranscriptionResult, VideoRenderConfig

# Platform safe zones (fractions of frame) — ported from
# src/renderer/src/lib/safeZones.ts. Advisory ONLY: captions intentionally go
# over these sometimes, so violations are reported as guidance, never errors.
SAFE_ZONES: dict[str, dict[str, float]] = {
    "tiktok": {"top": 0.10, "bottom": 0.25, "right": 0.125},
    "reels": {"top": 0.08, "bottom": 0.22, "right": 0.12},
    "shorts": {"top": 0.08, "bottom": 0.20, "right": 0.10},
}


def _active_group(groups: list[dict], t: float) -> Optional[dict]:
    for g in groups:
        if g["start"] <= t < g["end"]:
            return g
    return None


def render_overlay(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    custom_groups: Optional[list[dict]],
    t: float,
) -> Image.Image:
    """Render the transparent subtitle overlay at time ``t`` (RGBA)."""
    groups = custom_groups if custom_groups else _build_groups(result, config.words_per_group)
    if getattr(config, "fill_gaps", False):
        groups = fill_group_gaps(groups)
    group = _active_group(groups, t)
    font = _get_font(config.font_family, config.font_size, config.custom_font_path, bold=config.bold)
    return _render_frame(config, font, group, t)


def _grab_source_frame(media_path: str, t: float, width: int, height: int) -> Optional[Image.Image]:
    """Grab one frame from the source video at ``t`` via ffmpeg, scaled to the
    overlay canvas. Returns None for audio-only sources or any ffmpeg failure."""
    try:
        ffmpeg = _find_ffmpeg()
    except FileNotFoundError:
        return None
    cmd = [
        ffmpeg, "-nostdin", "-ss", f"{max(0.0, t):.3f}", "-i", media_path,
        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-",
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=30).stdout
    except (subprocess.SubprocessError, OSError):
        return None
    if not out:
        return None
    try:
        img = Image.open(io.BytesIO(out)).convert("RGBA")
    except Exception:
        return None
    if img.size != (width, height):
        img = img.resize((width, height), Image.LANCZOS)
    return img


def render_qa_frame_png(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    t: float,
    composite: bool,
    custom_groups: Optional[list[dict]] = None,
    source_path: Optional[str] = None,
) -> bytes:
    """PNG of the subtitle frame at ``t``. With ``composite``, the overlay is
    drawn on top of the real video frame so the agent can judge it in context."""
    overlay = render_overlay(result, config, custom_groups, t)
    out = overlay
    if composite and source_path:
        base = _grab_source_frame(source_path, t, config.resolution_w, config.resolution_h)
        if base is not None:
            base.alpha_composite(overlay)
            out = base
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def analyze_layout(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    t: float,
    custom_groups: Optional[list[dict]] = None,
    platform: str = "off",
) -> dict:
    """Mechanical layout read at ``t``: caption bounding box (px + fractions),
    whether it touches the frame edge, and advisory safe-zone violations."""
    overlay = render_overlay(result, config, custom_groups, t)
    w, h = config.resolution_w, config.resolution_h
    bbox = overlay.split()[-1].getbbox()  # non-transparent bounds
    if bbox is None:
        return {"has_content": False, "resolution": [w, h]}

    left, top, right, bottom = bbox
    frac = {"left": left / w, "top": top / h, "right": right / w, "bottom": bottom / h}
    eps = 2
    out: dict = {
        "has_content": True,
        "resolution": [w, h],
        "bbox_px": [left, top, right, bottom],
        "bbox_frac": frac,
        "touches_frame_edge": left <= eps or top <= eps or right >= w - eps or bottom >= h - eps,
    }

    zone = SAFE_ZONES.get(platform)
    if zone:
        violations = []
        if frac["top"] < zone["top"]:
            violations.append("top")
        if frac["bottom"] > 1 - zone["bottom"]:
            violations.append("bottom")
        if frac["right"] > 1 - zone["right"]:
            violations.append("right")
        out["safe_zone"] = {"platform": platform, "advisory": True, "violations": violations}
    return out
