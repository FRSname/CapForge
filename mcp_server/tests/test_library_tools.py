"""Unit tests for the library MCP tools (docs/plans/mcp-library-tools.md).

Everything runs against a stub client holding canned records, so the tools are
exercised with no CapForge running. What is under test is the seam: which client
call each tool makes, the dicts it hands back, and — the point of the whole tool
group — that a failure is a readable `{"status": "error", …}` dict rather than a
raised HTTP error the agent would see as a crashed tool.
"""

from __future__ import annotations

import asyncio
import copy
from typing import Any, Optional

import httpx
import pytest

from mcp_server import library, server, tracks
from mcp_server.client import StaleRecord
from mcp_server.discovery import BackendNotFound

VIDEO_ID = "6f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f"
OTHER_ID = "11112222333344445555666677778888"
MEDIA = "/clips/talk.mp4"
PUBLISHED_AT = "2026-01-02T03:04:05Z"
URL = "https://youtu.be/abc123"


def record(**over: Any) -> dict:
    base = {
        "id": VIDEO_ID,
        "rev": 3,
        "title": "Kubernetes on a budget",
        "description": "",
        "sourcePath": MEDIA,
        "status": "transcribed",
        "scratch": False,
        "publish": {"youtube": {"videoId": None, "url": None, "publishedAt": None},
                    "pushes": []},
    }
    return {**base, **over}


def transcript_envelope() -> dict:
    return {
        "rev": 3,
        "source": "record",
        "transcript": {
            "language": "en",
            "duration": 4.5,
            "segments": [{"start": 0.0, "end": 4.5, "text": "hello brave world"}],
        },
    }


def mirror(*, active_video: Optional[str] = None) -> dict:
    return {
        "screen": "results",
        "activeVideoId": active_video,
        "activeTrackId": "src",
        "agent": {"lastCommandId": None, "lastCommandStatus": None,
                  "lastCommandError": None},
        "tracks": [],
    }


def http_error(status: int, detail: Any) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "http://127.0.0.1:1/api/library")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


class FakeClock:
    """Stands in for `tracks.time`, so the confirm loop runs instantly."""

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class StubClient:
    """The CapForgeClient surface the library tools use, over canned records."""

    def __init__(self, *, records: Optional[dict] = None, state: Optional[dict] = None,
                 echo: Optional[str] = "ok", echo_error: Optional[str] = None,
                 opens: bool = True) -> None:
        self.records = records if records is not None else {VIDEO_ID: record()}
        self.state = state if state is not None else mirror()
        self.echo = echo
        self.echo_error = echo_error
        self.opens = opens
        self.commands: list[dict] = []
        self.patches: list[dict] = []
        self.promoted: list[str] = []
        self.listed: list[dict] = []
        self.moment_calls: list[dict] = []
        self.transcripts: dict[str, dict] = {VIDEO_ID: transcript_envelope()}
        self.matches: list[dict] = [{"text": "brave", "start": 1.0, "end": 2.0}]
        self.stale: Optional[StaleRecord] = None
        self.raises: Optional[Exception] = None

    # -- reads -----------------------------------------------------------
    def _check(self) -> None:
        if self.raises is not None:
            raise self.raises

    def _record(self, video_id: str) -> dict:
        self._check()
        if video_id not in self.records:
            raise http_error(404, f"No library record with id {video_id}")
        return copy.deepcopy(self.records[video_id])

    def library_list(self, params: dict) -> dict:
        self._check()
        self.listed.append(params)
        return {"videos": [copy.deepcopy(r) for r in self.records.values()]}

    def library_get(self, video_id: str) -> dict:
        return self._record(video_id)

    def library_find_by_path(self, path: str) -> Optional[dict]:
        self._check()
        for rec in self.records.values():
            if rec.get("sourcePath") == path:
                return copy.deepcopy(rec)
        return None

    def library_transcript(self, video_id: str, segments_only: bool = True) -> dict:
        self._record(video_id)
        return copy.deepcopy(self.transcripts[video_id])

    def library_moments(self, video_id: str, query: Optional[str] = None,
                        kind: Optional[str] = None) -> dict:
        self._record(video_id)
        self.moment_calls.append({"video_id": video_id, "query": query, "kind": kind})
        return {"matches": copy.deepcopy(self.matches)}

    # -- writes ----------------------------------------------------------
    def library_patch(self, video_id: str, patch: dict, rev: int) -> dict:
        current = self._record(video_id)
        if self.stale is not None:
            raise self.stale
        self.patches.append({"video_id": video_id, "patch": patch, "rev": rev})
        updated = {**current, **patch, "rev": rev + 1}
        self.records[video_id] = updated
        return copy.deepcopy(updated)

    def library_promote(self, video_id: str) -> dict:
        current = self._record(video_id)
        self.promoted.append(video_id)
        updated = {**current, "scratch": False, "rev": current["rev"] + 1}
        self.records[video_id] = updated
        return copy.deepcopy(updated)

    # -- the command relay -----------------------------------------------
    def send_command(self, op: str, payload: dict) -> dict:
        self._check()
        self.commands.append({"op": op, "payload": payload})
        if self.echo:
            self.state = {
                **self.state,
                "agent": {
                    "lastCommandId": payload.get("command_id"),
                    "lastCommandStatus": self.echo,
                    "lastCommandError": self.echo_error,
                },
            }
            if self.echo == "ok" and self.opens:
                self.state = {**self.state, "activeVideoId": payload.get("record_id")}
        return {"status": "ok"}

    def get_ui_state(self) -> dict:
        return copy.deepcopy(self.state)


