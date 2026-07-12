"""Golden-frame tests for the backend subtitle frame renderer.

These pin the pixel output of ``_render_frame`` (backend/exporters/video_render.py)
so rendering-formula changes are caught automatically. They are the safety net for
the Phase 3 frame-dedup cache, which must prove pixel-identical output.

Regenerate goldens after an *intentional* formula change (then review them visually):

    .venv-dev/bin/python -m backend.tests.gen_golden

Comparison is tolerance-based (mean abs diff < 2/255 AND max channel diff < 40)
so tiny cross-version Pillow rasterization drift does not flake, while real
formula changes still fail loudly.
"""

from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageFont

from backend.exporters.video_render import _get_font, _render_frame
from backend.models.schemas import VideoRenderConfig

# ---------------------------------------------------------------------------
# Frozen inputs — every drawing-relevant field is explicit so schema default
# changes can never silently shift the goldens.
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = REPO_ROOT / "Fonts" / "CaviarDreams.ttf"
GOLDEN_DIR = Path(__file__).resolve().parent / "golden"

# Tolerances (0-255 scale). Mean catches global drift; max catches localized
# changes (e.g. one word moving) that a mean over the whole frame would hide.
MAX_MEAN_DIFF = 2.0
MAX_PIXEL_DIFF = 40


def build_config(**overrides) -> VideoRenderConfig:
    """Frozen VideoRenderConfig — small canvas, bundled font, everything explicit."""
    base = dict(
        font_family="Caviar Dreams",
        font_size=36,
        bold=False,
        tracking=0,
        word_spacing=0,
        stroke_width=0,
        stroke_color="#000000",
        text_color="#FFFFFF",
        active_word_color="#FFD700",
        bg_color="#D4952A",
        bg_opacity=0.0,
        bg_padding_h=24,
        bg_padding_v=10,
        bg_corner_radius=12,
        bg_width_extra=0,
        bg_height_extra=0,
        text_offset_x=0,
        text_offset_y=0,
        text_align_h="center",
        text_align_v="middle",
        words_per_group=3,
        lines=1,
        max_width=0.9,
        line_height=1.2,
        position_y=0.8,
        position_x=0.5,
        resolution_w=640,
        resolution_h=360,
        fps=30,
        output_format="webm",
        custom_font_path=str(FONT_PATH),
        render_mode="overlay",
        video_bitrate="8M",
        animation="none",
        animation_duration=0.12,
        word_transition="instant",
        highlight_radius=16,
        highlight_padding_x=6,
        highlight_padding_y=6,
        highlight_opacity=0.85,
        highlight_animation="jump",
        highlight_text_color="",
        underline_thickness=4,
        underline_color="",
        underline_offset_y=2,
        underline_width=0,
        bounce_strength=0.18,
        scale_factor=1.25,
        shadow_enabled=False,
        shadow_color="#000000",
        shadow_opacity=0.8,
        shadow_blur=6,
        shadow_offset_x=3,
        shadow_offset_y=3,
    )
    base.update(overrides)
    return VideoRenderConfig(**base)


def build_group(words: list[str], start: float = 1.0, word_dur: float = 0.5) -> dict:
    """Frozen group dict matching the shape produced by _build_groups()."""
    word_dicts = [
        {"word": w, "start": start + i * word_dur, "end": start + (i + 1) * word_dur}
        for i, w in enumerate(words)
    ]
    return {
        "text": " ".join(words),
        "start": word_dicts[0]["start"],
        "end": word_dicts[-1]["end"],
        "words": word_dicts,
    }


GROUP_WORDS = ["Golden", "frames", "guard", "parity"]
WRAP_WORDS = ["Subtitle", "golden", "frames", "keep", "the",
              "preview", "and", "render", "honest"]

# name -> (config_overrides, group_words, t)
SCENARIOS: dict[str, tuple[dict, list[str], float]] = {
    # Steady state, mid-display, no entry/exit animation in flight.
    "plain_steady": ({}, GROUP_WORDS, 2.25),
    # Highlight pill on the 2nd word (word 2 spans 1.5-2.0 → t=1.75).
    "highlight_word2": ({"word_transition": "highlight"}, GROUP_WORDS, 1.75),
    # Background box with rounded corners + opacity.
    "bg_box": ({"bg_opacity": 0.85, "bg_corner_radius": 18}, GROUP_WORDS, 2.25),
    # Drop shadow on (blur + offset path).
    "shadow": ({"shadow_enabled": True}, GROUP_WORDS, 2.25),
    # Pop animation mid-entry: group starts at 1.0, anim window 0.12 s,
    # t=1.05 → entry_t = ease_out(0.05/0.12) ≈ 0.66 < 1 → pop scale branch.
    "pop_mid_entry": ({"animation": "pop", "bg_opacity": 0.85}, GROUP_WORDS, 1.05),
    # Greedy word-wrap: long group + small max_width → 2+ rows.
    "word_wrap": ({"max_width": 0.5}, WRAP_WORDS, 2.0),
    # Per-group position override: anchor moved to the top of the frame.
    # The override lives on the GROUP dict (CustomGroup.position_x/y), not on
    # the config — see GROUP_OVERRIDES below.
    "group_pos_top": ({}, GROUP_WORDS, 2.25),
}

