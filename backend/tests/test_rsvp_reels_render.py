"""What reels change once a frame exists: continuity, culling, and the cache.

``backend/tests/test_rsvp_reels.py`` pins the reel *rule* against the shared
fixture. This file pins what the rule is **for** — that the reading line crosses a
caption-group boundary the way it crosses a word boundary — plus the two pieces of
machinery a reel forces into existence, both of which must be invisible:

* the **cull** (``rsvp_layout.visible_range``): a reel's line runs far past the
  frame, so most of it is not drawn. Asserted pixel-neutral by rendering the same
  frame with the cull effectively disabled and diffing the bytes.
* the **per-reel layout cache** (``_render_frame``'s ``precomp``): measuring every
  word of a reel on every frame is the one cost that grows with the reel. Asserted
  byte-neutral the same way.

The third piece — the frame-dedup key — is pinned where it belongs, by the RSVP
scenarios in ``test_render_dedup.py``, which drive the real ``_FrameSource``.
"""

from __future__ import annotations

import pytest
from PIL import Image

from backend.exporters import rsvp_layout
from backend.exporters.rsvp_reels import merge_reels
from backend.exporters.video_render import _get_font, _render_frame, groups_for_render
from backend.models.schemas import Segment, TranscriptionResult, WordSegment
from backend.tests.test_render_golden import build_group, diff_stats
from backend.tests.test_rsvp_layout import capture_lines, render, rsvp_config

WORD_DUR = 0.4


def touching_groups(*chunks: list[str], start: float = 1.0) -> list[dict]:
    """Consecutive groups that leave no blank frame between them — one reel."""
    groups: list[dict] = []
    t = start
    for chunk in chunks:
        group = build_group(chunk, start=t, word_dur=WORD_DUR)
        groups.append(group)
        t = group["end"]
    return groups


# --- Continuity across a group boundary --------------------------------------


def test_a_reel_is_one_group_carrying_every_word():
    groups = touching_groups(["alpha", "beta"], ["gamma", "delta"], ["epsilon"])

    reels = merge_reels(groups)

    assert len(reels) == 1
    assert [w["word"] for w in reels[0]["words"]] == [
        "alpha", "beta", "gamma", "delta", "epsilon",
    ]
    assert reels[0]["start"] == groups[0]["start"]
    assert reels[0]["end"] == groups[-1]["end"]


def test_the_line_does_not_snap_back_at_a_group_boundary(monkeypatch: pytest.MonkeyPatch):
    """The bug this whole change exists to remove.

    Per group, the first word of the second group is index 0 of a fresh line, and
    ``line_offset_at`` **snaps** index 0 to its target with no ease — so the line
    jumped by the width of the first group and reset its context. In a reel that
    word is just the next index, so the boundary is one more eased slide.
    """
    config = rsvp_config()
    groups = touching_groups(["alpha", "beta"], ["gamma", "delta"])
    boundary = groups[1]["start"]
    # Just past the boundary, but still inside the slide window: per group this
    # frame was already parked on the new line's target; in a reel it is mid-ease.
    t = boundary + config.rsvp_slide_duration / 2

    _, per_group = capture_lines(monkeypatch, config, groups[1], t)
    _, per_reel = capture_lines(monkeypatch, config, merge_reels(groups)[0], t)

    (group_line, group_kwargs), (reel_line, reel_kwargs) = per_group[0], per_reel[0]

    def pivot_of(kwargs: dict) -> float:
        return rsvp_layout.caption_band(config, kwargs["center_x"]).pivot(config.rsvp_pivot_x)

    # Per group: anchored on index 0 of a fresh two-word line, i.e. snapped
    # straight onto its target with none of the slide run.
    assert group_line.anchor_index == 0
    assert group_line.line_x == pytest.approx(
        pivot_of(group_kwargs) - group_line.focus_offsets[0]
    )

    # As a reel: anchored on the third word of four, strictly between the
    # previous word's target and its own — i.e. still easing.
    assert reel_line.anchor_index == 2
    pivot = pivot_of(reel_kwargs)
    previous_target = pivot - reel_line.focus_offsets[1]
    target = pivot - reel_line.focus_offsets[2]
    assert min(previous_target, target) < reel_line.line_x < max(previous_target, target), (
        "the line should be part-way between the two words' targets, not parked"
    )


