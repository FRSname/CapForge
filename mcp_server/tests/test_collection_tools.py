"""Unit tests for the collection MCP tools in `mcp_server/collection_tools.py`.

docs/plans/library-collections.md §MCP.

Same shape as `test_publish_tools.py`: a stub client over canned collections, so
the tools run with no CapForge up. What is under test is the seam — the upsert's
create-vs-patch branch, the body each write sends, and that every refusal the
routes define (404, 409 exists, 409 in use, 422) is a readable error dict.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
from typing import Any, Optional

import httpx
import pytest

from mcp_server import collection_tools
from mcp_server import library, server
from mcp_server.discovery import BackendNotFound

EVENT_ID = "uck26"
EVENT_NAME = "UCK 2026"
SLOTS = {"event": "UCK 2026", "sponsor": "Acme"}
EFFECTIVE_BRIEF = {"channel": "CapForge", "footer": "Recorded at {{event}}", "slots": SLOTS}


def collection(**over: Any) -> dict:
    base = {
        "id": EVENT_ID,
        "name": EVENT_NAME,
        "slots": dict(SLOTS),
        "overrides": {"footer": "Recorded at {{event}}"},
        "createdAt": "2026-09-15T10:00:00Z",
        "updatedAt": "2026-09-15T10:00:00Z",
        "members": 3,
    }
    return {**base, **over}


def http_error(status: int, body: Any, method: str = "GET") -> httpx.HTTPStatusError:
    request = httpx.Request(method, f"http://127.0.0.1:1/api/library/collections/{EVENT_ID}")
    response = httpx.Response(status, json=body, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


def not_found() -> httpx.HTTPStatusError:
    return http_error(404, {"detail": f"No collection with id {EVENT_ID}"})


class StubClient:
    """The CapForgeClient surface the collection tools use, over canned answers."""

    def __init__(self, *, stored: Optional[dict] = None, orphans: Optional[list] = None) -> None:
        self.stored = stored if stored is not None else {EVENT_ID: collection()}
        self.orphans = orphans if orphans is not None else []
        self.calls: list[tuple[str, Any]] = []
        self.raises: dict[str, Exception] = {}

    def _check(self, op: str) -> None:
        if op in self.raises:
            raise self.raises[op]

    def library_collections_list(self) -> dict:
        self.calls.append(("list", None))
        self._check("list")
        return {"collections": copy.deepcopy(list(self.stored.values())),
                "orphans": copy.deepcopy(self.orphans)}

    def library_collection_get(self, collection_id: str) -> dict:
        self.calls.append(("get", collection_id))
        self._check("get")
        if collection_id not in self.stored:
            raise not_found()
        return {**copy.deepcopy(self.stored[collection_id]),
                "effective_brief": copy.deepcopy(EFFECTIVE_BRIEF)}

    def library_collection_create(self, body: dict) -> dict:
        self.calls.append(("create", copy.deepcopy(body)))
        self._check("create")
        created = collection(id=body["id"], name=body["name"],
                             slots=body.get("slots", {}),
                             overrides=body.get("overrides", {}), members=0)
        self.stored = {**self.stored, body["id"]: created}
        return copy.deepcopy(created)

    def library_collection_patch(self, collection_id: str, patch: dict) -> dict:
        self.calls.append(("patch", (collection_id, copy.deepcopy(patch))))
        self._check("patch")
        merged = {**self.stored[collection_id], **patch}
        self.stored = {**self.stored, collection_id: merged}
        return {**copy.deepcopy(merged), "effective_brief": copy.deepcopy(EFFECTIVE_BRIEF)}

    def library_collection_delete(self, collection_id: str) -> dict:
        self.calls.append(("delete", collection_id))
        self._check("delete")
        return {}

    def ops(self) -> list[str]:
        return [op for op, _ in self.calls]


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubClient:
    client = StubClient()
    monkeypatch.setattr(server, "_client", client)
    return client


# --- list_collections -------------------------------------------------------

def test_list_collections_passes_collections_and_orphans_through(monkeypatch) -> None:
    client = StubClient(orphans=[{"id": "devconf", "members": 2}])
    monkeypatch.setattr(server, "_client", client)

    out = collection_tools.list_collections()

    assert out["status"] == "ok"
    assert out["count"] == 1
    assert out["collections"][0]["id"] == EVENT_ID
    assert out["collections"][0]["members"] == 3
    assert out["orphans"] == [{"id": "devconf", "members": 2}]


def test_list_collections_on_an_empty_library(monkeypatch) -> None:
    monkeypatch.setattr(server, "_client", StubClient(stored={}))

    out = collection_tools.list_collections()

    assert out == {"status": "ok", "count": 0, "collections": [], "orphans": []}


# --- get_collection ---------------------------------------------------------

def test_get_collection_lifts_the_effective_brief_beside_the_collection(stub) -> None:
    out = collection_tools.get_collection(EVENT_ID)

    assert out["status"] == "ok"
    assert out["effective_brief"] == EFFECTIVE_BRIEF
    assert out["collection"]["members"] == 3
    assert "effective_brief" not in out["collection"]


def test_get_collection_unknown_id_names_the_id_and_the_way_out(stub) -> None:
    out = collection_tools.get_collection("nope")

    assert out["status"] == "error"
    assert out["reason"] == "collection_not_found"
    assert "'nope'" in out["error"]
    assert "list_collections" in out["error"] and "set_collection" in out["error"]


@pytest.mark.parametrize("bad", ["", "   ", None, 7])
def test_per_id_tools_refuse_a_missing_id_without_a_call(stub, bad) -> None:
    for call in (
        lambda: collection_tools.get_collection(bad),
        lambda: collection_tools.set_collection(bad, name=EVENT_NAME),
        lambda: collection_tools.delete_collection(bad),
    ):
        out = call()
        assert out["status"] == "error" and "collection_id" in out["error"]
    assert stub.calls == []


# --- set_collection: the upsert ----------------------------------------------

def test_set_collection_creates_when_the_get_404s(monkeypatch) -> None:
    client = StubClient(stored={})
    monkeypatch.setattr(server, "_client", client)

    out = collection_tools.set_collection("devconf", name="DevConf", slots={"city": "Brno"})

    assert out["status"] == "ok" and out["created"] is True
    assert client.ops() == ["get", "create"]
    # Only what was given goes over the wire: an absent `overrides` is not `{}`.
    assert client.calls[1][1] == {"id": "devconf", "name": "DevConf", "slots": {"city": "Brno"}}
    assert out["collection"]["id"] == "devconf"


def test_set_collection_create_without_a_name_is_refused_before_the_post(monkeypatch) -> None:
    client = StubClient(stored={})
    monkeypatch.setattr(server, "_client", client)

    out = collection_tools.set_collection("devconf", slots={"city": "Brno"})

    assert out["status"] == "error"
    assert "'devconf'" in out["error"] and "name" in out["error"]
    assert client.ops() == ["get"]


def test_set_collection_patches_an_existing_one_with_only_the_given_fields(stub) -> None:
    out = collection_tools.set_collection(EVENT_ID, overrides={"footer": None})

    assert out["status"] == "ok" and out["created"] is False
    assert stub.ops() == ["get", "patch"]
    # `null` inside overrides is sent as-is: it is how a field inherits again.
    assert stub.calls[1][1] == (EVENT_ID, {"overrides": {"footer": None}})
    assert out["effective_brief"] == EFFECTIVE_BRIEF


def test_set_collection_patch_sends_name_and_slots_together(stub) -> None:
    collection_tools.set_collection(EVENT_ID, name="UCK 26", slots={"sponsor": "Globex"})

    assert stub.calls[1][1] == (EVENT_ID, {"name": "UCK 26", "slots": {"sponsor": "Globex"}})


def test_set_collection_with_nothing_to_set_makes_no_call(stub) -> None:
    out = collection_tools.set_collection(EVENT_ID)

    assert out["status"] == "error"
    assert stub.calls == []


@pytest.mark.parametrize("kwargs", [
    {"slots": ["event", "UCK"]},
    {"slots": {"event": 2026}},
    {"slots": {7: "x"}},
    {"overrides": "footer"},
    {"name": ""},
    {"name": 42},
])
def test_set_collection_refuses_a_malformed_argument_without_a_call(stub, kwargs) -> None:
    out = collection_tools.set_collection(EVENT_ID, **kwargs)

    assert out["status"] == "error"
    assert stub.calls == []


def test_set_collection_does_not_mutate_the_callers_dicts(monkeypatch) -> None:
    client = StubClient(stored={})
    monkeypatch.setattr(server, "_client", client)
    slots = {"city": "Brno"}
    overrides = {"default_hashtags": ["#DevConf"]}

    collection_tools.set_collection("devconf", name="DevConf", slots=slots, overrides=overrides)
    client.calls[1][1]["slots"]["city"] = "changed"

    assert slots == {"city": "Brno"}
    assert overrides == {"default_hashtags": ["#DevConf"]}


def test_set_collection_a_failed_get_that_is_not_a_404_never_creates(stub) -> None:
    stub.raises["get"] = http_error(500, {"detail": "collections.json is corrupt: line 1"})

    out = collection_tools.set_collection(EVENT_ID, name=EVENT_NAME)

    assert out == {"status": "error", "error": "collections.json is corrupt: line 1"}
    assert stub.ops() == ["get"]


def test_set_collection_create_race_maps_the_409(monkeypatch) -> None:
    client = StubClient(stored={})
    client.raises["create"] = http_error(409, {"reason": "collection_exists"}, "POST")
    monkeypatch.setattr(server, "_client", client)

    out = collection_tools.set_collection("devconf", name="DevConf")

    assert out["status"] == "error" and out["reason"] == "collection_exists"
    assert "'devconf'" in out["error"] and "get_collection" in out["error"]


def test_set_collection_bad_slot_name_422_names_the_field(stub) -> None:
    stub.raises["patch"] = http_error(422, {"detail": [
        {"loc": ["body", "slots", "Event"], "msg": "slot names match ^[a-z][a-z0-9_]{0,31}$"},
    ]}, "PATCH")

    out = collection_tools.set_collection(EVENT_ID, slots={"Event": "x"})

    assert out["status"] == "error"
    assert "slots.Event" in out["error"]


def test_a_422_with_a_sentence_detail_comes_back_verbatim(stub) -> None:
    detail = "Slot name 'title' shadows a built-in slot"
    stub.raises["patch"] = http_error(422, {"detail": detail}, "PATCH")

    out = collection_tools.set_collection(EVENT_ID, slots={"title": "x"})

    assert out == {"status": "error", "error": detail}


def test_a_422_with_an_object_detail_uses_its_message(stub) -> None:
    stub.raises["create"] = http_error(
        422, {"detail": {"reason": "invalid_id", "message": "Bad collection id 'UCK 26'"}}, "POST",
    )
    stub.stored = {}

    out = collection_tools.set_collection("UCK 26", name="UCK")

    assert out["status"] == "error"
    assert out["error"] == "Bad collection id 'UCK 26'"
    assert out["reason"] == "invalid_id"


# --- set_collection: parent_id (folders inside folders) ----------------------

def test_set_collection_creates_inside_a_folder(monkeypatch) -> None:
    client = StubClient(stored={})
    monkeypatch.setattr(server, "_client", client)

    out = collection_tools.set_collection("day-1", name="Day 1", parent_id=EVENT_ID)

    assert out["status"] == "ok" and out["created"] is True
    assert client.calls[1][1] == {"id": "day-1", "name": "Day 1", "parent_id": EVENT_ID}


def test_set_collection_moves_with_only_parent_id(stub) -> None:
    out = collection_tools.set_collection(EVENT_ID, parent_id="events")

    assert out["status"] == "ok" and out["created"] is False
    assert stub.calls[1][1] == (EVENT_ID, {"parent_id": "events"})


@pytest.mark.parametrize("top_level", ["", "  "])
def test_an_empty_parent_id_moves_to_the_top_level_as_null(stub, top_level) -> None:
    out = collection_tools.set_collection(EVENT_ID, parent_id=top_level)

    assert out["status"] == "ok"
    assert stub.calls[1][1] == (EVENT_ID, {"parent_id": None})


def test_an_omitted_parent_id_is_never_sent(stub) -> None:
    collection_tools.set_collection(EVENT_ID, name="UCK 26")

    assert "parent_id" not in stub.calls[1][1][1]


@pytest.mark.parametrize("bad", [7, ["events"], {"id": "events"}, True])
def test_a_parent_id_that_is_not_a_string_is_refused_without_a_call(stub, bad) -> None:
    out = collection_tools.set_collection(EVENT_ID, parent_id=bad)

    assert out["status"] == "error" and "parent_id" in out["error"]
    assert stub.calls == []


@pytest.mark.parametrize("reason,hint", [
    ("unknown_parent", "list_collections"),
    ("collection_cycle", "not this one or inside it"),
    ("collection_too_deep", "higher up"),
])
def test_nesting_refusals_keep_the_backends_sentence_and_add_the_way_out(stub, reason, hint) -> None:
    detail = "No collection has the id 'nope' to hold this one"
    stub.raises["patch"] = http_error(422, {"reason": reason, "detail": detail}, "PATCH")

    out = collection_tools.set_collection(EVENT_ID, parent_id="nope")

    assert out["status"] == "error" and out["reason"] == reason
    assert out["error"].startswith(detail + ". ") and hint in out["error"]


def test_set_collection_docstring_explains_parent_id() -> None:
    doc = " ".join((collection_tools.set_collection.__doc__ or "").split())

    assert "`parent_id`" in doc and '`""` moves it to the top level' in doc
    assert "`None`" in doc and "8 levels" in doc


def test_list_and_get_docstrings_name_the_tree_fields() -> None:
    for fn in (collection_tools.list_collections, collection_tools.get_collection):
        doc = fn.__doc__ or ""
        assert "parent_id" in doc and "path" in doc and "total_members" in doc


# --- delete_collection ------------------------------------------------------

def test_delete_collection_confirms_the_id(stub) -> None:
    out = collection_tools.delete_collection(EVENT_ID)

    assert out == {"status": "ok", "deleted": EVENT_ID}
    assert stub.ops() == ["delete"]


@pytest.mark.parametrize("body", [
    {"reason": "collection_in_use", "members": 3},
    {"detail": {"reason": "collection_in_use", "members": 3}},
    {"detail": "Collection uck26 has 3 members", "reason": "collection_in_use", "members": 3},
], ids=["top-level", "under-detail", "sentence-plus-reason"])
def test_delete_in_use_names_the_member_count_and_how_to_move_them(stub, body) -> None:
    stub.raises["delete"] = http_error(409, body, "DELETE")

    out = collection_tools.delete_collection(EVENT_ID)

    assert out["status"] == "error"
    assert out["reason"] == "collection_in_use"
    assert out["members"] == 3
    assert "3 videos" in out["error"]
    assert "set_video_meta" in out["error"] and '"collection_id": null' in out["error"]
    assert f'list_videos(collection="{EVENT_ID}")' in out["error"]


def test_delete_in_use_with_one_member_is_singular(stub) -> None:
    stub.raises["delete"] = http_error(409, {"reason": "collection_in_use", "members": 1}, "DELETE")

    out = collection_tools.delete_collection(EVENT_ID)

    assert "has 1 video," in out["error"] and "1 videos" not in out["error"]


def test_delete_in_use_accepts_a_member_list(stub) -> None:
    stub.raises["delete"] = http_error(
        409, {"reason": "collection_in_use", "members": ["a", "b"]}, "DELETE",
    )

    out = collection_tools.delete_collection(EVENT_ID)

    assert out["members"] == 2 and "2 videos" in out["error"]


@pytest.mark.parametrize("count,words", [(2, "2 subfolders"), (1, "1 subfolder,")])
def test_delete_with_subfolders_names_the_count_and_how_to_move_them(stub, count, words) -> None:
    stub.raises["delete"] = http_error(
        409, {"reason": "collection_has_children", "children": count, "detail": "x"}, "DELETE",
    )

    out = collection_tools.delete_collection(EVENT_ID)

    assert out["status"] == "error" and out["reason"] == "collection_has_children"
    assert out["children"] == count and words in out["error"]
    assert 'parent_id="")' in out["error"]


def test_delete_unknown_collection_is_the_not_found_sentence(stub) -> None:
    stub.raises["delete"] = not_found()

    out = collection_tools.delete_collection(EVENT_ID)

    assert out["reason"] == "collection_not_found"


def test_a_409_with_an_unknown_reason_keeps_the_backends_words(stub) -> None:
    stub.raises["delete"] = http_error(409, {"detail": "Something else entirely"}, "DELETE")

    out = collection_tools.delete_collection(EVENT_ID)

    assert out == {"status": "error", "error": "Something else entirely"}


# --- the shared failure modes -------------------------------------------------

def test_a_closed_app_says_so_in_plain_words(stub) -> None:
    for op in ("list", "get", "delete"):
        stub.raises[op] = BackendNotFound("Could not reach the CapForge backend")

    for call in (
        collection_tools.list_collections,
        lambda: collection_tools.get_collection(EVENT_ID),
        lambda: collection_tools.set_collection(EVENT_ID, name=EVENT_NAME),
        lambda: collection_tools.delete_collection(EVENT_ID),
    ):
        assert call() == {"status": "error", "error": library.NOT_RUNNING}


def test_an_unexpected_exception_still_propagates(stub) -> None:
    stub.raises["list"] = KeyError("a bug, not an answer")

    with pytest.raises(KeyError):
        collection_tools.list_collections()


# --- registration -----------------------------------------------------------

def test_the_tool_group_is_the_four_the_plan_lists() -> None:
    assert [fn.__name__ for fn in collection_tools.TOOLS] == [
        "list_collections", "get_collection", "set_collection", "delete_collection",
    ]


def test_every_collection_tool_is_registered_on_the_server() -> None:
    names = {tool.name for tool in asyncio.run(server.mcp.list_tools())}

    assert {fn.__name__ for fn in collection_tools.TOOLS} <= names


def test_set_collection_signature_is_the_planned_one() -> None:
    """`parent_id` joined last (docs/plans/library-finder.md §2.5), so positional
    callers of the first four are unaffected."""
    params = inspect.signature(collection_tools.set_collection).parameters

    assert list(params) == ["collection_id", "name", "slots", "overrides", "parent_id"]
    assert all(params[p].default is None for p in ("name", "slots", "overrides", "parent_id"))


def test_set_collection_docstring_states_the_merge_rules() -> None:
    doc = " ".join((collection_tools.set_collection.__doc__ or "").split())

    assert "replace" in doc and "lists and blocks replace" in doc
    assert "`null`" in doc and "inherit" in doc
    assert "key-wise" in doc
    assert "every member's package" in doc and "no per-video write" in doc


def test_every_tool_has_a_docstring() -> None:
    for fn in collection_tools.TOOLS:
        assert (fn.__doc__ or "").strip(), f"{fn.__name__} has no docstring"
    assert "effective_brief" in (collection_tools.get_collection.__doc__ or "")
    assert "set_video_meta" in (collection_tools.delete_collection.__doc__ or "")


def test_collections_never_imports_the_server_module() -> None:
    with open(collection_tools.__file__ or "", encoding="utf-8") as handle:
        text = handle.read()
    assert "import server" not in text and "from .server" not in text
