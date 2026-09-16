"""Collection MCP tools — an event's shared boilerplate, stated once.

A collection (a conference, a series) holds what its videos share: **slots**
(named values such as `event` or `sponsor`) and **overrides** (channel brief
fields restated for the event: footer, recorded-at line, hashtags, the
description template…). A video joins by its record's `collection_id`, written
with `set_video_meta`. Nothing is copied onto the members: each member's upload
package is rendered at read time from its record plus the *effective brief*, so
one collection write updates every member's package (plan decision 3).

Collections nest like folders (docs/plans/library-finder.md §2): `parent_id`
names the collection one sits inside, and a member inherits from every folder
above its own. MCP cannot tell an omitted argument from `null`, so
`set_collection(parent_id="")` is the way to say "move to the top level".

Same shape as `library.py` and `publish.py`: `TOOLS`, `register(mcp,
get_client)`, the client resolved per call, **no import of `server`**, and
every failure is an error *dict* (`collection_call`) rather than a raised
exception.
"""

from __future__ import annotations

import copy
from typing import Any, Callable, Optional

import httpx

from .collection_errors import collection_call, is_not_found, not_found_message
from .library_errors import _OK, _fail, _library_call

#: The key a collection detail carries the merged brief under.
EFFECTIVE_BRIEF = "effective_brief"
#: `set_collection(parent_id=TOP_LEVEL)` moves a collection out of every folder.
TOP_LEVEL = ""

ClientFactory = Callable[[], Any]

_get_client: Optional[ClientFactory] = None


def _capforge() -> Any:
    """The live HTTP client, resolved at call time (never cached here)."""
    if _get_client is None:  # pragma: no cover - register() runs at import
        raise RuntimeError("mcp_server.collection_tools was never registered on the MCP server")
    return _get_client()


# --- boundary checks --------------------------------------------------------

def _id_problem(collection_id: Any) -> Optional[str]:
    if isinstance(collection_id, str) and collection_id.strip():
        return None
    return "Pass the 'collection_id' (e.g. \"uck26\"): lowercase letters, digits and hyphens."


def _argument_problem(
    name: Any, slots: Any, overrides: Any, parent_id: Any = None
) -> Optional[str]:
    """Why the arguments cannot be sent, or None. The backend stays the
    authority on id and slot-name syntax; this only refuses wrong *types*."""
    if name is not None and not (isinstance(name, str) and name.strip()):
        return "'name' must be a non-empty string."
    if parent_id is not None and not isinstance(parent_id, str):
        return ("'parent_id' must be a collection id string, or \"\" to move the "
                "collection to the top level.")
    if slots is not None:
        if not isinstance(slots, dict):
            return "'slots' must be an object of slot name to text, e.g. {\"event\": \"UCK 2026\"}."
        if any(not isinstance(k, str) or not isinstance(v, str) for k, v in slots.items()):
            return "Every slot name and slot value must be a string."
    if overrides is not None and not isinstance(overrides, dict):
        return "'overrides' must be an object of brief fields, e.g. {\"footer\": \"…\"}."
    return None


def _given(
    name: Optional[str],
    slots: Optional[dict],
    overrides: Optional[dict],
    parent_id: Optional[str] = None,
) -> dict:
    """Only the arguments that were passed, as fresh copies (never aliased).

    `parent_id=""` (blank, too) becomes `null` on the wire: the top level."""
    given: dict[str, Any] = {}
    if name is not None:
        given["name"] = name
    if parent_id is not None:
        given["parent_id"] = parent_id.strip() or None
    if slots is not None:
        given["slots"] = dict(slots)
    if overrides is not None:
        given["overrides"] = copy.deepcopy(overrides)
    return given


def _detail_view(body: dict) -> dict:
    """`{collection, effective_brief?}` — the brief lifted out beside it."""
    collection = {k: v for k, v in body.items() if k != EFFECTIVE_BRIEF}
    if EFFECTIVE_BRIEF not in body:
        return {"collection": collection}
    return {"collection": collection, EFFECTIVE_BRIEF: body[EFFECTIVE_BRIEF]}


def _exists(client: Any, collection_id: str) -> bool:
    """True when the GET answers; a 404 is False; any other failure raises."""
    try:
        client.library_collection_get(collection_id)
    except httpx.HTTPStatusError as exc:
        if is_not_found(exc):
            return False
        raise
    return True


# --- Tools ------------------------------------------------------------------

def list_collections() -> dict:
    """List the library's collections (events, series, folders) and the orphan ids.

    Each collection carries `id`, `name`, `parent_id`, `slots`, `overrides`,
    `createdAt`, `updatedAt`, `members` (how many videos have that
    `collection_id`), `total_members` (members plus every subfolder's) and
    `path` (folder names from the top level down to this one, e.g.
    `["Events", "UCK 2026", "Day 1"]`). The list is flat: build the tree from
    `parent_id` (`null` is the top level).
    `orphans` lists ids that videos already carry but no collection defines,
    as `[{id, members}]`: adopt one with `set_collection(<that exact id>,
    name=…)`. Works with the app's window closed.
    """
    def _call() -> dict:
        listed = _capforge().library_collections_list() or {}
        collections = listed.get("collections") or []
        return {
            "status": _OK,
            "count": len(collections),
            "collections": collections,
            "orphans": listed.get("orphans") or [],
        }

    return _library_call(_call)


