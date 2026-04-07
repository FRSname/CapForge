"""SubForge — Subtitle video renderer.

Renders word-by-word highlighted subtitle overlays as transparent video
using Pillow for frame generation and FFmpeg for encoding.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

from PIL import Image, ImageDraw, ImageFont

from backend.models.schemas import (
    JobStatus,
    ProgressUpdate,
    TranscriptionResult,
    VideoRenderConfig,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hex_to_rgba(hex_color: str, opacity: float = 1.0) -> tuple[int, int, int, int]:
    """Convert '#RRGGBB' to (R, G, B, A)."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, int(opacity * 255))


def _get_font(family: str, size: int) -> ImageFont.FreeTypeFont:
    """Load a TrueType font by name, falling back to bundled or default."""
    # Try common Windows font paths
    candidates = [
        f"C:/Windows/Fonts/{family}.ttf",
        f"C:/Windows/Fonts/{family.lower()}.ttf",
        f"C:/Windows/Fonts/{family.replace(' ', '')}.ttf",
        f"C:/Windows/Fonts/{family.lower().replace(' ', '')}.ttf",
        # Bold variants
        f"C:/Windows/Fonts/{family}bd.ttf",
        f"C:/Windows/Fonts/{family.lower()}bd.ttf",
        f"C:/Windows/Fonts/{family}b.ttf",
        f"C:/Windows/Fonts/arialbd.ttf",  # Final fallback
        f"C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    # Last resort: Pillow default
    return ImageFont.load_default()


def _find_ffmpeg() -> str:
    """Find ffmpeg executable."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    # Check common locations
    for candidate in [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
    ]:
        if os.path.isfile(candidate):
            return candidate
    raise FileNotFoundError(
        "FFmpeg not found. Install FFmpeg and ensure it is on your PATH."
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

    draw = ImageDraw.Draw(img)

    # Measure total text width and individual word widths
    words = group["words"]
    space_w = draw.textlength(" ", font=font)

    word_metrics: list[dict] = []
    total_w = 0.0
    for i, w in enumerate(words):
        ww = draw.textlength(w["word"], font=font)
        word_metrics.append({"word": w["word"], "width": ww, "start": w["start"], "end": w["end"]})
        total_w += ww
        if i < len(words) - 1:
            total_w += space_w

    # Text bounding box for height
    bbox = font.getbbox("Ayg")  # Representative chars for ascent/descent
    text_h = bbox[3] - bbox[1]

    # Background rectangle
    bg_w = total_w + config.bg_padding_h * 2
    bg_h = text_h + config.bg_padding_v * 2
    center_x = config.resolution_w / 2
    center_y = config.resolution_h * config.position_y

    bg_x1 = center_x - bg_w / 2
    bg_y1 = center_y - bg_h / 2
    bg_x2 = center_x + bg_w / 2
    bg_y2 = center_y + bg_h / 2

    bg_rgba = _hex_to_rgba(config.bg_color, config.bg_opacity)
    if config.bg_opacity > 0:
        _draw_rounded_rect(draw, (bg_x1, bg_y1, bg_x2, bg_y2), config.bg_corner_radius, bg_rgba)

    # Draw words
    text_color = _hex_to_rgba(config.text_color, 1.0)
    active_color = _hex_to_rgba(config.active_word_color, 1.0)

    x = center_x - total_w / 2
    y = center_y - text_h / 2 - bbox[1]  # Offset by ascent

    for i, wm in enumerate(word_metrics):
        # Is this word currently being spoken?
        is_active = wm["start"] <= current_time < wm["end"]
        color = active_color if is_active else text_color
        draw.text((x, y), wm["word"], font=font, fill=color)
        x += wm["width"]
        if i < len(word_metrics) - 1:
            x += space_w

    return img


# ---------------------------------------------------------------------------
# Video encoder
# ---------------------------------------------------------------------------


def render_subtitle_video(
    result: TranscriptionResult,
    config: VideoRenderConfig,
    output_dir: str,
    on_progress: Optional[Callable[[ProgressUpdate], None]] = None,
) -> str:
    """Render subtitle overlay video with transparent background.

    Returns the path to the output video file.
    """
    ffmpeg_path = _find_ffmpeg()

    os.makedirs(output_dir, exist_ok=True)
    stem = Path(result.audio_path).stem
    ext = ".webm" if config.output_format == "webm" else ".mov"
    output_path = str(Path(output_dir) / f"{stem}_subtitles{ext}")

    groups = _build_groups(result, config.words_per_group)
    if not groups:
        raise ValueError("No subtitle data to render")

    duration = result.duration or groups[-1]["end"] + 1.0
    total_frames = int(duration * config.fps)
    font = _get_font(config.font_family, config.font_size)

    def _report(msg: str, pct: float) -> None:
        if on_progress:
            on_progress(ProgressUpdate(
                status=JobStatus.RENDERING, progress=pct, message=msg
            ))

    _report("Starting render…", 0)

    # Build FFmpeg command for piping raw RGBA frames
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
    else:
        # ProRes 4444 with alpha (MOV) — use prores_ks speed 12 for fast encode
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

    logger.info("FFmpeg command: %s", " ".join(ffmpeg_cmd))

    # Collect stderr in a background thread to avoid pipe-buffer deadlock
    import threading

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

    _report("Encoding video…", 5)

    # Group index for quick lookup
    group_idx = 0
    report_interval = max(1, total_frames // 50)  # Report ~50 times

    try:
        for frame_num in range(total_frames):
            t = frame_num / config.fps

            # Find active group for this time
            while group_idx < len(groups) and groups[group_idx]["end"] < t:
                group_idx += 1

            active_group = None
            if group_idx < len(groups) and groups[group_idx]["start"] <= t:
                active_group = groups[group_idx]

            # Render frame
            img = _render_frame(config, font, active_group, t)
            proc.stdin.write(img.tobytes())

            # Progress reporting
            if frame_num % report_interval == 0:
                pct = 5 + (frame_num / total_frames) * 90
                _report(
                    f"Rendering frame {frame_num}/{total_frames}…",
                    min(pct, 95),
                )

        proc.stdin.close()
        _report("Encoding video (finalizing)…", 96)
        proc.wait(timeout=1800)
        stderr_thread.join(timeout=5)

        if proc.returncode != 0:
            stderr_text = b"".join(stderr_chunks).decode(errors="replace")
            raise RuntimeError(f"FFmpeg failed (code {proc.returncode}): {stderr_text[:500]}")

    except Exception:
        proc.kill()
        raise

    _report(f"Video saved: {output_path}", 100)
    logger.info("Rendered subtitle video: %s", output_path)
    return output_path
