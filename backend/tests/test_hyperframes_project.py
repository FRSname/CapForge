"""Tests for the HyperFrames project/composition generator (Phase A)."""

import json
from pathlib import Path

import pytest
from PIL import Image

from backend.exporters import hyperframes_project as hp
from backend.exporters.hyperframes_project import (
    export_hyperframes_project,
    sync_companions,
)
from backend.exporters.video_render import _get_font, resolve_font_file
from backend.models.schemas import TranscriptionResult, VideoRenderConfig

REPO_ROOT = Path(__file__).resolve().parents[2]
REPO_FONT = REPO_ROOT / "Fonts" / "CaviarDreams.ttf"


def _generate(result, tmp_path, **kwargs) -> Path:
    out = export_hyperframes_project(result, VideoRenderConfig(), str(tmp_path), **kwargs)
    return Path(out)


def test_writes_self_contained_project_files(transcription_result, tmp_path):
    project = _generate(transcription_result, tmp_path)
    assert project.is_dir()
    assert (project / "index.html").exists()
    assert (project / "transcript.json").exists()
    assert (project / "README.txt").exists()


def test_transcript_json_matches_bridge_format(transcription_result, tmp_path):
    project = _generate(transcription_result, tmp_path)
    words = json.loads((project / "transcript.json").read_text())
    assert len(words) == 6
    assert all(set(w) == {"text", "start", "end"} for w in words)


