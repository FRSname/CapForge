"""Tests for native HyperFrames caption-style install + transcript injection."""

import pytest

from backend.exporters.hyperframes_captions import (
    CaptionStyleError,
    _has_designed_layout,
    build_editorial_blocks,
    component_rel_path,
    fit_caption_component,
    inject_editorial_blocks,
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


def test_inject_handles_W_variable_name(tmp_path):
    # editorial-style components name their transcript `var W` (not TRANSCRIPT).
    f = tmp_path / "c.html"
    f.write_text("<script>var DURATION = 8;\n  var W = [\n    { text: 'old', start: 0, end: 1 },\n  ];</script>")
    inject_transcript(f, '[{"text": "new", "start": 0, "end": 1}]', 2.0)
    out = f.read_text()
    assert '"text": "new"' in out and "old" not in out
    assert "var DURATION = 2;" in out


# --- Designed (BLOCKS) components: editorial-emphasis ---


_EDITORIAL_STUB = (
    "<div data-composition-id='ee' data-duration='8'></div>\n"
    "<script>\n  var DURATION = 8;\n"
    "  var W = [\n    { text: 'Every', start: 0.0, end: 0.3 },\n  ];\n"
    "  var BLOCKS = [\n    { line1: [[0, 'n']], line2: null },\n  ];\n"
    "</script>"
)


def test_has_designed_layout_detects_blocks():
    assert _has_designed_layout(_EDITORIAL_STUB) is True
    assert _has_designed_layout("<script>var TRANSCRIPT = [];</script>") is False


def _groups():
    return [
        {"words": [
            {"word": "Join", "start": 0.0, "end": 0.3},
            {"word": "Update", "start": 0.3, "end": 0.6, "overrides": {"font_size_scale": 1.4}},
            {"word": "Conference", "start": 0.6, "end": 1.0, "overrides": {"bold": True}},
        ]},
        {"words": [
            {"word": "now", "start": 1.0, "end": 1.3},
        ]},
    ]


def test_build_editorial_blocks_flattens_words_and_marks_emphasis():
    words, blocks = build_editorial_blocks(_groups())
    assert [w["text"] for w in words] == ["Join", "Update", "Conference", "now"]
    # one block per group; 3-word group splits into two lines
    assert len(blocks) == 2
    assert blocks[0]["line1"] and blocks[0]["line2"]
    assert blocks[1]["line2"] is None  # single-word group → one line
    # font_size_scale>1 AND bold both count as emphasis (e)
    types = {pair[0]: pair[1] for b in blocks for ln in (b["line1"], b["line2"] or []) for pair in ln}
    assert types[1] == "e" and types[2] == "e"  # Update (scaled), Conference (bold)
    assert types[0] == "n" and types[3] == "n"  # Join, now


def test_build_editorial_blocks_skips_empty_words():
    words, blocks = build_editorial_blocks([{"words": [{"word": "  ", "start": 0, "end": 1}]}])
    assert words == [] and blocks == []


def test_inject_editorial_blocks_rewrites_W_and_BLOCKS(tmp_path):
    f = tmp_path / "ee.html"
    f.write_text(_EDITORIAL_STUB)
    inject_editorial_blocks(f, _groups(), 1.3)
    out = f.read_text()
    assert '"text": "Update"' in out and "Every" not in out  # W replaced
    assert '[1, "e"]' in out  # BLOCKS replaced with our layout (Update = emphasis)
    assert "var DURATION = 1.3;" in out  # retimed


def test_inject_editorial_blocks_raises_on_wrong_component(tmp_path):
    f = tmp_path / "flat.html"
    f.write_text("<script>var TRANSCRIPT = [];</script>")  # no W/BLOCKS
    with pytest.raises(CaptionStyleError):
        inject_editorial_blocks(f, _groups(), 1.0)


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
