"""Unit tests for the publish MCP tools (docs/plans/publish-workspace.md §MCP).

Same shape as `test_library_tools.py`: a stub client with canned answers, so the
tools are exercised with no CapForge running. What is under test is the seam —
which route each tool calls, the body it sends, how it groups what comes back,
and that every failure is a readable `{"status": "error", …}` dict.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
from typing import Any, Optional

import httpx
import pytest

from mcp_server import library, publish, server
from mcp_server.discovery import BackendNotFound

VIDEO_ID = "6f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f"

#: 46 tools, plus the six in `publish.py`, the four in `collection_tools.py`
#: and the four in `channel_tools.py`.
EXPECTED_TOOL_COUNT = 61

PACKAGE_TEXT = "TITLE OPTIONS\n1. Kubernetes on a budget\n"

#: A sentinel for "the tool did not pass this argument".
_UNSET = object()

#: A non-primary channel id (multi-channel PR 2).
IG_ID = "filip-ig"

HARD_VIOLATION = {
    "field": "title", "rule": "TITLE_MAX_CHARS",
    "message": "Title is 118 characters; the limit is 100", "severity": "hard",
}
STYLE_VIOLATION = {
    "field": "description", "rule": "NO_EM_DASHES",
    "message": "The brief forbids em dashes", "severity": "style",
}


def brief(**over: Any) -> dict:
    base = {
        "channel": "CapForge",
        "audience": "video editors",
        "voice": "plain",
        "language": "",
        "footer": "",
        "default_hashtags": ["#CapForge"],
        "link_rows": [],
        "house_rules": {"no_em_dashes": True, "hook_first_150": True},
    }
    return {**base, **over}


def http_error(status: int, detail: Any) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "http://127.0.0.1:1/api/library")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


class StubClient:
    """The CapForgeClient surface the publish tools use, over canned answers."""

    def __init__(self, *, violations: Optional[list] = None,
                 stored_brief: Optional[dict] = None) -> None:
        self.brief = stored_brief if stored_brief is not None else brief()
        self.violations = violations if violations is not None else []
        self.brief_patches: list[dict] = []
        self.validate_bodies: list[dict] = []
        self.package_calls: list[dict] = []
        self.patches: list[dict] = []
        self.raises: Optional[Exception] = None
        #: The platform a channel-scoped package answers with (the channel's).
        self.channel_platform = "tiktok"

    def _check(self) -> None:
        if self.raises is not None:
            raise self.raises

    # -- the brief --------------------------------------------------------
    def library_brief_get(self) -> dict:
        self._check()
        return copy.deepcopy(self.brief)

    def library_brief_patch(self, patch: dict) -> dict:
        self._check()
        self.brief_patches.append(copy.deepcopy(patch))
        # A merge, never a mutation of the stored dict.
        self.brief = {**self.brief, **patch}
        return copy.deepcopy(self.brief)

    # -- validators and the package ---------------------------------------
    def library_validate(self, body: dict) -> dict:
        self._check()
        self.validate_bodies.append(copy.deepcopy(body))
        return {"violations": copy.deepcopy(self.violations)}

    def library_package(self, video_id: str, platform: Any = _UNSET,
                        lang: Optional[str] = None, channel: Optional[str] = None) -> dict:
        """Records only the arguments the tool actually passed, so a channel
        call can be seen to send no platform."""
        self._check()
        call: dict = {"video_id": video_id}
        if platform is not _UNSET:
            call = {**call, "platform": platform}
        if lang is not None:
            call = {**call, "lang": lang}
        if channel is not None:
            call = {**call, "channel": channel}
        self.package_calls.append(call)
        if channel is not None:
            return {
                "channel": channel,
                "platform": self.channel_platform,
                "text": PACKAGE_TEXT,
                "violations": copy.deepcopy(self.violations),
                "description": None,
            }
        return {
            "platform": platform if platform is not _UNSET else "youtube",
            "text": PACKAGE_TEXT,
            "violations": copy.deepcopy(self.violations),
        }

    # -- the write the publish tools must never make -----------------------
    def library_patch(self, video_id: str, patch: dict, rev: int) -> dict:
        raise AssertionError("a publish tool wrote to the record")


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubClient:
    client = StubClient()
    monkeypatch.setattr(server, "_client", client)
    return client


def _use(monkeypatch: pytest.MonkeyPatch, client: StubClient) -> StubClient:
    monkeypatch.setattr(server, "_client", client)
    return client


# --- the brief -------------------------------------------------------------

def test_get_brief_returns_the_stored_brief(stub: StubClient) -> None:
    out = publish.get_brief()

    assert out["status"] == "ok"
    assert out["brief"]["channel"] == "CapForge"


def test_set_brief_merges_and_returns_the_merged_brief(stub: StubClient) -> None:
    out = publish.set_brief({"voice": "technical"})

    assert out["status"] == "ok"
    assert stub.brief_patches == [{"voice": "technical"}]
    assert out["brief"]["voice"] == "technical"
    assert out["brief"]["channel"] == "CapForge"  # untouched fields survive


def test_set_brief_refuses_an_empty_patch(stub: StubClient) -> None:
    out = publish.set_brief({})

    assert out["status"] == "error"
    assert stub.brief_patches == []


def test_set_brief_refuses_a_non_object_patch(stub: StubClient) -> None:
    out = publish.set_brief(["channel", "CapForge"])  # type: ignore[arg-type]

    assert out["status"] == "error"
    assert stub.brief_patches == []


# --- validate_video --------------------------------------------------------

def test_validate_video_groups_by_severity(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient(violations=[HARD_VIOLATION, STYLE_VIOLATION]))

    out = publish.validate_video(VIDEO_ID)

    assert out["status"] == "ok"
    assert out["hard"] == [HARD_VIOLATION]
    assert out["style"] == [STYLE_VIOLATION]
    assert out["ok"] is False
    # The record supplies both the fields and the duration.
    assert stub.validate_bodies == [{"video_id": VIDEO_ID}]


def test_validate_video_is_ok_when_only_style_rules_are_unmet(monkeypatch) -> None:
    """Style rules come from the brief and never block the write."""
    stub = _use(monkeypatch, StubClient(violations=[STYLE_VIOLATION]))

    out = publish.validate_video(VIDEO_ID)

    assert out["ok"] is True
    assert out["hard"] == [] and out["style"] == [STYLE_VIOLATION]


def test_validate_video_clean_record(stub: StubClient) -> None:
    out = publish.validate_video(VIDEO_ID)

    assert out == {"status": "ok", "hard": [], "style": [], "ok": True}


def test_validate_video_keeps_a_violation_of_an_unknown_severity(monkeypatch) -> None:
    """An unclassified finding must still reach the agent, not vanish."""
    odd = {"field": "tags", "rule": "SOMETHING_NEW", "message": "?", "severity": "note"}
    _use(monkeypatch, StubClient(violations=[odd]))

    out = publish.validate_video(VIDEO_ID)

    assert out["other"] == [odd]
    assert out["ok"] is True


# --- check_chapters --------------------------------------------------------

CHAPTERS = [
    {"start_s": 0, "title": "Cold open"},
    {"start_s": 61.25, "title": "The budget problem"},
    {"start_s": 180, "title": "Demo"},
]


def test_check_chapters_validates_only_the_chapters_and_writes_nothing(
    monkeypatch,
) -> None:
    stub = _use(monkeypatch, StubClient(violations=[]))

    out = publish.check_chapters(VIDEO_ID, CHAPTERS)

    assert out["status"] == "ok" and out["ok"] is True
    assert stub.validate_bodies == [
        {"video_id": VIDEO_ID, "fields": {"chapters": CHAPTERS}}
    ]
    assert stub.patches == []  # library_patch would have raised


def test_check_chapters_reports_the_hard_findings(monkeypatch) -> None:
    gap = {"field": "chapters", "rule": "CHAPTER_MIN_GAP_S",
           "message": "Chapters 2 and 3 are 4s apart; the minimum is 10s",
           "severity": "hard"}
    _use(monkeypatch, StubClient(violations=[gap]))

    out = publish.check_chapters(VIDEO_ID, CHAPTERS)

    assert out["ok"] is False and out["hard"] == [gap]


@pytest.mark.parametrize("chapters", [[], "00:00 intro", [{"start_s": 0}, "nope"]])
def test_check_chapters_refuses_a_shape_it_cannot_validate(stub, chapters) -> None:
    out = publish.check_chapters(VIDEO_ID, chapters)

    assert out["status"] == "error"
    assert "start_s" in out["error"]
    assert stub.validate_bodies == []


def test_check_chapters_does_not_mutate_the_list_it_was_given(stub: StubClient) -> None:
    mine = [dict(c) for c in CHAPTERS]

    publish.check_chapters(VIDEO_ID, mine)

    assert mine == CHAPTERS


# --- get_upload_package ----------------------------------------------------

def test_get_upload_package_returns_the_text_and_its_violations(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient(violations=[HARD_VIOLATION]))

    out = publish.get_upload_package(VIDEO_ID)

    assert out["status"] == "ok"
    assert out["text"] == PACKAGE_TEXT
    assert out["violations"] == [HARD_VIOLATION]
    assert out["platform"] == "youtube"
    assert stub.package_calls == [{"video_id": VIDEO_ID, "platform": "youtube"}]


def test_get_upload_package_rejects_an_unknown_platform_without_a_call(
    stub: StubClient,
) -> None:
    out = publish.get_upload_package(VIDEO_ID, platform="tiktok")

    assert out["status"] == "error"
    assert "tiktok" in out["error"] and "youtube" in out["error"]
    assert stub.package_calls == []


@pytest.mark.parametrize("platform", ["linkedin", "x", "instagram"])
def test_get_upload_package_renders_the_other_platforms(stub: StubClient, platform: str) -> None:
    out = publish.get_upload_package(VIDEO_ID, platform=platform, lang="de")

    assert out["status"] == "ok"
    assert out["platform"] == platform
    assert stub.package_calls == [{"video_id": VIDEO_ID, "platform": platform, "lang": "de"}]


def test_the_supported_platforms_are_the_four_the_backend_renders() -> None:
    assert publish.SUPPORTED_PLATFORMS == ("youtube", "linkedin", "x", "instagram")


def test_get_upload_package_explains_each_post_and_that_nothing_is_posted() -> None:
    doc = " ".join((publish.get_upload_package.__doc__ or "").split())

    for words in ("LinkedIn", "X", "Instagram", "Link in bio", "3000", "280", "2200",
                  "23", "nothing is posted", "emoji", "[FULL VIDEO URL]"):
        assert words in doc, words


def test_get_upload_package_passes_a_language_through(stub: StubClient) -> None:
    out = publish.get_upload_package(VIDEO_ID, lang="pl")

    assert out["status"] == "ok"
    assert stub.package_calls == [{"video_id": VIDEO_ID, "platform": "youtube", "lang": "pl"}]


def test_validate_video_sends_lang_only_when_given(stub: StubClient) -> None:
    publish.validate_video(VIDEO_ID)
    publish.validate_video(VIDEO_ID, lang="de")

    assert stub.validate_bodies == [{"video_id": VIDEO_ID}, {"video_id": VIDEO_ID, "lang": "de"}]


@pytest.mark.parametrize("lang", ["", "  ", 7])
def test_an_unusable_lang_is_refused_without_a_call(stub: StubClient, lang: Any) -> None:
    for call in (
        lambda: publish.validate_video(VIDEO_ID, lang=lang),
        lambda: publish.get_upload_package(VIDEO_ID, lang=lang),
    ):
        out = call()
        assert out["status"] == "error" and "lang" in out["error"]
    assert stub.validate_bodies == [] and stub.package_calls == []


def test_the_language_docstrings_name_the_localized_workflow() -> None:
    assert "lang" in (publish.validate_video.__doc__ or "")
    assert "lang" in (publish.get_upload_package.__doc__ or "")
    doc = " ".join((library.set_video_meta.__doc__ or "").split())
    assert "null" in doc and "only the languages" in doc


# --- error mapping ---------------------------------------------------------

def test_a_closed_app_says_so_in_plain_words(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient())
    stub.raises = BackendNotFound("Could not reach the CapForge backend")

    for call in (
        publish.get_brief,
        lambda: publish.set_brief({"voice": "plain"}),
        lambda: publish.validate_video(VIDEO_ID),
        lambda: publish.check_chapters(VIDEO_ID, CHAPTERS),
        lambda: publish.get_upload_package(VIDEO_ID),
    ):
        out = call()
        assert out["status"] == "error"
        assert out["error"] == library.NOT_RUNNING


def test_an_unknown_record_comes_back_as_the_backends_sentence(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient())
    stub.raises = http_error(404, f"No library record with id {VIDEO_ID}")

    out = publish.get_upload_package(VIDEO_ID)

    assert out == {"status": "error", "error": f"No library record with id {VIDEO_ID}"}


# --- registration ----------------------------------------------------------

def test_every_publish_tool_is_registered_on_the_server() -> None:
    names = {tool.name for tool in asyncio.run(server.mcp.list_tools())}

    assert {fn.__name__ for fn in publish.TOOLS} <= names


def test_the_tool_group_is_the_six_the_plans_list() -> None:
    assert [fn.__name__ for fn in publish.TOOLS] == [
        "get_brief", "set_brief", "validate_video", "check_chapters",
        "get_upload_package", "grab_frames",
    ]


def test_the_server_exposes_the_expected_number_of_tools() -> None:
    names = {tool.name for tool in asyncio.run(server.mcp.list_tools())}

    assert len(names) == EXPECTED_TOOL_COUNT


def test_every_tool_has_a_docstring_that_names_the_workflow() -> None:
    for fn in publish.TOOLS:
        assert (fn.__doc__ or "").strip(), f"{fn.__name__} has no docstring"
    # The order an agent has to follow is written where it will be read.
    assert "set_video_meta" in (publish.validate_video.__doc__ or "")
    assert "validate_video" in (publish.get_upload_package.__doc__ or "")
    assert "find_video_moments" in (publish.check_chapters.__doc__ or "")


def test_publish_never_imports_the_server_module() -> None:
    """Same rule as library.py/tracks.py: the tool group is import-safe."""
    source = (publish.__file__ or "")
    assert source.endswith("publish.py")
    with open(source, encoding="utf-8") as handle:
        text = handle.read()
    assert "import server" not in text and "from .server" not in text


# --- grab_frames (publish-editors Part A) ------------------------------------

FRAME_NAME = "0123456789abcdef0123456789abcdef.jpg"


class FramesStub(StubClient):
    """`StubClient` plus the frames route."""

    def __init__(self, answer: Optional[dict] = None) -> None:
        super().__init__()
        self.frame_calls: list[dict] = []
        self.answer = answer if answer is not None else {
            "frames": [{"time_s": 61.25, "name": FRAME_NAME}],
            "failed": [{"time_s": 9000.0, "reason": "ffmpeg produced no frame"}],
            "rev": 7,
        }

    def library_grab_frames(self, video_id: str, times: list) -> dict:
        self._check()
        self.frame_calls.append({"video_id": video_id, "times": copy.deepcopy(times)})
        return copy.deepcopy(self.answer)


def test_grab_frames_posts_the_times_and_answers_frames_failures_and_rev(monkeypatch) -> None:
    stub = _use(monkeypatch, FramesStub())
    times = [61.25, 9000.0]

    out = publish.grab_frames(VIDEO_ID, times)

    assert stub.frame_calls == [{"video_id": VIDEO_ID, "times": [61.25, 9000.0]}]
    assert out == {
        "status": "ok",
        "frames": [{"time_s": 61.25, "name": FRAME_NAME}],
        "failed": [{"time_s": 9000.0, "reason": "ffmpeg produced no frame"}],
        "rev": 7,
    }


def test_grab_frames_never_hands_the_callers_list_to_the_client(monkeypatch) -> None:
    stub = _use(monkeypatch, FramesStub())
    times = [1.0]

    publish.grab_frames(VIDEO_ID, times)
    stub.frame_calls[0]["times"].append(2.0)

    assert times == [1.0]


@pytest.mark.parametrize("times", [[], None, "61", [True], ["1.0"], [1.0, None]])
def test_grab_frames_refuses_unusable_times_without_a_call(monkeypatch, times) -> None:
    stub = _use(monkeypatch, FramesStub())

    out = publish.grab_frames(VIDEO_ID, times)

    assert out["status"] == "error"
    assert "times" in out["error"]
    assert stub.frame_calls == []


def test_grab_frames_passes_the_backends_refusal_sentence_through(monkeypatch) -> None:
    stub = _use(monkeypatch, FramesStub())
    sentence = "Record has 24 of 24 thumbnail candidates; delete a frame first."
    stub.raises = http_error(422, sentence)

    assert publish.grab_frames(VIDEO_ID, [1.0]) == {"status": "error", "error": sentence}


def test_grab_frames_reports_a_closed_app(monkeypatch) -> None:
    stub = _use(monkeypatch, FramesStub())
    stub.raises = BackendNotFound("gone")

    assert publish.grab_frames(VIDEO_ID, [1.0])["error"] == library.NOT_RUNNING


def test_grab_frames_docstring_names_the_workflow() -> None:
    doc = publish.grab_frames.__doc__ or ""
    assert "find_video_moments" in doc
    assert "set_video_meta" in doc
    assert "candidates" in doc and "cover" in doc


# --- per channel (docs/plans/multi-channel-pr2-contract.md → MCP) --------------

def test_validate_video_sends_the_channel_only_when_given(stub: StubClient) -> None:
    publish.validate_video(VIDEO_ID)
    publish.validate_video(VIDEO_ID, channel=IG_ID)
    publish.validate_video(VIDEO_ID, lang="pl", channel="update-conf")

    assert stub.validate_bodies == [
        {"video_id": VIDEO_ID},
        {"video_id": VIDEO_ID, "channel": IG_ID},
        {"video_id": VIDEO_ID, "lang": "pl", "channel": "update-conf"},
    ]


@pytest.mark.parametrize("channel", ["", "  ", 7])
def test_an_unusable_channel_is_refused_without_a_call(stub: StubClient, channel: Any) -> None:
    for call in (
        lambda: publish.validate_video(VIDEO_ID, channel=channel),
        lambda: publish.get_upload_package(VIDEO_ID, channel=channel),
    ):
        out = call()
        assert out["status"] == "error" and "channel" in out["error"]
    assert stub.validate_bodies == [] and stub.package_calls == []


def test_get_upload_package_for_a_channel_relays_channel_and_platform(stub: StubClient) -> None:
    out = publish.get_upload_package(VIDEO_ID, channel=IG_ID)

    assert out == {"status": "ok", "channel": IG_ID, "platform": "tiktok",
                   "text": PACKAGE_TEXT, "violations": []}
    # No platform is sent beside a channel: the route refuses both together.
    assert stub.package_calls == [{"video_id": VIDEO_ID, "channel": IG_ID}]


def test_get_upload_package_for_a_youtube_channel_relays_its_platform(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient(violations=[HARD_VIOLATION]))
    stub.channel_platform = "youtube"

    out = publish.get_upload_package(VIDEO_ID, lang="pl", channel="update-conf")

    assert out["platform"] == "youtube" and out["channel"] == "update-conf"
    assert out["violations"] == [HARD_VIOLATION]
    assert stub.package_calls == [{"video_id": VIDEO_ID, "lang": "pl", "channel": "update-conf"}]


@pytest.mark.parametrize("platform", ["linkedin", "x", "instagram"])
def test_a_channel_with_a_non_default_platform_is_refused_without_a_call(
    stub: StubClient, platform: str
) -> None:
    out = publish.get_upload_package(VIDEO_ID, platform=platform, channel=IG_ID)

    assert out["status"] == "error"
    assert "'channel' or 'platform', not both" in out["error"] and platform in out["error"]
    assert stub.package_calls == []


def test_an_explicit_youtube_platform_beside_a_channel_is_the_default(stub: StubClient) -> None:
    out = publish.get_upload_package(VIDEO_ID, platform="youtube", channel=IG_ID)

    assert out["status"] == "ok"
    assert stub.package_calls == [{"video_id": VIDEO_ID, "channel": IG_ID}]


def test_a_channel_with_no_post_comes_back_as_the_backends_sentence(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient())
    stub.raises = http_error(404, f"Video {VIDEO_ID} has no post for channel {IG_ID!r}")

    out = publish.get_upload_package(VIDEO_ID, channel=IG_ID)

    assert out == {"status": "error",
                   "error": f"Video {VIDEO_ID} has no post for channel {IG_ID!r}"}


def test_without_a_channel_the_package_answer_is_unchanged(stub: StubClient) -> None:
    out = publish.get_upload_package(VIDEO_ID)

    assert set(out) == {"status", "platform", "text", "violations"}


def test_the_channel_parameters_are_the_contracts() -> None:
    validate = inspect.signature(publish.validate_video).parameters
    assert list(validate) == ["video_id", "lang", "channel"]
    package = inspect.signature(publish.get_upload_package).parameters
    assert list(package) == ["video_id", "platform", "lang", "channel"]
    assert package["platform"].default == "youtube"
    assert validate["channel"].default is None and package["channel"].default is None


def test_the_channel_docstrings_name_the_post_and_the_refusal() -> None:
    validate = " ".join((publish.validate_video.__doc__ or "").split())
    for words in ("channel", "posts.<channel>.<field>", "field_not_on_platform",
                  "primary channel's post"):
        assert words in validate, words
    package = " ".join((publish.get_upload_package.__doc__ or "").split())
    for words in ("channel", "platform", "is refused", "no_post", "primary channel's package"):
        assert words in package, words
