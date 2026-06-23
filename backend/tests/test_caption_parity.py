"""Cross-renderer caption parity: the HyperFrames HTML caption layer must match
the Pillow render (the source of truth the panel preview already mirrors).

For each style we render the SAME frame two ways — Pillow (`render_qa_frame_png`)
and the HyperFrames engine (`snapshot_hyperframes_project`, the real
``npx hyperframes snapshot``) — composited over the same solid video, then assert
a tolerance diff. The Pillow output is authoritative; there is no frozen baseline
to drift.

Heavy + environmental (spawns a headless browser, needs Node 22 + ffmpeg + the
GSAP CDN), so it is OPT-IN: set ``CAPFORGE_PARITY=1`` to run. It also skips
cleanly when Node/ffmpeg are unavailable. Run it after changing any caption
formula in hyperframes_caption_html.py / useSubtitleOverlay.ts / video_render.py:

    CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -v
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageStat

from backend.exporters.frame_qa import render_qa_frame_png
from backend.exporters.hyperframes_project import export_hyperframes_project
from backend.exporters.hyperframes_render import (
    HyperframesRenderError,
    snapshot_hyperframes_project,
)
from backend.exporters.node_runtime import hyperframes_argv
from backend.models.schemas import Segment, TranscriptionResult, VideoRenderConfig, WordSegment

# Tolerances: calibrated from validated renders (worst real case ~mean 4 / 3% on
# the text-stroke style; everything else <2 / ~1%). Generous enough for font
# anti-aliasing + sub-pixel layout, tight enough to catch a wrong colour, a
# missing pill, or an element flying out of place.
MEAN_MAX = 8.0          # mean abs per-channel pixel difference (0-255)
NOTABLE_FRAC_MAX = 5.0  # % of pixels whose diff exceeds 40

REPO_ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = REPO_ROOT / "Fonts" / "CaviarDreams.ttf"
W, H = 1280, 720
T = 1.0  # mid-way through the active word "brave"

_run = pytest.mark.skipif(
    os.environ.get("CAPFORGE_PARITY") != "1",
    reason="opt-in: set CAPFORGE_PARITY=1 (spawns a browser; needs Node+ffmpeg+network)",
)


def _require_tools():
    if hyperframes_argv() is None:
        pytest.skip("Node 22 / hyperframes CLI unavailable")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg unavailable")


@pytest.fixture(scope="module")
def source_video() -> str:
    _require_tools()
    path = os.path.join(tempfile.mkdtemp(prefix="cap_parity_src_"), "src.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=0x223344:s={W}x{H}:d=3",
         "-pix_fmt", "yuv420p", path],
        check=True, capture_output=True,
    )
    return path


def _result(words_per_group_six: bool = False) -> TranscriptionResult:
    if words_per_group_six:
        ws = [("one", 0.0, 0.5), ("two", 0.5, 1.0), ("three", 1.0, 1.5),
              ("four", 1.5, 2.0), ("five", 2.0, 2.5), ("six", 2.5, 3.0)]
        text = "one two three four five six"
    else:
        ws = [("Hello", 0.0, 0.75), ("brave", 0.75, 1.5), ("world", 1.5, 2.5)]
        text = "Hello brave world"
    return TranscriptionResult(
        segments=[Segment(start=0.0, end=3.0, text=text,
                          words=[WordSegment(word=w, start=s, end=e) for w, s, e in ws])],
        language="en", audio_path="/tmp/parity.wav", duration=3.0,
    )


def _config(**over) -> VideoRenderConfig:
    base = dict(
        resolution_w=W, resolution_h=H, font_size=90, font_family="Caviar Dreams",
        custom_font_path=str(FONT_PATH), words_per_group=3, bg_opacity=0.9,
        bg_color="#D4952A", text_color="#FFFFFF", active_word_color="#F5C842",
        animation="fade", animation_duration=0.3, position_y=0.82, position_x=0.5,
    )
    base.update(over)
    return VideoRenderConfig(**base)


def _diff(pillow_png: bytes, hf_png: bytes) -> tuple[float, float]:
    a = Image.open(io.BytesIO(pillow_png)).convert("RGB")
    b = Image.open(io.BytesIO(hf_png)).convert("RGB")
    assert a.size == b.size, f"size mismatch {a.size} vs {b.size}"
    d = ImageChops.difference(a, b)
    mean = sum(ImageStat.Stat(d).mean) / 3.0
    hist = d.convert("L").histogram()
    notable = sum(hist[41:]) / sum(hist) * 100.0
    return mean, notable


def _render_both(result, config, source_video) -> tuple[bytes, bytes]:
    pillow_png = render_qa_frame_png(result, config, T, True, None, source_video)
    project = export_hyperframes_project(
        result, config, tempfile.mkdtemp(prefix="cap_parity_hf_"),
        source_video_path=source_video,
    )
    try:
        hf_png = snapshot_hyperframes_project(project, T)
    except HyperframesRenderError as e:
        pytest.skip(f"HyperFrames snapshot unavailable: {e}")
    return pillow_png, hf_png


@_run
@pytest.mark.parametrize("mode", [
    "instant", "crossfade", "highlight", "underline", "bounce", "scale", "karaoke", "reveal",
])
def test_word_transition_parity(mode, source_video):
    pillow_png, hf_png = _render_both(_result(), _config(word_transition=mode), source_video)
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"{mode}: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"{mode}: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"


@_run
@pytest.mark.parametrize("name,result_six,over", [
    ("stroke", False, dict(word_transition="highlight", stroke_width=6, stroke_color="#000000")),
    ("shadow", False, dict(word_transition="instant", bg_opacity=0.0, shadow_enabled=True,
                           shadow_color="#000000", shadow_opacity=0.9, shadow_blur=10,
                           shadow_offset_x=4, shadow_offset_y=4)),
    ("multiline", True, dict(word_transition="highlight", words_per_group=6, lines=2)),
])
def test_feature_parity(name, result_six, over, source_video):
    pillow_png, hf_png = _render_both(_result(result_six), _config(**over), source_video)
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"{name}: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"{name}: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
