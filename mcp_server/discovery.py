"""Locate and authenticate against a running CapForge backend.

The backend writes ``$CAPFORGE_HOME/backend.json`` (default ``~/.capforge``) on
startup (see
``backend/agent_bridge.py``). We read it here to get the port + token. If the
file is missing the app almost certainly isn't running, so we fail with an
actionable message rather than a bare KeyError.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

CAPFORGE_HOME_ENV = "CAPFORGE_HOME"


class BackendNotFound(RuntimeError):
    """Raised when the discovery file is missing or malformed."""


def capforge_home() -> Path:
    """``$CAPFORGE_HOME`` or ``~/.capforge``.

    Deliberate two-line mirror of ``backend.library.paths.capforge_home`` — this
    package ships standalone (an MCP client runs it without CapForge's backend on
    the path), so it cannot import ``backend``. Keep the two in step: if they
    disagree, the agent looks for the discovery file where the backend never
    wrote it. Pinned by ``mcp_server/tests/test_discovery_home.py``.
    """
    raw = os.environ.get(CAPFORGE_HOME_ENV)
    return Path(raw).expanduser() if raw else Path.home() / ".capforge"


def discovery_path() -> Path:
    return capforge_home() / "backend.json"


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