@pytest.fixture(autouse=True)
def _instant_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tracks, "time", FakeClock())


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubClient:
    client = StubClient()
    monkeypatch.setattr(server, "_client", client)
    return client


def _use(monkeypatch: pytest.MonkeyPatch, client: StubClient) -> StubClient:
    monkeypatch.setattr(server, "_client", client)
    return client


# --- list / search ---------------------------------------------------------

def test_list_videos_passes_the_filters_through(stub: StubClient) -> None:
    out = library.list_videos(status="drafted", collection="series-a", q="kube")

    assert out["status"] == "ok"
    assert out["count"] == 1
    assert out["videos"][0]["id"] == VIDEO_ID
    assert stub.listed[-1] == {
        "status": "drafted", "collection": "series-a", "q": "kube",
        "include_scratch": False,
    }


def test_list_videos_defaults_hide_scratch(stub: StubClient) -> None:
    library.list_videos()

    assert stub.listed[-1]["include_scratch"] is False
    assert stub.listed[-1]["status"] is None


def test_search_library_is_the_q_filter(stub: StubClient) -> None:
    out = library.search_library("kubernetes")

    assert out["status"] == "ok"
    assert stub.listed[-1]["q"] == "kubernetes"


# --- get_video -------------------------------------------------------------

def test_get_video_by_id(stub: StubClient) -> None:
    out = library.get_video(video_id=VIDEO_ID)

    assert out["status"] == "ok"
    assert out["video"]["id"] == VIDEO_ID
    assert out["video"]["rev"] == 3


def test_get_video_by_path(stub: StubClient) -> None:
    out = library.get_video(path=MEDIA)

    assert out["status"] == "ok" and out["video"]["id"] == VIDEO_ID


def test_get_video_by_an_unknown_path_is_a_clean_error(stub: StubClient) -> None:
    out = library.get_video(path="/clips/never-imported.mp4")

    assert out["status"] == "error"
    assert "never-imported.mp4" in out["error"]


@pytest.mark.parametrize("kwargs", [
    {},
    {"video_id": VIDEO_ID, "path": MEDIA},
])
def test_get_video_wants_exactly_one_argument(stub: StubClient, kwargs) -> None:
    out = library.get_video(**kwargs)

    assert out["status"] == "error"
    assert "exactly one" in out["error"]


