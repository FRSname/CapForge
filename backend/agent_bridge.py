"""Agent control-layer bridge: discovery file + per-session token auth.

The MCP control layer (a local Claude agent) needs two things to drive a running
CapForge instance:

1. **Where** the backend is — Electron picks a free port at launch and only hands
   it to the renderer over IPC, so an external process has no way to find it. On
   startup we write a small JSON discovery file to a well-known path that the MCP
   server reads.
2. **Permission** to mutate state — the discovery file also carries a per-session
   token. Agent-only endpoints (`/api/agent/*`) require it via the
   ``X-CapForge-Agent-Token`` header. The Electron renderer is unaffected: it keeps
   using the existing tokenless REST endpoints.

The token defaults to a fresh random value each launch; Electron may pin it via
``CAPFORGE_AGENT_TOKEN`` if it ever needs to share it with the renderer.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

#: Header the MCP server sends; FastAPI maps it from the ``x_capforge_agent_token`` param.
AGENT_TOKEN_HEADER = "X-CapForge-Agent-Token"

DEFAULT_PORT = 53421


def discovery_path() -> Path:
    """Well-known location both the backend and the MCP server agree on."""
    return Path.home() / ".capforge" / "backend.json"


def token_file_path() -> Path:
    return discovery_path().parent / "agent-token"


def resolve_token() -> str:
    """Resolve the agent token, stable across restarts.

    Priority: ``CAPFORGE_AGENT_TOKEN`` env → persisted token file → freshly
    minted (and persisted). Stability matters because the MCP server is a
    long-lived process that caches the token; regenerating it every launch would
    401 the agent after a CapForge restart.
    """
    env = os.environ.get("CAPFORGE_AGENT_TOKEN")
    if env:
        return env

    path = token_file_path()
    try:
        if path.is_file():
            existing = path.read_text(encoding="utf-8").strip()
            if existing:
                return existing
    except OSError:
        pass

    token = secrets.token_urlsafe(32)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except OSError:
        pass  # in-memory only this run; the client's 401 retry still recovers
    return token


def resolve_local_token() -> str:
    """Resolve the per-launch *local* token that gates the media endpoints
    (``/api/serve-audio`` and ``/api/video-info``).

    Priority: ``CAPFORGE_LOCAL_TOKEN`` env (set by the Electron launcher, which
    mints a fresh random value per spawn and hands it to the renderer over IPC) →
    a freshly minted in-memory value for standalone dev.

    Unlike ``resolve_token`` this is intentionally **NOT persisted**: the renderer
    receives it in-process each launch, so a brand-new secret per run is strictly
    safer — nothing on disk to leak and no cross-launch reuse. In standalone dev
    (no Electron) the self-minted token simply isn't shared with any client, which
    is fine since there is no renderer to authenticate.
    """
    env = os.environ.get("CAPFORGE_LOCAL_TOKEN")
    if env:
        return env
    return secrets.token_urlsafe(32)


def resolve_port() -> int:
    """The port the backend is actually bound to.

    Electron passes ``CAPFORGE_PORT`` (the free port it chose) when it spawns
    uvicorn; in standalone dev we fall back to the preferred port.
    """
    raw = os.environ.get("CAPFORGE_PORT")
    if raw:
        try:
            return int(raw)
        except ValueError:
            logger.warning("Ignoring non-integer CAPFORGE_PORT=%r", raw)
    return DEFAULT_PORT


def write_discovery(port: int, token: str) -> Path:
    """Atomically write the discovery file with owner-only permissions."""
    path = discovery_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"port": port, "token": token, "pid": os.getpid()}
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass  # best-effort on platforms without POSIX perms
    tmp.replace(path)
    return path


def remove_discovery() -> None:
    """Remove the discovery file on shutdown (best-effort)."""
    try:
        discovery_path().unlink()
    except OSError:
        pass


def token_matches(provided: Optional[str], expected: str) -> bool:
    """Constant-time token comparison; missing token never matches."""
    if not provided:
        return False
    return hmac.compare_digest(provided, expected)
