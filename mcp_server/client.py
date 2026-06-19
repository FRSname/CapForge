"""Thin HTTP client for the CapForge backend, mirroring the renderer's api.ts.

Reads the discovery file lazily on first use so the MCP server can start before
CapForge is open; the first tool call then surfaces a clear BackendNotFound.
"""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

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

    def _request(
        self, method: str, path: str, *, json: Any = None,
        timeout: Any = _SHORT_TIMEOUT, _retry: bool = True,
    ) -> Any:
        # The MCP server is long-lived, but CapForge may restart under it with a
        # new port and/or token. On a connection failure or 401 we drop the
        # cached connection, re-read the discovery file, and retry once.
        self._ensure()
        try:
            res = httpx.request(method, f"{self._base}{path}", json=json,
                                headers=self._headers(), timeout=timeout)
        except httpx.ConnectError as exc:
            self.reset()
            if _retry:
                return self._request(method, path, json=json, timeout=timeout, _retry=False)
            raise BackendNotFound(
                "Could not reach the CapForge backend. Is the app still open?"
            ) from exc
        if res.status_code == 401 and _retry:
            self.reset()
            return self._request(method, path, json=json, timeout=timeout, _retry=False)
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

    def check_layout(self, t: float, platform: str = "off") -> Any:
        return self._request("POST", "/api/agent/check-layout", json={"t": t, "platform": platform})

    def get_effects(self) -> Any:
        return self._request("GET", "/api/agent/effects")

    def add_effect(self, effect: dict) -> Any:
        return self._request("POST", "/api/agent/effects", json=effect)

    def remove_effect(self, effect_id: str) -> Any:
        return self._request("DELETE", f"/api/agent/effects/{quote(effect_id)}")

    def find_moments(self, query: str) -> Any:
        return self._request("GET", f"/api/agent/find-moments?query={quote(query)}")

    def find_semantic_moments(self, kind: str) -> Any:
        return self._request("GET", f"/api/agent/find-semantic-moments?kind={quote(kind)}")

    def render_hyperframes(self, payload: dict) -> Any:
        # Headless-Chrome capture can take a while.
        return self._request("POST", "/api/export-hyperframes", json=payload, timeout=_LONG_TIMEOUT)

    def get_frame(self, t: float, composite: bool = True, _retry: bool = True) -> bytes:
        """Render a QA frame and return raw PNG bytes (not JSON)."""
        self._ensure()
        try:
            res = httpx.post(
                f"{self._base}/api/render-frame",
                json={"t": t, "composite": composite},
                headers=self._headers(),
                timeout=_LONG_TIMEOUT,
            )
        except httpx.ConnectError as exc:
            self.reset()
            if _retry:
                return self.get_frame(t, composite, _retry=False)
            raise BackendNotFound("Could not reach the CapForge backend. Is the app still open?") from exc
        if res.status_code == 401 and _retry:
            self.reset()
            return self.get_frame(t, composite, _retry=False)
        res.raise_for_status()
        return res.content
