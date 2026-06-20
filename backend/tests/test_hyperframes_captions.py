"""Tests for native HyperFrames caption-style install + transcript injection."""

import pytest

from backend.exporters.hyperframes_captions import (
    CaptionStyleError,
    component_rel_path,
    fit_caption_component,
    inject_transcript,
    install_caption_component,
)

# A stand-in for an installed registry caption component: it carries the
# baked-in TRANSCRIPT array + DURATION + data-duration that injection rewrites.
_COMPONENT = (
    '<div id="x" data-composition-id="cap" data-duration="8" data-width="1920"></div>\n'
    '<video data-duration="8"></video>\n'
    "<script>\n"
    "  var DURATION = 8;\n"
    "  var TRANSCRIPT = [\n"
    '    { text: "old", start: 0.0, end: 0.5 },\n'
    "  ];\n"
    "</script>\n"
)


def test_component_rel_path():
    assert component_rel_path("caption-neon-accent") == "compositions/components/caption-neon-accent.html"


def test_inject_replaces_transcript_duration_and_data_duration(tmp_path):
    f = tmp_path / "c.html"
    f.write_text(_COMPONENT)
    inject_transcript(f, '[{"text": "new", "start": 0.0, "end": 1.0}]', 3.0)
    out = f.read_text()
    assert '"text": "new"' in out and "old" not in out
    assert "var DURATION = 3;" in out and "var DURATION = 8;" not in out
    # both data-duration occurrences (root div + bg video) are retimed
    assert 'data-duration="3"' in out and 'data-duration="8"' not in out


def test_inject_raises_without_transcript(tmp_path):
    f = tmp_path / "c.html"
    f.write_text("<div>no transcript array here</div>")
    with pytest.raises(CaptionStyleError):
        inject_transcript(f, "[]", 1.0)


def test_install_is_idempotent_when_component_present(tmp_path):
    # Pre-placing the component makes install a no-op (no npx invoked).
    style = "caption-pill-karaoke"
    dest = tmp_path / "compositions" / "components" / f"{style}.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("<div></div>")
    assert install_caption_component(str(tmp_path), style) == component_rel_path(style)


# A component with the canvas-dimension surface fit_caption_component rewrites.
_FIT_COMPONENT = (
    '<head>\n'
    '<meta name="viewport" content="width=1920, height=1080" />\n'
    '<style>\nhtml, body { width: 1920px; height: 1080px; }\n</style>\n'
    '</head>\n'
    '<body><div id="pk" data-composition-id="cap" data-width="1920" data-height="1080">'
    '<div class="caption-layer"></div></div></body>'
)


def _fit_file(tmp_path, body=_FIT_COMPONENT):
    f = tmp_path / "c.html"
    f.write_text(body)
    return f


def test_fit_is_noop_at_native_size(tmp_path):
    f = _fit_file(tmp_path)
    fit_caption_component(f, 1920, 1080)  # native stage
    out = f.read_text()
    assert out == _FIT_COMPONENT  # byte-identical — the proven path is untouched


def test_fit_portrait_rewrites_canvas_and_injects_fit_transform(tmp_path):
    f = _fit_file(tmp_path)
    fit_caption_component(f, 1080, 1920)  # portrait
    out = f.read_text()
    # viewport + body canvas → target
    assert 'content="width=1080, height=1920"' in out
    assert "width: 1080px !important; height: 1920px !important;" in out
    # comp root fit transform: scale to target width (1080/1920 = 0.5625), bottom-anchored
    assert "[data-composition-id]" in out
    assert "scale(0.5625)" in out
    assert "transform-origin: bottom center" in out
    # native box preserved on the root so internal layout stays in native coords
    assert "width: 1920px !important; height: 1080px !important;" in out


def test_fit_4k_same_aspect_scales_by_two(tmp_path):
    f = _fit_file(tmp_path)
    fit_caption_component(f, 3840, 2160)  # 4K, same 16:9 aspect
    out = f.read_text()
    assert "scale(2.0)" in out
    assert "width: 3840px !important; height: 2160px !important;" in out


def test_fit_falls_back_to_1920x1080_without_data_dims(tmp_path):
    # No data-width/height, no viewport → default native 1920×1080 assumed.
    f = _fit_file(tmp_path, '<style></style><body><div data-composition-id="cap"></div></body>')
    fit_caption_component(f, 1080, 1920)
    out = f.read_text()
    assert "scale(0.5625)" in out  # 1080/1920


def test_list_caption_styles_prepends_classic_and_falls_back(monkeypatch):
    import backend.exporters.hyperframes_captions as hc

    # No live catalog → curated fallback, with 'classic' always first.
    monkeypatch.setattr(hc, "_styles_cache", None)
    monkeypatch.setattr(hc, "_query_catalog", lambda: None)
    styles = hc.list_caption_styles()
    assert styles[0]["name"] == "classic"
    assert "caption-pill-karaoke" in [s["name"] for s in styles]