def get_collection(collection_id: str) -> dict:
    """Read one collection with its member count and its `effective_brief`.

    The collection carries `parent_id`, `path` (where it sits, e.g.
    `["Events", "UCK 2026"]` — use it to tell the user) and `total_members`.
    `effective_brief` is the channel brief with this collection applied, after
    every folder above it: its overrides replace the channel's fields and its
    slots merge over the channel's. For a video whose record has this `collection_id` it is *the*
    brief: read it once per collection instead of `get_brief`, and never paste
    what its template renders (footer, recorded-at line, hashtags, links) into
    a video's `description`.
    """
    problem = _id_problem(collection_id)
    if problem:
        return _fail(problem)

    def _call() -> dict:
        body = _capforge().library_collection_get(collection_id) or {}
        return {"status": _OK, **_detail_view(body)}

    return collection_call(_call, collection_id)


def set_collection(
    collection_id: str,
    name: Optional[str] = None,
    slots: Optional[dict[str, str]] = None,
    overrides: Optional[dict[str, Any]] = None,
    parent_id: Optional[str] = None,
) -> dict:
    """Create a collection, or change one — an upsert keyed on `collection_id`.

    When no collection has that id it is created, and `name` is required. An id
    is lowercase letters, digits and hyphens; creating one with an orphan id
    (from `list_collections`) adopts the videos that already carry it. When it
    exists, only the arguments you pass are sent.

    - `overrides` are channel brief fields for this event (`footer`,
      `recorded_at_line`, `default_hashtags`, `link_rows`, `house_rules`,
      `description_template`, …). An override replaces the channel's value
      whole: lists and blocks replace too, they never append. `null` for a
      field means inherit the channel's value again. Fields you leave out of
      `overrides` keep what the collection already had.
    - `slots` are `{{name}}` template variables (`event`, `sponsor`,
      `feedback_url`…). At render time they merge key-wise over the channel's
      slots. The dict you send becomes the collection's whole slot set, so read
      `get_collection` first and send back the slots you want to keep. Slot
      names are lowercase, start with a letter, and may not reuse a built-in
      slot (`title`, `footer`, `chapters`…).

    - `parent_id` places the collection inside another (a folder inside a
      folder): a collection id creates it there or moves it there with its
      whole subtree; `""` moves it to the top level; leaving it out (`None`)
      keeps it where it is. Members inherit from every folder above: slots
      merge down the chain (the deepest value wins) and each override is the
      deepest one that is set. A folder cannot go inside itself or its own
      subfolder, and folders nest at most 8 levels deep.

    Changing a collection changes every member's package on its next
    `get_upload_package`, with no per-video write: that is how an event's
    footers are regenerated. Never rewrite member descriptions for it.
    """
    problem = _id_problem(collection_id) or _argument_problem(name, slots, overrides, parent_id)
    if problem:
        return _fail(problem)
    changes = _given(name, slots, overrides, parent_id)
    if not changes:
        return _fail(
            "Nothing to set: pass at least one of 'name', 'slots', 'overrides' or 'parent_id'."
        )

    def _call() -> dict:
        client = _capforge()
        if _exists(client, collection_id):
            updated = client.library_collection_patch(collection_id, changes) or {}
            return {"status": _OK, "created": False, **_detail_view(updated)}
        if name is None:
            return _fail(
                f"{not_found_message(collection_id)} Pass 'name' to create it."
            )
        created = client.library_collection_create({"id": collection_id, **changes}) or {}
        return {"status": _OK, "created": True, **_detail_view(created)}

    return collection_call(_call, collection_id)


def delete_collection(collection_id: str) -> dict:
    """Delete a collection that has no members and no subfolders.

    Refused while any video still has this `collection_id`, with the member
    count, and then while any collection has it as `parent_id`, with the
    subfolder count: emptying an event is never a side effect. Move each video out with
    `set_video_meta(video_id, {"collection_id": null}, rev)`, one per call and
    only when the user asked, then delete.
    """
    problem = _id_problem(collection_id)
    if problem:
        return _fail(problem)

    def _call() -> dict:
        _capforge().library_collection_delete(collection_id)
        return {"status": _OK, "deleted": collection_id}

    return collection_call(_call, collection_id)


#: The four tools this module contributes, in the order they are registered.
TOOLS = (
    list_collections,
    get_collection,
    set_collection,
    delete_collection,
)


def register(mcp: Any, get_client: ClientFactory) -> None:
    """Register the collection tools on the server's FastMCP instance.

    `get_client` is called per request rather than stored, so the server's own
    `_client` remains the one object that has to exist (or be patched).
    """
    global _get_client
    _get_client = get_client
    for tool in TOOLS:
        mcp.tool()(tool)
