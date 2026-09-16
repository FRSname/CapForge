"""Refusal copy for the collection tools (docs/plans/library-collections.md).

The collection routes answer a refusal with a machine `reason` — at the top of
the body or under `detail`, depending on how the route raised it — so the
sentence an agent reads is written here, once, from that reason. Anything this
module does not recognise is re-raised into `_library_call`, which keeps the
backend's own words; nothing is swallowed.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

import httpx

from .library_errors import _ERROR, _library_call

#: The `reason` values the collection routes (and this module) use.
COLLECTION_NOT_FOUND = "collection_not_found"
COLLECTION_EXISTS = "collection_exists"
COLLECTION_IN_USE = "collection_in_use"
COLLECTION_HAS_CHILDREN = "collection_has_children"
#: The 422 nesting refusals: the backend's sentence, plus the way out below.
NESTING_HINTS = {
    "unknown_parent": (
        "list_collections shows every collection's id and path; "
        'parent_id="" puts it at the top level.'
    ),
    "collection_cycle": "Pick a folder that is not this one or inside it.",
    "collection_too_deep": (
        "Pick a folder higher up, or move this folder's subfolders out first."
    ),
}

_NOT_FOUND = 404
_CONFLICT = 409
_UNPROCESSABLE = 422

#: The keys a structured 422 `detail` object may carry its sentence under.
_MESSAGE_KEYS = ("message", "msg")


def _body(exc: httpx.HTTPStatusError) -> dict:
    """The response body as a dict, or `{}` when it is not a JSON object."""
    try:
        body = exc.response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def refusal_fields(body: dict) -> dict:
    """`reason`, `members`, `message`… wherever the route put them.

    `HTTPException(detail={...})` nests them under `detail`; a `JSONResponse`
    puts them at the top. A new dict: a `detail` object's keys, overlaid by the
    top-level ones (so a sentence `detail` beside a top-level `reason` works).
    """
    detail = body.get("detail")
    nested = detail if isinstance(detail, dict) else {}
    top = {key: value for key, value in body.items() if key != "detail"}
    return {**nested, **top}


def member_count(members: Any) -> Optional[int]:
    """A member count from either an int or a list of member ids."""
    if isinstance(members, bool):
        return None
    if isinstance(members, int):
        return members
    if isinstance(members, list):
        return len(members)
    return None


def is_not_found(exc: httpx.HTTPStatusError) -> bool:
    return exc.response.status_code == _NOT_FOUND


def _videos(count: int) -> str:
    return f"{count} video" if count == 1 else f"{count} videos"


def in_use_message(collection_id: str, count: Optional[int]) -> str:
    """The 409 sentence: how many members, and how to move each one out."""
    held = f"still has {_videos(count)}" if count is not None else "still has videos"
    return (
        f"Collection {collection_id!r} {held}, so it cannot be deleted. Emptying it "
        f"is one write per video and needs the user's go-ahead: find the members "
        f'with list_videos(collection="{collection_id}"), then for each one '
        f'get_video for its rev and set_video_meta(video_id, {{"collection_id": null}}, rev). '
        f"Delete the collection once none are left."
    )


def not_found_message(collection_id: str) -> str:
    return (
        f"No collection {collection_id!r}. list_collections shows the ones that "
        f"exist, plus any orphan ids videos already carry; "
        f"set_collection({collection_id!r}, name=…) creates it."
    )


def has_children_message(collection_id: str, count: Optional[int]) -> str:
    """The 409 sentence for a folder that still holds subfolders."""
    held = f"{count} subfolder{'' if count == 1 else 's'}" if count is not None else "subfolders"
    return (
        f"Collection {collection_id!r} still holds {held}, so it cannot be deleted. "
        f"list_collections shows them (parent_id {collection_id!r}); move each one "
        f'with set_collection(<id>, parent_id="") or into another folder, or delete '
        f"it, and only when the user asked."
    )


def exists_message(collection_id: str) -> str:
    return (
        f"A collection with id {collection_id!r} already exists. Read it with "
        f"get_collection({collection_id!r}) and change it with set_collection, "
        f"or pick another id."
    )


def collection_refusal(exc: httpx.HTTPStatusError, collection_id: str) -> Optional[dict]:
    """The error dict for a refusal this module has words for, else None."""
    status = exc.response.status_code
    body = _body(exc)
    fields = refusal_fields(body)
    reason = fields.get("reason")
    if status == _NOT_FOUND:
        return _refused(COLLECTION_NOT_FOUND, not_found_message(collection_id))
    if status == _CONFLICT and reason == COLLECTION_IN_USE:
        count = member_count(fields.get("members"))
        return _refused(COLLECTION_IN_USE, in_use_message(collection_id, count), members=count)
    if status == _CONFLICT and reason == COLLECTION_EXISTS:
        return _refused(COLLECTION_EXISTS, exists_message(collection_id))
    if status == _CONFLICT and reason == COLLECTION_HAS_CHILDREN:
        count = member_count(fields.get("children"))
        return _refused(COLLECTION_HAS_CHILDREN, has_children_message(collection_id, count),
                        children=count)
    if status == _UNPROCESSABLE and reason in NESTING_HINTS:
        return _nesting_refusal(reason, body.get("detail"))
    if status == _UNPROCESSABLE:
        return _structured_422(body.get("detail"), reason)
    return None


def _structured_422(detail: Any, reason: Any) -> Optional[dict]:
    """A 422 whose `detail` is an object with a sentence in it, else None.

    A string or pydantic-list `detail` (or a `violations` body) returns None,
    so `_library_call` answers it the way every library route's 422 is answered.
    """
    if not isinstance(detail, dict):
        return None
    message = next(
        (detail[key] for key in _MESSAGE_KEYS if isinstance(detail.get(key), str)), None
    )
    if message is None:
        return None
    extra = {"reason": reason} if isinstance(reason, str) else {}
    return {"status": _ERROR, _ERROR: message, **extra}


def _nesting_refusal(reason: str, detail: Any) -> dict:
    """A 422 ``parent_id`` refusal: the backend's sentence, then the way out."""
    sentence = detail.rstrip(".") if isinstance(detail, str) else "That parent_id was refused"
    return _refused(reason, f"{sentence}. {NESTING_HINTS[reason]}")


def _refused(reason: str, message: str, **extra: Any) -> dict:
    return {"status": _ERROR, _ERROR: message, "reason": reason, **extra}


def collection_call(fn: Callable[[], dict], collection_id: str) -> dict:
    """`_library_call`, with the collection refusals mapped first.

    An HTTP error without a collection meaning is re-raised, so `_library_call`
    still answers it with the backend's sentence or its 422 field summary.
    """
    def _mapped() -> dict:
        try:
            return fn()
        except httpx.HTTPStatusError as exc:
            refusal = collection_refusal(exc, collection_id)
            if refusal is None:
                raise
            return refusal

    return _library_call(_mapped)
