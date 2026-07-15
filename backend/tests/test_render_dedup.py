"""Equivalence tests for the Phase 3 frame-dedup cache.

The cached pipeline (_FrameSource, used by _render_overlay and _render_baked)
must produce EXACTLY the same bytes as calling _render_frame directly for
every frame — across gaps, entry/exit animation windows, steady display with
word-highlight changes, and group transitions.

The test drives the same render_batch()/overlay_image() code paths the
encoders use, so any divergence between _frame_state_key and the actual
time-dependencies of _render_frame fails here.
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import pytest
from PIL import ImageFont

from backend.exporters.video_render import (
    _FRAME_CACHE_MAX_ENTRIES,
    _FrameSource,
    _frame_state_key,
    _get_font,
    _render_frame,
)
from backend.tests.test_render_golden import build_config, build_group

# ---------------------------------------------------------------------------
# Timeline: ~8 s @ 30 fps, 320x180. Covers leading gap, steady display with
# several word-highlight changes, a mid-timeline gap, a back-to-back group
# transition (no gap), and a trailing gap.
# ---------------------------------------------------------------------------

FPS = 30
DURATION = 8.0
TOTAL_FRAMES = int(DURATION * FPS)  # 240


def build_groups() -> list[dict]:
    return [
        build_group(["Hello", "brave", "new"], start=0.5, word_dur=0.5),     # 0.5–2.0
        # gap 2.0–2.4
        build_group(["world", "this", "is", "fine"], start=2.4, word_dur=0.4),  # 2.4–4.0
        build_group(["groups", "abut", "directly"], start=4.0, word_dur=0.5),   # 4.0–5.5 (no gap)
        # gap 5.5–6.0
        build_group(["short", "tail"], start=6.0, word_dur=0.6),             # 6.0–7.2
        # trailing gap 7.2–8.0
    ]


def make_config(**overrides):
    return build_config(resolution_w=320, resolution_h=180, fps=FPS, **overrides)


def load_font(config) -> ImageFont.FreeTypeFont:
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    assert isinstance(font, ImageFont.FreeTypeFont), "bundled test font failed to load"
    return font


def direct_frame_bytes(config, font, groups, blank_bytes: bytes, fn: int) -> bytes:
    """Reference path: the pre-cache per-frame render, independent of _FrameSource."""
    t = fn / config.fps
    group: Optional[dict] = None
    for g in groups:  # independent (O(n)) reimplementation of the group scan
        if g["start"] <= t <= g["end"]:
            group = g
            break
    if group is None:
        return blank_bytes
    return _render_frame(config, font, group, t).tobytes()


# Every animation × word-transition combination the renderer supports,
# including the continuously-animating ones that must fall back to direct
# rendering (key=None) while staying byte-identical.
SCENARIOS = {
    "none_instant":        dict(animation="none", word_transition="instant"),
    "fade_instant":        dict(animation="fade", word_transition="instant"),
    "slide_crossfade":     dict(animation="slide", word_transition="crossfade"),
    "pop_instant":         dict(animation="pop", word_transition="instant",
                                bg_opacity=0.85),
    "none_highlight_jump":  dict(animation="none", word_transition="highlight",
                                 highlight_animation="jump"),
    "none_highlight_slide": dict(animation="none", word_transition="highlight",
                                 highlight_animation="slide"),
    "none_bounce":         dict(animation="none", word_transition="bounce"),
    "none_karaoke":        dict(animation="none", word_transition="karaoke"),
    "none_underline":      dict(animation="none", word_transition="underline"),
    "none_scale":          dict(animation="none", word_transition="scale"),
    "none_reveal":         dict(animation="none", word_transition="reveal"),
    "fade_shadow_bg":      dict(animation="fade", word_transition="instant",
                                shadow_enabled=True, bg_opacity=0.85),
}


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_overlay_pipeline_bytes_equal_direct_render(name: str) -> None:
    """render_batch() output must be byte-identical to the uncached render."""
    config = make_config(**SCENARIOS[name])
    font = load_font(config)
    groups = build_groups()
    source = _FrameSource(config, font, groups, TOTAL_FRAMES)

    batch = 8  # small batch so cache hits span batch boundaries
    with ThreadPoolExecutor(max_workers=2) as pool:
        for start in range(0, TOTAL_FRAMES, batch):
            frame_range = range(start, min(start + batch, TOTAL_FRAMES))
            results = source.render_batch(pool, frame_range)
            for fn in frame_range:
                expected = direct_frame_bytes(config, font, groups,
                                              source.blank_bytes, fn)
                assert results[fn] == expected, (
                    f"scenario {name!r}: frame {fn} (t={fn / FPS:.3f}s) from the "
                    f"cached pipeline differs from a direct _render_frame call "
                    f"(key={source.frame_key(fn)!r})"
                )

    # The cache must never grow beyond its bound.
    assert len(source._cache) <= _FRAME_CACHE_MAX_ENTRIES

    # Sanity: every frame was accounted for by exactly one path.
    assert (source.hits + source.misses + source.uncached_renders
            + source.blank_frames) == TOTAL_FRAMES


def test_baked_overlay_images_equal_direct_render() -> None:
    """overlay_image() (baked path) must match direct rendering pixel-exactly."""
    config = make_config(animation="fade", word_transition="highlight")
    font = load_font(config)
    groups = build_groups()
    source = _FrameSource(config, font, groups, TOTAL_FRAMES)

    for fn in range(TOTAL_FRAMES):
        img = source.overlay_image(fn)
        expected = direct_frame_bytes(config, font, groups, source.blank_bytes, fn)
        if img is None:
            assert expected == source.blank_bytes, (
                f"frame {fn}: pipeline says blank but direct render has content"
            )
        else:
            assert img.tobytes() == expected, (
                f"frame {fn} (t={fn / FPS:.3f}s): baked overlay differs from "
                f"direct render"
            )
    assert source.hits > 0, "baked path never hit the cache"


def test_cache_hit_rate_is_meaningful() -> None:
    """Guard against the key function degenerating to all-None.

    With instant word transitions + fade entry/exit, each word's steady window
    collapses to one cached render, so well over half of all frames must be
    served from the cache.
    """
    config = make_config(animation="fade", word_transition="instant")
    font = load_font(config)
    groups = build_groups()
    source = _FrameSource(config, font, groups, TOTAL_FRAMES)

    with ThreadPoolExecutor(max_workers=2) as pool:
        for start in range(0, TOTAL_FRAMES, 16):
            source.render_batch(pool, range(start, min(start + 16, TOTAL_FRAMES)))

    hit_rate = source.hits / TOTAL_FRAMES
    assert hit_rate > 0.5, (
        f"cache hit rate {hit_rate:.1%} ({source.hits}/{TOTAL_FRAMES}) — "
        f"misses={source.misses} uncached={source.uncached_renders} "
        f"blank={source.blank_frames}; the state key has degenerated"
    )


# ---------------------------------------------------------------------------
# Unit tests for the key function itself
# ---------------------------------------------------------------------------


def test_key_is_none_inside_entry_and_exit_animation_windows() -> None:
    config = make_config(animation="fade")  # animation_duration = 0.12
    group = build_group(["one", "two"], start=1.0, word_dur=0.5)  # 1.0–2.0
    assert _frame_state_key(0, group, 1.05, config) is None      # entry window
    assert _frame_state_key(0, group, 1.95, config) is None      # exit window
    assert _frame_state_key(0, group, 1.30, config) is not None  # steady


def test_key_ignores_animation_window_when_animation_none() -> None:
    config = make_config(animation="none")
    group = build_group(["one", "two"], start=1.0, word_dur=0.5)
    assert _frame_state_key(0, group, 1.01, config) is not None


def test_key_is_none_while_bounce_or_karaoke_word_is_active() -> None:
    group = build_group(["one", "two"], start=1.0, word_dur=0.5)
    for transition in ("bounce", "karaoke"):
        config = make_config(animation="none", word_transition=transition)
        assert _frame_state_key(0, group, 1.25, config) is None   # word active
        # after the group ends, nothing animates
        assert _frame_state_key(0, group, 2.0, config) is not None


def test_key_is_none_only_inside_crossfade_ramps() -> None:
    config = make_config(animation="none", word_transition="crossfade")
    group = build_group(["one", "two"], start=1.0, word_dur=0.5)  # word1: 1.0–1.5
    assert _frame_state_key(0, group, 1.0, config) is None        # fade_in==0 ≠ plateau
    assert _frame_state_key(0, group, 1.03, config) is None       # fade-in ramp
    assert _frame_state_key(0, group, 1.48, config) is None       # fade-out ramp
    assert _frame_state_key(0, group, 1.25, config) is not None   # plateau


def test_key_is_none_during_highlight_slide_then_steady() -> None:
    config = make_config(animation="none", word_transition="highlight",
                         highlight_animation="slide")
    group = build_group(["one", "two"], start=1.0, word_dur=0.5)  # word2: 1.5–2.0
    # slide eases over the first 40% of the word (1.5–1.7)
    assert _frame_state_key(0, group, 1.55, config) is None
    assert _frame_state_key(0, group, 1.80, config) is not None
    # first word active: no previous word to slide from → steady
    assert _frame_state_key(0, group, 1.25, config) is not None


def test_key_distinguishes_active_word_and_group() -> None:
    config = make_config(animation="none", word_transition="instant")
    group = build_group(["one", "two", "three"], start=1.0, word_dur=0.5)
    k1 = _frame_state_key(0, group, 1.25, config)   # word 1 active
    k1b = _frame_state_key(0, group, 1.40, config)  # still word 1
    k2 = _frame_state_key(0, group, 1.75, config)   # word 2 active
    k_other_group = _frame_state_key(1, group, 1.25, config)
    assert k1 == k1b
    assert k1 != k2
    assert k1 != k_other_group


def test_key_is_stable_across_words_when_transition_is_none() -> None:
    """word_transition="none" ignores active/past/future entirely (all words draw
    in the base text colour), so the key must stay identical across the whole
    group regardless of which word is active — this is what lets the group
    collapse to one cached frame instead of re-keying at every word boundary.
    """
    config = make_config(animation="none", word_transition="none")
    group = build_group(["one", "two", "three"], start=1.0, word_dur=0.5)
    k_word1 = _frame_state_key(0, group, 1.25, config)   # word 1 active
    k_word2 = _frame_state_key(0, group, 1.75, config)   # word 2 active
    assert k_word1 is not None
    assert k_word1 == k_word2


def test_key_still_varies_by_active_word_when_transition_is_instant() -> None:
    """Guard against the fix above over-broadening: "instant" (and other
    active-word-aware transitions) must still re-key when the active word
    changes.
    """
    config = make_config(animation="none", word_transition="instant")
    group = build_group(["one", "two", "three"], start=1.0, word_dur=0.5)
    k_word1 = _frame_state_key(0, group, 1.25, config)   # word 1 active
    k_word2 = _frame_state_key(0, group, 1.75, config)   # word 2 active
    assert k_word1 != k_word2


def test_per_word_transition_override_is_respected() -> None:
    """A word overriding its transition to bounce must be uncacheable while active."""
    config = make_config(animation="none", word_transition="instant")
    group = build_group(["one", "two"], start=1.0, word_dur=0.5)
    group["words"][1]["overrides"] = {"word_transition": "bounce"}
    assert _frame_state_key(0, group, 1.25, config) is not None  # word1: instant
    assert _frame_state_key(0, group, 1.75, config) is None      # word2: bounce


def test_lru_cache_stays_bounded() -> None:
    config = make_config(animation="none", word_transition="instant")
    font = load_font(config)
    # 40 one-word groups → 40 distinct keys, more than the cache bound
    groups = [build_group([f"w{i}"], start=i * 0.5, word_dur=0.5) for i in range(40)]
    total = int(20.0 * FPS)
    source = _FrameSource(config, font, groups, total)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for start in range(0, total, 16):
            source.render_batch(pool, range(start, min(start + 16, total)))
    assert len(source._cache) <= _FRAME_CACHE_MAX_ENTRIES
