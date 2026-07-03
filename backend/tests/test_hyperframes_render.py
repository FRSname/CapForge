"""Tests for the HyperFrames render runner's output discovery/relocation fallback
and the fps passthrough to the CLI ``--fps`` flag."""

import subprocess
from pathlib import Path

import pytest

from backend.exporters import hyperframes_render, hyperframes_version
from backend.exporters.hyperframes_render import (
    HyperframesRenderError,
    _discover_output,
    _render_fps,
)


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


# --- fps passthrough -------------------------------------------------------

def test_render_fps_passes_source_rate_through():
    # Case A (CLI v0.7.21): arbitrary integer fps is honored, including 25.
    assert _render_fps(25) == 25
    assert _render_fps(30) == 30
    assert _render_fps(60) == 60
    assert _render_fps(50) == 50


def test_render_fps_clamps_to_cli_range():
    # The CLI accepts 1-240; clamp defends against a stray out-of-range value.
    assert _render_fps(0) == 1
    assert _render_fps(-5) == 1
    assert _render_fps(1000) == 240
    assert _render_fps(24.0) == 24  # coerces float to int


class _FakeProc:
    """Minimal stand-in for a finished `subprocess.Popen` with rc 0 and no output lines."""

    def __init__(self, out_path: str):
        Path(out_path).write_bytes(b"\x00")  # so the runner doesn't raise "no output file"
        self.stdout = iter(())
        self.returncode = 0

    def wait(self):
        return 0


def _patch_cli(monkeypatch, captured: dict):
    monkeypatch.setattr(hyperframes_render, "_hyperframes_cmd", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hyperframes_render, "hyperframes_env", lambda: {})
    # Neutralize the version gate so these tests never shell out to a real CLI
    # probe (offline/CI safe). Compat behavior is covered in its own suite.
    monkeypatch.setattr(
        hyperframes_render,
        "check_cli_compat",
        lambda *a, **k: {"version": "0.7.26", "ok": True, "reasons": []},
    )

    def fake_popen(cmd, **_kwargs):
        captured["cmd"] = cmd
        return _FakeProc(cmd[cmd.index("--output") + 1])

    monkeypatch.setattr(subprocess, "Popen", fake_popen)


def test_render_cmd_includes_requested_fps(tmp_path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    out = tmp_path / "out.mp4"
    captured: dict = {}
    _patch_cli(monkeypatch, captured)

    result = hyperframes_render.render_hyperframes_project(
        str(proj), str(out), quality="draft", video_format="mp4", fps=25,
    )

    cmd = captured["cmd"]
    assert "--fps" in cmd
    assert cmd[cmd.index("--fps") + 1] == "25"
    assert result == str(out)


def test_render_cmd_defaults_fps_to_30(tmp_path, monkeypatch):
    # Existing positional callers that pass no fps keep the prior 30fps behavior.
    proj = tmp_path / "proj"
    proj.mkdir()
    out = tmp_path / "out.mp4"
    captured: dict = {}
    _patch_cli(monkeypatch, captured)

    hyperframes_render.render_hyperframes_project(str(proj), str(out))

    cmd = captured["cmd"]
    assert cmd[cmd.index("--fps") + 1] == "30"


# --- version gate ----------------------------------------------------------

def test_render_refuses_too_old_cli(tmp_path, monkeypatch):
    """An explicitly-detected old CLI blocks the render up front with a clear,
    actionable message — before any subprocess is launched."""
    proj = tmp_path / "proj"
    proj.mkdir()
    # Drive the REAL compat check via a mocked version probe (0.7.20 < MIN 0.7.21).
    hyperframes_version.reset_version_cache()
    monkeypatch.setattr(hyperframes_version, "get_cli_version", lambda *a, **k: "0.7.20")

    with pytest.raises(HyperframesRenderError, match=r"older than 0\.7\.21"):
        hyperframes_render.render_hyperframes_project(str(proj), str(tmp_path / "out.mp4"))


def test_render_proceeds_when_probe_fails(tmp_path, monkeypatch):
    """A failed probe (unknown version) must NOT brick a render — it degrades to
    a warning and runs, so version-gating can never break what worked before."""
    proj = tmp_path / "proj"
    proj.mkdir()
    out = tmp_path / "out.mp4"
    captured: dict = {}
    # Real gate, but the probe returns None (unknown) → compat_ok is None → proceed.
    monkeypatch.setattr(hyperframes_render, "_hyperframes_cmd", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hyperframes_render, "hyperframes_env", lambda: {})
    hyperframes_version.reset_version_cache()
    monkeypatch.setattr(hyperframes_version, "get_cli_version", lambda *a, **k: None)

    def fake_popen(cmd, **_kwargs):
        captured["cmd"] = cmd
        return _FakeProc(cmd[cmd.index("--output") + 1])

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    result = hyperframes_render.render_hyperframes_project(str(proj), str(out))
    assert result == str(out)
    assert "cmd" in captured  # the render actually launched