def test_get_video_unknown_id_returns_the_backends_detail(stub: StubClient) -> None:
    out = library.get_video(video_id=OTHER_ID)

    assert out == {"status": "error", "error": f"No library record with id {OTHER_ID}"}


# --- transcript / moments --------------------------------------------------

def test_get_video_transcript_passes_the_envelope_through(stub: StubClient) -> None:
    out = library.get_video_transcript(VIDEO_ID)

    assert out["status"] == "ok"
    assert out["source"] == "record" and out["rev"] == 3
    assert out["transcript"]["duration"] == 4.5


def test_get_video_transcript_404s_without_a_stored_transcript(stub: StubClient) -> None:
    out = library.get_video_transcript(OTHER_ID)

    assert out["status"] == "error" and OTHER_ID in out["error"]


def test_find_video_moments_by_query_and_by_kind(stub: StubClient) -> None:
    by_query = library.find_video_moments(VIDEO_ID, query="brave")
    by_kind = library.find_video_moments(VIDEO_ID, kind="pause")

    assert by_query["status"] == "ok" and by_query["count"] == 1
    assert by_query["matches"][0]["text"] == "brave"
    assert stub.moment_calls[0] == {"video_id": VIDEO_ID, "query": "brave", "kind": None}
    assert stub.moment_calls[1] == {"video_id": VIDEO_ID, "query": None, "kind": "pause"}
    assert by_kind["status"] == "ok"


# --- set_video_meta --------------------------------------------------------

def test_set_video_meta_patches_with_the_callers_rev(stub: StubClient) -> None:
    out = library.set_video_meta(VIDEO_ID, {"title": "New title"}, rev=3)

    assert out["status"] == "ok" and out["rev"] == 4
    assert stub.patches[-1] == {"video_id": VIDEO_ID, "patch": {"title": "New title"},
                                "rev": 3}


def test_set_video_meta_refuses_an_empty_patch(stub: StubClient) -> None:
    out = library.set_video_meta(VIDEO_ID, {}, rev=3)

    assert out["status"] == "error"
    assert not stub.patches


def test_scratch_false_promotes_instead_of_patching(stub: StubClient) -> None:
    """`scratch` is a system field — a patch carrying it would 422. The one
    promotion the plan allows is routed to the promote route instead."""
    out = library.set_video_meta(VIDEO_ID, {"scratch": False}, rev=3)

    assert out["status"] == "ok"
    assert stub.promoted == [VIDEO_ID]
    assert not stub.patches
    assert out["video"]["scratch"] is False


def test_a_patch_that_only_looks_like_the_promotion_is_still_a_patch(stub: StubClient) -> None:
    out = library.set_video_meta(VIDEO_ID, {"scratch": False, "title": "T"}, rev=3)

    assert out["status"] == "error"  # `scratch` is not an authored field
    assert not stub.promoted and not stub.patches


def test_stale_rev_surfaces_the_current_record(stub: StubClient) -> None:
    current = record(rev=9, title="someone else wrote this")
    stub.stale = StaleRecord("Record is at rev 9; re-read it before writing", current)

    out = library.set_video_meta(VIDEO_ID, {"title": "mine"}, rev=3)

    assert out["status"] == "error"
    assert out["reason"] == "stale_rev"
    assert out["current"]["rev"] == 9
    assert "rev 9" in out["detail"]


# --- mark_published --------------------------------------------------------

def test_mark_published_writes_the_youtube_block(stub: StubClient) -> None:
    out = library.mark_published(VIDEO_ID, URL, youtube_video_id="abc123",
                                 published_at=PUBLISHED_AT)

    assert out["status"] == "ok"
    patch = stub.patches[-1]["patch"]
    assert patch["publish"]["youtube"] == {
        "videoId": "abc123", "url": URL, "publishedAt": PUBLISHED_AT,
    }
    assert stub.patches[-1]["rev"] == 3  # the rev it just read


