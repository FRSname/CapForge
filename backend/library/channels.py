"""Channels — where a video is published, and how that channel writes.

docs/plans/multi-channel-pr1-contract.md and multi-channel-publish.md §4.1/§4.1a.
A channel is **context for the agent first** (``context``: about, audience,
voice, title style and examples, naming, keywords, notes) and the boilerplate
the package pastes second (``profile``: exactly the brief's footer, recorded-at
line, speaker block, default hashtags, link rows, house rules, description
template and slots). This module holds the models and the pure mappings; the
file and the store mixin are ``channel_store.py``.

**The brief is a view of the primary channel.** :func:`brief_from_channel` is
what every brief reader (the package, the validators, ``platform_posts``,
collections' ``effective_brief``, ``GET /brief``) now sees, and
:func:`channel_patch_from_brief` is how ``PATCH /brief`` lands on the primary
channel. ``brief.json`` stays the bootstrap source only.

**Accepted delta:** a library whose ``brief.channel`` was empty bootstraps a
channel named ``PLACEHOLDER_NAME``, so ``GET /brief`` answers ``channel:
"YouTube channel"`` and a *custom* description template renders ``{{channel}}``
as that until the channel is renamed. The built-in layout never prints
``{{channel}}``, so every default package stays byte-identical. For the same
reason a brief patch that clears ``channel`` names the channel the placeholder
(a channel name cannot be empty).
"""

from __future__ import annotations

import copy
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.library.brief import Brief, BriefPatch, HouseRules
from backend.library.collection_store import (
    COLLECTION_NAME_MAX_CHARS,
    CollectionId,
    CollectionName,
    SlotMap,
    now_iso,
    slugify,
)
from backend.library.platforms import YOUTUBE, Platform
from backend.library.schemas import Link

CHANNELS_FILE_VERSION = 1
#: The id a channel name with no ASCII letters or digits slugs to (``"日本"``).
FALLBACK_CHANNEL_ID = "channel"
#: The name a channel bootstrapped from a brief with no ``channel`` gets.
PLACEHOLDER_NAME = "YouTube channel"
#: The brief fields a channel's ``profile`` holds, in the brief's order.
PROFILE_FIELDS = (
    "footer", "recorded_at_line", "speaker_block", "default_hashtags", "link_rows",
    "house_rules", "description_template", "slots",
)
#: The brief fields that moved into a channel's ``context``.
CONTEXT_FROM_BRIEF = ("audience", "voice")
#: A patch may leave any of these out but may not send one as ``null``.
_NON_NULLABLE_PATCH_FIELDS = ("name", "handle", "url", "language", "context", "profile")
_SCALAR_PATCH_FIELDS = ("name", "handle", "url", "language")
_BLOCK_PATCH_FIELDS = ("context", "profile")


# --- models ------------------------------------------------------------------------

class ChannelContext(BaseModel):
    """What an agent reads before writing for the channel (plan §4.1a)."""

    model_config = ConfigDict(extra="forbid")

    about: str = ""
    audience: str = ""
    voice: str = ""
    title_style: str = ""
    example_titles: list[str] = Field(default_factory=list)
    naming: str = ""
    example_slugs: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    notes: str = ""


class ChannelProfile(BaseModel):
    """What the package pastes mechanically: the brief's boilerplate, as it was."""

    model_config = ConfigDict(extra="forbid")

    footer: str = ""
    recorded_at_line: str = ""
    speaker_block: str = ""
    default_hashtags: list[str] = Field(default_factory=list)
    link_rows: list[Link] = Field(default_factory=list)
    house_rules: HouseRules = Field(default_factory=HouseRules)
    description_template: str = ""
    slots: SlotMap = Field(default_factory=dict)


class Channel(BaseModel):
    """One entry of ``channels.json``."""

    model_config = ConfigDict(extra="forbid")

    id: CollectionId
    platform: Platform
    name: CollectionName
    handle: str = ""
    url: str = ""
    #: Empty means "the transcript's language".
    language: str = ""
    context: ChannelContext = Field(default_factory=ChannelContext)
    profile: ChannelProfile = Field(default_factory=ChannelProfile)
    createdAt: str
    updatedAt: str


class ChannelCreate(BaseModel):
    """``POST /channels``: an omitted ``id`` is slugged from ``name``."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[CollectionId] = None
    platform: Platform
    name: CollectionName
    handle: str = ""
    url: str = ""
    language: str = ""
    context: ChannelContext = Field(default_factory=ChannelContext)
    profile: ChannelProfile = Field(default_factory=ChannelProfile)


class ChannelPatch(BaseModel):
    """``PATCH /channels/{id}``: scalars replace, ``context``/``profile`` merge
    per field. ``platform`` is not patchable (``extra="forbid"``)."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[CollectionName] = None
    handle: Optional[str] = None
    url: Optional[str] = None
    language: Optional[str] = None
    context: Optional[ChannelContext] = None
    profile: Optional[ChannelProfile] = None

    @model_validator(mode="after")
    def _no_null_top_level_field(self) -> "ChannelPatch":
        for name in _NON_NULLABLE_PATCH_FIELDS:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may be left out of a patch but not set to null")
        return self


