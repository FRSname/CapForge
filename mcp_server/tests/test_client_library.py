"""`CapForgeClient`'s library methods — the HTTP details the tools depend on.

Everything here runs against a fake `httpx.request`, so no backend is needed.
What is under test is the wire: the paths, the query strings, the `If-Match`
header a conditional write is nothing without, and the `409` that has to become
a `StaleRecord` carrying the *current* record rather than an HTTPStatusError.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx
import pytest

from mcp_server import client as client_module
from mcp_server.client import AGENT_TOKEN_HEADER, CapForgeClient, StaleRecord

PORT = 51234
TOKEN = "agent-token-under-test"
BASE = f"http://127.0.0.1:{PORT}"


class Recorder:
    """Stands in for `httpx.request`, answering from a canned response map."""

    def __init__(self, responses: Optional[dict] = None) -> None:
        self.responses = responses or {}
        self.calls: list[dict] = []

    def __call__(self, method: str, url: str, *, json: Any = None,
                 headers: Optional[dict] = None, timeout: Any = None) -> httpx.Response:
        self.calls.append({"method": method, "url": url, "json": json,
                           "headers": headers or {}})
        status, body = self.responses.get((method, url), (200, {"ok": True}))
        return httpx.Response(
            status_code=status,
            json=body,
            request=httpx.Request(method, url),
        )

    @property
    def last(self) -> dict:
        return self.calls[-1]


@pytest.fixture
def capforge(monkeypatch: pytest.MonkeyPatch) -> CapForgeClient:
    monkeypatch.setattr(
        client_module, "read_discovery", lambda: {"port": PORT, "token": TOKEN}
    )
    return CapForgeClient()


def _record(monkeypatch: pytest.MonkeyPatch, responses: Optional[dict] = None) -> Recorder:
    recorder = Recorder(responses)
    monkeypatch.setattr(client_module.httpx, "request", recorder)
    return recorder


# --- reads ------------------------------------------------------------------

def test_library_list_sends_only_the_params_that_were_set(capforge, monkeypatch):
    rec = _record(monkeypatch)

    capforge.library_list({"status": "drafted", "collection": None, "q": "kubernetes",
                           "include_scratch": False})

    url = rec.last["url"]
    assert url.startswith(f"{BASE}/api/library?")
    assert "status=drafted" in url and "q=kubernetes" in url
    # A None param must not become the literal string "None" server-side.
    assert "collection" not in url
    # Booleans go over the wire lowercase, the way FastAPI writes them.
    assert "include_scratch=false" in url
    assert rec.last["headers"][AGENT_TOKEN_HEADER] == TOKEN


def test_library_list_with_no_params_hits_the_bare_path(capforge, monkeypatch):
    rec = _record(monkeypatch)

    capforge.library_list({})

    assert rec.last["url"] == f"{BASE}/api/library"


def test_library_get_and_transcript_and_moments_paths(capforge, monkeypatch):
    rec = _record(monkeypatch)

    capforge.library_get("abc123")
    assert rec.last["url"] == f"{BASE}/api/library/abc123"

    capforge.library_transcript("abc123", segments_only=False)
    assert rec.last["url"] == f"{BASE}/api/library/abc123/transcript?segments_only=false"

    capforge.library_moments("abc123", query="a phrase")
    assert rec.last["url"] == f"{BASE}/api/library/abc123/moments?query=a+phrase"

    capforge.library_moments("abc123", kind="pause")
    assert rec.last["url"] == f"{BASE}/api/library/abc123/moments?kind=pause"


def test_library_create_and_promote(capforge, monkeypatch):
    rec = _record(monkeypatch)

    capforge.library_create("/clips/talk.mp4")
    assert rec.last["method"] == "POST"
    assert rec.last["url"] == f"{BASE}/api/library"
    assert rec.last["json"] == {"source_path": "/clips/talk.mp4", "scratch": False}

    capforge.library_promote("abc123")
    assert rec.last["method"] == "POST"
    assert rec.last["url"] == f"{BASE}/api/library/abc123/promote"


# --- find_by_path -----------------------------------------------------------

def test_library_find_by_path_matches_on_the_real_path(capforge, monkeypatch, tmp_path):
    media = tmp_path / "talk.mp4"
    media.write_bytes(b"x")
    link = tmp_path / "link.mp4"
    link.symlink_to(media)
    listing = {"videos": [
        {"id": "other", "sourcePath": str(tmp_path / "nope.mp4")},
        {"id": "wanted", "sourcePath": str(media)},
    ]}
    _record(monkeypatch, {("GET", f"{BASE}/api/library?include_scratch=true"): (200, listing)})

    # The symlink resolves to the same file, so it finds the same record.
    assert capforge.library_find_by_path(str(link))["id"] == "wanted"
    assert capforge.library_find_by_path(str(media))["id"] == "wanted"


def test_library_find_by_path_returns_none_when_nothing_matches(capforge, monkeypatch, tmp_path):
    _record(monkeypatch, {
        ("GET", f"{BASE}/api/library?include_scratch=true"): (200, {"videos": []}),
    })

    assert capforge.library_find_by_path(str(tmp_path / "unknown.mp4")) is None


# --- the conditional write --------------------------------------------------

def test_library_patch_sends_if_match_and_the_token(capforge, monkeypatch):
    rec = _record(monkeypatch)

    capforge.library_patch("abc123", {"title": "T"}, rev=4)

    assert rec.last["method"] == "PATCH"
    assert rec.last["url"] == f"{BASE}/api/library/abc123"
    assert rec.last["json"] == {"title": "T"}
    assert rec.last["headers"]["If-Match"] == "4"
    # The caller's header is merged *over* the token header, not instead of it.
    assert rec.last["headers"][AGENT_TOKEN_HEADER] == TOKEN


def test_library_patch_409_raises_stale_record_with_the_current_record(capforge, monkeypatch):
    current = {"id": "abc123", "rev": 7, "title": "someone else wrote this"}
    _record(monkeypatch, {
        ("PATCH", f"{BASE}/api/library/abc123"): (
            409, {"detail": "Record abc123 is at rev 7", "current": current},
        ),
    })

    with pytest.raises(StaleRecord) as excinfo:
        capforge.library_patch("abc123", {"title": "T"}, rev=4)

    assert excinfo.value.current == current
    assert "rev 7" in excinfo.value.detail
    assert "rev 7" in str(excinfo.value)


def test_library_patch_other_errors_still_raise_http_status_error(capforge, monkeypatch):
    _record(monkeypatch, {
        ("PATCH", f"{BASE}/api/library/abc123"): (422, {"detail": "unknown field"}),
    })

    with pytest.raises(httpx.HTTPStatusError):
        capforge.library_patch("abc123", {"nope": 1}, rev=1)


# --- the shared send path ---------------------------------------------------

def test_a_401_is_retried_once_after_re_reading_discovery(capforge, monkeypatch):
    """The MCP server outlives CapForge: a restart means a new port and token."""
    rec = _record(monkeypatch, {("GET", f"{BASE}/api/library/abc"): (401, {})})

    with pytest.raises(httpx.HTTPStatusError):
        capforge.library_get("abc")

    assert len(rec.calls) == 2


def test_request_status_returns_accepted_statuses_instead_of_raising(capforge, monkeypatch):
    _record(monkeypatch, {("GET", f"{BASE}/api/thing"): (409, {"detail": "nope"})})

    status, body = capforge._request_status("GET", "/api/thing", accept=(409,))

    assert status == 409 and body == {"detail": "nope"}


def test_a_connect_error_becomes_backend_not_found(capforge, monkeypatch):
    from mcp_server.discovery import BackendNotFound

    def _boom(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(client_module.httpx, "request", _boom)

    with pytest.raises(BackendNotFound):
        capforge.library_get("abc")
