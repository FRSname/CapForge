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
EXTENT_TOL_PX = 3       # max per-edge caption-bbox delta between the two frames

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


def _solid_video(w: int, h: int) -> str:
    """Solid-colour source video at an arbitrary resolution (the resolution
    fixtures need sizes other than the module default)."""
    _require_tools()
    path = os.path.join(tempfile.mkdtemp(prefix="cap_parity_src_"), "src.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=0x223344:s={w}x{h}:d=3",
         "-pix_fmt", "yuv420p", path],
        check=True, capture_output=True,
    )
    return path


@pytest.fixture(scope="module")
def source_video() -> str:
    return _solid_video(W, H)


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


def _content_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of pixels that differ notably from the frame's flat
    background (sampled at the top-left corner — every fixture composites over
    a solid-colour video). Threshold 24 on the max-channel diff sits far above
    codec noise (~±5) but well inside any real caption pixel."""
    bg = Image.new("RGB", img.size, img.getpixel((0, 0)))
    r, g, b = ImageChops.difference(img, bg).split()
    mask = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v > 24 else 0)
    bbox = mask.getbbox()
    assert bbox is not None, "no caption content found against the background"
    return bbox


def _diff(pillow_png: bytes, hf_png: bytes) -> tuple[float, float]:
    a = Image.open(io.BytesIO(pillow_png)).convert("RGB")
    b = Image.open(io.BytesIO(hf_png)).convert("RGB")
    assert a.size == b.size, f"size mismatch {a.size} vs {b.size}"
    # Extent check: caption bounding boxes must agree edge-for-edge. This
    # catches the few-px geometry drift (a shifted word, a wrong scale) that
    # the loose mean/notable tolerances below can hide.
    ba, bb = _content_bbox(a), _content_bbox(b)
    edges = [abs(x - y) for x, y in zip(ba, bb)]
    print(f"[extent] pillow={ba} hyperframes={bb} edge-deltas={edges}")
    assert max(edges) <= EXTENT_TOL_PX, (
        f"caption extents drift: pillow bbox {ba} vs hyperframes {bb} "
        f"(edge deltas {edges}, budget {EXTENT_TOL_PX}px)"
    )
    d = ImageChops.difference(a, b)
    mean = sum(ImageStat.Stat(d).mean) / 3.0
    hist = d.convert("L").histogram()
    notable = sum(hist[41:]) / sum(hist) * 100.0
    return mean, notable


def _render_both(result, config, source_video, custom_groups=None, t=T) -> tuple[bytes, bytes]:
    pillow_png = render_qa_frame_png(result, config, t, True, custom_groups, source_video)
    project = export_hyperframes_project(
        result, config, tempfile.mkdtemp(prefix="cap_parity_hf_"),
        source_video_path=source_video,
        custom_groups=custom_groups,
    )
    try:
        hf_png = snapshot_hyperframes_project(project, t)
    except HyperframesRenderError as e:
        pytest.skip(f"HyperFrames snapshot unavailable: {e}")
    return pillow_png, hf_png


@_run
@pytest.mark.parametrize("mode", [
    "instant", "crossfade", "highlight", "underline", "bounce", "scale", "karaoke", "reveal",
    "none",
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


def _override_groups() -> list[dict]:
    """One 4-word group with per-word overrides riding on the word dicts under
    ``overrides`` — exactly the shape Pillow consumes (video_render.py:476)."""
    words = [
        {"word": "Big",    "start": 0.0,  "end": 0.75,
         "overrides": {"font_size_scale": 1.5}},
        {"word": "colour", "start": 0.75, "end": 1.5,
         "overrides": {"text_color": "#3EC1FF", "active_word_color": "#FF4D6D"}},
        {"word": "under",  "start": 1.5,  "end": 2.25,
         "overrides": {"word_transition": "underline"}},
        {"word": "moved",  "start": 2.25, "end": 3.0,
         "overrides": {"pos_offset_x": 12, "pos_offset_y": -8}},
    ]
    return [{"text": "Big colour under moved", "start": 0.0, "end": 3.0, "words": words}]


@_run
def test_highlight_slide_parity(source_video):
    """D2: highlight_animation='slide' — the pill lerps from the previous word's
    rect with t_ease = 1 - (1 - clamp(raw_t*2.5, 0, 1))**2 (video_render.py
    _draw_word_list). Snapshot at t=0.9, 20% into word 2 "brave" (0.75-1.5):
    raw_t=0.2 → t_ease=0.75, so the pill sits mid-slide between "Hello" and
    "brave" — a jump-mode pill (or a static one) would land pixels elsewhere."""
    pillow_png, hf_png = _render_both(
        _result(), _config(word_transition="highlight", highlight_animation="slide"),
        source_video, t=0.9,
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"slide: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"slide: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"


@_run
def test_word_override_parity(source_video):
    """D1: per-word overrides — a size-scaled word, a recolored word, a per-word
    transition override, and a positional nudge must match Pillow exactly.
    Snapshot at t=1.9 → word 3 is active, so its 'underline' override fires
    (and gates the pill OFF despite the global 'highlight' mode) while word 2
    shows its overridden base text_color."""
    pillow_png, hf_png = _render_both(
        _result(), _config(word_transition="highlight"), source_video,
        custom_groups=_override_groups(), t=1.9,
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"overrides: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"overrides: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"


@_run
def test_group_position_parity(source_video):
    """Phase 5 (per-group position): position_x/position_y on the GROUP dict
    (the sparse CustomGroup override) must move the caption anchor identically
    in Pillow and the HyperFrames runtime. The config keeps its default bottom
    anchor (0.82) while the group pins itself near the top (0.15) — a runtime
    that ignored the group-level fields would leave the caption ~480px away
    and blow the extent assertion. The bbox-top sanity check guards the
    complementary failure: BOTH renderers ignoring the override would still
    agree with each other."""
    groups = [{
        "text": "Hello brave world", "start": 0.0, "end": 3.0,
        "position_x": 0.5, "position_y": 0.15,
        "words": [
            {"word": "Hello", "start": 0.0, "end": 0.75},
            {"word": "brave", "start": 0.75, "end": 1.5},
            {"word": "world", "start": 1.5, "end": 2.5},
        ],
    }]
    pillow_png, hf_png = _render_both(
        _result(), _config(word_transition="highlight"), source_video,
        custom_groups=groups,
    )
    top = _content_bbox(Image.open(io.BytesIO(pillow_png)).convert("RGB"))[1]
    assert top < H * 0.4, f"group position override ignored: caption top at y={top}"
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"group position: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"group position: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"


@_run
def test_group_entry_ease_parity(source_video):
    """Phase 3 ease lock: group entrance easing must be QUADRATIC — Canvas
    easeOut (useSubtitleOverlay.ts) / Pillow _ease_out / GSAP power1.out are
    all 1-(1-t)^2. Snapshot mid-entry of a SLIDE group (t = animDur/2 → raw
    0.5, frame-aligned at 30fps): quad leaves the caption offset by
    slide_px*(1-0.75) = 7.2px, a cubic tween (power2.out — the GSAP naming
    trap) only 3.6px — the extent check separates them cleanly; the alpha
    delta (0.75 vs 0.875) adds mean/notable signal on top. bg_opacity=0 +
    instant words keep the frame free of overlapping translucent elements,
    where browser group-opacity flattening and Canvas/Pillow's stacked
    per-element alpha legitimately differ mid-fade (documented accepted
    delta — a mid-entry POP frame can never be pixel-exact for that reason).
    All other fixtures snapshot with the entry animation already complete,
    so only this one exercises the ease."""
    pillow_png, hf_png = _render_both(
        _result(), _config(animation="slide", animation_duration=0.4,
                           bg_opacity=0.0, word_transition="instant"),
        source_video, t=0.2,
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"slide mid-entry: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"slide mid-entry: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"


@_run
@pytest.mark.parametrize("rw,rh", [(1920, 1080), (1080, 1920)], ids=["1080p", "portrait"])
def test_resolution_parity(rw, rh):
    """Phase 3: every other fixture runs at 1280x720 — lock the basic highlight
    scenario at 1080p landscape and 1080x1920 portrait so a resolution-dependent
    scale/layout bug can't hide behind the single-size suite."""
    pillow_png, hf_png = _render_both(
        _result(), _config(resolution_w=rw, resolution_h=rh, word_transition="highlight"),
        _solid_video(rw, rh),
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"{rw}x{rh}: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"{rw}x{rh}: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
