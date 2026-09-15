"""Thin HTTP client for the CapForge backend, mirroring the renderer's api.ts.

Reads the discovery file lazily on first use so the MCP server can start before
CapForge is open; the first tool call then surfaces a clear BackendNotFound.
"""

from __future__ import annotations

import os
from typing import Any, Optional
from urllib.parse import quote, urlencode

import httpx

from .discovery import BackendNotFound, read_discovery

#: Header the backend's require_agent_token dependency checks.
AGENT_TOKEN_HEADER = "X-CapForge-Agent-Token"

#: The conditional-write header every record patch carries (§2.3).
IF_MATCH_HEADER = "If-Match"

#: Prefix of the library routes (`backend/library/router.py`).
LIBRARY_PATH = "/api/library"

#: The channel brief — one file for the whole library, not a per-record route.
BRIEF_PATH = f"{LIBRARY_PATH}/brief"

#: Collections (events): one small file for the whole library, like the brief.
COLLECTIONS_PATH = f"{LIBRARY_PATH}/collections"

#: transcription/render can take minutes; reads are quick.
_LONG_TIMEOUT = httpx.Timeout(None)
_SHORT_TIMEOUT = httpx.Timeout(30.0)


class StaleRecord(RuntimeError):
    """A record patch lost a race: the stored ``rev`` moved on (HTTP 409).

    Carries the backend's ``detail`` and the ``current`` record, so the caller
    can show the agent what it would have clobbered instead of retrying blind.
    """

    def __init__(self, detail: str, current: Any) -> None:
        super().__init__(detail)
        self.detail = detail
        self.current = current


