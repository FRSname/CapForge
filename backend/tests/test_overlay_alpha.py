"""Regression test for the overlay MOV encode path — the ProRes 4444 branch
must write PREMULTIPLIED alpha (the QuickTime/Premiere/FCP convention), not
straight alpha, or the caption background box reads ~2x too light when the
MOV is layered over source footage in an NLE.

This is the first test covering the FFmpeg *encode* side of overlay export;
``test_render_golden.py`` / ``test_caption_parity.py`` only cover the Pillow
frame renderer, which is unaffected (both modes share the same straight-alpha
``_render_frame`` — see CLAUDE.md "Preview <-> Render Parity"). Opt-in-style
gating like ``test_caption_parity.py``, but this only needs ffmpeg (no Node):
skips cleanly when ffmpeg is unavailable.

Two invariants (see docs/plans/overlay-mov-premultiplied-alpha.md Phase 3):

1. Premultiplied invariant — for a decoded box-interior pixel,
   ``RGB_decoded ~= RGB_straight * (a_decoded / 255)``.
2. Round-trip equivalence — un-premultiplying the decoded frame and
   compositing it over a solid backdrop (what a premultiplied-aware NLE
   shows) must match Pillow's ``alpha_composite`` of the ORIGINAL
   straight-alpha frame over the same backdrop.

Pure PIL, no numpy (not a project dependency — see test_render_golden.py's
``diff_stats`` docstring); the tiny 320x180x10-frame fixture keeps the
per-pixel Python loops fast.
"""

from __future__ import annotations

import subprocess

import pytest
from PIL import Image, ImageChops, ImageStat

from backend.exporters.video_render import (
    _build_groups,
    _find_ffmpeg,
    _get_font,
    _hex_to_rgba,
    _render_frame,
    render_subtitle_video,
)
from backend.models.schemas import Segment, TranscriptionResult, VideoRenderConfig, WordSegment
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = REPO_ROOT / "Fonts" / "CaviarDreams.ttf"

# Tiny + short: keeps the encode/decode round trip fast (opt-in but not heavy).
W, H = 320, 180
FPS = 10
DURATION = 1.0

BG_COLOR = "#1a1a1a"
BG_OPACITY = 0.5
GRAY = (128, 128, 128)  # solid backdrop the round-trip composites onto

# 10/12-bit ProRes roundtrip noise measures ~1/255 (Phase 2). A straight-alpha
# regression shows up as ~13/255 on this box color/opacity (26 straight vs
# ~13 premultiplied) so these stay well below that signature while absorbing
# real codec noise.
ALPHA_TOL = 6
RGB_TOL = 6
COMPOSITE_MEAN_TOL = 3.0
COMPOSITE_MAX_TOL = 24

try:
    _FFMPEG = _find_ffmpeg()
except FileNotFoundError:
    _FFMPEG = None

_run = pytest.mark.skipif(
    _FFMPEG is None,
    reason="ffmpeg unavailable (needed to encode/decode the overlay MOV)",
)


def _config(**over) -> VideoRenderConfig:
    base = dict(
        resolution_w=W, resolution_h=H, fps=FPS,
        font_family="Caviar Dreams", font_size=28, bold=False,
        custom_font_path=str(FONT_PATH),
        words_per_group=1,
        bg_color=BG_COLOR, bg_opacity=BG_OPACITY,
        bg_corner_radius=10, bg_padding_h=16, bg_padding_v=8,
        text_color="#FFFFFF", active_word_color="#FFD700",
        output_format="mov", render_mode="overlay",
        word_transition="instant", animation="none",
    )
    base.update(over)
    return VideoRenderConfig(**base)


def _result(tmp_path) -> TranscriptionResult:
    """One word spanning the whole clip — keeps the caption box on screen for
    every frame, including frame 0 (t=0.0) which this test samples."""
    return TranscriptionResult(
        segments=[Segment(
            start=0.0, end=DURATION, text="Test",
            words=[WordSegment(word="Test", start=0.0, end=DURATION)],
        )],
        language="en", audio_path=str(tmp_path / "stub.wav"), duration=DURATION,
    )


def _decode_first_frame_rgba(path: str, w: int, h: int) -> Image.Image:
    """Decode the MOV's first frame back to straight RGBA bytes, mirroring
    the diagnostic recipe in the plan (Phase 3 step 2)."""
    cmd = [_FFMPEG, "-y", "-i", path, "-frames:v", "1",
           "-pix_fmt", "rgba", "-f", "rawvideo", "-"]
    proc = subprocess.run(cmd, capture_output=True, timeout=30)
    assert proc.returncode == 0, proc.stderr.decode(errors="replace")[-800:]
    raw = proc.stdout
    expected_len = w * h * 4
    assert len(raw) == expected_len, (
        f"decoded frame is {len(raw)} bytes, expected {expected_len} for {w}x{h} RGBA "
        f"(stderr tail: {proc.stderr.decode(errors='replace')[-400:]})"
    )
    return Image.frombytes("RGBA", (w, h), raw)


