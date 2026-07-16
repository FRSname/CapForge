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


def _ffprobe_video_stream_tags(path: str) -> dict[str, str]:
    """ffprobe the first video stream's color metadata tags as a flat dict."""
    ffprobe_path = str(Path(_FFMPEG).parent / Path(_FFMPEG).name.replace("ffmpeg", "ffprobe"))
    cmd = [
        ffprobe_path, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries",
        "stream=color_range,color_space,color_transfer,color_primaries",
        "-of", "default=noprint_wrappers=1",
        path,
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=30)
    assert proc.returncode == 0, proc.stderr.decode(errors="replace")[-800:]
    tags: dict[str, str] = {}
    for line in proc.stdout.decode(errors="replace").splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            tags[key.strip()] = value.strip()
    return tags


# NOTE on the ProRes/MOV branch's tag coverage (verified against both
# Homebrew ffmpeg 8.0.1 and the bundled resources/bin-mac/ffmpeg 8.1):
# ``color_space`` (matrix) is the only one of the four ffprobe-visible
# container tags that lands for a prores_ks stream in an mov container —
# ``color_range``/``color_primaries``/``color_transfer`` never appear at the
# container level for ProRes here regardless of which encoder-side flags are
# passed (the mov muxer only ever emits the legacy 3-field 'nclc' colr atom
# variant for ProRes, which structurally has no range bit; primaries/transfer
# were reproducibly unpropagated through this ffmpeg build's generic
# AVCodecContext options for EVERY codec tested — including ffv1/mkv and
# libx264/mp4 — not just prores_ks). The underlying pixel data is still
# correctly BT.709/limited-range converted (pinned by the premultiplied +
# saturated-color round-trip assertions below), it just isn't visible via
# ffprobe's container-level query on this branch. See CLAUDE.md "Overlay MOV
# alpha convention" section and the color-metadata hardening report for the
# full investigation.
_MOV_ACHIEVABLE_TAG = "color_space"
_MOV_ACHIEVABLE_VALUE = "bt709"


@_run
def test_overlay_mov_color_tags(tmp_path):
    """The ProRes 4444 overlay MOV must be explicitly tagged BT.709 so NLEs
    stop guessing the matrix (an untagged stream lets Premiere assume the
    wrong matrix/range and mis-render the caption box). See the module-level
    note above ``_MOV_ACHIEVABLE_TAG`` for why only ``color_space`` is
    asserted here rather than all four fields."""
    config = _config()
    result = _result(tmp_path)

    output_path = render_subtitle_video(result, config, str(tmp_path))
    assert output_path.endswith(".mov")

    tags = _ffprobe_video_stream_tags(output_path)
    assert tags.get(_MOV_ACHIEVABLE_TAG) == _MOV_ACHIEVABLE_VALUE, tags


@_run
def test_overlay_mov_saturated_color_premultiply_and_tags(tmp_path):
    """Same premultiplied-invariant + round-trip-composite assertions as
    ``test_overlay_mov_alpha_is_premultiplied``, but on a SATURATED background
    color (not grayscale). A tags-without-matrix or matrix-without-tags
    mistake in the BT.709 pipeline shows up as a hue shift on saturated
    colors — invisible on the grayscale fixture above — so this pins matrix
    and tag consistency together. Also re-checks the color tags on this
    config to guard against a config-dependent regression in the ``-vf``
    filter chain (e.g. accidentally gating the scale/format filter on
    grayscale-only test values)."""
    config = _config(bg_color="#CC3344", bg_opacity=0.5)
    result = _result(tmp_path)

    output_path = render_subtitle_video(result, config, str(tmp_path))
    assert output_path.endswith(".mov")

    tags = _ffprobe_video_stream_tags(output_path)
    assert tags.get(_MOV_ACHIEVABLE_TAG) == _MOV_ACHIEVABLE_VALUE, tags

    decoded = _decode_first_frame_rgba(output_path, W, H)
    assert decoded.size == (W, H)

    groups = _build_groups(result, config.words_per_group)
    font = _get_font(config.font_family, config.font_size, config.custom_font_path, bold=config.bold)
    original = _render_frame(config, font, groups[0], 0.0)

    box_rgba = _hex_to_rgba(config.bg_color, config.bg_opacity)
    box_rgb = box_rgba[:3]

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
                "looks like straight, not premultiplied, alpha, or a matrix/tag "
                "mismatch introduced a hue shift"
            )

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


# NOTE on MP4 (libx264) tag coverage — verified against both Homebrew ffmpeg
# 8.0.1 and the bundled resources/bin-mac/ffmpeg 8.1: ``color_range`` and
# ``color_space`` (matrix) both land correctly for a libx264 stream, but
# ``color_transfer``/``color_primaries`` never appear regardless of the
# ``-color_trc``/``-color_primaries`` flags passed — reproduced identically
# across every codec tested (libx264, libx265, mpeg4, ffv1/mkv, mjpeg,
# prores_ks), so this is a generic limitation of this ffmpeg build's
# AVCodecContext option propagation, not specific to the mp4 muxer. Only the
# two fields verified to actually work are asserted below.


@_run
def test_overlay_mp4_color_tags(tmp_path):
    """The libx264 overlay MP4 branch must carry explicit BT.709 limited-range
    tags (see the module-level note above for scope)."""
    config = _config(output_format="mp4")
    result = _result(tmp_path)

    output_path = render_subtitle_video(result, config, str(tmp_path))
    assert output_path.endswith(".mp4")

    tags = _ffprobe_video_stream_tags(output_path)
    assert tags.get("color_range") == "tv", tags
    assert tags.get("color_space") == "bt709", tags


@_run
def test_baked_mp4_color_tags(tmp_path):
    """The baked MP4 branch (libx264, rgb24 pipe input + audio mapped from a
    second ffmpeg input) must carry the same explicit BT.709 tags (see the
    module-level note above for scope). Synthesizes a tiny 1-second lavfi
    source video so the decode/encode pipe pair in ``_render_baked`` runs
    end-to-end without a real media fixture."""
    source_path = str(tmp_path / "source.mp4")
    gen_cmd = [
        _FFMPEG, "-y",
        "-f", "lavfi", "-i", f"color=c=blue:s={W}x{H}:d={DURATION}:r={FPS}",
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono",
        "-t", str(DURATION),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        source_path,
    ]
    proc = subprocess.run(gen_cmd, capture_output=True, timeout=30)
    assert proc.returncode == 0, proc.stderr.decode(errors="replace")[-800:]

    config = _config(render_mode="baked", output_format="mp4")
    result = _result(tmp_path)

    output_path = render_subtitle_video(
        result, config, str(tmp_path), source_video_path=source_path,
    )
    assert output_path.endswith(".mp4")

    tags = _ffprobe_video_stream_tags(output_path)
    assert tags.get("color_range") == "tv", tags
    assert tags.get("color_space") == "bt709", tags
