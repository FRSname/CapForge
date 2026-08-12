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
# GROUP_WORDS + a 5th word that carries an explicit value for every geometry
# key (see WORD_OVERRIDES["word_bg_box"][4]). Its own list so the other goldens,
# which share GROUP_WORDS, stay byte-identical.
WORD_BG_WORDS = GROUP_WORDS + ["boxed"]

# --- RSVP (reading_mode="rsvp") -------------------------------------------
# All seven RSVP fields explicit, for the same reason every other drawing field
# is: a schema default change must never silently shift a golden. Shared by both
# RSVP scenarios so the ONLY difference between the two goldens is ``t``.
# rsvp_edge_fade and rsvp_reticle are deliberately non-default-off so the fade
# ramp and the reticle are both pinned by pixels (backend/tests/test_rsvp_layout.py
# proves each one moves pixels on its own).
RSVP_CONFIG: dict = {
    # An opaque background box, unlike most scenarios: the box is what makes the
    # caption BAND visible, and in RSVP mode the box is deliberately derived from
    # the band (``max_row_w = box_band.width``, centred on the band rather than on
    # ``center_x``) instead of from the unwrapped row, which nothing else pins.
    # Note this is NOT a ``min()`` clamp: a group NARROWER than the band still gets
    # a band-sized box, because the text inside it is placed by the pivot column.
    # It also makes the edge fade — an alpha ramp, invisible on a transparent frame
    # — reviewable by eye.
    "bg_opacity": 0.85,
    "bg_color": "#2E5FCC",
    "reading_mode": "rsvp",
    "rsvp_pivot_x": 0.35,
    "rsvp_focus_color": "#E4851F",
    "rsvp_context_opacity": 0.75,
    "rsvp_slide_duration": 0.06,
    "rsvp_edge_fade": 0.12,
    "rsvp_reticle": True,
}

# One word per row of the Spritz ORP table — lengths 1, 3, 5, 10, 15 → focus
# indices 0, 1, 1, 3, 4 — so a reviewer can see the focus glyph walk the whole
# table across the two frames. Deliberately far wider than the caption band: the
# RSVP row is unwrapped by design, so its ends must dissolve into the edge fade
# rather than be clipped or wrapped.
RSVP_WORDS = ["a", "the", "rapid", "eliminates", "extraordinarily"]

# name -> (config_overrides, group_words, t)
SCENARIOS: dict[str, tuple[dict, list[str], float]] = {
    # Steady state, mid-display, no entry/exit animation in flight.
    "plain_steady": ({}, GROUP_WORDS, 2.25),
    # Highlight pill on the 2nd word (word 2 spans 1.5-2.0 → t=1.75).
    "highlight_word2": ({"word_transition": "highlight"}, GROUP_WORDS, 1.75),
    # Highlight pill with a global offset — same t as highlight_word2 so the
    # two goldens are directly comparable: pill shifted right+up, text stays put.
    "highlight_offset": (
        {"word_transition": "highlight", "highlight_offset_x": 20, "highlight_offset_y": -12},
        GROUP_WORDS,
        1.75,
    ),
    # Highlight pill on a SCALED active word — same t/words as highlight_word2
    # so the two goldens are directly comparable: the pill must grow to hug
    # word 2 ("frames") rendered at font_size_scale=1.6, not the group's
    # global text height (Defect A, docs/plans/word-scale-highlight-pill-parity.md).
    "highlight_word_scale": (
        {"word_transition": "highlight"},
        GROUP_WORDS,
        1.75,
    ),
    # Static "none" mode: all words in base text_color, no active-word treatment.
    # Same t as highlight_word2 so the two goldens are directly comparable.
    "none_static": ({"word_transition": "none"}, GROUP_WORDS, 1.75),
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
    # Per-word background boxes over a 2-line group, on top of a NON-DEFAULT
    # global background (colour/radius/padding/extras all off their defaults)
    # so the inherit-from-global rule is what the pixels pin. The global
    # bg_opacity is deliberately > 0: if the enable gate ever regressed to
    # `word_bg_opacity ?? bg_opacity`, EVERY word would sprout a box and this
    # golden would fail. See WORD_OVERRIDES + docs/plans/per-word-background.md.
    "word_bg_box": (
        {
            "lines": 2,
            "bg_opacity": 0.5,
            "bg_color": "#2E5FCC",
            "bg_corner_radius": 8,
            "bg_padding_h": 10,
            "bg_padding_v": 6,
            "bg_width_extra": 8,
            "bg_height_extra": 4,
            "position_y": 0.5,
        },
        WORD_BG_WORDS,
        2.25,
    ),
    # RSVP mid-hold. Words start at 1.0 s, 0.5 s apart, so word 4
    # ("eliminates", 10 chars → focus index 3, the letter "m") is active at
    # t=2.7 and its 60 ms slide finished at 2.56 — the line is parked, and the
    # focus glyph's centre sits on the pivot column: band = 640*0.9 = 576 px
    # spanning x 32→608, pivot = 32 + 0.35*576 = 233.6.
    "rsvp_mid_word": (RSVP_CONFIG, RSVP_WORDS, 2.7),
    # RSVP mid-slide: word 3 ("rapid") starts at 2.0, so t=2.03 is exactly
    # halfway through the 60 ms slide → power1.out (1-(1-p)^2) puts the line 75 %
    # of the way from word 2's target to word 3's. A hold-only golden would pass
    # with the wrong ease; this one does not.
    "rsvp_mid_slide": (RSVP_CONFIG, RSVP_WORDS, 2.03),
}

