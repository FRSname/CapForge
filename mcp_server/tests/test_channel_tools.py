"""Unit tests for the channel MCP tools in `mcp_server/channel_tools.py`.

docs/plans/multi-channel-pr1-contract.md → MCP. Same shape as
`test_collection_tools.py`: a stub client over canned channels, so the tools run
with no CapForge up. Under test is the seam — the upsert's create-vs-patch
branch, what each write sends, the client-side refusals, and that every refusal
the routes define comes back as a readable error dict carrying its `reason`.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
from typing import Any, Optional

import httpx
import pytest

from mcp_server import channel_tools, library, server
from mcp_server.discovery import BackendNotFound

PRIMARY_ID = "update-conf"
IG_ID = "filip-ig"

#: What `?include_recent_posts=true` adds (multi-channel PR 2 contract → Channels).
RECENT_POSTS = [
    {"video_id": "v2", "title": "Second talk", "text": "Newer body", "hashtags": ["#dev"],
     "url": "https://youtu.be/two", "at": "2026-09-10T10:00:00Z"},
    {"video_id": "v1", "title": "First talk", "text": "Older body", "hashtags": [],
     "url": "https://youtu.be/one", "at": "2026-09-01T10:00:00Z"},
]


def channel(**over: Any) -> dict:
    base = {
        "id": PRIMARY_ID, "platform": "youtube", "name": "Update Conference",
        "handle": "", "url": "", "language": "cs",
        "context": {"about": "", "audience": "devs", "voice": "plain", "title_style": "",
                    "example_titles": [], "naming": "", "example_slugs": [],
                    "keywords": [], "notes": ""},
        "profile": {"footer": "Thanks", "default_hashtags": []},
        "createdAt": "2026-09-15T10:00:00Z", "updatedAt": "2026-09-15T10:00:00Z",
        "primary": True,
    }
    return {**base, **over}


def http_error(status: int, body: Any, method: str = "GET") -> httpx.HTTPStatusError:
    request = httpx.Request(method, "http://127.0.0.1:1/api/library/channels/x")
    response = httpx.Response(status, json=body, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


def not_found() -> httpx.HTTPStatusError:
    return http_error(404, {"detail": "No channel with id 'x'"})


class StubClient:
    """The CapForgeClient surface the channel tools use, over canned answers."""

    def __init__(self, *, stored: Optional[dict] = None, primary_id: str = PRIMARY_ID) -> None:
        self.stored = stored if stored is not None else {PRIMARY_ID: channel()}
        self.primary_id = primary_id
        self.calls: list[tuple[str, Any]] = []
        self.raises: dict[str, Exception] = {}

    def _check(self, op: str) -> None:
        if op in self.raises:
            raise self.raises[op]

    def _view(self, channel_id: str) -> dict:
        return {**copy.deepcopy(self.stored[channel_id]), "primary": channel_id == self.primary_id}

    def _book(self) -> dict:
        return {"primary_id": self.primary_id, "channels": [self._view(i) for i in self.stored]}

    def library_channels_list(self) -> dict:
        self.calls.append(("list", None))
        self._check("list")
        return self._book()

    def library_channel_get(self, channel_id: str, **query: Any) -> dict:
        # A plain read records just the id, so every PR 1 assertion still holds.
        self.calls.append(("get", (channel_id, dict(query)) if query else channel_id))
        self._check("get")
        if channel_id not in self.stored:
            raise not_found()
        view = self._view(channel_id)
        if query.get("include_recent_posts"):
            return {**view, "recent_posts": copy.deepcopy(RECENT_POSTS[: query["limit"]])}
        return view

    def library_channel_create(self, body: dict) -> dict:
        self.calls.append(("create", copy.deepcopy(body)))
        self._check("create")
        created = channel(**{k: v for k, v in body.items()}, primary=False)
        self.stored = {**self.stored, body["id"]: created}
        return self._view(body["id"])

    def library_channel_patch(self, channel_id: str, patch: dict) -> dict:
        self.calls.append(("patch", (channel_id, copy.deepcopy(patch))))
        self._check("patch")
        self.stored = {**self.stored, channel_id: {**self.stored[channel_id], **patch}}
        return self._view(channel_id)

    def library_channel_delete(self, channel_id: str) -> dict:
        self.calls.append(("delete", channel_id))
        self._check("delete")
        return {}

    def library_channel_set_primary(self, channel_id: str) -> dict:
        self.calls.append(("primary", channel_id))
        self._check("primary")
        self.primary_id = channel_id
        return self._book()

    def ops(self) -> list[str]:
        return [op for op, _ in self.calls]


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubClient:
    client = StubClient()
    monkeypatch.setattr(server, "_client", client)
    return client


# --- list / get --------------------------------------------------------------

def test_list_channels_passes_the_book_through(stub) -> None:
    out = channel_tools.list_channels()

    assert out["status"] == "ok" and out["count"] == 1
    assert out["primary_id"] == PRIMARY_ID
    assert out["channels"][0]["primary"] is True


def test_get_channel_answers_the_channel(stub) -> None:
    out = channel_tools.get_channel(PRIMARY_ID)

    assert out["status"] == "ok"
    assert out["channel"]["context"]["voice"] == "plain"


def test_get_channel_docstring_says_it_is_the_read_before_writing() -> None:
    doc = " ".join((channel_tools.get_channel.__doc__ or "").split())
    for words in ("before writing", "context", "profile", "example_titles", "never copy"):
        assert words in doc, words


def test_get_unknown_channel_names_the_way_out(stub) -> None:
    out = channel_tools.get_channel("nope")

    assert out["status"] == "error" and out["reason"] == "channel_not_found"
    assert "'nope'" in out["error"]
    assert "list_channels" in out["error"] and "set_channel" in out["error"]


@pytest.mark.parametrize("bad", ["", "   ", None, 7])
def test_per_id_tools_refuse_a_missing_id_without_a_call(stub, bad) -> None:
    for call in (
        lambda: channel_tools.get_channel(bad),
        lambda: channel_tools.set_channel(bad, platform="x", name="X"),
        lambda: channel_tools.delete_channel(bad),
    ):
        out = call()
        assert out["status"] == "error" and "channel_id" in out["error"]
    assert stub.calls == []


# --- set_channel: the upsert -----------------------------------------------------

def test_set_channel_creates_when_the_get_404s(stub) -> None:
    out = channel_tools.set_channel(IG_ID, platform="instagram", name="Filip IG",
                                    context={"about": "Behind the scenes"})

    assert out["status"] == "ok" and out["created"] is True
    assert stub.ops() == ["get", "create"]
    assert stub.calls[1][1] == {"id": IG_ID, "platform": "instagram", "name": "Filip IG",
                                "context": {"about": "Behind the scenes"}}
    assert out["channel"]["id"] == IG_ID and out["channel"]["primary"] is False


@pytest.mark.parametrize("missing", ["platform", "name"])
def test_create_without_platform_or_name_is_refused_before_the_post(stub, missing) -> None:
    kwargs = {"platform": "instagram", "name": "Filip IG"}
    kwargs.pop(missing)

    out = channel_tools.set_channel(IG_ID, **kwargs)

    assert out["status"] == "error"
    assert missing in out["error"] and f"'{IG_ID}'" in out["error"]
    assert stub.ops() == ["get"]


def test_set_channel_patches_only_the_given_fields(stub) -> None:
    out = channel_tools.set_channel(PRIMARY_ID, handle="@update",
                                    context={"keywords": ["dev"]}, profile={"footer": "F"})

    assert out["status"] == "ok" and out["created"] is False
    assert stub.ops() == ["get", "patch"]
    assert stub.calls[1][1] == (PRIMARY_ID, {"handle": "@update", "context": {"keywords": ["dev"]},
                                             "profile": {"footer": "F"}})


def test_changing_the_platform_is_refused_client_side(stub) -> None:
    out = channel_tools.set_channel(PRIMARY_ID, platform="tiktok", name="Renamed")

    assert out["status"] == "error"
    assert "platform" in out["error"] and "youtube" in out["error"]
    assert stub.ops() == ["get"]


def test_restating_the_same_platform_is_not_a_change(stub) -> None:
    out = channel_tools.set_channel(PRIMARY_ID, platform="youtube", name="Renamed")

    assert out["status"] == "ok"
    assert stub.calls[1][1] == (PRIMARY_ID, {"name": "Renamed"})


def test_primary_true_calls_the_primary_route_after_the_write(stub) -> None:
    stub.stored = {**stub.stored, "second": channel(id="second", name="Second")}

    out = channel_tools.set_channel("second", name="Second YT", primary=True)

    assert stub.ops() == ["get", "patch", "primary"]
    assert out["status"] == "ok" and out["channel"]["primary"] is True
    assert out["channel"]["name"] == "Second YT"


def test_primary_alone_is_enough_to_set(stub) -> None:
    stub.stored = {**stub.stored, "second": channel(id="second")}

    out = channel_tools.set_channel("second", primary=True)

    assert stub.ops() == ["get", "primary"]
    assert out["channel"]["primary"] is True and out["primary_id"] == "second"


def test_create_with_primary_true(stub) -> None:
    out = channel_tools.set_channel("second", platform="youtube", name="Second", primary=True)

    assert stub.ops() == ["get", "create", "primary"]
    assert out["created"] is True and out["channel"]["primary"] is True


def test_a_non_youtube_primary_relays_the_reason(stub) -> None:
    stub.stored = {**stub.stored, IG_ID: channel(id=IG_ID, platform="instagram")}
    stub.raises["primary"] = http_error(422, {
        "reason": "primary_not_youtube",
        "detail": "Channel 'filip-ig' is on instagram, and the primary channel is always a YouTube channel",
    }, "POST")

    out = channel_tools.set_channel(IG_ID, primary=True)

    assert out["status"] == "error" and out["reason"] == "primary_not_youtube"
    assert "YouTube" in out["error"]


def test_primary_false_is_refused_without_a_call(stub) -> None:
    out = channel_tools.set_channel(PRIMARY_ID, primary=False)

    assert out["status"] == "error" and "primary=True" in out["error"]
    assert stub.calls == []


def test_set_channel_with_nothing_to_set_makes_no_call(stub) -> None:
    out = channel_tools.set_channel(PRIMARY_ID)

    assert out["status"] == "error"
    assert stub.calls == []


@pytest.mark.parametrize("kwargs", [
    {"name": ""}, {"name": 42}, {"handle": 7}, {"url": ["x"]}, {"language": 1},
    {"context": "about"}, {"profile": ["footer"]}, {"platform": 3}, {"primary": "yes"},
])
def test_set_channel_refuses_a_malformed_argument_without_a_call(stub, kwargs) -> None:
    out = channel_tools.set_channel(PRIMARY_ID, **kwargs)

    assert out["status"] == "error"
    assert stub.calls == []


def test_set_channel_does_not_mutate_the_callers_dicts(stub) -> None:
    context = {"example_titles": ["One"]}

    channel_tools.set_channel(PRIMARY_ID, context=context)
    stub.calls[1][1][1]["context"]["example_titles"].append("leak")

    assert context == {"example_titles": ["One"]}


def test_a_failed_get_that_is_not_a_404_never_creates(stub) -> None:
    stub.raises["get"] = http_error(500, {"detail": "channels.json is not valid JSON: line 1"})

    out = channel_tools.set_channel(IG_ID, platform="instagram", name="IG")

    assert out == {"status": "error", "error": "channels.json is not valid JSON: line 1"}
    assert stub.ops() == ["get"]


def test_the_create_race_maps_the_409(stub) -> None:
    stub.raises["create"] = http_error(409, {"reason": "channel_exists", "detail": "taken"}, "POST")

    out = channel_tools.set_channel(IG_ID, platform="instagram", name="IG")

    assert out["status"] == "error" and out["reason"] == "channel_exists"
    assert f"'{IG_ID}'" in out["error"] and "get_channel" in out["error"]


def test_a_pydantic_422_names_the_field(stub) -> None:
    stub.raises["patch"] = http_error(422, {"detail": [
        {"loc": ["body", "profile", "slots"], "msg": "Slot name 'footer' shadows a built-in slot"},
    ]}, "PATCH")

    out = channel_tools.set_channel(PRIMARY_ID, profile={"slots": {"footer": "x"}})

    assert out["status"] == "error" and "profile.slots" in out["error"]


# --- delete_channel --------------------------------------------------------------

def test_delete_channel_confirms_the_id(stub) -> None:
    out = channel_tools.delete_channel(IG_ID)

    assert out == {"status": "ok", "deleted": IG_ID}


def test_deleting_the_primary_relays_the_reason_and_the_way_out(stub) -> None:
    stub.raises["delete"] = http_error(409, {
        "reason": "channel_is_primary", "detail": "Channel 'update-conf' is the primary channel",
    }, "DELETE")

    out = channel_tools.delete_channel(PRIMARY_ID)

    assert out["status"] == "error" and out["reason"] == "channel_is_primary"
    assert "primary=True" in out["error"] and "set_channel" in out["error"]


def test_delete_unknown_is_the_not_found_sentence(stub) -> None:
    stub.raises["delete"] = not_found()

    assert channel_tools.delete_channel("nope")["reason"] == "channel_not_found"


def test_a_409_with_an_unknown_reason_keeps_the_backends_words(stub) -> None:
    stub.raises["delete"] = http_error(409, {"detail": "Something else"}, "DELETE")

    assert channel_tools.delete_channel(IG_ID) == {"status": "error", "error": "Something else"}


# --- the shared failure modes -------------------------------------------------------

def test_a_closed_app_says_so_in_plain_words(stub) -> None:
    for op in ("list", "get", "delete"):
        stub.raises[op] = BackendNotFound("Could not reach the CapForge backend")

    for call in (
        channel_tools.list_channels,
        lambda: channel_tools.get_channel(PRIMARY_ID),
        lambda: channel_tools.set_channel(PRIMARY_ID, name="X"),
        lambda: channel_tools.delete_channel(PRIMARY_ID),
    ):
        assert call() == {"status": "error", "error": library.NOT_RUNNING}


def test_an_unexpected_exception_still_propagates(stub) -> None:
    stub.raises["list"] = KeyError("a bug, not an answer")

    with pytest.raises(KeyError):
        channel_tools.list_channels()


# --- registration -------------------------------------------------------------------

def test_the_tool_group_is_the_four_the_contract_lists() -> None:
    assert [fn.__name__ for fn in channel_tools.TOOLS] == [
        "list_channels", "get_channel", "set_channel", "delete_channel",
    ]


def test_every_channel_tool_is_registered_on_the_server() -> None:
    names = {tool.name for tool in asyncio.run(server.mcp.list_tools())}

    assert {fn.__name__ for fn in channel_tools.TOOLS} <= names


def test_set_channel_signature_is_the_contracts() -> None:
    params = inspect.signature(channel_tools.set_channel).parameters

    assert list(params) == ["channel_id", "platform", "name", "handle", "url", "language",
                            "context", "profile", "primary"]
    assert all(params[p].default is None for p in list(params)[1:])


# --- recent posts (docs/plans/multi-channel-pr2-contract.md → Channels) ------------

def test_get_channel_asks_for_no_recent_posts_by_default(stub) -> None:
    out = channel_tools.get_channel(PRIMARY_ID)

    assert stub.calls == [("get", PRIMARY_ID)]
    assert "recent_posts" not in out["channel"]


def test_get_channel_with_recent_posts_sends_the_flag_and_the_limit(stub) -> None:
    out = channel_tools.get_channel(PRIMARY_ID, include_recent_posts=True, limit=1)

    assert stub.calls == [("get", (PRIMARY_ID, {"include_recent_posts": True, "limit": 1}))]
    assert out["status"] == "ok"
    assert out["channel"]["recent_posts"] == RECENT_POSTS[:1]


def test_a_limit_without_the_flag_sends_nothing_extra(stub) -> None:
    channel_tools.get_channel(PRIMARY_ID, limit=20)

    assert stub.calls == [("get", PRIMARY_ID)]


@pytest.mark.parametrize("limit", [1, 50])
def test_the_limit_bounds_are_inclusive(stub, limit) -> None:
    out = channel_tools.get_channel(PRIMARY_ID, include_recent_posts=True, limit=limit)

    assert out["status"] == "ok"


@pytest.mark.parametrize("limit", [0, 51, -1, True, 2.5, "10", None])
def test_a_limit_outside_1_to_50_is_refused_without_a_call(stub, limit) -> None:
    out = channel_tools.get_channel(PRIMARY_ID, include_recent_posts=True, limit=limit)

    assert out["status"] == "error"
    assert "'limit'" in out["error"] and "1 to 50" in out["error"]
    assert stub.calls == []


@pytest.mark.parametrize("flag", ["yes", 1, None])
def test_include_recent_posts_must_be_true_or_false(stub, flag) -> None:
    out = channel_tools.get_channel(PRIMARY_ID, include_recent_posts=flag)

    assert out["status"] == "error" and "include_recent_posts" in out["error"]
    assert stub.calls == []


def test_an_unknown_channel_with_recent_posts_is_still_the_not_found_sentence(stub) -> None:
    out = channel_tools.get_channel("nope", include_recent_posts=True)

    assert out["status"] == "error" and out["reason"] == "channel_not_found"


def test_get_channel_docstring_keeps_recent_posts_opt_in() -> None:
    doc = " ".join((channel_tools.get_channel.__doc__ or "").split())

    assert "`include_recent_posts=True` **only when the user explicitly asks**" in doc
    for words in ("inspiration from older videos", "this video alone", "`recent_posts`",
                  "1 to 50"):
        assert words in doc, words


def test_get_channel_signature_is_the_contracts() -> None:
    params = inspect.signature(channel_tools.get_channel).parameters

    assert list(params) == ["channel_id", "include_recent_posts", "limit"]
    assert params["include_recent_posts"].default is False
    assert params["limit"].default == 10