def test_composition_has_root_and_video_audio_tracks(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    assert 'data-composition-id="root"' in html
    assert 'data-duration="' in html and 'data-start="0"' in html
    # Video base track, separate audio track (HyperFrames requires muted video).
    assert "<video" in html and "muted" in html and 'data-track-index="0"' in html
    assert "<audio" in html and 'data-track-index="2"' in html


def test_root_carries_source_fps(transcription_result, tmp_path):
    # data-fps lets the HyperFrames render honor the source rate (25fps stays 25,
    # not the CLI's 30 default). config.fps flows onto the composition root.
    out = export_hyperframes_project(
        transcription_result, VideoRenderConfig(fps=25), str(tmp_path)
    )
    html = (Path(out) / "index.html").read_text()
    assert 'data-fps="25"' in html


def test_root_fps_defaults_to_config(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    assert 'data-fps="30"' in html  # VideoRenderConfig default


def test_registers_single_root_timeline(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    assert 'window.__timelines["root"]' in html
    assert "gsap.timeline({ paused: true })" in html


def test_caption_groups_match_capforge_grouping(transcription_result, tmp_path):
    # 2 segments × 3 words, words_per_group=3 → 2 groups, 6 word spans.
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    assert html.count('class="cgroup"') == 2
    assert html.count('class="cw"') == 6
    assert "Hello" in html and "Crossing" in html  # fixture words present


def test_every_group_has_hard_exit_kill(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    # captions.md exit guarantee — a deterministic hidden kill at group.end.
    assert 'visibility: "hidden"' in html


def test_style_values_flow_from_config(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    cfg = VideoRenderConfig()
    assert cfg.active_word_color in html  # #FFD700
    assert cfg.text_color in html  # #FFFFFF
    assert f"{cfg.font_size}px" in html


def test_no_banned_hyperframes_patterns(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    for banned in ("Math.random", "Date.now", "repeat: -1", "data-end", "data-layer"):
        assert banned not in html, f"banned pattern present: {banned}"


def test_custom_groups_override_autogrouping(transcription_result, tmp_path):
    custom = [
        {"text": "one two", "start": 0.0, "end": 1.0,
         "words": [{"word": "one", "start": 0.0, "end": 0.5},
                   {"word": "two", "start": 0.5, "end": 1.0}]},
    ]
    html = (_generate(transcription_result, tmp_path, custom_groups=custom) / "index.html").read_text()
    assert html.count('class="cgroup"') == 1
    assert html.count('class="cw"') == 2


def test_empty_result_raises(empty_result, tmp_path):
    with pytest.raises(ValueError):
        export_hyperframes_project(empty_result, VideoRenderConfig(), str(tmp_path))


# --- sync_companions error paths: clear errors, never a partial write ---


def test_sync_companions_missing_project_dir_raises_clear_error(
    transcription_result, tmp_path
):
    """A co-author sync against a non-existent project must fail loudly with the
    offending path — never silently scaffold a fresh (agent-clobbering) project."""
    missing = tmp_path / "does-not-exist-hyperframes"
    with pytest.raises(FileNotFoundError) as exc:
        sync_companions(transcription_result, VideoRenderConfig(), str(missing))
    assert str(missing) in str(exc.value)
    # Nothing was created as a side effect of the failed sync.
    assert not missing.exists()


def test_sync_companions_empty_result_raises_without_partial_write(
    empty_result, transcription_result, tmp_path
):
    """With no subtitle data, sync must raise BEFORE touching companion files, so a
    pre-existing (even corrupt) transcript.json is left byte-for-byte intact — no
    half-written state the agent could later render from."""
    project = Path(
        export_hyperframes_project(transcription_result, VideoRenderConfig(), str(tmp_path))
    )
    # Simulate a corrupt companion already on disk.
    corrupt = "{ this is not valid json"
    (project / "transcript.json").write_text(corrupt, encoding="utf-8")
    index_before = (project / "index.html").read_text()

    with pytest.raises(ValueError):
        sync_companions(empty_result, VideoRenderConfig(), str(project))

    # The raise happened before any write: corrupt transcript + agent index untouched.
    assert (project / "transcript.json").read_text() == corrupt
    assert (project / "index.html").read_text() == index_before


def test_sync_companions_overwrites_corrupt_transcript_on_success(
    transcription_result, tmp_path
):
    """sync never trusts prior companion state: a corrupt transcript.json is fully
    regenerated (not merged/appended) from the live result on a successful sync."""
    project = Path(
        export_hyperframes_project(transcription_result, VideoRenderConfig(), str(tmp_path))
    )
    (project / "transcript.json").write_text("{ corrupt", encoding="utf-8")

    sync_companions(transcription_result, VideoRenderConfig(), str(project))

    words = json.loads((project / "transcript.json").read_text())
    assert len(words) == 6  # fixture has 6 words — regenerated wholesale


# --- Phase B: effect clips ---


def _make_logo(tmp_path) -> str:
    path = tmp_path / "logo.png"
    Image.new("RGBA", (64, 64), (212, 149, 42, 255)).save(path)
    return str(path)


def test_logo_effect_composited(transcription_result, tmp_path):
    logo = _make_logo(tmp_path)
    effects = [{
        "id": "e1", "type": "logo", "start": 0.5, "duration": 1.5,
        "anchor_x": 0.5, "anchor_y": 0.3,
        "variables": {"src": logo, "width": 200},
    }]
    project = _generate(transcription_result, tmp_path, effects=effects)
    html = (project / "index.html").read_text()
    assert 'class="fx"' in html and 'id="fx-0"' in html
    assert "var EFFECTS" in html
    assert "width: 200px" in html
    assert (project / "assets" / "logo.png").exists()  # asset copied in


def test_logo_with_missing_image_is_skipped(transcription_result, tmp_path):
    effects = [{
        "id": "e1", "type": "logo", "start": 0.0, "duration": 1.0,
        "variables": {"src": str(tmp_path / "does-not-exist.png")},
    }]
    project = _generate(transcription_result, tmp_path, effects=effects)
    html = (project / "index.html").read_text()
    assert 'class="fx"' not in html


def test_no_effects_emits_empty_effects_array(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    assert 'class="fx"' not in html
    assert "var EFFECTS = []" in html


# --- Phase D: text effect types ---


def test_lower_third_effect_renders_title_and_subtitle(transcription_result, tmp_path):
    effects = [{
        "id": "e1", "type": "lower_third", "start": 0.5, "duration": 2.0,
        "variables": {"title": "Jane Doe", "subtitle": "CEO, Acme"},
    }]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert 'class="fx"' in html and 'class="fx-inner fx-lower"' in html
    assert "Jane Doe" in html and "CEO, Acme" in html


def test_kinetic_stat_effect_renders_value_and_label(transcription_result, tmp_path):
    effects = [{
        "id": "e1", "type": "kinetic_stat", "start": 1.0, "duration": 1.5,
        "variables": {"value": "2.4M", "label": "downloads"},
    }]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert 'class="fx-inner fx-stat"' in html
    assert "2.4M" in html and "downloads" in html


def test_lower_third_without_title_is_skipped(transcription_result, tmp_path):
    effects = [{"id": "e1", "type": "lower_third", "start": 0.0, "variables": {"subtitle": "x"}}]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert 'class="fx"' not in html


def test_unknown_effect_type_is_skipped(transcription_result, tmp_path):
    effects = [{"id": "e1", "type": "explosion", "start": 0.0, "variables": {}}]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert 'class="fx"' not in html


def test_text_effect_escapes_html(transcription_result, tmp_path):
    effects = [{
        "id": "e1", "type": "lower_third", "start": 0.0,
        "variables": {"title": "<script>x</script>"},
    }]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert "<script>x</script>" not in html
    assert "&lt;script&gt;" in html


# --- Phase D slice 2: highlight + b_roll ---


def test_highlight_renders_marker_bar(transcription_result, tmp_path):
    effects = [{
        "id": "e1", "type": "highlight", "start": 0.5, "duration": 1.0,
        "anchor_x": 0.4, "anchor_y": 0.5, "variables": {"width": 240, "height": 40},
    }]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert 'class="fx-inner fx-highlight"' in html
    assert "fx-hl-bar" in html and "width: 240px" in html
    assert '"transformOrigin": "left center"' in html  # GSAP sweep origin


def test_b_roll_image_composited_and_copied(transcription_result, tmp_path):
    img = _make_logo(tmp_path)  # any image file works
    effects = [{
        "id": "e1", "type": "b_roll", "start": 1.0, "duration": 2.0,
        "variables": {"src": img, "width": 600},
    }]
    project = _generate(transcription_result, tmp_path, effects=effects)
    html = (project / "index.html").read_text()
    assert 'class="fx-inner fx-broll"' in html and "width: 600px" in html
    assert (project / "assets" / "logo.png").exists()


def test_b_roll_fullscreen_covers_frame(transcription_result, tmp_path):
    img = _make_logo(tmp_path)
    effects = [{
        "id": "e1", "type": "b_roll", "start": 0.0, "duration": 1.0,
        "variables": {"src": img, "fullscreen": True},
    }]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert "object-fit: cover" in html and "width: 100%; height: 100%" in html


def test_b_roll_with_missing_image_is_skipped(transcription_result, tmp_path):
    effects = [{"id": "e1", "type": "b_roll", "start": 0.0, "variables": {"src": str(tmp_path / "nope.png")}}]
    html = (_generate(transcription_result, tmp_path, effects=effects) / "index.html").read_text()
    assert 'class="fx"' not in html


# --- Phase 3: native HyperFrames caption styles ---


def test_classic_caption_style_is_the_default_and_unchanged(transcription_result, tmp_path):
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    # Default config = classic: hand-rolled track, no sub-composition reference.
    assert "data-composition-src" not in html
    assert html.count('class="cgroup"') == 2


def test_custom_caption_style_writes_agent_component(transcription_result, tmp_path):
    from backend.exporters.hyperframes_captions import custom_caption_template

    cfg = VideoRenderConfig(caption_style="custom")
    out = export_hyperframes_project(
        transcription_result, cfg, str(tmp_path), caption_html=custom_caption_template()
    )
    project = Path(out)
    comp = project / "compositions" / "components" / "custom-caption.html"
    assert comp.exists()
    html = (project / "index.html").read_text()
    assert 'data-composition-src="compositions/components/custom-caption.html"' in html
    assert 'class="cgroup"' not in html  # hand-rolled track replaced by the custom one
    # our transcript was injected into the agent's component
    assert "Hello" in comp.read_text() and "Your" not in comp.read_text()


def test_custom_caption_style_without_html_raises(transcription_result, tmp_path):
    from backend.exporters.hyperframes_captions import CaptionStyleError

    cfg = VideoRenderConfig(caption_style="custom")
    with pytest.raises(CaptionStyleError, match="No custom caption style"):
        export_hyperframes_project(transcription_result, cfg, str(tmp_path))


# --- Caption word-spacing parity: font embedding (RC2) + load-gate (RC1) ---
#
# The HyperFrames caption layer positions every word by canvas measureText(). If
# the render browser measures with the wrong font (a name-only family it lacks,
# or an @font-face that hasn't decoded yet), word advances are wrong → captions
# render in the right glyphs but mis-spaced ("connected words"). Two guards:
#   RC2 — embed the SAME file Pillow rasterizes, even without a custom upload.
#   RC1 — defer measurement until the font is loaded.


def test_resolve_font_file_prefers_custom_path():
    assert resolve_font_file("Whatever", str(REPO_FONT), True) == str(REPO_FONT)


def test_resolve_font_file_matches_pillow_get_font():
    # The HyperFrames @font-face must embed exactly the file Pillow loads.
    for custom in (str(REPO_FONT), None):
        resolved = resolve_font_file("Arial", custom, True)
        font = _get_font("Arial", 40, custom, True)
        font_path = getattr(font, "path", None)
        if resolved is None or font_path is None:
            continue  # no system font on this host (e.g. headless Linux) — skip
        assert resolved == font_path


def test_classic_captions_embed_resolved_font_without_custom_upload(
    transcription_result, tmp_path, monkeypatch
):
    # RC2: a bundled/system font is referenced by name only (custom_font_path is
    # None). Previously _font_face_block early-returned "" → the render machine
    # fell back to a different font. It must now embed the resolved file.
    monkeypatch.setattr(hp, "resolve_font_file", lambda *a, **k: str(REPO_FONT))
    cfg = VideoRenderConfig(font_family="Caviar Dreams", custom_font_path=None)
    project = Path(export_hyperframes_project(transcription_result, cfg, str(tmp_path)))
    html = (project / "index.html").read_text()
    assert '@font-face { font-family: "Caviar Dreams";' in html
    assert 'src: url("fonts/CaviarDreams.ttf")' in html
    assert (project / "fonts" / "CaviarDreams.ttf").exists()


def test_classic_captions_no_font_when_unresolvable(
    transcription_result, tmp_path, monkeypatch
):
    monkeypatch.setattr(hp, "resolve_font_file", lambda *a, **k: None)
    cfg = VideoRenderConfig(custom_font_path=None)
    html = (Path(export_hyperframes_project(transcription_result, cfg, str(tmp_path))) / "index.html").read_text()
    # The CSS @font-face *rule* (not the word in a code comment) must be absent.
    assert "@font-face { font-family:" not in html


def test_classic_captions_defer_build_until_fonts_ready(transcription_result, tmp_path):
    # RC1: measurement + timeline registration are gated on the font loading.
    html = (_generate(transcription_result, tmp_path) / "index.html").read_text()
    assert "__capWhenFontsReady(CAP_CFG" in html  # the font-ready gate is wired
    assert "document.fonts" in html               # ...and actually awaits fonts
    assert "function __capStart()" in html         # build deferred into a callback
    # __capBuild must run INSIDE the gated callback, not at parse time.
    gate = html.index("__capWhenFontsReady(CAP_CFG")
    build = html.index("__capBuild(tl")
    assert build < gate, "caption build must be defined before the gate invokes it"
    assert "window.__renderReady = true;" in html  # signals the CLI we're ready


def test_native_caption_style_references_subcomposition(transcription_result, tmp_path):
    # Pre-place the registry component so install (npx) is skipped (cache path),
    # keeping the test Node-free.
    project = tmp_path / "audio-hyperframes"  # stem of fixture audio_path /tmp/audio.wav
    comp = project / "compositions" / "components" / "caption-pill-karaoke.html"
    comp.parent.mkdir(parents=True, exist_ok=True)
    comp.write_text(
        '<div data-composition-id="cap" data-duration="8"></div>\n'
        "<script>var DURATION = 8;\n"
        '  var TRANSCRIPT = [{ text: "demo", start: 0.0, end: 0.5 }];</script>'
    )
    cfg = VideoRenderConfig(caption_style="caption-pill-karaoke")
    out = export_hyperframes_project(transcription_result, cfg, str(tmp_path))
    html = (Path(out) / "index.html").read_text()
    # Native path: captions are a sub-composition; the hand-rolled track is gone.
    assert 'data-composition-src="compositions/components/caption-pill-karaoke.html"' in html
    assert 'class="cgroup"' not in html and 'class="cw"' not in html
    # Root timeline (effects) still registered.
    assert 'window.__timelines["root"]' in html
    # Our transcript + duration were injected into the component.
    injected = comp.read_text()
    assert "Hello" in injected and "var DURATION = 8;" not in injected
