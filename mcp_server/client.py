"""Thin HTTP client for the CapForge backend, mirroring the renderer's api.ts.

Reads the discovery file lazily on first use so the MCP server can start before
CapForge is open; the first tool call then surfaces a clear BackendNotFound.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from .discovery import BackendNotFound, read_discovery

#: Header the backend's require_agent_token dependency checks.
AGENT_TOKEN_HEADER = "X-CapForge-Agent-Token"

#: transcription/render can take minutes; reads are quick.
_LONG_TIMEOUT = httpx.Timeout(None)
_SHORT_TIMEOUT = httpx.Timeout(30.0)


class CapForgeClient:
    """Talks to the running backend over loopback HTTP with the agent token."""

    def __init__(self) -> None:
        self._base: Optional[str] = None
        self._token: Optional[str] = None

    # -- connection -------------------------------------------------------
    def _ensure(self) -> None:
        if self._base is not None:
            return
        info = read_discovery()
        self._base = f"http://127.0.0.1:{info['port']}"
        self._token = info["token"]

    def _headers(self) -> dict[str, str]:
        return {AGENT_TOKEN_HEADER: self._token or ""}

    def reset(self) -> None:
        """Forget cached connection — next call re-reads the discovery file."""
        self._base = None
        self._token = None

    def _request(self, method: str, path: str, *, json: Any = None, timeout: Any = _SHORT_TIMEOUT) -> Any:
        self._ensure()
        try:
            res = httpx.request(method, f"{self._base}{path}", json=json,
                                headers=self._headers(), timeout=timeout)
        except httpx.ConnectError as exc:
            # Stale discovery file (app closed/restarted) — clear and explain.
            self.reset()
            raise BackendNotFound(
                "Could not reach the CapForge backend. Is the app still open?"
            ) from exc
        res.raise_for_status()
        return res.json() if res.content else {}

    # -- endpoints --------------------------------------------------------
    def get_status(self) -> Any:
        return self._request("GET", "/api/status")

    def get_result(self) -> Any:
        return self._request("GET", "/api/agent/result")

    def put_result(self, result: dict) -> Any:
        return self._request("PUT", "/api/agent/result", json=result)

    def transcribe(self, payload: dict) -> Any:
        # Blocks until the job finishes on the server (possibly minutes).
        return self._request("POST", "/api/transcribe", json=payload, timeout=_LONG_TIMEOUT)

    def export(self, payload: dict) -> Any:
        return self._request("POST", "/api/export", json=payload)

    def get_ui_state(self) -> Any:
        return self._request("GET", "/api/agent/ui-state")

    def send_command(self, op: str, payload: dict) -> Any:
        return self._request("POST", "/api/agent/command", json={"op": op, "payload": payload})