def test_mark_published_defaults_published_at_to_now_utc(stub: StubClient) -> None:
    out = library.mark_published(VIDEO_ID, URL)

    written = stub.patches[-1]["patch"]["publish"]["youtube"]["publishedAt"]
    assert written.endswith("Z") and written.startswith("20")
    assert out["publish"]["youtube"]["url"] == URL


def test_mark_published_never_clobbers_an_existing_timestamp(monkeypatch) -> None:
    already = record(publish={
        "youtube": {"videoId": "old-id", "url": "https://youtu.be/old",
                    "publishedAt": PUBLISHED_AT},
        "pushes": [{"at": "2026-01-01T00:00:00Z"}],
    })
    stub = _use(monkeypatch, StubClient(records={VIDEO_ID: already}))

    library.mark_published(VIDEO_ID, "https://youtu.be/new")

    youtube = stub.patches[-1]["patch"]["publish"]["youtube"]
    assert youtube["publishedAt"] == PUBLISHED_AT  # kept, not restamped
    assert youtube["videoId"] == "new"  # the corrected URL names the id
    assert youtube["url"] == "https://youtu.be/new"
    # Sibling keys of `youtube` survive the merge too.
    assert stub.patches[-1]["patch"]["publish"]["pushes"] == [{"at": "2026-01-01T00:00:00Z"}]


def test_mark_published_does_not_mutate_the_record_it_read(monkeypatch) -> None:
    original = record()
    stub = _use(monkeypatch, StubClient(records={VIDEO_ID: original}))

    library.mark_published(VIDEO_ID, URL)

    assert original["publish"]["youtube"]["url"] is None


# --- open_video ------------------------------------------------------------

def test_open_video_sends_the_record_id_and_a_command_id(stub: StubClient) -> None:
    out = library.open_video(VIDEO_ID)

    assert out["status"] == "ok" and out["video_id"] == VIDEO_ID
    cmd = stub.commands[-1]
    assert cmd["op"] == "open_video"
    assert cmd["payload"]["record_id"] == VIDEO_ID
    assert cmd["payload"]["command_id"]


def test_open_video_waits_for_both_the_echo_and_the_active_id(monkeypatch) -> None:
    """An echo alone is not enough — the store is only replaced once the
    renderer reports the record as active."""
    stub = _use(monkeypatch, StubClient(opens=False))

    out = library.open_video(VIDEO_ID)

    assert out["status"] == "unconfirmed"
    assert "open_video" in out["hint"]


def test_open_video_returns_the_renderers_refusal(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient(
        echo="error", echo_error="A transcription is running — wait for it to finish",
    ))

    out = library.open_video(VIDEO_ID)

    assert out["status"] == "error"
    assert out["error"] == "A transcription is running — wait for it to finish"
    assert stub.commands[-1]["op"] == "open_video"


def test_open_video_returns_the_backends_409_verbatim(monkeypatch) -> None:
    detail = (
        f"Record {VIDEO_ID} has no session snapshot yet — open it in CapForge "
        "once (autosave lands with the library screen)"
    )
    stub = _use(monkeypatch, StubClient())
    stub.raises = http_error(409, detail)

    out = library.open_video(VIDEO_ID)

    assert out == {"status": "error", "error": detail}


def test_open_video_no_window_409_comes_back_verbatim(monkeypatch) -> None:
    detail = (
        "CapForge is running but no window is open — click the Dock icon, "
        "then retry open_video"
    )
    stub = _use(monkeypatch, StubClient())
    stub.raises = http_error(409, detail)

    assert library.open_video(VIDEO_ID)["error"] == detail


# --- error mapping ---------------------------------------------------------

