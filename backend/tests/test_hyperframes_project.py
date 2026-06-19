"""Tests for the HyperFrames project/composition generator (Phase A)."""

import json
from pathlib import Path

import pytest

from backend.exporters.hyperframes_project import export_hyperframes_project
from backend.models.schemas import TranscriptionResult, VideoRenderConfig


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
