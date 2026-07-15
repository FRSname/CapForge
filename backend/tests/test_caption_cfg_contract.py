"""Always-on contract: every ``VideoRenderConfig`` field is *accounted for* with
respect to the HyperFrames HTML caption layer.

This is the automated guard against the bug class that shipped by eye twice
(``_build_index_html`` / ``caption_cfg`` silently dropping style keys — see
MEMORY obs 3453 "silently Drops 15+ Style Fields"). The moment someone adds a
new ``VideoRenderConfig`` field and forgets to thread it into
``caption_cfg()``, this test FAILS and tells them exactly which bucket to file
it into.

Pure Python — NO Node / ffmpeg / browser. Runs everywhere the backend job runs
(the live cross-renderer pixel diff is the opt-in ``test_caption_parity.py``).

Two guarantees:
  1. **Total partition.** Every ``VideoRenderConfig.model_fields`` key sits in
     EXACTLY ONE of two buckets — ``EXPECTED_IN_CAP_CFG`` (reaches the HTML
     layer) or ``INTENTIONALLY_ABSENT`` (documented reason it must not). A new,
     unclassified field breaks the build until its author files it.
  2. **Sentinels survive.** A config populated with distinctive non-default
     values must surface each expected key's value in ``caption_cfg()`` output —
     catching a key that is present but reads a default / the wrong field.

Per-word overrides get the same treatment: ``_WORD_OVERRIDE_KEYS`` (the set the
HTML runtime forwards) must equal the set Pillow honors, minus the one key
deliberately excluded from HTML (``custom_font_path``).
"""

from __future__ import annotations

import pytest

from backend.exporters.hyperframes_caption_html import (
    _WORD_OVERRIDE_KEYS,
    caption_cfg,
)
from backend.models.schemas import VideoRenderConfig


# ── Bucket 1: fields that MUST reach the HTML caption layer ───────────────────
# Maps each snake_case model field → the key it becomes in ``caption_cfg()``
# output. Derived by READING caption_cfg() (hyperframes_caption_html.py), never
# guessed. If caption_cfg gains/renames a key, update this map (and the test
# fails loudly until you do).
EXPECTED_IN_CAP_CFG: dict[str, str] = {
    "resolution_w": "resW",
    "resolution_h": "resH",
    "font_family": "fontFamily",
    "font_size": "fontSize",
    "line_height": "lineHeight",
    "tracking": "tracking",
    "lines": "lines",
    "max_width": "maxWidth",
    "position_x": "posX",
    "position_y": "posY",
    "bg_padding_h": "padH",
    "bg_padding_v": "padV",
    "bg_color": "bgColor",
    "bg_opacity": "bgOpacity",
    "bg_corner_radius": "bgRadius",
    "bg_width_extra": "bgWidthExtra",
    "bg_height_extra": "bgHeightExtra",
    "text_offset_x": "textOffsetX",
    "text_offset_y": "textOffsetY",
    "text_align_h": "alignH",
    "text_align_v": "alignV",
    "text_color": "textColor",
    "active_word_color": "activeColor",
    "stroke_width": "strokeWidth",
    "stroke_color": "strokeColor",
    "shadow_enabled": "shadowEnabled",
    "shadow_color": "shadowColor",
    "shadow_opacity": "shadowOpacity",
    "shadow_blur": "shadowBlur",
    "shadow_offset_x": "shadowOffsetX",
    "shadow_offset_y": "shadowOffsetY",
    "animation": "animation",
    "animation_duration": "animDur",
    "crossfade_duration": "crossfadeDur",
    "word_transition": "wordTransition",
    "highlight_text_color": "highlightTextColor",
    "highlight_padding_x": "hlPadX",
    "highlight_padding_y": "hlPadY",
    "highlight_radius": "hlRadius",
    "highlight_opacity": "hlOpacity",
    "highlight_animation": "hlAnim",
    "highlight_offset_x": "hlOffX",
    "highlight_offset_y": "hlOffY",
    "underline_thickness": "ulThickness",
    "underline_color": "ulColor",
    "underline_offset_y": "ulOffsetY",
    "underline_width": "ulWidth",
    "bounce_strength": "bounceStrength",
    "scale_factor": "scaleFactor",
}


