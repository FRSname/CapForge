"""Tests for the HyperFrames render runner's output discovery/relocation fallback."""

from pathlib import Path

from backend.exporters.hyperframes_render import _discover_output


def _vid(p: Path) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\x00")
    return p


def test_discovers_file_in_renders_dir(tmp_path):
    proj = tmp_path / "proj"
    produced = _vid(proj / "renders" / "comp_123.mp4")
    assert _discover_output(str(proj), tmp_path / "wanted.mp4", "mp4") == produced


def test_prefers_matching_format_in_renders(tmp_path):
    proj = tmp_path / "proj"
    _vid(proj / "renders" / "comp.mp4")
    webm = _vid(proj / "renders" / "comp.webm")
    assert _discover_output(str(proj), tmp_path / "wanted.webm", "webm") == webm


def test_falls_back_to_project_video_excluding_source(tmp_path):
    proj = tmp_path / "proj"
    _vid(proj / "source.mp4")  # the copied source — must be ignored
    stray = _vid(proj / "sub" / "render-out.mp4")
    assert _discover_output(str(proj), tmp_path / "wanted.mp4", "mp4") == stray


def test_returns_none_when_only_source_present(tmp_path):
    proj = tmp_path / "proj"
    _vid(proj / "source.mp4")
    assert _discover_output(str(proj), tmp_path / "wanted.mp4", "mp4") is None


def test_returns_none_when_nothing(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    assert _discover_output(str(proj), tmp_path / "x.mp4", "mp4") is None
