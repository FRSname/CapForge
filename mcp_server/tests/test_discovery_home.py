"""``mcp_server.discovery`` honours ``CAPFORGE_HOME`` like the backend does.

The MCP server is a standalone package that cannot import ``backend``, so its
home resolution is a deliberate two-line mirror of
``backend.library.paths.capforge_home``. These tests are what keep the copy
honest: if the backend relocates its discovery file, an MCP client pointed at
the old ``~/.capforge`` finds nothing and reports "CapForge isn't running".
"""

from __future__ import annotations

from pathlib import Path

import pytest

from mcp_server import discovery


def test_discovery_path_follows_capforge_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path / "home"))
    assert discovery.discovery_path() == tmp_path / "home" / "backend.json"


def test_discovery_path_defaults_to_dot_capforge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CAPFORGE_HOME", raising=False)
    assert discovery.discovery_path() == Path.home() / ".capforge" / "backend.json"


def test_capforge_home_expands_a_tilde(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAPFORGE_HOME", "~/relocated-capforge")
    assert discovery.discovery_path() == Path.home() / "relocated-capforge" / "backend.json"


def test_read_discovery_reads_the_overridden_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / "backend.json").write_text('{"port": 5555, "token": "t", "pid": 1}', encoding="utf-8")
    monkeypatch.setenv("CAPFORGE_HOME", str(home))
    assert discovery.read_discovery()["port"] == 5555