# ── Bucket 2: fields deliberately NOT in caption_cfg — each with a real reason ─
# A HyperFrames caption is styled by caption_cfg; these fields shape a DIFFERENT
# stage (grouping, encoding, compositing, font embedding, path selection) and so
# must never appear in the caption style payload. An entry without a reason is a
# review blocker.
INTENTIONALLY_ABSENT: dict[str, str] = {
    "bold": (
        "No synthetic bold — the user picks a font-variant FILE directly and all "
        "three renderers use it as-is (CLAUDE.md 'No bold synthesis'). Per-word "
        "bold rides in the override 'o.bold', not the group caption style."
    ),
    "word_spacing": (
        "Pillow adds it to the inter-word gap (video_render._render_frame "
        "extra_word_spacing); the HTML runtime spaces words by the measured space "
        "glyph only. Identical at the default (0); a non-zero value is a known, "
        "documented HTML-layer limitation — not a silent config-key drop."
    ),
    "words_per_group": (
        "Grouping is applied UPSTREAM (segments → N-word display groups) before "
        "markup; it shapes CAP_GROUPS / the DOM spans, not the CAP_CFG style."
    ),
    "fill_gaps": (
        "Applied UPSTREAM to group selection (fill_group_gaps() stretches group "
        "end times before the groups are handed to the HTML/Pillow renderers); it "
        "shapes CAP_GROUPS' start/end values, not the CAP_CFG style payload."
    ),
    "caption_style": (
        "Selects the render PATH (classic Pillow-parity HTML vs a HyperFrames "
        "registry caption-style). When this HTML caption layer runs it is already "
        "'classic', so it is never a parameter the runtime reads."
    ),
    "custom_font_path": (
        "Local filesystem paths must never leak into HTML; the font file is "
        "embedded server-side via @font-face (hyperframes_project._font_face_block), "
        "same mechanism referenced by _WORD_OVERRIDE_KEYS."
    ),
    "render_mode": (
        "overlay vs baked is a compositing/mux decision (transparent overlay vs "
        "burned into source), not a caption-style parameter."
    ),
    "output_format": (
        "Output container/codec (webm/mov/mp4) — an encoding concern, not caption "
        "styling."
    ),
    "video_bitrate": (
        "MP4 encoder bitrate — an encoding concern, not caption styling."
    ),
    "fps": (
        "Timeline frame rate; threaded to the CLI via --fps + data-fps on the "
        "composition root (hyperframes_project), not into the caption style payload."
    ),
}


# ── Per-word override contract ───────────────────────────────────────────────
# Mirror of the per-word override keys Pillow reads in
# backend/exporters/video_render.py (the ``ov.get(...)`` / ``ov[...]`` /
# ``active_ov.get(...)`` sites in _draw_word_list + _render_frame). Kept in sync
# by a cross-reference comment at that read site ("--- per-word overrides ---").
# If Pillow starts (or stops) honoring an override key, update BOTH.
PILLOW_HONORED_OVERRIDE_KEYS = frozenset({
    "text_color",
    "active_word_color",
    "font_size_scale",
    "bold",
    "font_family",
    "custom_font_path",
    "word_transition",
    "pos_offset_x",
    "pos_offset_y",
    "bounce_strength",
    "scale_factor",
    "underline_thickness",
    "underline_color",
    "underline_offset_y",
    "underline_width",
    "highlight_padding_x",
    "highlight_padding_y",
    "highlight_radius",
    "highlight_opacity",
    "highlight_offset_x",
    "highlight_offset_y",
})

# Honored by Pillow but DELIBERATELY excluded from the HTML payload: a local path
# must never cross into HTML. The per-word font is embedded server-side via a
# per-word @font-face (hyperframes_project._word_font_face_blocks), exactly like
# the main font — see the _WORD_OVERRIDE_KEYS docstring.
HTML_EXCLUDED_OVERRIDE_KEYS = frozenset({"custom_font_path"})