def test_a_closed_app_says_so_in_plain_words(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient())
    stub.raises = BackendNotFound("Could not reach the CapForge backend")

    for call in (
        lambda: library.list_videos(),
        lambda: library.get_video(video_id=VIDEO_ID),
        lambda: library.open_video(VIDEO_ID),
    ):
        out = call()
        assert out == {
            "status": "error",
            "error": "CapForge is not running — launch it (the window can stay "
                     "closed) and retry.",
        }


def test_an_http_error_without_a_detail_falls_back_to_the_status(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient())
    request = httpx.Request("GET", "http://127.0.0.1:1/api/library")
    stub.raises = httpx.HTTPStatusError(
        "boom", request=request, response=httpx.Response(500, text="", request=request)
    )

    out = library.list_videos()

    assert out["status"] == "error" and "500" in out["error"]


# --- registration ----------------------------------------------------------

def test_every_library_tool_is_registered_on_the_server() -> None:
    names = {tool.name for tool in asyncio.run(server.mcp.list_tools())}

    assert {fn.__name__ for fn in library.TOOLS} <= names


def test_the_tool_group_is_the_eight_the_plan_lists() -> None:
    assert [fn.__name__ for fn in library.TOOLS] == [
        "list_videos", "search_library", "get_video", "get_video_transcript",
        "set_video_meta", "mark_published", "find_video_moments", "open_video",
    ]


def test_every_tool_has_a_docstring_for_the_llm() -> None:
    for fn in library.TOOLS:
        assert (fn.__doc__ or "").strip(), f"{fn.__name__} has no docstring"


def test_the_editing_tools_point_at_open_video() -> None:
    """A library record's transcript is read-only until it is opened."""
    for doc in (server.update_words.__doc__, server.remove_filler_words.__doc__):
        assert "open_video" in (doc or "")


# --- server.py wiring ------------------------------------------------------

class RecordingSessionClient(StubClient):
    """`server`'s own tools touch two more client methods than the tool group."""

    def __init__(self, *, command_response: Optional[dict] = None,
                 create: Any = None) -> None:
        super().__init__()
        self.command_response = command_response or {"status": "ok"}
        self.create = create if create is not None else {"id": VIDEO_ID}
        self.transcribed: list[dict] = []
        self.created: list[str] = []

    def send_command(self, op: str, payload: dict) -> dict:
        super().send_command(op, payload)
        return copy.deepcopy(self.command_response)

    def transcribe(self, payload: dict) -> dict:
        self.transcribed.append(payload)
        return {"status": "ok", "language": "en", "segments": []}

    def library_create(self, path: str, scratch: bool = False) -> Any:
        self.created.append(path)
        if isinstance(self.create, Exception):
            raise self.create
        return copy.deepcopy(self.create)


def test_load_video_passes_the_backends_video_id_through(monkeypatch) -> None:
    stub = RecordingSessionClient(
        command_response={"status": "ok", "video_id": VIDEO_ID}
    )
    monkeypatch.setattr(server, "_client", stub)

    out = server.load_video(MEDIA)

    assert out["video_id"] == VIDEO_ID
    assert out["loading"] == MEDIA


def test_load_video_without_a_record_still_reports_the_load(monkeypatch) -> None:
    """The backend logs a library failure and omits the id — not an error here."""
    monkeypatch.setattr(server, "_client", RecordingSessionClient())

    out = server.load_video(MEDIA)

    assert out["status"] == "ok" and "video_id" not in out


def test_transcribe_creates_the_library_record(monkeypatch) -> None:
    stub = RecordingSessionClient()
    monkeypatch.setattr(server, "_client", stub)

    out = server.transcribe(MEDIA)

    assert stub.created == [MEDIA]
    assert out["video_id"] == VIDEO_ID
    assert out["language"] == "en"


