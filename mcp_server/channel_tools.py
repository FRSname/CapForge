"""Channel MCP tools — where videos are published, and how each channel writes.

A channel (a YouTube channel, an Instagram account, a LinkedIn page…) is
**context for the agent first**: `context` says what the channel is about, who
reads it, how it sounds, how its titles and slugs are built (with real
examples), its recurring keywords and anything else worth knowing. `profile` is
the boilerplate the upload package pastes (footer, links, default hashtags,
template, slots, house rules). The **primary channel** is always a YouTube
channel, and the channel brief (`get_brief` / `set_brief`) is its view.

Same shape as `collection_tools.py`: `TOOLS`, `register(mcp, get_client)`, the
client resolved per call, **no import of `server`**, and every failure is an
error *dict* (`channel_call`) rather than a raised exception.
"""

from __future__ import annotations

import copy
from typing import Any, Callable, Optional

import httpx

from .channel_errors import channel_call, not_found_message
from .collection_errors import is_not_found
from .library_errors import _OK, _fail

ClientFactory = Callable[[], Any]

_STRING_FIELDS = ("handle", "url", "language")
_BLOCK_FIELDS = ("context", "profile")
PRIMARY_FALSE = (
    "There is always exactly one primary channel, so it cannot be switched off. "
    "Call set_channel(<another YouTube channel's id>, primary=True) to move it."
)
PLATFORM_CHANGE = (
    "Channel {channel_id!r} is a {current} channel and a channel's platform cannot "
    "change. Create a new channel with set_channel(<new id>, platform={wanted!r}, name=…)."
)

_get_client: Optional[ClientFactory] = None


def _capforge() -> Any:
    """The live HTTP client, resolved at call time (never cached here)."""
    if _get_client is None:  # pragma: no cover - register() runs at import
        raise RuntimeError("mcp_server.channel_tools was never registered on the MCP server")
    return _get_client()


# --- boundary checks --------------------------------------------------------

def _id_problem(channel_id: Any) -> Optional[str]:
    if isinstance(channel_id, str) and channel_id.strip():
        return None
    return "Pass the 'channel_id' (e.g. \"update-conf\"): lowercase letters, digits and hyphens."


def _argument_problem(platform: Any, name: Any, strings: dict, blocks: dict, primary: Any) -> Optional[str]:
    """Why the arguments cannot be sent, or None. The backend stays the authority
    on ids, platforms and field names; this only refuses wrong *types*."""
    if platform is not None and not isinstance(platform, str):
        return "'platform' must be one of \"youtube\", \"tiktok\", \"instagram\", \"linkedin\", \"x\"."
    if name is not None and not (isinstance(name, str) and name.strip()):
        return "'name' must be a non-empty string."
    for field, value in strings.items():
        if value is not None and not isinstance(value, str):
            return f"'{field}' must be a string."
    for field, value in blocks.items():
        if value is not None and not isinstance(value, dict):
            return f"'{field}' must be an object of {field} fields, e.g. {{\"notes\": \"…\"}}."
    if primary is not None and not isinstance(primary, bool):
        return "'primary' must be true (or left out)."
    if primary is False:
        return PRIMARY_FALSE
    return None


def _given(name: Optional[str], strings: dict, blocks: dict) -> dict:
    """Only the arguments that were passed, as fresh copies (never aliased)."""
    given: dict[str, Any] = {} if name is None else {"name": name}
    given.update({field: value for field, value in strings.items() if value is not None})
    given.update({field: copy.deepcopy(value) for field, value in blocks.items() if value is not None})
    return given


def _existing(client: Any, channel_id: str) -> Optional[dict]:
    """The channel, or None on a 404; any other failure raises."""
    try:
        return client.library_channel_get(channel_id) or {}
    except httpx.HTTPStatusError as exc:
        if is_not_found(exc):
            return None
        raise


def _made_primary(client: Any, channel_id: str, written: dict) -> dict:
    """`{channel, primary_id}` after the primary route, read from its list answer."""
    book = client.library_channel_set_primary(channel_id) or {}
    listed = next((c for c in book.get("channels") or [] if c.get("id") == channel_id), written)
    return {"channel": listed, "primary_id": book.get("primary_id")}


def _create(client: Any, channel_id: str, platform: Optional[str], changes: dict,
            primary: Optional[bool]) -> dict:
    missing = [repr(field) for field, value in (("platform", platform), ("name", changes.get("name")))
               if value is None]
    if missing:
        return _fail(f"{not_found_message(channel_id)} Pass {' and '.join(missing)} to create it.")
    created = client.library_channel_create({"id": channel_id, "platform": platform, **changes}) or {}
    out = {"status": _OK, "created": True, "channel": created}
    return {**out, **_made_primary(client, channel_id, created)} if primary else out