# Distinctive, non-default, mutually-distinct values for every EXPECTED field so
# a key that is present-but-default-swallowed, OR present-but-reads-the-wrong-
# field, both fail (each field's sentinel is unique).
_SENTINELS: dict[str, object] = {
    "resolution_w": 1234,
    "resolution_h": 2345,
    "font_family": "SentinelSans",
    "font_size": 71,
    "line_height": 1.77,
    "tracking": 3.5,
    "lines": 4,
    "max_width": 0.61,
    "position_x": 0.31,
    "position_y": 0.41,
    "bg_padding_h": 43,
    "bg_padding_v": 47,
    "bg_color": "#101112",
    "bg_opacity": 0.53,
    "bg_corner_radius": 19,
    "bg_width_extra": 21,
    "bg_height_extra": 22,
    "text_offset_x": 25,
    "text_offset_y": 27,
    "text_align_h": "left",
    "text_align_v": "top",
    "text_color": "#131415",
    "active_word_color": "#161718",
    "stroke_width": 7,
    "stroke_color": "#191a1b",
    "shadow_enabled": True,
    "shadow_color": "#1c1d1e",
    "shadow_opacity": 0.59,
    "shadow_blur": 9,
    "shadow_offset_x": 11,
    "shadow_offset_y": 13,
    "animation": "pop",
    "animation_duration": 0.37,
    "crossfade_duration": 0.29,
    "word_transition": "karaoke",
    "highlight_text_color": "#202122",
    "highlight_padding_x": 8,
    "highlight_padding_y": 10,
    "highlight_radius": 18,
    "highlight_opacity": 0.71,
    "highlight_animation": "slide",
    "highlight_offset_x": 15,
    "highlight_offset_y": -17,
    "underline_thickness": 5,
    "underline_color": "#232425",
    "underline_offset_y": 6,
    "underline_width": 14,
    "bounce_strength": 0.23,
    "scale_factor": 1.9,
}


def test_every_model_field_is_classified_exactly_once():
    """Total partition: no field unclassified, none in both buckets, none stale.

    THIS is the guard that makes the contract self-defending: a NEW
    VideoRenderConfig field lands in neither bucket → this fails → the author is
    told which bucket to file it into before the build goes green.
    """
    model_fields = set(VideoRenderConfig.model_fields)
    expected = set(EXPECTED_IN_CAP_CFG)
    absent = set(INTENTIONALLY_ABSENT)

    overlap = expected & absent
    assert not overlap, (
        f"Fields in BOTH buckets (pick one): {sorted(overlap)}"
    )

    unclassified = model_fields - expected - absent
    assert not unclassified, (
        "New VideoRenderConfig field(s) not accounted for: "
        f"{sorted(unclassified)}.\n"
        "FILE EACH into exactly one bucket in test_caption_cfg_contract.py:\n"
        "  • EXPECTED_IN_CAP_CFG  — if it should style the HTML caption layer "
        "(then also add it to caption_cfg() in hyperframes_caption_html.py);\n"
        "  • INTENTIONALLY_ABSENT — if it must NOT reach captions (add a "
        "one-line reason)."
    )

    stale = (expected | absent) - model_fields
    assert not stale, (
        f"Bucket entries for fields that no longer exist on VideoRenderConfig: "
        f"{sorted(stale)} — remove them."
    )


def test_intentionally_absent_entries_each_have_a_reason():
    """An absent field without a documented reason is a review blocker."""
    missing = [f for f, reason in INTENTIONALLY_ABSENT.items() if not reason.strip()]
    assert not missing, f"INTENTIONALLY_ABSENT needs a reason for: {missing}"


def test_absent_fields_do_not_leak_into_caption_cfg():
    """The absent bucket must genuinely stay out of the style payload."""
    out = caption_cfg(VideoRenderConfig())
    cfg_key_for = {v: k for k, v in EXPECTED_IN_CAP_CFG.items()}
    # No caption_cfg key may map back to an intentionally-absent field name, and
    # no absent field name may appear verbatim as a caption_cfg key.
    for absent_field in INTENTIONALLY_ABSENT:
        assert absent_field not in out, (
            f"{absent_field!r} is INTENTIONALLY_ABSENT but appears in caption_cfg()"
        )