def test_the_words_of_the_previous_group_are_still_on_the_line(monkeypatch: pytest.MonkeyPatch):
    """Continuity is also *visible*: the words already read stay to the left of
    the pivot instead of vanishing when their group ends."""
    config = rsvp_config()
    groups = touching_groups(["alpha", "beta"], ["gamma", "delta"])
    reel = merge_reels(groups)[0]
    t = groups[1]["start"] + WORD_DUR / 2

    _, calls = capture_lines(monkeypatch, config, reel, t)
    line, kwargs = calls[0]

    assert [wm["word"] for wm in kwargs["word_metrics"]] == [
        "alpha", "beta", "gamma", "delta",
    ]
    positions = line.positions()
    band = rsvp_layout.caption_band(config, kwargs["center_x"])
    pivot = band.pivot(config.rsvp_pivot_x)
    # The first group's words are laid out to the LEFT of the anchored word...
    assert positions[0] < positions[1] < positions[2]
    # ...and the anchor still sits on the pivot column.
    assert positions[2] <= pivot <= positions[2] + kwargs["word_metrics"][2]["width"]


def test_a_real_gap_still_blanks_the_caption():
    """Reels add continuity *without* changing when captions appear or disappear:
    a group with a real gap after it is still its own reel, so the frames in the
    gap have no active group at all."""
    groups = [
        build_group(["alpha", "beta"], start=1.0, word_dur=WORD_DUR),
        build_group(["gamma"], start=3.0, word_dur=WORD_DUR),
    ]

    reels = merge_reels(groups)

    assert len(reels) == 2
    assert reels[0]["end"] < reels[1]["start"]


# --- groups_for_render is the one place this happens -------------------------


def _result(words: list[str]) -> TranscriptionResult:
    word_segments = [
        WordSegment(word=w, start=1.0 + i * WORD_DUR, end=1.0 + (i + 1) * WORD_DUR)
        for i, w in enumerate(words)
    ]
    return TranscriptionResult(
        text=" ".join(words),
        language="en",
        segments=[Segment(
            id=0, start=word_segments[0].start, end=word_segments[-1].end,
            text=" ".join(words), words=word_segments,
        )],
    )


def test_groups_for_render_merges_reels_only_in_rsvp_mode():
    result = _result(["one", "two", "three", "four", "five", "six"])

    wrapped = groups_for_render(result, rsvp_config(reading_mode="wrap"), None)
    reeled = groups_for_render(result, rsvp_config(), None)

    # Same words either way; the chunking into 2 groups of 3 is unchanged, and
    # only RSVP joins the (touching) chunks into one line.
    assert len(wrapped) == 2
    assert len(reeled) == 1
    assert [w["word"] for w in reeled[0]["words"]] == [
        w["word"] for g in wrapped for w in g["words"]
    ]


def test_custom_groups_are_reeled_too():
    """The frontend-authored path must reel exactly like the built path, or the
    Canvas preview (which reels its own copy) and the render disagree."""
    custom = touching_groups(["alpha", "beta"], ["gamma"])

    reeled = groups_for_render(_result(["ignored"]), rsvp_config(), custom)

    assert len(reeled) == 1
    assert [w["word"] for w in reeled[0]["words"]] == ["alpha", "beta", "gamma"]


# --- The HTML/GSAP layer gets its reels from here too ------------------------


def test_the_html_caption_track_gets_one_clip_per_reel():
    """The HTML layer has no reel code of its own — deliberately, so there is no
    third implementation to drift (``rsvp_reels.py`` module docstring). It is
    handed the merged groups by ``groups_for_render``, and one ``.cgroup`` per reel
    is what makes its line slide across a group boundary like Pillow's."""
    import json

    from backend.exporters.hyperframes_caption_html import caption_block, caption_groups_json

    config = rsvp_config()
    custom = touching_groups(["alpha", "beta"], ["gamma", "delta"])
    groups = groups_for_render(_result(["ignored"]), config, custom)

    block = caption_block(config, groups)

    assert block["markup"].count('class="cgroup"') == 1
    for word in ("alpha", "beta", "gamma", "delta"):
        assert f">{word}<" in block["markup"]

    # ...and the payload's single entry spans both groups, with every word's
    # timing carried through untouched.
    payload = json.loads(caption_groups_json(groups))
    assert len(payload) == 1
    assert payload[0]["s"] == custom[0]["start"]
    assert payload[0]["e"] == custom[-1]["end"]
    assert [w["s"] for w in payload[0]["w"]] == [
        w["start"] for g in custom for w in g["words"]
    ]