# Scenario name -> extra keys merged into the group dict (per-group overrides).
# Mirrors how backend/main.py hands CustomGroup.model_dump() dicts to the
# renderer: position_x/position_y are group-level, absent/None = use config.
GROUP_OVERRIDES: dict[str, dict] = {
    "group_pos_top": {"position_x": 0.5, "position_y": 0.15},
}

# Scenario name -> {word index: per-word "overrides" dict}. Mirrors the shape
# _draw_word_list reads off each word dict (video_render.py: `wm.get("overrides")`).
WORD_OVERRIDES: dict[str, dict[int, dict]] = {
    "highlight_word_scale": {1: {"font_size_scale": 1.6}},
    # Row 1 = ["Golden", "frames", "guard"], row 2 = ["parity", "boxed"] (lines=2).
    # Word 1 ("Golden") sets NOTHING — it must stay boxless even though the
    # global background is on (the enable gate is presence-based).
    "word_bg_box": {
        # Word 2: enabled + a non-default radius and colour of its own.
        1: {"word_bg_opacity": 0.9, "word_bg_color": "#E23E57", "word_bg_radius": 24},
        # Word 3: a box on a SCALED word — it must hug the scaled glyphs, not
        # the group's global text height.
        2: {"font_size_scale": 1.4, "word_bg_opacity": 0.8, "word_bg_color": "#1FA97A"},
        # Word 4: ONLY opacity — colour, radius, padding H/V and both extras all
        # inherit the (non-default) global bg_* values above.
        3: {"word_bg_opacity": 0.85},
        # Word 5: every geometry key set EXPLICITLY as a per-word override, with
        # mutually distinct values so a transposed read (padding_h ← padding_v,
        # offset_x ← offset_y, width_extra ← height_extra, or any cross-key mixup)
        # visibly moves the box. Words 2-4 exercise these keys only through
        # inheritance, which cannot catch a transposition. Each value is proven
        # to matter by test_word_background_geometry_key_is_pinned_by_golden.
        4: {
            "word_bg_opacity": 0.95,
            "word_bg_color": "#8A2BE2",
            "word_bg_radius": 3,
            "word_bg_padding_h": 22,
            "word_bg_padding_v": 4,
            "word_bg_width_extra": 18,
            "word_bg_height_extra": -6,
            "word_bg_offset_x": 15,
            "word_bg_offset_y": -10,
        },
    },
}

# The six geometry keys word 5 of the word_bg_box scenario sets explicitly.
WORD_BG_GEOMETRY_KEYS = (
    "word_bg_padding_h", "word_bg_padding_v",
    "word_bg_width_extra", "word_bg_height_extra",
    "word_bg_offset_x", "word_bg_offset_y",
)


def render_variant(
    name: str,
    word_overrides: dict[int, dict],
    config_overrides: dict | None = None,
    words: list[str] | None = None,
) -> Image.Image:
    """Render a scenario with a REPLACED per-word override map, optionally
    patching the config or the word list too.

    This is how the sanity tests render an otherwise byte-identical frame with
    exactly one feature removed, so a pixel diff isolates that feature.
    """
    if not FONT_PATH.is_file():
        raise FileNotFoundError(f"Bundled test font missing: {FONT_PATH}")
    overrides, scenario_words, t = SCENARIOS[name]
    config = build_config(**{**overrides, **(config_overrides or {})})
    group = build_group(words if words is not None else scenario_words)
    group.update(GROUP_OVERRIDES.get(name, {}))
    for word_idx, word_ov in word_overrides.items():
        group["words"][word_idx]["overrides"] = word_ov
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    # Guard: never bake goldens with Pillow's bitmap fallback font.
    assert isinstance(font, ImageFont.FreeTypeFont), "custom font failed to load"
    return _render_frame(config, font, group, t)


def render_scenario(name: str) -> Image.Image:
    """Render one scenario to an RGBA frame using the bundled font."""
    return render_variant(name, WORD_OVERRIDES.get(name, {}))


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