class ChannelBook(BaseModel):
    """The file's shape. Duplicate ids, or a ``primary_id`` naming no channel or
    a non-YouTube one, make it unreadable rather than "fixed" on read."""

    model_config = ConfigDict(extra="forbid")

    version: int = CHANNELS_FILE_VERSION
    primary_id: CollectionId
    channels: list[Channel]

    @model_validator(mode="after")
    def _consistent(self) -> "ChannelBook":
        ids = [channel.id for channel in self.channels]
        if len(ids) != len(set(ids)):
            raise ValueError("two channels share an id")
        primary = self.find(self.primary_id)
        if primary is None:
            raise ValueError(f"primary_id {self.primary_id!r} names no channel")
        if primary.platform != YOUTUBE:
            raise ValueError(f"primary channel {self.primary_id!r} is not a YouTube channel")
        return self

    def find(self, channel_id: str) -> Optional[Channel]:
        return next((c for c in self.channels if c.id == channel_id), None)


# --- pure helpers ------------------------------------------------------------------

def channel_name_from(text: str) -> str:
    """A legal channel name from brief text: stripped, capped, else the placeholder."""
    return text.strip()[:COLLECTION_NAME_MAX_CHARS].strip() or PLACEHOLDER_NAME


def bootstrap_channel(brief: Brief) -> Channel:
    """The one YouTube channel a library without ``channels.json`` starts with."""
    name = channel_name_from(brief.channel)
    now = now_iso()
    return Channel(
        id=slugify(name, FALLBACK_CHANNEL_ID), platform=YOUTUBE, name=name, language=brief.language,
        context=ChannelContext(**{f: getattr(brief, f) for f in CONTEXT_FROM_BRIEF}),
        profile=ChannelProfile(**{f: copy.deepcopy(getattr(brief, f)) for f in PROFILE_FIELDS}),
        createdAt=now, updatedAt=now,
    )


def bootstrap_book(brief: Brief) -> ChannelBook:
    channel = bootstrap_channel(brief)
    return ChannelBook(primary_id=channel.id, channels=[channel])


def brief_from_channel(channel: Channel) -> Brief:
    """The brief view of ``channel``. Pure; the lists are copies, never aliases."""
    return Brief(
        channel=channel.name,
        **{f: getattr(channel.context, f) for f in CONTEXT_FROM_BRIEF},
        language=channel.language,
        **{f: copy.deepcopy(getattr(channel.profile, f)) for f in PROFILE_FIELDS},
    )


def channel_patch_from_brief(patch: BriefPatch) -> ChannelPatch:
    """The channel patch ``PATCH /brief`` means, for the fields it sets.

    Raises ``ValueError`` for a field sent as ``null`` (a pydantic
    ``ValidationError`` is one too): the brief never had a null field.
    """
    sent = {name: getattr(patch, name) for name in patch.model_fields_set}
    nulls = sorted(name for name, value in sent.items() if value is None)
    if nulls:
        raise ValueError(f"{', '.join(nulls)} may be left out of a brief patch but not set to null")
    update: dict[str, Any] = {}
    if "channel" in sent:
        update["name"] = channel_name_from(sent["channel"])
    if "language" in sent:
        update["language"] = sent["language"]
    context = {name: sent[name] for name in CONTEXT_FROM_BRIEF if name in sent}
    if context:
        update["context"] = ChannelContext(**context)
    profile = {name: copy.deepcopy(sent[name]) for name in PROFILE_FIELDS if name in sent}
    if profile:
        update["profile"] = ChannelProfile(**profile)
    return ChannelPatch(**update)


def new_channel(channel_id: str, body: ChannelCreate) -> Channel:
    now = now_iso()
    fields = body.model_dump(exclude={"id"})
    return Channel.model_validate({**fields, "id": channel_id, "createdAt": now, "updatedAt": now})


def patched_channel(current: Channel, patch: ChannelPatch) -> Channel:
    """The channel after ``patch``; ``current`` itself when nothing changed."""
    sent = patch.model_fields_set
    update: dict[str, Any] = {name: getattr(patch, name) for name in _SCALAR_PATCH_FIELDS if name in sent}
    for block in _BLOCK_PATCH_FIELDS:
        given = getattr(patch, block)
        if block in sent and given is not None:
            per_field = {name: copy.deepcopy(getattr(given, name)) for name in given.model_fields_set}
            update[block] = getattr(current, block).model_copy(update=per_field)
    candidate = current.model_copy(update=update)
    if candidate.model_dump() == current.model_dump():
        return current
    return candidate.model_copy(update={"updatedAt": now_iso()})
