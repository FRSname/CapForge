"""The Pillow renderer shapes text through HarfBuzz when it can (issue #73).

Pillow's ``Layout.BASIC`` engine applies no OpenType feature at all, so a font's
contextual alternates and ligatures never fire in a render even though the
Canvas preview (Chromium) shows them. ``video_render.LAYOUT_ENGINE`` asks for
``Layout.RAQM`` whenever libraqm could load FriBiDi; these tests pin that every
font ``_get_font`` hands out is on that engine, and — where the interpreter has
FriBiDi (CI installs it; the app ships it, see ``electron/text-shaping.js``) —
that a default-on feature really changes the pixels.
"""

from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageDraw, ImageFont

from backend.exporters.video_render import (
    LAYOUT_ENGINE,
    OPENTYPE_SHAPING,
    _get_font,
    shaping_status,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
# Bundled font whose ``liga`` table (a default-on feature) joins "ra" and "ro".
LIGATURE_FONT = REPO_ROOT / "Fonts" / "OrangeGumdrop-PersonalUse-Regular.otf"
LIGATURE_TEXT = "Rome orange"


def _render(font: ImageFont.FreeTypeFont, features: list[str] | None = None) -> Image.Image:
    im = Image.new("L", (700, 110), 0)
    ImageDraw.Draw(im).text((10, 10), LIGATURE_TEXT, font=font, fill=255, features=features)
    return im


def test_every_loaded_font_is_on_the_resolved_engine():
    font = _get_font("Orange Gumdrop", 48, str(LIGATURE_FONT))
    assert font.layout_engine == LAYOUT_ENGINE
    assert OPENTYPE_SHAPING == (LAYOUT_ENGINE == ImageFont.Layout.RAQM)


def test_status_names_the_engine():
    status = shaping_status()
    assert status["layout_engine"] == LAYOUT_ENGINE.name
    assert status["opentype_shaping"] is OPENTYPE_SHAPING


@pytest.mark.skipif(not OPENTYPE_SHAPING, reason="FriBiDi not found: Pillow fell back to BASIC")
def test_default_opentype_features_change_the_render():
    """With RAQM the ligatures fire by default and switching them off changes
    the pixels; BASIC (what a runtime without FriBiDi gets) never draws them.
    BASIC also positions glyphs on hinted integer advances where HarfBuzz uses
    fractional ones, so the two engines are only compared for *having* changed,
    never for equality."""
    shaped = _get_font("Orange Gumdrop", 72, str(LIGATURE_FONT))
    basic = ImageFont.truetype(str(LIGATURE_FONT), 72, layout_engine=ImageFont.Layout.BASIC)

    with_liga = _render(shaped)
    without_liga = _render(shaped, ["-liga"])
    plain = _render(basic)

    assert ImageChops.difference(with_liga, without_liga).getbbox() is not None
    assert ImageChops.difference(with_liga, plain).getbbox() is not None
    # BASIC has no shaper to hand a feature request to — Pillow refuses it
    # outright, which is why the render path never passes `features=`.
    with pytest.raises(KeyError):
        _render(basic, ["-liga"])