def test_word_background_boxes_draw() -> None:
    """Sanity: the per-word background boxes must actually change the frame.

    Without this, a golden baked from a no-op implementation would pass forever.
    Renders the word_bg_box scenario with and without the per-word overrides —
    the only difference between the two is the ``word_bg_*`` keys, so any
    difference proves _draw_word_list honoured them.
    """
    with_boxes = render_scenario("word_bg_box")
    overrides, words, t = SCENARIOS["word_bg_box"]
    config = build_config(**overrides)
    group = build_group(words)
    # Keep the font_size_scale override so ONLY the word_bg_* keys differ.
    group["words"][2]["overrides"] = {"font_size_scale": 1.4}
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    without_boxes = _render_frame(config, font, group, t)
    mean_diff, _ = diff_stats(with_boxes, without_boxes)
    assert mean_diff > 0.1, "expected the per-word background boxes to be drawn"


@pytest.mark.parametrize("key", WORD_BG_GEOMETRY_KEYS)
def test_word_background_geometry_key_is_pinned_by_golden(key: str) -> None:
    """Each geometry key must move pixels ON ITS OWN as a per-word override.

    Word 5 of the golden scenario sets padding_h/v, width/height_extra and
    offset_x/y explicitly, with mutually distinct values. This drops ONE key at
    a time (the word then falls back to the global bg_* geometry for it) and
    demands the resulting frame trip ``test_golden_frame``'s own tolerances —
    proving the golden pins that key rather than only its inherited value.
    Per-key (not just all-six-at-once) so a transposed read — offset_x ←
    offset_y, padding_h ← padding_v, width_extra ← height_extra — cannot hide
    behind the other five still being correct.
    """
    word_5 = WORD_OVERRIDES["word_bg_box"][4]
    without_key = {
        **WORD_OVERRIDES["word_bg_box"],
        4: {k: v for k, v in word_5.items() if k != key},
    }
    mean_diff, max_diff = diff_stats(
        render_scenario("word_bg_box"), render_variant("word_bg_box", without_key),
    )
    trips_golden = not (mean_diff < MAX_MEAN_DIFF and max_diff < MAX_PIXEL_DIFF)
    assert trips_golden, (
        f"dropping the per-word {key} left the frame within the golden's "
        f"tolerances (mean {mean_diff:.3f} < {MAX_MEAN_DIFF}, max {max_diff} < "
        f"{MAX_PIXEL_DIFF}) — the golden would pass with or without it, so it "
        f"pins nothing and a transposed read of it stays invisible."
    )


# (case id, word list, config overrides, overrides for word index 1) — one case
# per clause of the degenerate-rect guard so none of the three is dead in tests.
DEGENERATE_CASES = [
    # box_h <= 0 via the inherited global bg_height_extra floor (-50).
    ("height", WORD_BG_WORDS, {"bg_height_extra": -50}, {"word_bg_opacity": 0.9}),
    # box_w <= 0 via a PER-WORD width_extra floor on a narrow word.
    ("width", ["a", "b", "c"], {}, {"word_bg_opacity": 0.9, "word_bg_width_extra": -50}),
    # Zero-extent word: box_w and box_h both stay > 0, so only the width guard
    # can skip it — without it the word would paint a free-floating blob.
    ("empty_word", ["Golden", "", "guard"], {}, {"word_bg_opacity": 0.9}),
]


@pytest.mark.parametrize(
    "words,config_overrides,word_ov",
    [case[1:] for case in DEGENERATE_CASES],
    ids=[case[0] for case in DEGENERATE_CASES],
)
def test_word_background_skips_degenerate_rect(
    words: list[str], config_overrides: dict, word_ov: dict,
) -> None:
    """A degenerate box must be SKIPPED — not merely survive without crashing.

    PIL's ``rounded_rectangle`` raises ValueError on an inverted rect, so the
    <= 0 guard is load-bearing: bg_width_extra/bg_height_extra are user-settable
    down to -50 and are inherited by every enabled word box. Asserting only "does
    not raise" would also pass for an over-eager guard that skipped EVERY box, so
    the frame is compared against the same render with ``word_bg_opacity``
    removed and must be pixel-identical: the box is skipped, nothing else is.
    """
    skipped = render_variant("word_bg_box", {1: word_ov}, config_overrides, words)
    disabled_ov = {k: v for k, v in word_ov.items() if k != "word_bg_opacity"}
    disabled = render_variant("word_bg_box", {1: disabled_ov}, config_overrides, words)
    _, max_diff = diff_stats(skipped, disabled)
    assert max_diff == 0, (
        f"a degenerate word box changed the frame by up to {max_diff}/255 — it "
        f"must be skipped outright, leaving the frame identical to the same "
        f"render with word_bg_opacity unset."
    )


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
