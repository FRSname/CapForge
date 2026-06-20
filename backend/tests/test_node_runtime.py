"""Unit tests for npx resolution (managed Node runtime vs system PATH)."""

from __future__ import annotations

from pathlib import Path

from backend.exporters import node_runtime


def test_prefers_managed_npx_when_set_and_present(monkeypatch, tmp_path) -> None:
    managed = tmp_path / "npx"
    managed.write_text("#!/bin/sh\n")
    monkeypatch.setenv("CAPFORGE_NPX", str(managed))
    # Even if a system npx exists, the managed one wins.
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: "/usr/bin/npx")
    assert node_runtime.find_npx() == str(managed)


def test_ignores_managed_npx_when_path_missing(monkeypatch, tmp_path) -> None:
    """A stale CAPFORGE_NPX (e.g. runtime nuked) must not be returned."""
    monkeypatch.setenv("CAPFORGE_NPX", str(tmp_path / "gone" / "npx"))
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: "/usr/bin/npx")
    assert node_runtime.find_npx() == "/usr/bin/npx"


def test_falls_back_to_system_path_when_unset(monkeypatch) -> None:
    monkeypatch.delenv("CAPFORGE_NPX", raising=False)
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: "/usr/bin/npx")
    assert node_runtime.find_npx() == "/usr/bin/npx"


def test_returns_none_when_no_npx_anywhere(monkeypatch) -> None:
    monkeypatch.delenv("CAPFORGE_NPX", raising=False)
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: None)
    assert node_runtime.find_npx() is None


# --- hyperframes_argv ------------------------------------------------------

def test_argv_prefers_managed_node_cli_when_present(monkeypatch, tmp_path) -> None:
    node = tmp_path / "node"
    node.write_text("#!/bin/sh\n")
    cli = tmp_path / "cli.js"
    cli.write_text("// cli\n")
    monkeypatch.setenv("CAPFORGE_NODE_BIN", str(node))
    monkeypatch.setenv("CAPFORGE_HYPERFRAMES_CLI", str(cli))
    # Even if a system npx exists, the managed [node, cli.js] wins (no .cmd shim).
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: "/usr/bin/npx")
    assert node_runtime.hyperframes_argv() == [str(node), str(cli)]


def test_argv_falls_back_to_npx_when_managed_cli_missing(monkeypatch, tmp_path) -> None:
    node = tmp_path / "node"
    node.write_text("#!/bin/sh\n")
    monkeypatch.setenv("CAPFORGE_NODE_BIN", str(node))
    monkeypatch.setenv("CAPFORGE_HYPERFRAMES_CLI", str(tmp_path / "gone.js"))  # missing
    monkeypatch.delenv("CAPFORGE_NPX", raising=False)
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: "/usr/bin/npx")
    assert node_runtime.hyperframes_argv() == ["/usr/bin/npx", "-y", "hyperframes"]


def test_argv_none_when_no_node_at_all(monkeypatch) -> None:
    monkeypatch.delenv("CAPFORGE_NODE_BIN", raising=False)
    monkeypatch.delenv("CAPFORGE_HYPERFRAMES_CLI", raising=False)
    monkeypatch.delenv("CAPFORGE_NPX", raising=False)
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: None)
    assert node_runtime.hyperframes_argv() is None
