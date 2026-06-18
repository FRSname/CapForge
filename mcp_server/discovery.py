"""Locate and authenticate against a running CapForge backend.

The backend writes ``~/.capforge/backend.json`` on startup (see
``backend/agent_bridge.py``). We read it here to get the port + token. If the
file is missing the app almost certainly isn't running, so we fail with an
actionable message rather than a bare KeyError.
"""

from __future__ import annotations

import json
from pathlib import Path


class BackendNotFound(RuntimeError):
    """Raised when the discovery file is missing or malformed."""


def discovery_path() -> Path:
    return Path.home() / ".capforge" / "backend.json"


def read_discovery() -> dict:
    """Return {"port": int, "token": str, "pid": int}.

    Raises BackendNotFound with guidance if CapForge isn't running.
    """
    path = discovery_path()
    if not path.is_file():
        raise BackendNotFound(
            f"CapForge backend discovery file not found at {path}. "
            "Open the CapForge app first — the agent drives the running app."
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BackendNotFound(f"Could not read {path}: {exc}") from exc

    if "port" not in data or "token" not in data:
        raise BackendNotFound(f"Discovery file {path} is missing port/token.")
    return data