def test_wrap_mode_still_gets_one_clip_per_group():
    from backend.exporters.hyperframes_caption_html import caption_block

    config = rsvp_config(reading_mode="wrap")
    custom = touching_groups(["alpha", "beta"], ["gamma", "delta"])
    groups = groups_for_render(_result(["ignored"]), config, custom)

    block = caption_block(config, groups)

    assert block["markup"].count('class="cgroup"') == 2


# --- The cull and the layout cache are both invisible ------------------------


def long_reel(word_count: int = 60, start: float = 1.0) -> dict:
    """One reel long enough that most of its line is nowhere near the frame."""
    groups = touching_groups(
        *[[f"word{i}{j}" for j in range(3)] for i in range(word_count // 3)],
        start=start,
    )
    return merge_reels(groups)[0]


def render_uncached(config, group, t) -> Image.Image:
    """``render`` bypasses the per-group precompute; spelled out for contrast
    with the cached path below."""
    return render(config, group, t)


def render_cached(config, group, t, precomp: dict) -> Image.Image:
    font = _get_font(config.font_family, config.font_size,
                     config.custom_font_path, bold=config.bold)
    return _render_frame(config, font, group, t, precomp)


@pytest.mark.parametrize("fade", [0.0, 0.12])
def test_the_cull_is_pixel_neutral(monkeypatch: pytest.MonkeyPatch, fade: float):
    """Rendering with the cull disabled must produce the same bytes.

    Both windows matter: with the edge fade ON the mask zeroes everything outside
    the band, and with it OFF the line is *allowed* to overflow the band to the
    frame edges — a cull that used the band in both cases would clip real ink.
    """
    config = rsvp_config(rsvp_edge_fade=fade, shadow_enabled=True, stroke_width=3)
    reel = long_reel()
    t = reel["start"] + 6.0

    culled = render(config, reel, t)

    real_range = rsvp_layout.visible_range
    monkeypatch.setattr(
        rsvp_layout, "visible_range",
        lambda word_x, widths, **kw: (0, min(len(word_x), len(widths))),
    )
    unculled = render(config, reel, t)
    assert real_range is not rsvp_layout.visible_range  # the patch really applied

    assert culled.tobytes() == unculled.tobytes()


def test_the_cull_actually_culls(monkeypatch: pytest.MonkeyPatch):
    """Otherwise the neutrality test above is vacuous — two identical renders.

    Spies on the real render rather than calling ``visible_range`` with made-up
    numbers, so what is asserted is that the *production* path skips words.
    """
    config = rsvp_config()
    reel = long_reel()
    seen: list[tuple[tuple[int, int], int]] = []
    real = rsvp_layout.visible_range

    def spy(word_x, widths, **kwargs):
        result = real(word_x, widths, **kwargs)
        seen.append((result, len(word_x)))
        return result

    monkeypatch.setattr(rsvp_layout, "visible_range", spy)
    render(config, reel, reel["start"] + 6.0)

    assert seen, "the render never consulted the cull"
    (first, last), total = seen[0]
    assert total == len(reel["words"])
    assert last - first < total, (
        f"nothing was culled: {last - first} of {total} words drawn"
    )


def test_the_layout_cache_is_byte_neutral():
    """The cached path is an optimisation, not a second renderer."""
    config = rsvp_config()
    reel = long_reel()
    precomp: dict = {}

    for offset in (0.5, 2.0, 6.0, 9.5):
        t = reel["start"] + offset
        cached = render_cached(config, reel, t, precomp)
        assert cached.tobytes() == render_uncached(config, reel, t).tobytes(), (
            f"the precomputed path diverged at t={t}"
        )

    # And it really was populated, or the assertions above compared two cold runs.
    assert "metrics" in precomp
    assert any(key != "metrics" for key in precomp), "the RSVP line layout was not cached"
