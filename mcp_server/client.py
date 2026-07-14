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

    def get_hyperframes_status(self) -> Any:
        return self._request("GET", "/api/hyperframes/status")

    def get_result(self, words: bool = True) -> Any:
        # Bare path when words=True keeps existing callers byte-identical; the
        # segments-only path drops per-word timing to fit the LLM token budget.
        path = "/api/agent/result" if words else "/api/agent/result?include_words=false"
        return self._request("GET", path)

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

    def find_moments(self, query: str) -> Any:
        return self._request("GET", f"/api/agent/find-moments?query={quote(query)}")

    def find_semantic_moments(self, kind: str) -> Any:
        return self._request("GET", f"/api/agent/find-semantic-moments?kind={quote(kind)}")

    def render_hyperframes(self, payload: dict) -> Any:
        # Headless-Chrome capture can take a while.
        return self._request("POST", "/api/export-hyperframes", json=payload, timeout=_LONG_TIMEOUT)

    def list_caption_styles(self) -> Any:
        return self._request("GET", "/api/caption-styles")

    def set_custom_caption(self, html: str) -> Any:
        return self._request("POST", "/api/agent/custom-caption", json={"html": html})

    def get_custom_caption(self) -> Any:
        return self._request("GET", "/api/agent/custom-caption")

    def get_custom_caption_contract(self) -> Any:
        return self._request("GET", "/api/custom-caption-contract")

    # -- co-author workspace ---------------------------------------------
    def get_workspace(self) -> Any:
        return self._request("GET", "/api/agent/workspace")

    def read_workspace_file(self, path: str) -> Any:
        return self._request("GET", f"/api/agent/workspace/file?path={quote(path)}")

    def write_workspace_file(self, path: str, content: str) -> Any:
        return self._request(
            "PUT", "/api/agent/workspace/file", json={"path": path, "content": content}
        )

    def import_into_workspace(self, src: str, dest_subdir: str = "compositions") -> Any:
        return self._request(
            "POST", "/api/agent/workspace/import",
            json={"src": src, "dest_subdir": dest_subdir},
        )

    def run_hyperframes_cli(self, args: list) -> Any:
        # lint/inspect can take a few seconds on a heavy project.
        return self._request(
            "POST", "/api/agent/hyperframes-cli", json={"args": args}, timeout=_LONG_TIMEOUT
        )

    def get_coauthor(self) -> Any:
        return self._request("GET", "/api/agent/coauthor")

    def set_coauthor(self, enable: bool) -> Any:
        # Entering seeds a starter project (scaffold) — can take a moment.
        return self._request(
            "POST", "/api/agent/coauthor", json={"enable": enable}, timeout=_LONG_TIMEOUT
        )

    def sync_captions(self) -> Any:
        return self._request("POST", "/api/agent/coauthor/sync-captions", timeout=_LONG_TIMEOUT)

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

    def preview_hyperframes_frame(self, t: float, _retry: bool = True) -> bytes:
        """Snapshot one HyperFrames frame at `t`; return raw PNG bytes (not JSON)."""
        self._ensure()
        try:
            res = httpx.post(
                f"{self._base}/api/agent/preview-hyperframes-frame",
                json={"t": t},
                headers=self._headers(),
                timeout=_LONG_TIMEOUT,
            )
        except httpx.ConnectError as exc:
            self.reset()
            if _retry:
                return self.preview_hyperframes_frame(t, _retry=False)
            raise BackendNotFound("Could not reach the CapForge backend. Is the app still open?") from exc
        if res.status_code == 401 and _retry:
            self.reset()
            return self.preview_hyperframes_frame(t, _retry=False)
        res.raise_for_status()
        return res.content
