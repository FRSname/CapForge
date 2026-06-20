"""Resolve the Node.js `npx` used to drive the HyperFrames CLI.

HyperFrames (`npx hyperframes …`) needs Node.js 22+. The Electron shell injects
``CAPFORGE_NPX`` when it has provisioned an app-managed Node runtime; otherwise we
fall back to a system ``npx`` on PATH. Centralised here so every HyperFrames call
site resolves it identically — env-managed first, PATH second.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


def find_npx() -> str | None:
    """Path to ``npx``, preferring the app-managed Node runtime.

    Order: ``CAPFORGE_NPX`` (set by Electron when a bundled Node 22+ exists) →
    a system ``npx`` on PATH → ``None`` when neither is available.
    """
    managed = os.environ.get("CAPFORGE_NPX")
    if managed and Path(managed).exists():
        return managed
    return shutil.which("npx")


def hyperframes_argv() -> list[str] | None:
    """The argv *prefix* for invoking the HyperFrames CLI.

    Prefers the app-managed install, invoked as ``[node, cli.js]`` via
    ``CAPFORGE_NODE_BIN`` + ``CAPFORGE_HYPERFRAMES_CLI`` — a pinned, offline CLI
    that never touches the npm registry and, crucially, avoids the ``.cmd`` shim
    (Windows ``subprocess`` can't run a ``.cmd`` without a shell). Falls back to
    ``npx -y hyperframes`` (dev / system Node). ``None`` when no Node is available.

    Call sites append the subcommand, e.g. ``[*hyperframes_argv(), "render", …]``.
    """
    node = os.environ.get("CAPFORGE_NODE_BIN")
    cli = os.environ.get("CAPFORGE_HYPERFRAMES_CLI")
    if node and cli and Path(node).exists() and Path(cli).exists():
        return [node, cli]
    npx = find_npx()
    if npx:
        return [npx, "-y", "hyperframes"]
    return None
