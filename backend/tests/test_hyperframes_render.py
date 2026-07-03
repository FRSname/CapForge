"""Tests for the HyperFrames render runner's output discovery/relocation fallback,
the fps passthrough to the CLI ``--fps`` flag, and the Phase 2 hardening lifecycle
(error taxonomy, timeout budgets, cancellation, partial-file hygiene, and the
export endpoint's error envelope)."""

import subprocess
import sys
import threading
from pathlib import Path

import pytest

from backend.exporters import hyperframes_render, hyperframes_version
from backend.exporters.hyperframes_render import (
    HyperframesCancelledError,
    HyperframesRenderError,
    HyperframesTimeoutError,
    HyperframesUnavailableError,
    HyperframesVersionError,
    _discover_output,
    _env_timeout,
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


# --- error taxonomy -------------------------------------------------------


def test_error_subclasses_expose_codes_and_are_render_errors():
    """Every variant carries the right machine-readable ``code`` and stays a
    subclass of the base so existing ``except HyperframesRenderError`` handlers
    keep catching all of them."""
    assert HyperframesRenderError.code == "render_failed"
    cases = [
        (HyperframesUnavailableError, "cli_unavailable"),
        (HyperframesVersionError, "cli_incompatible"),
        (HyperframesTimeoutError, "timeout"),
        (HyperframesCancelledError, "cancelled"),
    ]
    for cls, code in cases:
        assert cls.code == code
        assert issubclass(cls, HyperframesRenderError)
        # Instances surface the same code and are catchable as the base type.
        exc = cls("boom")
        assert exc.code == code
        assert isinstance(exc, HyperframesRenderError)


def test_error_classes_with_a_remedy_have_a_non_empty_one():
    """The plan gives an actionable remedy to the unavailable/version/timeout
    variants; the base carries none by default."""
    assert HyperframesRenderError.remedy == ""
    for cls in (HyperframesUnavailableError, HyperframesVersionError, HyperframesTimeoutError):
        assert isinstance(cls.remedy, str) and cls.remedy.strip()
        assert cls("x").remedy.strip()


def test_error_carries_optional_detail_and_remedy_override():
    exc = HyperframesRenderError("failed", detail="stderr tail", remedy="do the thing")
    assert exc.detail == "stderr tail"
    assert exc.remedy == "do the thing"
    # detail defaults to empty when omitted.
    assert HyperframesRenderError("x").detail == ""


# --- _env_timeout parsing -------------------------------------------------


def test_env_timeout_reads_valid_integer(monkeypatch):
    monkeypatch.setenv("CAPFORGE_TEST_TIMEOUT", "45")
    assert _env_timeout("CAPFORGE_TEST_TIMEOUT", 120) == 45


def test_env_timeout_defaults_when_missing(monkeypatch):
    monkeypatch.delenv("CAPFORGE_TEST_TIMEOUT", raising=False)
    assert _env_timeout("CAPFORGE_TEST_TIMEOUT", 120) == 120


@pytest.mark.parametrize("raw", ["abc", "", "12.5", "  ", "1e3"])
def test_env_timeout_defaults_on_garbage(monkeypatch, raw):
    monkeypatch.setenv("CAPFORGE_TEST_TIMEOUT", raw)
    assert _env_timeout("CAPFORGE_TEST_TIMEOUT", 99) == 99


@pytest.mark.parametrize("raw", ["0", "-5"])
def test_env_timeout_defaults_on_non_positive(monkeypatch, raw):
    monkeypatch.setenv("CAPFORGE_TEST_TIMEOUT", raw)
    assert _env_timeout("CAPFORGE_TEST_TIMEOUT", 77) == 77


# --- timeout path ---------------------------------------------------------


def _patch_gate_only(monkeypatch):
    """Neutralize the version gate + env but leave the REAL subprocess layer so a
    tiny wall-clock budget can actually reap a live process tree."""
    monkeypatch.setattr(hyperframes_render, "hyperframes_env", lambda: {})
    monkeypatch.setattr(
        hyperframes_render,
        "check_cli_compat",
        lambda *a, **k: {"version": "0.7.26", "ok": True, "reasons": []},
    )


def _sleeper_cmd() -> list[str]:
    # A real child that never exits within a sub-second budget. Extra CLI args the
    # runner appends (render/--output/…) land in sys.argv and are ignored.
    return [sys.executable, "-c", "import time; time.sleep(30)"]


def test_render_raises_timeout_and_reaps_process(tmp_path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    out = tmp_path / "out.mp4"
    _patch_gate_only(monkeypatch)
    monkeypatch.setattr(hyperframes_render, "_hyperframes_cmd", _sleeper_cmd)
    monkeypatch.setattr(hyperframes_render, "RENDER_TIMEOUT_S", 0.5)

    with pytest.raises(HyperframesTimeoutError):
        hyperframes_render.render_hyperframes_project(str(proj), str(out))

    # Timeout removed the staged partial and left no final file behind.
    assert not out.exists()
    assert not list(tmp_path.glob("out.partial.*"))


def test_snapshot_raises_timeout_and_reaps_process(tmp_path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    _patch_gate_only(monkeypatch)
    monkeypatch.setattr(hyperframes_render, "_hyperframes_cmd", _sleeper_cmd)
    monkeypatch.setattr(hyperframes_render, "SNAPSHOT_TIMEOUT_S", 0.5)

    with pytest.raises(HyperframesTimeoutError):
        hyperframes_render.snapshot_hyperframes_project(str(proj), 1.0)


# --- cancel kills + cleans the partial ------------------------------------


class _BlockingProc:
    """Controllable stand-in for a long-running CLI Popen.

    ``poll()`` stays ``None`` until ``kill()`` (so the runner treats it as live and
    reaches the cancel branch), and it creates a real ``.partial`` file on disk up
    front so the test can assert the runner cleans it up on cancel. Its ``stdout``
    iterator blocks until killed, mirroring a silent (startup-phase) CLI.
    """

    def __init__(self, out_path: str):
        Path(out_path).write_bytes(b"\x00")  # a real partial the runner must remove
        self.pid = -1  # os.getpgid(-1) → error → _kill_process_tree falls back to .kill()
        self.returncode = None
        self._done = threading.Event()

        proc = self

        class _BlockingStdout:
            def __iter__(self):
                return self

            def __next__(self):
                proc._done.wait()  # unblocks only once the proc is killed
                raise StopIteration

        self.stdout = _BlockingStdout()

    def poll(self):
        return self.returncode

    def kill(self):
        self.returncode = -9
        self._done.set()

    def wait(self, timeout=None):
        self._done.set()
        self.returncode = self.returncode if self.returncode is not None else -9
        return self.returncode


def test_render_cancel_kills_and_removes_partial(tmp_path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    out = tmp_path / "out.mp4"
    partial = tmp_path / "out.partial.mp4"

    monkeypatch.setattr(hyperframes_render, "_hyperframes_cmd", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hyperframes_render, "hyperframes_env", lambda: {})
    monkeypatch.setattr(
        hyperframes_render,
        "check_cli_compat",
        lambda *a, **k: {"version": "0.7.26", "ok": True, "reasons": []},
    )
    monkeypatch.setattr(
        subprocess, "Popen", lambda cmd, **_k: _BlockingProc(cmd[cmd.index("--output") + 1])
    )

    cancel_event = threading.Event()
    # Fire the cancel shortly after the runner enters its poll loop.
    timer = threading.Timer(0.2, cancel_event.set)
    timer.start()
    try:
        with pytest.raises(HyperframesCancelledError):
            hyperframes_render.render_hyperframes_project(
                str(proj), str(out), cancel_event=cancel_event
            )
    finally:
        timer.cancel()

    # The staged partial (created by the fake CLI) is cleaned up; no final leaks.
    assert not partial.exists()
    assert not out.exists()
    assert not list(tmp_path.glob("out.partial.*"))


# --- success leaves exactly the final file --------------------------------


def test_render_success_leaves_only_final_file(tmp_path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    out = tmp_path / "out.mp4"
    captured: dict = {}
    _patch_cli(monkeypatch, captured)

    result = hyperframes_render.render_hyperframes_project(str(proj), str(out))

    assert result == str(out)
    assert out.exists()  # atomically published
    assert not list(tmp_path.glob("out.partial.*"))  # no half-written sibling remains


# --- export endpoint error envelope --------------------------------------
#
# Self-sufficient whisperx stub so importing backend.main works in isolation
# (the dev venv has no whisperx). Mirrors test_realign.py's approach.

def _install_fake_whisperx():
    import types

    fake = sys.modules.get("whisperx")
    if fake is None:
        fake = types.ModuleType("whisperx")
        sys.modules["whisperx"] = fake
    fake.load_audio = lambda path, sr=16000: "AUDIO"
    fake.load_align_model = lambda language_code, device, **kw: (f"M:{language_code}", {})
    fake.align = lambda *a, **kw: {"segments": []}
    return fake


_install_fake_whisperx()


@pytest.fixture
def hf_client():
    from fastapi.testclient import TestClient

    import backend.main as main_module

    # No context manager: skip startup/shutdown (agent discovery file IO).
    return TestClient(main_module.app), main_module


def _loaded_result(main_module, audio_path: str):
    from backend.models.schemas import Segment, TranscriptionResult, WordSegment

    return TranscriptionResult(
        segments=[
            Segment(
                start=0.0, end=1.0, text="hi",
                words=[WordSegment(word="hi", start=0.0, end=1.0)],
            )
        ],
        language="en",
        audio_path=audio_path,
    )


def _stub_scaffold_and_render(main_module, monkeypatch, exc):
    """Skip the heavy composition scaffold and make the render raise ``exc``."""
    monkeypatch.setattr(main_module, "export_hyperframes_project", lambda *a, **k: "proj-dir")

    def _raise(*_a, **_k):
        raise exc

    monkeypatch.setattr(main_module, "render_hyperframes_project", _raise)


def test_export_endpoint_returns_code_on_render_error(hf_client, tmp_path, monkeypatch):
    tc, main_module = hf_client
    audio = tmp_path / "clip.wav"
    audio.write_bytes(b"\x00" * 32)
    monkeypatch.setattr(main_module, "current_result", _loaded_result(main_module, str(audio)))
    _stub_scaffold_and_render(
        main_module, monkeypatch, HyperframesUnavailableError("no cli")
    )

    resp = tc.post("/api/export-hyperframes", json={"render": True, "use_ui_config": False})

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["code"] == "cli_unavailable"
    assert detail["remedy"].strip()  # actionable remedy rides along


def test_export_endpoint_returns_cancelled_envelope(hf_client, tmp_path, monkeypatch):
    tc, main_module = hf_client
    audio = tmp_path / "clip.wav"
    audio.write_bytes(b"\x00" * 32)
    monkeypatch.setattr(main_module, "current_result", _loaded_result(main_module, str(audio)))
    _stub_scaffold_and_render(
        main_module, monkeypatch, HyperframesCancelledError("stopped")
    )

    resp = tc.post("/api/export-hyperframes", json={"render": True, "use_ui_config": False})

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["code"] == "cancelled"