def _find_box_pixel_samples(
    frame: Image.Image, target_rgba: tuple[int, int, int, int], max_samples: int = 24
) -> list[tuple[int, int]]:
    """Coordinates of pixels matching the box color/alpha exactly — i.e. box
    interior untouched by text glyphs, stroke, or the box's rounded corners."""
    w = frame.width
    coords = []
    for idx, px in enumerate(frame.get_flattened_data()):
        if px == target_rgba:
            coords.append((idx % w, idx // w))
            if len(coords) >= max_samples:
                break
    return coords


def _unpremultiply(frame: Image.Image) -> Image.Image:
    """Undo ffmpeg's ``-vf premultiply=inplace=1``: straight = premultiplied
    / (a/255). Fully-transparent pixels pass through unchanged (division by
    zero would be undefined, and ffmpeg's own filter leaves them at 0)."""
    w, h = frame.size
    out = []
    for r, g, b, a in frame.convert("RGBA").get_flattened_data():
        if a == 0:
            out.append((0, 0, 0, 0))
            continue
        t = a / 255.0
        out.append((
            min(255, round(r / t)),
            min(255, round(g / t)),
            min(255, round(b / t)),
            a,
        ))
    result = Image.new("RGBA", (w, h))
    result.putdata(out)
    return result


def _composite_over(frame_rgba: Image.Image, over_rgb: tuple[int, int, int]) -> Image.Image:
    backdrop = Image.new("RGBA", frame_rgba.size, over_rgb + (255,))
    return Image.alpha_composite(backdrop, frame_rgba.convert("RGBA")).convert("RGB")


def _rgb_diff_stats(a: Image.Image, b: Image.Image) -> tuple[float, int]:
    diff = ImageChops.difference(a, b)
    mean = sum(ImageStat.Stat(diff).mean) / 3.0
    max_diff = max(hi for _, hi in diff.getextrema())
    return mean, max_diff


@_run
def test_overlay_mov_alpha_is_premultiplied(tmp_path):
    """Encode a tiny overlay MOV and verify its ProRes 4444 alpha channel is
    premultiplied (Phase 3, assertions 1 + 2)."""
    config = _config()
    result = _result(tmp_path)

    output_path = render_subtitle_video(result, config, str(tmp_path))
    assert output_path.endswith(".mov")

    decoded = _decode_first_frame_rgba(output_path, W, H)
    assert decoded.size == (W, H)

    # Recompute the exact straight-alpha frame that was piped into ffmpeg for
    # this position (frame 0 -> t=0.0s) — the same call render_subtitle_video
    # makes internally via _FrameSource.render_frame_bytes().
    groups = _build_groups(result, config.words_per_group)
    font = _get_font(config.font_family, config.font_size, config.custom_font_path, bold=config.bold)
    original = _render_frame(config, font, groups[0], 0.0)

    box_rgba = _hex_to_rgba(config.bg_color, config.bg_opacity)
    box_rgb = box_rgba[:3]

    # --- Assertion 1: premultiplied invariant on box-interior pixels -------
    samples = _find_box_pixel_samples(original, box_rgba)
    assert len(samples) >= 8, (
        "expected several caption background box interior pixels (exact "
        f"match to {box_rgba}) in the source frame; found {len(samples)} — "
        "fixture geometry may need adjusting"
    )

    for x, y in samples:
        rd, gd, bd, ad = decoded.getpixel((x, y))
        assert abs(ad - box_rgba[3]) <= ALPHA_TOL, (
            f"decoded alpha at ({x},{y}) is {ad}, expected ~{box_rgba[3]} (tol {ALPHA_TOL})"
        )
        for channel_dec, channel_box, name in zip((rd, gd, bd), box_rgb, "RGB"):
            expected = channel_box * (ad / 255.0)
            assert abs(channel_dec - expected) <= RGB_TOL, (
                f"{name} at ({x},{y}) decoded={channel_dec}, expected "
                f"{name}_straight*(a/255)={expected:.1f} (tol {RGB_TOL}) — "
                "looks like straight, not premultiplied, alpha"
            )

    # --- Assertion 2: round-trip equivalence over a solid backdrop ---------
    reference = _composite_over(original, GRAY)
    candidate = _composite_over(_unpremultiply(decoded), GRAY)

    mean, max_diff = _rgb_diff_stats(reference, candidate)
    assert mean <= COMPOSITE_MEAN_TOL, (
        f"round-trip composite mean diff {mean:.2f} exceeds {COMPOSITE_MEAN_TOL} "
        "(unpremultiplied decoded MOV over gray vs. Pillow composite of the "
        "original straight-alpha frame over the same gray should match)"
    )
    assert max_diff <= COMPOSITE_MAX_TOL, (
        f"round-trip composite max diff {max_diff} exceeds {COMPOSITE_MAX_TOL}"
    )