def test_transcribe_reports_a_library_failure_beside_the_transcript(monkeypatch) -> None:
    """The transcript is the primary result — it must survive an index failure."""
    stub = RecordingSessionClient(create=BackendNotFound("gone"))
    monkeypatch.setattr(server, "_client", stub)

    out = server.transcribe(MEDIA)

    assert out["status"] == "ok" and out["language"] == "en"
    assert "library_error" in out and "video_id" not in out


# --- mark_published: the id comes from the URL --------------------------------

@pytest.mark.parametrize("url, expected", [
    ("https://youtu.be/abc123", "abc123"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"),
    ("https://youtube.com/shorts/sh0rtId1", "sh0rtId1"),
    ("https://m.youtube.com/live/liveId9?feature=share", "liveId9"),
    ("https://vimeo.com/12345", None),
    ("not a url", None),
])
def test_youtube_id_from_url(url: str, expected) -> None:
    assert library.youtube_id_from_url(url) == expected


def test_mark_published_reads_the_id_from_the_url(stub: StubClient) -> None:
    """`published` status keys on `videoId`, so a URL-only call must still set it."""
    out = library.mark_published(VIDEO_ID, "https://www.youtube.com/watch?v=xyz789")

    assert out["status"] == "ok"
    assert stub.patches[-1]["patch"]["publish"]["youtube"]["videoId"] == "xyz789"


def test_mark_published_refuses_a_url_with_no_readable_id(stub: StubClient) -> None:
    out = library.mark_published(VIDEO_ID, "https://vimeo.com/12345")

    assert out["status"] == "error" and "youtube_video_id" in out["error"]
    assert stub.patches == []


# --- 422 details name the field ---------------------------------------------

def test_validation_errors_name_the_refused_field(monkeypatch) -> None:
    """FastAPI's 422 `detail` is a list; the agent must see which field it was."""
    request = httpx.Request("PATCH", "http://127.0.0.1/api/library/x")
    response = httpx.Response(
        422, request=request,
        json={"detail": [{"loc": ["body", "rev"], "msg": "Extra inputs are not permitted"}]},
    )
    exc = httpx.HTTPStatusError("422", request=request, response=response)

    text = library._http_detail(exc)

    assert "rev" in text and "Extra inputs are not permitted" in text
    assert "422 Unprocessable" not in text


# --- a 422 carrying violations is a refusal, not a pydantic complaint ---------

def violations_error(detail: str, violations: list) -> httpx.HTTPStatusError:
    request = httpx.Request("PATCH", f"http://127.0.0.1/api/library/{VIDEO_ID}")
    response = httpx.Response(
        422, request=request, json={"detail": detail, "violations": violations}
    )
    return httpx.HTTPStatusError("422", request=request, response=response)


def test_set_video_meta_maps_a_violations_422_into_a_readable_refusal(monkeypatch) -> None:
    """The hard rules run before the write: the agent must see field and rule."""
    refused = [
        {"field": "title", "rule": "TITLE_MAX_CHARS",
         "message": "Title is 118 characters; the limit is 100", "severity": "hard"},
    ]
    stub = _use(monkeypatch, StubClient())
    stub.raises = violations_error("CapForge refused the write", refused)

    out = library.set_video_meta(VIDEO_ID, {"title": "x" * 118}, rev=3)

    assert out["status"] == "error"
    assert out["reason"] == "violations"
    assert out["detail"] == "CapForge refused the write"
    assert out["violations"] == refused
    assert stub.patches == []


def test_a_pydantic_422_still_takes_the_field_summary_path(monkeypatch) -> None:
    """Only a body carrying `violations` is a rule refusal — the rest are 422s."""
    stub = _use(monkeypatch, StubClient())
    stub.raises = http_error(
        422, [{"loc": ["body", "rev"], "msg": "Extra inputs are not permitted"}]
    )

    out = library.set_video_meta(VIDEO_ID, {"title": "T"}, rev=3)

    assert out["status"] == "error" and "reason" not in out
    assert "rev" in out["error"]
