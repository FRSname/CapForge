"""Refusal copy for the channel tools (docs/plans/multi-channel-pr1-contract.md).

The channel routes answer a refusal with a machine `reason` at the top of the
body beside a `detail` sentence (the collection routes' shape, so the body
helpers are shared with `collection_errors.py`). The sentence an agent reads is
written here, once, from that reason, and the backend's `reason` is relayed.
Anything this module does not recognise is re-raised into `_library_call`,
which keeps the backend's own words; nothing is swallowed.
"""

from __future__ import annotations

from typing import Callable, Optional

import httpx

from .collection_errors import _body, _refused, _structured_422, refusal_fields
from .library_errors import _library_call

#: The `reason` values the channel routes (and this module) use.
CHANNEL_NOT_FOUND = "channel_not_found"
CHANNEL_EXISTS = "channel_exists"
CHANNEL_IS_PRIMARY = "channel_is_primary"
PRIMARY_NOT_YOUTUBE = "primary_not_youtube"

_NOT_FOUND = 404
_CONFLICT = 409
_UNPROCESSABLE = 422


def not_found_message(channel_id: str) -> str:
    return (
        f"No channel {channel_id!r}. list_channels shows the ones that exist; "
        f"set_channel({channel_id!r}, platform=…, name=…) creates it."
    )


def exists_message(channel_id: str) -> str:
    return (
        f"A channel with id {channel_id!r} already exists. Read it with "
        f"get_channel({channel_id!r}) and change it with set_channel, or pick another id."
    )


def is_primary_message(channel_id: str) -> str:
    return (
        f"Channel {channel_id!r} is the primary channel, so it cannot be deleted. "
        f"Make another YouTube channel primary first with "
        f"set_channel(<that channel's id>, primary=True), then delete this one."
    )


def not_youtube_message(detail: object) -> str:
    said = f"{detail} " if isinstance(detail, str) and detail else ""
    return (
        f"{said}Only a YouTube channel can be the primary channel (the one "
        f"get_brief and set_brief read and write)."
    ).strip()


def channel_refusal(exc: httpx.HTTPStatusError, channel_id: str) -> Optional[dict]:
    """The error dict for a refusal this module has words for, else None."""
    status = exc.response.status_code
    body = _body(exc)
    reason = refusal_fields(body).get("reason")
    if status == _NOT_FOUND:
        return _refused(CHANNEL_NOT_FOUND, not_found_message(channel_id))
    if status == _CONFLICT and reason == CHANNEL_EXISTS:
        return _refused(CHANNEL_EXISTS, exists_message(channel_id))
    if status == _CONFLICT and reason == CHANNEL_IS_PRIMARY:
        return _refused(CHANNEL_IS_PRIMARY, is_primary_message(channel_id))
    if status == _UNPROCESSABLE and reason == PRIMARY_NOT_YOUTUBE:
        return _refused(PRIMARY_NOT_YOUTUBE, not_youtube_message(body.get("detail")))
    if status == _UNPROCESSABLE:
        return _structured_422(body.get("detail"), reason)
    return None


def channel_call(fn: Callable[[], dict], channel_id: str) -> dict:
    """`_library_call`, with the channel refusals mapped first.

    An HTTP error without a channel meaning is re-raised, so `_library_call`
    still answers it with the backend's sentence or its 422 field summary.
    """
    def _mapped() -> dict:
        try:
            return fn()
        except httpx.HTTPStatusError as exc:
            refusal = channel_refusal(exc, channel_id)
            if refusal is None:
                raise
            return refusal

    return _library_call(_mapped)