def _query(params: dict) -> str:
    """A query string with unset params dropped and bools written FastAPI-style.

    A ``None`` left in would be sent as the literal string ``"None"`` and read
    as a real filter by the route; ``True`` would arrive as ``"True"``.
    """
    usable = {
        key: ("true" if value else "false") if isinstance(value, bool) else value
        for key, value in params.items()
        if value is not None and value != ""
    }
    return urlencode(usable)


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

    def _send(
        self, method: str, path: str, *, json: Any = None,
        headers: Optional[dict] = None, timeout: Any = _SHORT_TIMEOUT,
        _retry: bool = True,
    ) -> httpx.Response:
        """The one request path: connect, auth-retry, raw response.

        The MCP server is long-lived, but CapForge may restart under it with a
        new port and/or token. On a connection failure or 401 we drop the cached
        connection, re-read the discovery file, and retry once. `headers` is
        merged *over* the token header, never instead of it.
        """
        self._ensure()
        merged = {**self._headers(), **(headers or {})}
        try:
            res = httpx.request(method, f"{self._base}{path}", json=json,
                                headers=merged, timeout=timeout)
        except httpx.ConnectError as exc:
            self.reset()
            if _retry:
                return self._send(method, path, json=json, headers=headers,
                                  timeout=timeout, _retry=False)
            raise BackendNotFound(
                "Could not reach the CapForge backend. Is the app still open?"
            ) from exc
        if res.status_code == 401 and _retry:
            self.reset()
            return self._send(method, path, json=json, headers=headers,
                              timeout=timeout, _retry=False)
        return res

    def _request(
        self, method: str, path: str, *, json: Any = None,
        headers: Optional[dict] = None, timeout: Any = _SHORT_TIMEOUT,
    ) -> Any:
        res = self._send(method, path, json=json, headers=headers, timeout=timeout)
        res.raise_for_status()
        return res.json() if res.content else {}

    def _request_status(
        self, method: str, path: str, *, json: Any = None,
        headers: Optional[dict] = None, accept: tuple[int, ...] = (),
        timeout: Any = _SHORT_TIMEOUT,
    ) -> tuple[int, Any]:
        """`_request`, but statuses in `accept` come back instead of raising.

        For the handful of error codes that are an *answer* — a 409 carrying the
        record that beat us — rather than a transport failure.
        """
        res = self._send(method, path, json=json, headers=headers, timeout=timeout)
        if res.status_code not in accept:
            res.raise_for_status()
        return res.status_code, (res.json() if res.content else {})

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

    def check_layout(
        self, t: float, platform: str = "off", track_id: Optional[str] = None,
        scan: bool = False, max_lines: int = 2,
    ) -> Any:
        # The scan keys are only sent for a scan, so an ordinary layout read is
        # byte-identical to the request this always made.
        payload: dict[str, Any] = {"t": t, "platform": platform}
        if track_id:
            payload["track_id"] = track_id
        if scan:
            payload["scan"] = True
            payload["max_lines"] = max_lines
        return self._request("POST", "/api/agent/check-layout", json=payload)

    def find_moments(self, query: str) -> Any:
        return self._request("GET", f"/api/agent/find-moments?query={quote(query)}")

    def find_semantic_moments(self, kind: str) -> Any:
        return self._request("GET", f"/api/agent/find-semantic-moments?kind={quote(kind)}")

    def render_hyperframes(self, payload: dict) -> Any:
        # Headless-Chrome capture can take a while.
        return self._request("POST", "/api/export-hyperframes", json=payload, timeout=_LONG_TIMEOUT)

    def render_video(self, payload: dict) -> Any:
        # Classic Pillow render — minutes for a long clip, so no short timeout.
        return self._request("POST", "/api/render-video", json=payload, timeout=_LONG_TIMEOUT)

    def list_caption_styles(self) -> Any:
        return self._request("GET", "/api/caption-styles")

    def set_custom_caption(self, html: str) -> Any:
        return self._request("POST", "/api/agent/custom-caption", json={"html": html})

    def get_custom_caption(self) -> Any:
        return self._request("GET", "/api/agent/custom-caption")

    def get_custom_caption_contract(self) -> Any:
        return self._request("GET", "/api/custom-caption-contract")

    # -- library (the video record) ---------------------------------------
    def library_list(self, params: dict) -> Any:
        query = _query(params)
        return self._request("GET", f"{LIBRARY_PATH}?{query}" if query else LIBRARY_PATH)

    def library_get(self, video_id: str) -> Any:
        return self._request("GET", f"{LIBRARY_PATH}/{quote(video_id)}")

    def library_find_by_path(self, path: str) -> Optional[dict]:
        """The record whose media is `path`, or None — a list plus a local match.

        Deliberately client-side: the list route has no `?path=` filter, and the
        comparison has to be on the *resolved* path anyway (a symlink or a
        relative path names the same media), which is knowledge the caller's
        filesystem has and the backend's index does not.
        """
        target = os.path.realpath(path)
        listed = self.library_list({"include_scratch": True}) or {}
        for video in listed.get("videos") or []:
            source = video.get("sourcePath")
            if isinstance(source, str) and source and os.path.realpath(source) == target:
                return video
        return None

    def library_create(self, path: str, scratch: bool = False) -> Any:
        return self._request(
            "POST", LIBRARY_PATH, json={"source_path": path, "scratch": scratch}
        )

    def library_transcript(self, video_id: str, segments_only: bool = True) -> Any:
        query = _query({"segments_only": segments_only})
        return self._request("GET", f"{LIBRARY_PATH}/{quote(video_id)}/transcript?{query}")

    def library_patch(self, video_id: str, patch: dict, rev: int) -> Any:
        """Conditional write. A 409 is an *answer* (someone else wrote first),
        so it is raised as StaleRecord carrying the current record, not as a
        transport error the tool layer would have to re-parse."""
        status, body = self._request_status(
            "PATCH", f"{LIBRARY_PATH}/{quote(video_id)}", json=patch,
            headers={IF_MATCH_HEADER: str(rev)}, accept=(409,),
        )
        if status == 409:
            detail = body.get("detail") if isinstance(body, dict) else None
            current = body.get("current") if isinstance(body, dict) else None
            raise StaleRecord(
                detail or f"Record {video_id} was written by someone else — re-read it",
                current,
            )
        return body

    def library_promote(self, video_id: str) -> Any:
        return self._request("POST", f"{LIBRARY_PATH}/{quote(video_id)}/promote")

    def library_moments(
        self, video_id: str, query: Optional[str] = None, kind: Optional[str] = None
    ) -> Any:
        # The route itself refuses both-or-neither; passing them through keeps
        # that one rule in one place.
        params = _query({"query": query, "kind": kind})
        return self._request("GET", f"{LIBRARY_PATH}/{quote(video_id)}/moments?{params}")

    # -- the brief, the validators and the upload package ------------------
    def library_brief_get(self) -> Any:
        return self._request("GET", BRIEF_PATH)

    def library_brief_patch(self, patch: dict) -> Any:
        """Merge top-level fields into the channel brief; returns the merged one.

        No `If-Match`: the brief is one small file shared by every record, not a
        record with a `rev` two writers can race on (plan §Contracts)."""
        return self._request("PATCH", BRIEF_PATH, json=patch)

    def library_validate(self, body: dict) -> Any:
        """Run the publish rules. Body: `{fields?, duration?, video_id?, lang?}` —
        with a `video_id`, whatever is missing is read from the record."""
        return self._request("POST", f"{LIBRARY_PATH}/validate", json=body)

    def library_package(
        self, video_id: str, platform: str = "youtube", lang: Optional[str] = None
    ) -> Any:
        """The upload package; `lang` renders one localized language's view."""
        query = _query({"platform": platform, "lang": lang})
        return self._request(
            "GET", f"{LIBRARY_PATH}/{quote(video_id)}/package?{query}"
        )

    def library_grab_frames(self, video_id: str, times: list) -> Any:
        """`{frames: [{time_s, name}], failed: [{time_s, reason}], rev}`. The
        backend runs ffmpeg once per time, so this waits with no timeout."""
        return self._request(
            "POST", f"{LIBRARY_PATH}/{quote(video_id)}/frames",
            json={"times": list(times)}, timeout=_LONG_TIMEOUT,
        )

    # -- collections (docs/plans/library-collections.md) -------------------
    # No `If-Match` anywhere here: like the brief, collections live in one small
    # file with no `rev`. A 409 is left as an HTTPStatusError on purpose — its
    # body (`reason`, `members`) is what the tool layer turns into a sentence.
    def library_collections_list(self) -> Any:
        """`{collections: [collection & {members}], orphans: [{id, members}]}`."""
        return self._request("GET", COLLECTIONS_PATH)

    def library_collection_get(self, collection_id: str) -> Any:
        """The collection plus `{members, effective_brief}`; 404 when unknown."""
        return self._request("GET", f"{COLLECTIONS_PATH}/{quote(collection_id)}")

    def library_collection_create(self, body: dict) -> Any:
        """POST `{id?, name, slots?, overrides?}` verbatim; 201 with `members`."""
        return self._request("POST", COLLECTIONS_PATH, json=body)

    def library_collection_patch(self, collection_id: str, patch: dict) -> Any:
        """PATCH `{name?, slots?, overrides?}`; answers the same shape as GET."""
        return self._request(
            "PATCH", f"{COLLECTIONS_PATH}/{quote(collection_id)}", json=patch
        )

    def library_collection_delete(self, collection_id: str) -> Any:
        """DELETE; a 204 comes back as `{}`."""
        return self._request("DELETE", f"{COLLECTIONS_PATH}/{quote(collection_id)}")

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

    def install_caption_component(self, style: str) -> Any:
        # Install shells to the HyperFrames CLI on first use of a style — same
        # ballpark cost as entering co-author mode.
        return self._request(
            "POST", "/api/agent/coauthor/install-caption-component",
            json={"style": style}, timeout=_LONG_TIMEOUT,
        )

    def get_frame(
        self, t: float, composite: bool = True, track_id: Optional[str] = None,
        _retry: bool = True,
    ) -> bytes:
        """Render a QA frame and return raw PNG bytes (not JSON).

        `track_id` previews one caption track's mirrored style; omitted, the
        backend reads the active track's, as it always did.
        """
        self._ensure()
        body: dict[str, Any] = {"t": t, "composite": composite}
        if track_id:
            body["track_id"] = track_id
        try:
            res = httpx.post(
                f"{self._base}/api/render-frame",
                json=body,
                headers=self._headers(),
                timeout=_LONG_TIMEOUT,
            )
        except httpx.ConnectError as exc:
            self.reset()
            if _retry:
                return self.get_frame(t, composite, track_id, _retry=False)
            raise BackendNotFound("Could not reach the CapForge backend. Is the app still open?") from exc
        if res.status_code == 401 and _retry:
            self.reset()
            return self.get_frame(t, composite, track_id, _retry=False)
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