def _update(client: Any, channel_id: str, current: dict, platform: Optional[str], changes: dict,
            primary: Optional[bool]) -> dict:
    if platform is not None and platform != current.get("platform"):
        return _fail(PLATFORM_CHANGE.format(
            channel_id=channel_id, current=current.get("platform"), wanted=platform))
    written = (client.library_channel_patch(channel_id, changes) or {}) if changes else current
    out = {"status": _OK, "created": False, "channel": written}
    return {**out, **_made_primary(client, channel_id, written)} if primary else out


# --- Tools ------------------------------------------------------------------

def list_channels() -> dict:
    """List the library's channels and which one is primary.

    Each channel carries `id`, `platform` (youtube, tiktok, instagram, linkedin
    or x), `name`, `handle`, `url`, `language` (empty means the transcript's),
    `context`, `profile`, `createdAt`, `updatedAt` and `primary`. The primary
    channel is always a YouTube channel; `get_brief` is its view. Works with the
    app's window closed.
    """
    def _call() -> dict:
        book = _capforge().library_channels_list() or {}
        channels = book.get("channels") or []
        return {"status": _OK, "count": len(channels), "primary_id": book.get("primary_id"),
                "channels": channels}

    return channel_call(_call, "")


def get_channel(channel_id: str) -> dict:
    """Read one channel. This is the main read before writing any text for a channel.

    Treat `context` as the style reference for everything you draft for this
    channel: `about` (what it is and covers), `audience` and `voice`,
    `title_style` with `example_titles` (how titles or captions are built,
    shown by real ones), `naming` with `example_slugs` (how videos are named and
    slugged), `keywords` to reuse, and `notes` (CTAs, words to avoid, habits).
    Match the examples' length, casing and order rather than copying them.

    `profile` (footer, recorded-at line, speaker block, default hashtags, link
    rows, house rules, description template, slots) is what the upload package
    pastes on its own: never copy it into a video's text, or it prints twice.
    """
    problem = _id_problem(channel_id)
    if problem:
        return _fail(problem)

    def _call() -> dict:
        return {"status": _OK, "channel": _capforge().library_channel_get(channel_id) or {}}

    return channel_call(_call, channel_id)


def set_channel(
    channel_id: str,
    platform: Optional[str] = None,
    name: Optional[str] = None,
    handle: Optional[str] = None,
    url: Optional[str] = None,
    language: Optional[str] = None,
    context: Optional[dict[str, Any]] = None,
    profile: Optional[dict[str, Any]] = None,
    primary: Optional[bool] = None,
) -> dict:
    """Create a channel, or change one — an upsert keyed on `channel_id`.

    When no channel has that id it is created: `platform` ("youtube", "tiktok",
    "instagram", "linkedin" or "x") and `name` are required, and an id is
    lowercase letters, digits and hyphens. When it exists, only the arguments
    you pass are sent, and its platform cannot change.

    - `context` and `profile` merge per field: the fields you send replace the
      stored ones, the ones you leave out are kept. A list field (`keywords`,
      `example_titles`, `default_hashtags`…) is replaced by the list you send, so
      read `get_channel` first and send back the items you want to keep.
    - `primary=True` makes this (YouTube) channel the primary one after the
      write; `get_brief` and `set_brief` then read and write it.

    Change a channel only for what the user tells you about it, and prefer
    letting them edit it in Settings → Channels.
    """
    strings = {"handle": handle, "url": url, "language": language}
    blocks = {"context": context, "profile": profile}
    problem = _id_problem(channel_id) or _argument_problem(platform, name, strings, blocks, primary)
    if problem:
        return _fail(problem)
    changes = _given(name, strings, blocks)
    # `platform` alone still reaches the lookup: on a missing channel it is a
    # create that forgot `name`, and the answer should say exactly that.
    if not changes and platform is None and primary is None:
        return _fail("Nothing to set: pass 'name', 'handle', 'url', 'language', 'context', "
                     "'profile' or primary=True (and 'platform' with 'name' to create).")

    def _call() -> dict:
        client = _capforge()
        current = _existing(client, channel_id)
        if current is None:
            return _create(client, channel_id, platform, changes, primary)
        return _update(client, channel_id, current, platform, changes, primary)

    return channel_call(_call, channel_id)


def delete_channel(channel_id: str) -> dict:
    """Delete a channel. Only when the user asked.

    The primary channel is refused: make another YouTube channel primary first
    with `set_channel(<its id>, primary=True)`.
    """
    problem = _id_problem(channel_id)
    if problem:
        return _fail(problem)

    def _call() -> dict:
        _capforge().library_channel_delete(channel_id)
        return {"status": _OK, "deleted": channel_id}

    return channel_call(_call, channel_id)


#: The four tools this module contributes, in the order they are registered.
TOOLS = (
    list_channels,
    get_channel,
    set_channel,
    delete_channel,
)


def register(mcp: Any, get_client: ClientFactory) -> None:
    """Register the channel tools on the server's FastMCP instance.

    `get_client` is called per request rather than stored, so the server's own
    `_client` remains the one object that has to exist (or be patched).
    """
    global _get_client
    _get_client = get_client
    for tool in TOOLS:
        mcp.tool()(tool)
