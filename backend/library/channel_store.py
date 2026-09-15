"""``channels.json`` on disk, and the store methods that read and write it.

docs/plans/multi-channel-pr1-contract.md → Files. The models and pure mappings
are ``channels.py``; this is the I/O, mixed into ``LibraryStore`` (at its size
ceiling) like ``CollectionStoreMixin``, so call sites stay
``store.create_channel(...)``.

Rules this module holds:

* **A missing file is bootstrapped on first access** — any channel read or
  write, and every brief read, since the brief is the primary channel's view.
  The bootstrap runs under the store's ``write_lock`` and re-reads the file
  inside it, so concurrent first reads write it once. It never overwrites a
  file, and ``brief.json`` is left untouched.
* **A corrupt file is an error, never a reset**: :class:`ChannelsUnreadable`.
  A corrupt ``brief.json`` met by the bootstrap propagates as the ``ValueError``
  ``load_brief`` raises, and no ``channels.json`` is written.
* **Every write is a read-modify-write under ``write_lock``** (``@writes``).
  Reads stay unlocked: the file is swapped in with ``os.replace``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from pydantic import ValidationError

from backend.library import fs
from backend.library.brief import load_brief
from backend.library.channels import (
    Channel,
    ChannelBook,
    ChannelCreate,
    ChannelPatch,
    FALLBACK_CHANNEL_ID,
    bootstrap_book,
    new_channel,
    patched_channel,
)
from backend.library.collection_store import slugify, unique_id
from backend.library.errors import (
    ChannelExists,
    ChannelIsPrimary,
    ChannelNotFound,
    ChannelsUnreadable,
    PrimaryNotYoutube,
)
from backend.library.locking import writes
from backend.library.platforms import YOUTUBE

if TYPE_CHECKING:  # pragma: no cover - typing only
    import threading

logger = logging.getLogger(__name__)

CHANNELS_FILE = "channels.json"


# --- the file ----------------------------------------------------------------------

def load_channels(root: Path) -> Optional[ChannelBook]:
    """The stored channels, or ``None`` when the file was never written.

    Raises :class:`ChannelsUnreadable` for corrupt JSON, an unknown key, a
    duplicate id or a bad ``primary_id``. The file is left exactly as it is.
    """
    path = Path(root) / CHANNELS_FILE
    if not path.is_file():
        return None
    try:
        raw = fs.read_json(path)
    except ValueError as exc:  # JSONDecodeError is a ValueError
        raise ChannelsUnreadable(f"{CHANNELS_FILE} is not valid JSON: {exc}") from exc
    try:
        return ChannelBook.model_validate(raw)
    except ValidationError as exc:
        raise ChannelsUnreadable(f"{CHANNELS_FILE} is not a valid channels file: {exc}") from exc


def save_channels(root: Path, book: ChannelBook) -> None:
    """Write the whole file atomically. The caller holds the store's write lock."""
    fs.write_json_atomic(Path(root) / CHANNELS_FILE, book.model_dump(mode="json"))


def _require(book: ChannelBook, channel_id: str) -> Channel:
    channel = book.find(channel_id)
    if channel is None:
        raise ChannelNotFound(f"No channel with id {channel_id!r}")
    return channel


def _with_channels(book: ChannelBook, channels: list[Channel]) -> ChannelBook:
    return book.model_copy(update={"channels": channels})


# --- the store mixin ---------------------------------------------------------------

class ChannelStoreMixin:
    """Channel CRUD and the primary channel, on ``LibraryStore``."""

    if TYPE_CHECKING:  # pragma: no cover - provided by LibraryStore
        root: Path
        write_lock: "threading.RLock"

    def list_channels(self) -> ChannelBook:
        """Every channel in file order plus ``primary_id``; bootstraps a missing file."""
        book = load_channels(self.root)
        return book if book is not None else self._bootstrap_channels()

    @writes
    def _bootstrap_channels(self) -> ChannelBook:
        book = load_channels(self.root)  # re-checked inside the lock
        if book is not None:
            return book
        book = bootstrap_book(load_brief(self.root))
        save_channels(self.root, book)
        logger.info("Bootstrapped %s with primary channel %s", CHANNELS_FILE, book.primary_id)
        return book

    def get_channel(self, channel_id: str) -> Channel:
        return _require(self.list_channels(), channel_id)

    def primary_channel(self) -> Channel:
        book = self.list_channels()
        return _require(book, book.primary_id)

    @writes
    def create_channel(self, body: ChannelCreate) -> Channel:
        """Add a channel. A taken explicit id raises :class:`ChannelExists`."""
        book = self.list_channels()
        taken = {channel.id for channel in book.channels}
        if body.id is not None and body.id in taken:
            raise ChannelExists(body.id)
        channel_id = body.id if body.id is not None else unique_id(slugify(body.name, FALLBACK_CHANNEL_ID), taken)
        created = new_channel(channel_id, body)
        save_channels(self.root, _with_channels(book, [*book.channels, created]))
        logger.info("Created %s channel %s", created.platform, created.id)
        return created

    @writes
    def patch_channel(self, channel_id: str, patch: ChannelPatch) -> Channel:
        """Merge ``patch``; a patch that changes nothing writes nothing."""
        book = self.list_channels()
        current = _require(book, channel_id)
        updated = patched_channel(current, patch)
        if updated is not current:
            replaced = [updated if c.id == channel_id else c for c in book.channels]
            save_channels(self.root, _with_channels(book, replaced))
        return updated

    @writes
    def patch_primary_channel(self, patch: ChannelPatch) -> Channel:
        """``PATCH /brief``: the primary is resolved inside the same lock as the write."""
        return self.patch_channel(self.list_channels().primary_id, patch)

    @writes
    def delete_channel(self, channel_id: str) -> None:
        """Remove a channel; the primary raises :class:`ChannelIsPrimary`."""
        book = self.list_channels()
        _require(book, channel_id)
        if channel_id == book.primary_id:
            raise ChannelIsPrimary(channel_id)
        save_channels(self.root, _with_channels(book, [c for c in book.channels if c.id != channel_id]))
        logger.info("Deleted channel %s", channel_id)

    @writes
    def set_primary_channel(self, channel_id: str) -> ChannelBook:
        """Make a YouTube channel primary; any other platform raises :class:`PrimaryNotYoutube`."""
        book = self.list_channels()
        channel = _require(book, channel_id)
        if channel.platform != YOUTUBE:
            raise PrimaryNotYoutube(channel_id, channel.platform)
        if book.primary_id == channel_id:
            return book
        updated = book.model_copy(update={"primary_id": channel_id})
        save_channels(self.root, updated)
        logger.info("Primary channel is now %s", channel_id)
        return updated
