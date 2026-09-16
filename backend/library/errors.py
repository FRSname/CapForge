"""Failures the library raises; the router maps them to status codes."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.schemas import VideoRecord


class LibraryError(Exception):
    """Base for every library failure."""


class RecordNotFound(LibraryError):
    """No record folder with that id (404)."""


class MediaNotFound(LibraryError):
    """The source media is unreadable, so no record can be created (404)."""


class StaleRevision(LibraryError):
    """``If-Match`` did not equal the stored ``rev`` (409).

    Carries the *current* record so the caller re-reads instead of clobbering
    (vision §2.3) — today's 409s carry only a detail string.
    """

    def __init__(self, current: "VideoRecord") -> None:
        super().__init__(
            f"Record {current.id} is at rev {current.rev}; re-read it before writing again"
        )
        self.current = current


class ScratchReadOnly(LibraryError):
    """A scratch record's dossier cannot be patched until it is promoted (409)."""


class MediaInUse(LibraryError):
    """Relink target already belongs to another record, library or scratch (409).

    Carries that record's id so the UI can point at the card that owns the file.
    """

    def __init__(self, video_id: str) -> None:
        super().__init__(f"That file already belongs to library record {video_id}")
        self.video_id = video_id


class MediaMismatch(LibraryError):
    """Relink target is different media from the record's; needs ``force`` (409)."""


class CollectionNotFound(LibraryError):
    """No collection with that id (404)."""


class CollectionExists(LibraryError):
    """An explicit collection id that is already taken (409 ``collection_exists``)."""

    def __init__(self, collection_id: str) -> None:
        super().__init__(f"A collection with the id {collection_id!r} already exists")
        self.collection_id = collection_id


class CollectionInUse(LibraryError):
    """Delete refused while videos still name the collection (409 ``collection_in_use``).

    Carries the member count; emptying a collection is a per-video
    ``collection_id: null`` write, never a bulk side effect of a delete.
    """

    def __init__(self, collection_id: str, members: int) -> None:
        super().__init__(
            f"Collection {collection_id!r} still has {members} video(s); set their "
            "collection_id to null before deleting it"
        )
        self.collection_id = collection_id
        self.members = members


class CollectionsUnreadable(LibraryError, ValueError):
    """``collections.json`` exists but cannot be read as collections (500).

    A ``ValueError`` too, like a corrupt brief: the file is reported, never reset.
    """


class FrameNotFound(LibraryError):
    """No thumbnail frame with that name on the record (404)."""


class FramesRefused(LibraryError, ValueError):
    """Frame times or the candidate limit refused (422); the message is a sentence."""


class ChannelNotFound(LibraryError):
    """No channel with that id (404)."""


class ChannelExists(LibraryError):
    """An explicit channel id that is already taken (409 ``channel_exists``)."""

    def __init__(self, channel_id: str) -> None:
        super().__init__(f"A channel with the id {channel_id!r} already exists")
        self.channel_id = channel_id


class ChannelIsPrimary(LibraryError):
    """Delete refused for the primary channel (409 ``channel_is_primary``)."""

    def __init__(self, channel_id: str) -> None:
        super().__init__(
            f"Channel {channel_id!r} is the primary channel; make another YouTube "
            "channel primary before deleting it"
        )
        self.channel_id = channel_id


class PrimaryNotYoutube(LibraryError):
    """Only a YouTube channel can be primary (422 ``primary_not_youtube``)."""

    def __init__(self, channel_id: str, platform: str) -> None:
        super().__init__(
            f"Channel {channel_id!r} is on {platform}, and the primary channel "
            "is always a YouTube channel"
        )
        self.channel_id = channel_id
        self.platform = platform


class ChannelInUse(LibraryError):
    """Delete refused while records hold posts for the channel (409 ``channel_in_use``).

    ``posts`` is how many records (scratch included) hold one, hidden or not.
    """

    def __init__(self, channel_id: str, posts: int) -> None:
        super().__init__(
            f"Channel {channel_id!r} still has posts on {posts} video(s); remove those "
            "posts (posts.<channel>: null) before deleting it"
        )
        self.channel_id = channel_id
        self.posts = posts


class UnknownChannel(LibraryError, ValueError):
    """Channel ids that name no channel (422 ``unknown_channel``)."""

    def __init__(self, channel_ids: "list[str]") -> None:
        super().__init__(f"No channel has the id(s) {', '.join(repr(c) for c in channel_ids)}")
        self.channel_ids = channel_ids


class ChannelsUnreadable(LibraryError, ValueError):
    """``channels.json`` exists but cannot be read as channels (500).

    A ``ValueError`` too, like a corrupt brief: the file is reported, never reset.
    """
