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
from backend.exporters.video_render import groups_for_render
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


def _content_mask(img: Image.Image) -> Image.Image:
    """1-bit mask of pixels that differ notably from the frame's flat
    background (sampled at the top-left corner — every fixture composites over
    a solid-colour video). Threshold 24 on the max-channel diff sits far above
    codec noise (~±5) but well inside any real caption pixel."""
    bg = Image.new("RGB", img.size, img.getpixel((0, 0)))
    r, g, b = ImageChops.difference(img, bg).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v > 24 else 0)


def _content_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of `_content_mask`'s notable-diff pixels."""
    bbox = _content_mask(img).getbbox()
    assert bbox is not None, "no caption content found against the background"
    return bbox


def _color_pixel_count(img: Image.Image, hex_color: str, tol: int = 12) -> int:
    """Number of pixels within `tol` per channel of `hex_color`. Used to assert
    an element is still VISIBLE (i.e. not buried under a later-drawn layer) —
    a stacking-order check the mean/notable tolerances are too coarse for, since
    a single mis-layered element covers only a few percent of the frame."""
    want = Image.new("RGB", img.size, hex_color)
    r, g, b = ImageChops.difference(img, want).split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return sum(worst.histogram()[: tol + 1])


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


def _highlight_offset_override_group() -> list[dict]:
    """One 3-word group where the active word carries a per-word highlight
    pill offset override — the highlight-mode counterpart of
    ``_override_groups()``. Unlike that group's "under"/"moved" words (whose
    overrides disable the pill or move a different word), the active word
    here keeps ``word_transition='highlight'`` from the global config so its
    pill actually renders with the per-word offset applied."""
    words = [
        {"word": "Hello", "start": 0.0, "end": 0.75},
        {"word": "brave", "start": 0.75, "end": 1.5,
         "overrides": {"highlight_offset_x": 10, "highlight_offset_y": -6}},
        {"word": "world", "start": 1.5, "end": 2.5},
    ]
    return [{"text": "Hello brave world", "start": 0.0, "end": 2.5, "words": words}]


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
def test_highlight_offset_parity(source_video):
    """highlight_offset_x/y must shift the pill rect identically in Pillow and
    HyperFrames — including the riskiest combination, offset + 'slide'
    movement. The offset must translate the pill rigidly (applied post-lerp
    to BOTH tween ends), not lerp in during the slide. Same mid-slide t as
    test_highlight_slide_parity (t=0.9, 20% into word 2 'brave': raw_t=0.2 ->
    t_ease=0.75) so a renderer that added the offset only to the tween's
    'to' value would land pixels elsewhere than one that translated rigidly."""
    pillow_png, hf_png = _render_both(
        _result(),
        _config(word_transition="highlight", highlight_animation="slide",
                 highlight_offset_x=20, highlight_offset_y=-12),
        source_video, t=0.9,
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"offset+slide: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"offset+slide: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"

    # Per-word highlight_offset override. _override_groups()'s "under"/"moved"
    # words never show a pill at their sampled t (the override disables
    # highlight or nudges a different word), so cover the per-word offset
    # override path with its own small group where the active word's pill
    # actually renders.
    pillow_png2, hf_png2 = _render_both(
        _result(), _config(word_transition="highlight"), source_video,
        custom_groups=_highlight_offset_override_group(), t=1.0,
    )
    mean2, notable2 = _diff(pillow_png2, hf_png2)
    assert mean2 < MEAN_MAX, f"offset override: mean diff {mean2:.2f} >= {MEAN_MAX}"
    assert notable2 < NOTABLE_FRAC_MAX, (
        f"offset override: {notable2:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )


def _scaled_word_group() -> list[dict]:
    """One 3-word group where the ACTIVE highlight word ("brave") carries a
    font_size_scale override — Defect A/B's dedicated fixture
    (word-scale-highlight-pill-parity.md): the pill must grow to hug the
    word as rendered (scaled height AND scaled width), not the group's
    global text metrics. "Hello" stays scale 1.0 so the slide variant below
    has a differently-sized previous word to lerp from."""
    words = [
        {"word": "Hello", "start": 0.0, "end": 0.75},
        {"word": "brave", "start": 0.75, "end": 1.5,
         "overrides": {"font_size_scale": 1.5}},
        {"word": "world", "start": 1.5, "end": 2.5},
    ]
    return [{"text": "Hello brave world", "start": 0.0, "end": 2.5, "words": words}]


@_run
def test_word_scale_highlight_parity(source_video):
    """Defect A/B (word-scale-highlight-pill-parity.md): a per-word
    font_size_scale override on the ACTIVE highlight word must grow the pill
    to match the word's rendered size — not the group's global text height/
    width — identically in Pillow and HyperFrames. Snapshot at t=1.0, mid-way
    through the scaled word 'brave' (active 0.75-1.5)."""
    pillow_png, hf_png = _render_both(
        _result(), _config(word_transition="highlight"), source_video,
        custom_groups=_scaled_word_group(), t=1.0,
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"word scale highlight: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, (
        f"word scale highlight: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )


@_run
def test_word_scale_highlight_slide_parity(source_video):
    """Slide variant of the scaled-word pill: the pill HEIGHT (and the
    already-scaled width) must lerp from the previous word's rect to the
    active (scaled) word's rect using the same t_ease as the x/width lerp.
    Snapshot at t=0.9, 20% into scaled word 'brave' (0.75-1.5): raw_t=0.2 ->
    t_ease=0.75, so the pill sits mid-slide between 'Hello' (scale 1.0) and
    'brave' (scale 1.5) — a renderer using the wrong (global or unscaled)
    height at either tween end would land pixels elsewhere."""
    pillow_png, hf_png = _render_both(
        _result(),
        _config(word_transition="highlight", highlight_animation="slide"),
        source_video, custom_groups=_scaled_word_group(), t=0.9,
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"word scale slide: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, (
        f"word scale slide: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )


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

    # Gap closed (word-scale-highlight-pill-parity.md Phase 4 #3): the same
    # group's "Big" word (font_size_scale=1.5) has no word_transition override
    # of its own, so it inherits the global 'highlight' mode. t=1.9 above
    # samples word 3 ("under"), long after "Big" (active 0.0-0.75) has ended —
    # so the scaled-word-ACTIVE pill was never asserted. Snapshot mid-word here.
    pillow_png2, hf_png2 = _render_both(
        _result(), _config(word_transition="highlight"), source_video,
        custom_groups=_override_groups(), t=0.375,
    )
    mean2, notable2 = _diff(pillow_png2, hf_png2)
    assert mean2 < MEAN_MAX, f"overrides (scaled word active): mean diff {mean2:.2f} >= {MEAN_MAX}"
    assert notable2 < NOTABLE_FRAC_MAX, (
        f"overrides (scaled word active): {notable2:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )


# Active word "three" carries both a word box and the highlight pill. The two
# colours must stay far apart so `_color_pixel_count` can tell "pill on top of
# box" (correct) from "box on top of pill" (a stacking regression) — see
# test_word_background_parity.
_WORD_BG_ACTIVE_BOX_COLOR = "#0B1020"   # near-black word box
_WORD_BG_PILL_COLOR = "#F5C842"         # gold pill, = _config()'s active_word_color


def _word_bg_groups() -> list[dict]:
    """One 6-word group (wrapped to 2 rows of 3 by ``lines=2``) covering every
    per-word background case from docs/plans/per-word-background.md Phase 5a.

    Row 1 — "one" / "two" / "three":
      * ``one``   inactive, fully explicit box (own colour/radius/padding) plus
        ``word_bg_offset_x/y`` — the two keys with no global counterpart.
      * ``two``   boxless, and deliberately ``font_size_scale`` 1.5. It is the
        enable-gate probe: the gate is presence AND value, so an unset word must
        stay boxless even though the global background is on. Scaled to 1.5 it
        sits in the narrow band where a leaked box (scaled text height + the
        inherited padding/extra) would clear ``three``'s box and push the caption
        bbox top out by ~6px — past the 3px extent budget — while its bare glyphs
        stay ~11px inside it. The Pillow side of the gate is pinned by the
        ``word_bg_box`` golden; this is what pins the HTML runtime's copy.
      * ``three`` ACTIVE at the sampled t, with a box padded WIDER and TALLER
        than the highlight pill on every side — the pill must sit on top of it
        (group bg → word box → pill → words). Pinned by the pill-visibility
        assertion in the test, not by the diff alone.

    Row 2 — "four" / "five" / "six":
      * ``four`` ``font_size_scale`` + a box, exercising the per-word scaled text
        height (Canvas ``wordScaledTextH`` / Pillow ``_resolve_scaled_font`` /
        HTML ``m.textH``) AND row-locality: the box must land on row 2's centre.
      * ``five`` boxless spacer.
      * ``six``  sets ONLY ``word_bg_opacity`` — colour, radius, padding and the
        width/height extras all inherit from the (deliberately non-default)
        global ``bg_*`` config, which is the plan's core inheritance rule.

    Extent teeth (why the offsets and paddings are the values they are): the
    boxes are tuned so a WORD box — not the group box — owns each edge of the
    caption bounding box, which is the one assertion in ``_diff`` sharp enough to
    catch few-px drift. ``one``'s negative ``word_bg_offset_x`` owns left,
    ``three``'s wide explicit padding owns top+right, and ``four`` — which sets
    no geometry of its own, so its box is sized by the inherited
    ``bg_padding_v`` / ``bg_height_extra`` and its own scaled text height — owns
    bottom. Both the inheritance rule and the scaled height are therefore
    measured by the 3px extent budget, not merely eyeballed. Every owned edge
    clears the group box by >=8px.

    Layout note (load-bearing, not cosmetic): the boxes are placed so that no two
    pill-layer elements overlap, and the pill is made opaque by the caller. Pillow
    paints boxes and pills onto one shared RGBA ``pill_layer`` with
    ``ImageDraw.rounded_rectangle``, which REPLACES pixels, while the HTML runtime
    stacks independent divs that alpha-blend. Two *translucent* pill-layer shapes
    on top of each other would therefore differ legitimately — the same accepted
    delta CLAUDE.md documents for overlapping translucent pixels — and that is not
    what this fixture is measuring. Keep the boxes separated (word ``two``/``five``
    are the spacers) and the pill opaque if you retune it.
    """
    words = [
        {"word": "one", "start": 0.0, "end": 0.5, "overrides": {
            "word_bg_opacity": 0.8, "word_bg_color": "#7A1FA2", "word_bg_radius": 6,
            "word_bg_padding_h": 12, "word_bg_padding_v": 8,
            "word_bg_offset_x": -22, "word_bg_offset_y": -10,
        }},
        {"word": "two", "start": 0.5, "end": 1.0, "overrides": {"font_size_scale": 1.5}},
        {"word": "three", "start": 1.0, "end": 1.5, "overrides": {
            "word_bg_opacity": 0.9, "word_bg_color": _WORD_BG_ACTIVE_BOX_COLOR,
            "word_bg_padding_h": 30, "word_bg_padding_v": 26,
        }},
        {"word": "four", "start": 1.5, "end": 2.0, "overrides": {
            "font_size_scale": 1.3, "word_bg_opacity": 0.8,
        }},
        {"word": "five", "start": 2.0, "end": 2.5},
        {"word": "six", "start": 2.5, "end": 3.0, "overrides": {"word_bg_opacity": 0.7}},
    ]
    return [{"text": "one two three four five six", "start": 0.0, "end": 3.0, "words": words}]


@_run
def test_word_background_parity(source_video):
    """Phase 5a (docs/plans/per-word-background.md): the per-word background box
    must be identical in Pillow and the HyperFrames runtime — geometry, the
    inheritance chain onto the global ``bg_*`` fields, and its place in the
    stack (group bg → word box → highlight pill → words).

    The global background is pushed OFF its defaults on every field a word box
    can inherit (colour, radius, both paddings, both extras), so the "opacity
    only" word ``six`` genuinely pins the inheritance rule: a renderer that fell
    back to the schema defaults instead — e.g. ``bg_padding_h`` 40 rather than
    22 — would mis-size that box by 18px per side, far outside every tolerance
    here.

    Sampled at t=1.2, frame-aligned at 30fps and mid-way through word 3 "three"
    (1.0-1.5) so its box carries the highlight pill, and past the 0.3s entry fade
    so the group sits at full opacity (a mid-entry frame over translucent boxes
    is a documented accepted delta — CLAUDE.md → Accepted deltas).

    ``highlight_opacity=1.0`` and ``line_height=1.7`` are deliberate: see the
    layout note on ``_word_bg_groups`` — they keep the shared Pillow pill layer
    free of overlapping translucent shapes so the assertion measures the word
    box, not PIL's replace-vs-blend semantics.
    """
    pillow_png, hf_png = _render_both(
        _result(words_per_group_six=True),
        _config(words_per_group=6, lines=2, line_height=1.7, position_y=0.75,
                word_transition="highlight", highlight_opacity=1.0,
                highlight_padding_x=20, highlight_padding_y=16,
                bg_color="#1E4B8F", bg_corner_radius=34,
                bg_padding_h=22, bg_padding_v=10,
                bg_width_extra=14, bg_height_extra=6),
        source_video, custom_groups=_word_bg_groups(), t=1.2,
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"word background: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, (
        f"word background: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )

    # Stacking order (group bg → word box → pill → words), asserted directly.
    # `three`'s box is opaque-ish near-black and strictly larger than its pill on
    # every side, so if either renderer drew the box AFTER the pill the pill
    # would vanish. That covers only ~3% of the frame, which the mean/notable
    # budgets above are deliberately too coarse to catch — verified by mutation:
    # swapping the HTML runtime's insertBefore for appendChild passes _diff and
    # fails here. Absolute floor catches BOTH renderers regressing together; the
    # ratio catches just one of them.
    counts = {}
    for label, png in (("pillow", pillow_png), ("hyperframes", hf_png)):
        img = Image.open(io.BytesIO(png)).convert("RGB")
        counts[label] = _color_pixel_count(img, _WORD_BG_PILL_COLOR)
        assert counts[label] > 5000, (
            f"stacking: {label} shows only {counts[label]} highlight-pill pixels — "
            f"the word background box was drawn on top of the pill"
        )
    lo, hi = min(counts.values()), max(counts.values())
    assert hi - lo <= hi * 0.15, (
        f"stacking: pill visibility disagrees between renderers {counts} — one of "
        f"them layers the per-word background box against the pill differently"
    )


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


def _gap_groups(held: bool = False) -> list[dict]:
    """Two groups with a real 1s silence gap between them: group 1's words end
    at 1.0, group 2's words start at 2.0. When ``held`` is True, group 1's
    outer ``end`` is baked to 2.0 (group 2's start) — the "Fill gaps" button /
    editable end-time result — so a sample at t=1.5, inside the former gap,
    still shows group 1's caption. With the natural end (1.0), the same t falls
    in the real gap and both renderers must show nothing."""
    return [
        {"text": "Hello brave", "start": 0.0, "end": 2.0 if held else 1.0, "words": [
            {"word": "Hello", "start": 0.0, "end": 0.5},
            {"word": "brave", "start": 0.5, "end": 1.0},
        ]},
        {"text": "world today", "start": 2.0, "end": 3.0, "words": [
            {"word": "world", "start": 2.0, "end": 2.5},
            {"word": "today", "start": 2.5, "end": 3.0},
        ]},
    ]


@_run
def test_baked_gap_end_parity(source_video):
    """A group whose end is baked/extended to the next group's start (the
    "Fill gaps" button / editable end-time result) persists its caption through
    the silence gap instead of disappearing. Sampled at t=1.5 — inside the
    former gap — both renderers must still show group 1's "Hello brave" text."""
    pillow_png, hf_png = _render_both(
        _result(), _config(word_transition="instant"), source_video,
        custom_groups=_gap_groups(held=True), t=1.5,
    )
    assert _content_mask(Image.open(io.BytesIO(pillow_png)).convert("RGB")).getbbox() is not None, (
        "baked gap end: pillow frame at t=1.5 has no caption content"
    )
    mean, notable = _diff(pillow_png, hf_png)
    assert mean < MEAN_MAX, f"baked gap end: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, f"baked gap end: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"

    # Sanity counterpart: with the NATURAL end (1.0), the same t is still inside
    # the REAL gap and must render an EMPTY caption in both renderers. This
    # guards the diff assertion above against a false positive where both
    # renderers simply show nothing (which would also "agree").
    pillow_empty, hf_empty = _render_both(
        _result(), _config(word_transition="instant"), source_video,
        custom_groups=_gap_groups(held=False), t=1.5,
    )
    for label, png in (("pillow", pillow_empty), ("hyperframes", hf_empty)):
        img = Image.open(io.BytesIO(png)).convert("RGB")
        assert _content_mask(img).getbbox() is None, (
            f"natural gap end: {label} frame at t=1.5 unexpectedly shows caption content"
        )


# RSVP ("speed reading") is a LAYOUT mode, not a `word_transition` value, so it
# cannot ride the `test_word_transition_parity` parametrize list — passing
# `word_transition='rsvp'` would just be an unknown decoration mode. It gets its own
# fixtures below.
#
# `rsvp_slide_duration` is 0.2 here rather than the 0.06 default on purpose: the
# mid-slide sample has to land on a 30fps frame boundary (the CLI captures the frame
# nearest `--at`), and with a 60ms slide the nearest frame is only ~2 frames wide, so
# a 3ms timing difference between the two renderers would move the line several px.
# A 200ms slide keeps the *ease* under test while making the sample robust.
_RSVP = dict(
    reading_mode="rsvp", rsvp_pivot_x=0.35, rsvp_focus_color="#E4851F",
    rsvp_context_opacity=0.75, rsvp_slide_duration=0.2, rsvp_edge_fade=0.12,
    rsvp_reticle=True, word_transition="instant",
)

# Word 3 "world" starts at 1.5; 47/30 s is 1/3 of the way through its 200ms slide,
# where the shared quad ease-out (GSAP 'power1.out') puts the line 55.6% of the way
# to the new target and a cubic ('power2.out', the naming trap) 70.4% — tens of px
# apart. A hold-only case passes with either.
_RSVP_MID_SLIDE_T = 47 / 30


@_run
@pytest.mark.parametrize("name,t,over", [
    # Box ON: the caption bbox is then the BACKGROUND BOX, so the extent budget
    # measures the band-sized box (RSVP sizes it to the band, never to the row).
    ("hold-boxed", 1.0, dict(bg_opacity=0.9)),
    # Box OFF: the bbox is the TEXT, so the extent budget measures the line
    # translation itself — this is the case a wrong lineX/ease cannot survive.
    ("mid-slide", _RSVP_MID_SLIDE_T, dict(bg_opacity=0.0)),
])
def test_rsvp_parity(name, t, over, source_video):
    """Phase 4b: the HTML/GSAP RSVP renderer vs Pillow (the source of truth).

    Everything RSVP owns is in frame: the caption band (`resolution_w * max_width`
    centred on the row anchor) and therefore the background box, the pivot column,
    the eased single-scalar line translation, the three-piece active word with its
    focus glyph centred on the pivot, the context dimming, the edge-fade mask and
    the unmasked reticle. A wrong `lineX`, prefix measurement, band or ease shows up
    as a bbox shift, which the 3px per-edge extent budget in `_diff` catches — as
    long as the bbox belongs to the *text*, hence the box-off case.
    """
    pillow_png, hf_png = _render_both(
        _result(), _config(**_RSVP, **over), source_video, t=t,
    )
    mean, notable = _diff(pillow_png, hf_png)
    print(f"[rsvp {name}] mean={mean:.2f} notable={notable:.2f}%")
    assert mean < MEAN_MAX, f"rsvp {name}: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, (
        f"rsvp {name}: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )


@_run
def test_rsvp_reel_parity(source_video):
    """A frame **past a caption-group boundary**, inside one reel.

    Six words at `words_per_group=3` is two groups whose ends touch exactly, so
    `groups_for_render` joins them into one reel (`rsvp_reels.py`) and the line
    slides across the boundary instead of resetting at it. That makes this the
    case where the two renderers can most easily disagree: the boundary word is
    index 0 of a *fresh* line if either side failed to reel (which snaps, with no
    ease at all) and index 3 of a continuing one if it did. `bg_opacity=0` so the
    caption bbox is the TEXT and the 3px per-edge extent budget measures the line
    translation rather than a band-sized box that would look identical either way.

    Sampled at the same 1/3-through-the-slide instant as the mid-slide case above,
    which for this fixture falls inside the slide into "four" — the first word of
    the second group.
    """
    result, config = _result(words_per_group_six=True), _config(**_RSVP, bg_opacity=0.0)

    # Non-vacuous: assert the fixture really does produce one reel from two groups.
    assert len(groups_for_render(result, _config(words_per_group_six=True), None)) == 2
    reels = groups_for_render(result, config, None)
    assert len(reels) == 1 and len(reels[0]["words"]) == 6

    pillow_png, hf_png = _render_both(result, config, source_video, t=_RSVP_MID_SLIDE_T)
    mean, notable = _diff(pillow_png, hf_png)
    print(f"[rsvp reel] mean={mean:.2f} notable={notable:.2f}%")
    assert mean < MEAN_MAX, f"rsvp reel: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, (
        f"rsvp reel: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )


def _rsvp_override_groups() -> list[dict]:
    """One RSVP group exercising every per-word override the mode honours: a
    recoloured context word, a differently-coloured active word, a font-scaled word
    (measured AND drawn in its own font, so its focus glyph must still land on the
    pivot) and a positional nudge (which moves the drawn word *including* its focus
    glyph — intended). "moved" is the anchor at the sampled t=1.9."""
    words = [
        {"word": "Big", "start": 0.0, "end": 0.75,
         "overrides": {"font_size_scale": 1.5}},
        {"word": "colour", "start": 0.75, "end": 1.5,
         "overrides": {"text_color": "#3EC1FF", "active_word_color": "#FF4D6D"}},
        {"word": "moved", "start": 1.5, "end": 2.25,
         "overrides": {"pos_offset_x": 12, "pos_offset_y": -8}},
    ]
    return [{"text": "Big colour moved", "start": 0.0, "end": 2.25, "words": words}]


@_run
def test_rsvp_override_parity(source_video):
    """Per-word overrides + letter tracking + a text stroke, all in RSVP mode.

    Tracking is the tracking-gap teeth: the measurement primitive counts `n - 1`
    inter-character gaps, so both renderers must add the one missing gap in the
    three-piece pen walk *and* at the layout site, or the focus glyph lands a whole
    `tracking` off the pivot. The stroke is the dimming teeth: a context word's
    outline must dim with its fill (Pillow needed an explicit `_dim_alpha`; the HTML
    layer gets it from element opacity), otherwise the frame shows solid outlines
    around ghosts and the notable-pixel budget blows."""
    pillow_png, hf_png = _render_both(
        _result(),
        # bg_opacity 0 so the caption bbox is the TEXT: the extent budget then
        # measures the overridden words' positions, not a box that ignores them.
        _config(**_RSVP, bg_opacity=0.0, tracking=3,
                stroke_width=4, stroke_color="#101820"),
        source_video, custom_groups=_rsvp_override_groups(), t=1.9,
    )
    mean, notable = _diff(pillow_png, hf_png)
    print(f"[rsvp overrides] mean={mean:.2f} notable={notable:.2f}%")
    assert mean < MEAN_MAX, f"rsvp overrides: mean diff {mean:.2f} >= {MEAN_MAX}"
    assert notable < NOTABLE_FRAC_MAX, (
        f"rsvp overrides: {notable:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )

    # Same group sampled while the FONT-SCALED word is the anchor: it must be
    # measured *and* drawn (as three pieces) in its own 1.5x font, or its focus
    # glyph lands off the pivot and the whole line is translated wrong. t=1.9 above
    # anchors on "moved", which has no font override, so this is a real second case
    # (the same gap test_word_override_parity closes for the wrap path).
    pillow2, hf2 = _render_both(
        _result(),
        _config(**_RSVP, bg_opacity=0.0, tracking=3,
                stroke_width=4, stroke_color="#101820"),
        source_video, custom_groups=_rsvp_override_groups(), t=0.4,
    )
    mean2, notable2 = _diff(pillow2, hf2)
    print(f"[rsvp overrides, scaled anchor] mean={mean2:.2f} notable={notable2:.2f}%")
    assert mean2 < MEAN_MAX, f"rsvp scaled anchor: mean diff {mean2:.2f} >= {MEAN_MAX}"
    assert notable2 < NOTABLE_FRAC_MAX, (
        f"rsvp scaled anchor: {notable2:.2f}% pixels differ > {NOTABLE_FRAC_MAX}%"
    )


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