def test_caption_cfg_emits_exactly_the_expected_keys():
    """caption_cfg() output keys == EXPECTED values — no extra, no missing.

    Adding a key to caption_cfg without registering it here (or removing one)
    fails, keeping the map honest.
    """
    out_keys = set(caption_cfg(VideoRenderConfig()).keys())
    expected_keys = set(EXPECTED_IN_CAP_CFG.values())
    # camelCase targets must be unique (a dup would hide a dropped field).
    assert len(expected_keys) == len(EXPECTED_IN_CAP_CFG), (
        "Two model fields map to the same caption_cfg key in EXPECTED_IN_CAP_CFG."
    )
    assert out_keys == expected_keys, (
        f"caption_cfg keys drifted from the contract.\n"
        f"  Only in caption_cfg(): {sorted(out_keys - expected_keys)}\n"
        f"  Only in EXPECTED map:  {sorted(expected_keys - out_keys)}"
    )


def test_every_expected_key_surfaces_its_sentinel_value():
    """A distinctive value set on each field must survive into caption_cfg().

    Catches a key that is present in the output but reads a hard-coded default or
    the wrong source field (both fail because sentinels are unique).
    """
    # Guard: the sentinel table must cover exactly the EXPECTED fields, so this
    # test can never quietly stop checking a field.
    assert set(_SENTINELS) == set(EXPECTED_IN_CAP_CFG), (
        "Sentinel table out of sync with EXPECTED_IN_CAP_CFG:\n"
        f"  missing sentinels: {sorted(set(EXPECTED_IN_CAP_CFG) - set(_SENTINELS))}\n"
        f"  extra sentinels:   {sorted(set(_SENTINELS) - set(EXPECTED_IN_CAP_CFG))}"
    )

    cfg = VideoRenderConfig(**_SENTINELS)
    out = caption_cfg(cfg)

    for field, cap_key in EXPECTED_IN_CAP_CFG.items():
        assert cap_key in out, f"caption_cfg() dropped {cap_key!r} (from {field})"
        assert out[cap_key] == getattr(cfg, field), (
            f"caption_cfg[{cap_key!r}] should surface VideoRenderConfig.{field} "
            f"(={getattr(cfg, field)!r}) but got {out[cap_key]!r} — the key reads "
            f"a default or the wrong field."
        )


def test_html_word_overrides_match_pillow_minus_deliberate_exclusion():
    """The HTML per-word override set must equal Pillow's honored set, minus the
    one key deliberately kept out of HTML (custom_font_path)."""
    html_keys = set(_WORD_OVERRIDE_KEYS)

    # (a) No duplicate keys in the tuple.
    assert len(html_keys) == len(_WORD_OVERRIDE_KEYS), (
        "Duplicate key in _WORD_OVERRIDE_KEYS."
    )

    # (b) HTML forwards every Pillow-honored key that is allowed in HTML — i.e.
    #     _WORD_OVERRIDE_KEYS ⊇ (Pillow honored − excluded). A key Pillow honors
    #     that silently stops reaching the HTML runtime is the drift we catch.
    should_forward = PILLOW_HONORED_OVERRIDE_KEYS - HTML_EXCLUDED_OVERRIDE_KEYS
    missing = should_forward - html_keys
    assert not missing, (
        f"Pillow honors {sorted(missing)} per-word but the HTML runtime does not "
        f"forward them (add to _WORD_OVERRIDE_KEYS in hyperframes_caption_html.py)."
    )

    # (c) HTML must not forward a key Pillow never honors (would be a no-op at best
    #     or a leaked path at worst).
    extra = html_keys - should_forward
    assert not extra, (
        f"_WORD_OVERRIDE_KEYS forwards {sorted(extra)} which Pillow does not honor "
        f"(or which is deliberately HTML-excluded)."
    )

    # (d) The exclusion is real: the excluded key IS honored by Pillow (else the
    #     exclusion list is stale) and IS kept out of HTML.
    assert HTML_EXCLUDED_OVERRIDE_KEYS <= PILLOW_HONORED_OVERRIDE_KEYS, (
        "HTML_EXCLUDED_OVERRIDE_KEYS lists a key Pillow does not honor — stale."
    )
    assert not (HTML_EXCLUDED_OVERRIDE_KEYS & html_keys), (
        "A deliberately HTML-excluded override key leaked into _WORD_OVERRIDE_KEYS."
    )
