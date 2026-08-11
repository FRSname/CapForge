"""The RSVP settings contract on ``VideoRenderConfig``.

Phase 2 of docs/plans/rsvp-speed-reading-mode.md lands seven new fields whose
*units* are the whole risk: two are post-``pct()`` fractions of the caption band,
one is a 0-1 opacity fraction, one is PLAIN SECONDS, and the frontend sanitizer
(``src/renderer/src/lib/settingsSanitize.ts``) claims its bounds mirror the
``Field(...)`` constraints asserted here. If either side moves without the other,
an in-range UI value starts failing schema validation at render time (422 on
/api/render-video) — so the bounds are pinned on both sides.

The defaults are MEASURED ground truth from the reference clip (the pivot column
at 35% of the band, the focus glyph at rgb(228,133,31)); they are not free
parameters to retune.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.models.schemas import VideoRenderConfig


def test_defaults_are_wrap_mode_and_the_measured_rsvp_values():
    cfg = VideoRenderConfig()

    # Wrap is the default so an existing project renders exactly as before.
    assert cfg.reading_mode == "wrap"
    assert cfg.rsvp_pivot_x == pytest.approx(0.35)
    assert cfg.rsvp_focus_color == "#E4851F"
    assert cfg.rsvp_context_opacity == pytest.approx(0.75)
    assert cfg.rsvp_slide_duration == pytest.approx(0.06)
    assert cfg.rsvp_edge_fade == pytest.approx(0.12)
    assert cfg.rsvp_reticle is True


def test_reading_mode_is_a_closed_set():
    assert VideoRenderConfig(reading_mode="rsvp").reading_mode == "rsvp"
    with pytest.raises(ValidationError):
        VideoRenderConfig(reading_mode="turbo")


@pytest.mark.parametrize(
    "field,too_low,too_high",
    [
        # Fractions of the caption band — the frontend sends these already
        # divided by 100 (render.ts pct()), hence le=1.0 / le=0.5.
        ("rsvp_pivot_x", -0.01, 1.01),
        ("rsvp_edge_fade", -0.01, 0.51),
        ("rsvp_context_opacity", -0.01, 1.01),
        # SECONDS, not a fraction — but still bounded, and the sanitizer's
        # {min: 0, max: 1} mirrors exactly this.
        ("rsvp_slide_duration", -0.01, 1.01),
    ],
)
def test_numeric_rsvp_fields_are_bounded(field: str, too_low: float, too_high: float):
    with pytest.raises(ValidationError):
        VideoRenderConfig(**{field: too_low})
    with pytest.raises(ValidationError):
        VideoRenderConfig(**{field: too_high})


def test_a_one_second_slide_is_legal():
    """The `fraction: true` regression, from the backend side: 1 second is a
    legitimate slide duration, so the schema must accept it (the frontend must
    not have rescaled it to 0.01 on the way here)."""
    assert VideoRenderConfig(rsvp_slide_duration=1).rsvp_slide_duration == pytest.approx(1.0)
