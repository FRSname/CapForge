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

    Prefers the app-managed install (``CAPFORGE_HYPERFRAMES_BIN`` — a pinned,
    offline ``hyperframes`` bin) so renders don't hit the npm registry. Falls
    back to ``npx -y hyperframes`` (dev / system Node). ``None`` when neither
    Node nor a managed CLI is available.

    Call sites append the subcommand, e.g. ``[*hyperframes_argv(), "render", …]``.
    """
    managed = os.environ.get("CAPFORGE_HYPERFRAMES_BIN")
    if managed and Path(managed).exists():
        return [managed]
    npx = find_npx()
    if npx:
        return [npx, "-y", "hyperframes"]
    return None
