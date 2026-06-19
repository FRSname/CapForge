"""Tests for native HyperFrames caption-style install + transcript injection."""

import pytest

from backend.exporters.hyperframes_captions import (
    CaptionStyleError,
    component_rel_path,
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


def test_list_caption_styles_prepends_classic_and_falls_back(monkeypatch):
    import backend.exporters.hyperframes_captions as hc

    # No live catalog → curated fallback, with 'classic' always first.
    monkeypatch.setattr(hc, "_styles_cache", None)
    monkeypatch.setattr(hc, "_query_catalog", lambda: None)
    styles = hc.list_caption_styles()
    assert styles[0]["name"] == "classic"
    assert "caption-pill-karaoke" in [s["name"] for s in styles]
