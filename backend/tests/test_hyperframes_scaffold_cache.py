"""Tests for the scaffold-cache fast path (Phase 4).

``ensure_hyperframes_project`` skips a full re-scaffold when config + groups +
transcript + source + effects are unchanged, and always re-scaffolds on any
change. Over-inclusion is the invariant: a spurious re-scaffold is acceptable,
a stale cache hit is a WRONG preview and must never happen.
"""

from pathlib import Path

import pytest

from backend.exporters import hyperframes_project as hp
from backend.exporters.hyperframes_project import (
    SCAFFOLD_FINGERPRINT_FILE,
    _scaffold_fingerprint,
    ensure_hyperframes_project,
)
from backend.models.schemas import VideoRenderConfig


def _index_mtime_ns(project_dir: Path) -> int:
    return (project_dir / "index.html").stat().st_mtime_ns


def _ensure(result, tmp_path, config=None, **kwargs) -> Path:
    cfg = config if config is not None else VideoRenderConfig()
    out = ensure_hyperframes_project(result, cfg, str(tmp_path), **kwargs)
    return Path(out)


# --- Cache hit: identical inputs perform NO writes ---

def test_second_call_is_a_cache_hit_no_rewrite(transcription_result, tmp_path):
    project = _ensure(transcription_result, tmp_path)
    before = _index_mtime_ns(project)

    project2 = _ensure(transcription_result, tmp_path)

    assert project2 == project
    # A cache hit must not touch index.html at all.
    assert _index_mtime_ns(project) == before


def test_cache_hit_writes_fingerprint_sidecar(transcription_result, tmp_path):
    project = _ensure(transcription_result, tmp_path)
    sidecar = project / SCAFFOLD_FINGERPRINT_FILE
    assert sidecar.is_file()
    data = hp.read_scaffold_fingerprint(project)
    assert data is not None
    assert data["scaffold_version"] == hp.SCAFFOLD_VERSION
    assert isinstance(data["fingerprint"], str) and data["fingerprint"]


# --- Invalidation: any single input change forces a re-scaffold ---

def test_config_field_change_forces_rescaffold(transcription_result, tmp_path):
    project = _ensure(transcription_result, tmp_path)
    before = _index_mtime_ns(project)

    _ensure(
        transcription_result, tmp_path, config=VideoRenderConfig(font_size=99)
    )

    assert _index_mtime_ns(project) != before


def test_source_touch_forces_rescaffold(transcription_result, tmp_path):
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"\x00\x01\x02")
    project = _ensure(
        transcription_result, tmp_path, source_video_path=str(source)
    )
    before = _index_mtime_ns(project)

    # A larger source file → different stat (size) → re-scaffold.
    source.write_bytes(b"\x00\x01\x02\x03\x04\x05\x06\x07")
    _ensure(transcription_result, tmp_path, source_video_path=str(source))

    assert _index_mtime_ns(project) != before


def test_effects_change_forces_rescaffold(transcription_result, tmp_path):
    project = _ensure(transcription_result, tmp_path)
    before = _index_mtime_ns(project)

    effects = [{
        "type": "logo", "start": 0.0, "duration": 2.0,
        "anchor_x": 0.5, "anchor_y": 0.5, "variables": {},
    }]
    _ensure(transcription_result, tmp_path, effects=effects)

    assert _index_mtime_ns(project) != before


def test_missing_index_html_forces_rescaffold(transcription_result, tmp_path):
    project = _ensure(transcription_result, tmp_path)
    # Valid fingerprint remains, but the composition is gone.
    (project / "index.html").unlink()
    assert hp.read_scaffold_fingerprint(project) is not None

    _ensure(transcription_result, tmp_path)

    assert (project / "index.html").is_file()


def test_scaffold_version_bump_forces_rescaffold(
    transcription_result, tmp_path, monkeypatch
):
    project = _ensure(transcription_result, tmp_path)
    before = _index_mtime_ns(project)
    stored_version = hp.read_scaffold_fingerprint(project)["scaffold_version"]

    # A code change to the HTML generator would bump SCAFFOLD_VERSION; the stored
    # sidecar still carries the old version → forced re-scaffold.
    monkeypatch.setattr(hp, "SCAFFOLD_VERSION", stored_version + 1)
    _ensure(transcription_result, tmp_path)

    assert _index_mtime_ns(project) != before


# --- Fingerprint determinism ---

def test_fingerprint_is_stable_across_calls(transcription_result, tmp_path):
    cfg = VideoRenderConfig()
    groups = hp._build_groups(transcription_result, cfg.words_per_group)
    fp1 = _scaffold_fingerprint(cfg, groups, transcription_result, None)
    fp2 = _scaffold_fingerprint(cfg, groups, transcription_result, None)
    assert fp1 == fp2


def test_fingerprint_differs_on_config_change(transcription_result, tmp_path):
    groups = hp._build_groups(transcription_result, VideoRenderConfig().words_per_group)
    fp_a = _scaffold_fingerprint(
        VideoRenderConfig(), groups, transcription_result, None
    )
    fp_b = _scaffold_fingerprint(
        VideoRenderConfig(font_size=99), groups, transcription_result, None
    )
    assert fp_a != fp_b


def test_fingerprint_differs_on_source_stat(transcription_result, tmp_path):
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"\x00")
    cfg = VideoRenderConfig()
    groups = hp._build_groups(transcription_result, cfg.words_per_group)
    fp_small = _scaffold_fingerprint(cfg, groups, transcription_result, str(source))
    source.write_bytes(b"\x00\x01\x02\x03")
    fp_big = _scaffold_fingerprint(cfg, groups, transcription_result, str(source))
    assert fp_small != fp_big
