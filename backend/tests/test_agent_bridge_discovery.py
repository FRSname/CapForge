"""Discovery + token files follow ``CAPFORGE_HOME``.

Decision D5: ``backend.library.paths.capforge_home()`` is the ONE reader of the
env var, so relocating the data home in one place must move the discovery file
and the agent token with it — otherwise a test (or a second instance) writes
``backend.json`` into the developer's real ``~/.capforge`` and hijacks whichever
MCP client is listening.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend import agent_bridge


def test_discovery_path_follows_capforge_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path / "home"))
    assert agent_bridge.discovery_path() == tmp_path / "home" / "backend.json"


def test_token_file_sits_beside_the_discovery_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path / "home"))
    assert agent_bridge.token_file_path() == tmp_path / "home" / "agent-token"


def test_discovery_path_defaults_to_dot_capforge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CAPFORGE_HOME", raising=False)
    assert agent_bridge.discovery_path() == Path.home() / ".capforge" / "backend.json"
    assert agent_bridge.token_file_path() == Path.home() / ".capforge" / "agent-token"


def test_capforge_home_expands_a_tilde(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAPFORGE_HOME", "~/relocated-capforge")
    assert agent_bridge.discovery_path() == Path.home() / "relocated-capforge" / "backend.json"


def test_write_and_remove_discovery_stay_inside_the_overridden_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("CAPFORGE_HOME", str(home))
    path = agent_bridge.write_discovery(1234, "tok")
    assert path == home / "backend.json"
    assert json.loads(path.read_text(encoding="utf-8"))["port"] == 1234
    agent_bridge.remove_discovery()
    assert not path.exists()


def test_resolve_token_persists_under_the_overridden_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("CAPFORGE_AGENT_TOKEN", raising=False)
    home = tmp_path / "home"
    monkeypatch.setenv("CAPFORGE_HOME", str(home))
    token = agent_bridge.resolve_token()
    assert (home / "agent-token").read_text(encoding="utf-8") == token
    assert agent_bridge.resolve_token() == token  # stable across restarts