# Scenario name -> extra keys merged into the group dict (per-group overrides).
# Mirrors how backend/main.py hands CustomGroup.model_dump() dicts to the
# renderer: position_x/position_y are group-level, absent/None = use config.
GROUP_OVERRIDES: dict[str, dict] = {
    "group_pos_top": {"position_x": 0.5, "position_y": 0.15},
}


def render_scenario(name: str) -> Image.Image:
    """Render one scenario to an RGBA frame using the bundled font."""
    if not FONT_PATH.is_file():
        raise FileNotFoundError(f"Bundled test font missing: {FONT_PATH}")
    overrides, words, t = SCENARIOS[name]
    config = build_config(**overrides)
    group = build_group(words)
    group.update(GROUP_OVERRIDES.get(name, {}))
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    # Guard: never bake goldens with Pillow's bitmap fallback font.
    assert isinstance(font, ImageFont.FreeTypeFont), "custom font failed to load"
    return _render_frame(config, font, group, t)


# ---------------------------------------------------------------------------
# Comparison helper (pure PIL — no numpy in CI)
# ---------------------------------------------------------------------------


def diff_stats(a: Image.Image, b: Image.Image) -> tuple[float, int]:
    """Return (mean abs diff, max abs diff) across all RGBA channels."""
    assert a.size == b.size, f"size mismatch: {a.size} vs {b.size}"
    diff = ImageChops.difference(a.convert("RGBA"), b.convert("RGBA"))
    hist = diff.histogram()  # 4 channels x 256 bins
    total = 0
    count = 0
    max_diff = 0
    for ch in range(4):
        bins = hist[ch * 256:(ch + 1) * 256]
        for value, n in enumerate(bins):
            if n:
                total += value * n
                if value > max_diff:
                    max_diff = value
        count += sum(bins)
    return total / count, max_diff


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_golden_frame(name: str) -> None:
    golden_path = GOLDEN_DIR / f"{name}.png"
    assert golden_path.is_file(), (
        f"Missing golden {golden_path}. Regenerate with: "
        f"python -m backend.tests.gen_golden"
    )

    rendered = render_scenario(name)
    golden = Image.open(golden_path)

    mean_diff, max_diff = diff_stats(rendered, golden)
    assert mean_diff < MAX_MEAN_DIFF and max_diff < MAX_PIXEL_DIFF, (
        f"Frame {name!r} drifted from golden: mean diff {mean_diff:.3f} "
        f"(limit {MAX_MEAN_DIFF}), max diff {max_diff} (limit {MAX_PIXEL_DIFF}). "
        f"If the rendering change is intentional, regenerate goldens with "
        f"`python -m backend.tests.gen_golden` and review them visually."
    )


def test_word_wrap_scenario_actually_wraps() -> None:
    """Sanity: the wrap scenario must be wider than max_width so it breaks rows.

    Renders the same words at max_width=0.9 (no wrap) and asserts it differs
    from the wrapped golden scenario — proving the wrap path was exercised.
    """
    wrapped = render_scenario("word_wrap")
    overrides, words, t = SCENARIOS["word_wrap"]
    config = build_config(**{**overrides, "max_width": 0.9})
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    unwrapped = _render_frame(config, font, build_group(words), t)
    mean_diff, _ = diff_stats(wrapped, unwrapped)
    assert mean_diff > 0.1, "expected word_wrap scenario to produce multiple rows"


def test_group_position_override_moves_caption() -> None:
    """Sanity: the group-level position override must actually move the anchor.

    Renders the same group with and without the override — if _render_frame
    ignored the group's position_x/y, the frames would be identical and the
    golden would silently pin the fallback path instead of the override.
    """
    with_override = render_scenario("group_pos_top")
    overrides, words, t = SCENARIOS["group_pos_top"]
    config = build_config(**overrides)
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    without_override = _render_frame(config, font, build_group(words), t)
    mean_diff, _ = diff_stats(with_override, without_override)
    assert mean_diff > 0.1, "expected the position override to move the caption"
