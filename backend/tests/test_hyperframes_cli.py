"""Allowlist + plumbing for the co-author HyperFrames CLI runner.

The allowlist is a security boundary (an agent could otherwise run `init`,
`publish`, `auth`, …), so it's enforced before anything launches — which also
means the rejection path is testable without Node installed."""

from __future__ import annotations

import subprocess
from types import SimpleNamespace

import pytest

from backend.exporters import hyperframes_render as hr


@pytest.mark.parametrize("args", [["init"], ["render"], ["publish"], ["auth"],
                                   ["snapshot"], ["tts"], []])
def test_disallowed_subcommands_rejected(args):
    with pytest.raises(hr.HyperframesRenderError):
        hr.run_hyperframes_cli("/tmp/proj", args)


@pytest.mark.parametrize("args", [
    ["lint", "--config", "/etc/passwd"],   # flag with an arbitrary path value
    ["inspect", "--output", "/tmp/exfil"],  # write redirection
    ["docs", "--open"],                      # browser-open vector
    ["lint", "../escape"],                   # path-ish positional
])
def test_flag_injection_rejected(args):
    with pytest.raises(hr.HyperframesRenderError):
        hr.run_hyperframes_cli("/tmp/proj", args)


def test_safe_flags_and_numeric_args_allowed(monkeypatch):
    monkeypatch.setattr(hr, "_hyperframes_cmd", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hr, "hyperframes_env", lambda: {})
    monkeypatch.setattr(
        hr.subprocess, "run",
        lambda cmd, **kw: SimpleNamespace(returncode=0, stdout="ok", stderr=""),
    )
    # `inspect --at 2` and `lint --json` are legitimate dev-loop calls.
    assert hr.run_hyperframes_cli("/tmp/proj", ["inspect", "--at", "2"])["ok"]
    assert hr.run_hyperframes_cli("/tmp/proj", ["lint", "--json"])["ok"]


def test_allowlisted_subcommand_runs(monkeypatch):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["cwd"] = kwargs.get("cwd")
        captured["env"] = kwargs.get("env")
        return SimpleNamespace(returncode=0, stdout="lint ok", stderr="")

    monkeypatch.setattr(hr, "_hyperframes_cmd", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hr, "hyperframes_env", lambda: {"FFMPEG_PATH": "/x/ffmpeg"})
    monkeypatch.setattr(hr.subprocess, "run", fake_run)

    res = hr.run_hyperframes_cli("/tmp/proj", ["lint", "--json"])

    assert res == {
        "ok": True, "exit_code": 0, "stdout": "lint ok", "stderr": "",
        "command": "hyperframes lint --json",
    }
    assert captured["cmd"] == ["node", "cli.js", "lint", "--json"]
    assert captured["cwd"] == "/tmp/proj"
    assert captured["env"] == {"FFMPEG_PATH": "/x/ffmpeg"}


def test_nonzero_exit_reports_not_ok(monkeypatch):
    monkeypatch.setattr(hr, "_hyperframes_cmd", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hr, "hyperframes_env", lambda: {})
    monkeypatch.setattr(
        hr.subprocess, "run",
        lambda cmd, **kw: SimpleNamespace(returncode=2, stdout="", stderr="boom"),
    )
    res = hr.run_hyperframes_cli("/tmp/proj", ["inspect"])
    assert res["ok"] is False and res["exit_code"] == 2 and res["stderr"] == "boom"


def test_timeout_raises(monkeypatch):
    monkeypatch.setattr(hr, "_hyperframes_cmd", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hr, "hyperframes_env", lambda: {})

    def boom(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, kw.get("timeout", 1))

    monkeypatch.setattr(hr.subprocess, "run", boom)
    with pytest.raises(hr.HyperframesRenderError):
        hr.run_hyperframes_cli("/tmp/proj", ["lint"])
