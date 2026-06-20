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
