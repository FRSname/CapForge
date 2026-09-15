"""The dossier: one Pydantic model per video record (vision §2.4).

Two base classes carry the split the contract test pins: ``AuthoredFields`` is
what a human or the agent writes, ``SystemFields`` is what the backend derives
or mints. ``VideoRecord`` is their union and ``RecordPatch`` is exactly the
authored half, all-optional and ``extra="forbid"`` — so a patch carrying ``rev``
or a typo'd key is a 422 rather than a silent no-op.

Status is **derived at read time, never stored** (§2.3), and chapters are
**seconds** (§9.2) — never a segment/word index, so a transcript edit before a
chapter cannot move it.
"""

from __future__ import annotations

import warnings
from datetime import datetime
from typing import Any, Literal, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field

#: Newest history entries kept per record; older ones fall off the front.
HISTORY_CAP = 200
#: A replaced string value longer than this is stored truncated in history —
#: a 5000-byte description would otherwise dominate the record file.
HISTORY_PREV_MAX_CHARS = 500

Actor = Literal["agent", "user", "system"]
Status = Literal["imported", "transcribed", "captioned", "drafted", "published"]


# --- authored sub-models -----------------------------------------------------

class Chapter(BaseModel):
    """A YouTube chapter. ``start_s`` is **seconds**, never an index (§9.2)."""

    start_s: float = Field(..., ge=0.0)
    title: str


class Highlight(BaseModel):
    text: str
    start_s: float
    end_s: float


class Quote(BaseModel):
    text: str
    start_s: float
    end_s: float
    speaker: Optional[str] = None


class Link(BaseModel):
    label: str
    url: str


class ClipSuggestion(BaseModel):
    start_s: float
    end_s: float
    why: str


class Shorts(BaseModel):
    caption: str = ""
    clip_suggestions: list[ClipSuggestion] = Field(default_factory=list)


class ThumbnailIdea(BaseModel):
    label: str
    type: str
    headline: str
    subtext: Optional[str] = None
    visual_suggestion: Optional[str] = None
    recommended: bool = False


class Thumbnail(BaseModel):
    ideas: list[ThumbnailIdea] = Field(default_factory=list)
    #: Frame names (``<32-hex>.jpg``) in the record's ``thumbnails/`` folder. Only
    #: the frame routes change this list (``frames.py``); a PATCH that changes it
    #: is refused (``candidates_managed``), and ``cover`` is null or one of them.
    candidates: list[str] = Field(default_factory=list)
    cover: Optional[str] = None


class Speaker(BaseModel):
    name: str
    handle: Optional[str] = None
    url: Optional[str] = None


class LocalizedFields(BaseModel):
    """The authored set for one language (§2.4); every field optional so a
    translation can cover only the title."""

    title: Optional[str] = None
    description: Optional[str] = None
    short_description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    hashtags: list[str] = Field(default_factory=list)
    chapter_titles: list[str] = Field(default_factory=list)
    shorts_caption: Optional[str] = None


class YouTubePublish(BaseModel):
    """Recorded from a URL the user pasted — v3.0 ships no YouTube API (D6)."""

    videoId: Optional[str] = None
    url: Optional[str] = None
    publishedAt: Optional[str] = None


class Publish(BaseModel):
    youtube: YouTubePublish = Field(default_factory=YouTubePublish)
    pushes: list[dict] = Field(default_factory=list)


class PostPublished(BaseModel):
    """Where one channel's post went live. ``id`` is the YouTube video id, derived
    from ``url`` on a ``posts`` write when absent (``youtube_url.py``)."""

    model_config = ConfigDict(extra="forbid")

    url: Optional[str] = None
    id: Optional[str] = None
    #: ISO-8601.
    at: Optional[str] = None


class Post(BaseModel):
    """One video's text for one channel (multi-channel PR 2). One model for every
    platform; which fields a platform has is ``platforms.py``'s table, and a
    filled field the platform lacks is ``field_not_on_platform``."""

    model_config = ConfigDict(extra="forbid")

    title: str = ""                     # youtube
    description: str = ""               # youtube
    short_description: str = ""         # youtube
    tags: list[str] = Field(default_factory=list)        # youtube
    caption: str = ""                   # tiktok, instagram
    text: str = ""                      # linkedin, x
    hashtags: list[str] = Field(default_factory=list)
    #: One of ``thumbnail.candidates``.
    cover: Optional[str] = None
    #: ``None`` means the channel's language.
    language: Optional[str] = None
    localized: dict[str, LocalizedFields] = Field(default_factory=dict)  # youtube
    published: PostPublished = Field(default_factory=PostPublished)
    hidden: bool = False


class PostPatch(Post):
    """A partial post. Only ``model_fields_set`` applies: a sent field replaces
    (``null`` resets it to the default), and ``localized`` merges per language."""

    title: Optional[str] = None
    description: Optional[str] = None
    short_description: Optional[str] = None
    tags: Optional[list[str]] = None
    caption: Optional[str] = None
    text: Optional[str] = None
    hashtags: Optional[list[str]] = None
    cover: Optional[str] = None
    language: Optional[str] = None
    localized: Optional[dict[str, Optional[LocalizedFields]]] = None
    published: Optional[PostPublished] = None
    hidden: Optional[bool] = None


class ExternalRef(BaseModel):
    system: str
    id: str
    url: Optional[str] = None


# --- system sub-models -------------------------------------------------------

class RenderEntry(BaseModel):
    """One produced output; a non-empty ``renders[]`` is what "captioned" means (D8)."""

    path: str
    kind: str
    at: str


class HistoryEntry(BaseModel):
    field: str
    prev: Any = None
    by: Actor
    at: str


# --- the record --------------------------------------------------------------

class AuthoredFields(BaseModel):
    title_options: list[str] = Field(default_factory=list)
    title: str = ""
    description: str = ""
    short_description: str = ""
    chapters: list[Chapter] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    hashtags: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    summary_md: str = ""
    highlights: list[Highlight] = Field(default_factory=list)
    quotes: list[Quote] = Field(default_factory=list)
    tools_mentioned: list[str] = Field(default_factory=list)
    links: list[Link] = Field(default_factory=list)
    shorts: Shorts = Field(default_factory=Shorts)
    thumbnail: Thumbnail = Field(default_factory=Thumbnail)
    speakers: dict[str, Speaker] = Field(default_factory=dict)
    collection_id: Optional[str] = None
    localized: dict[str, LocalizedFields] = Field(default_factory=dict)
    publish: Publish = Field(default_factory=Publish)
    external_refs: list[ExternalRef] = Field(default_factory=list)
    #: Per-channel text, keyed by channel id. The projected root fields above
    #: (``record_projection.PROJECTED_FIELDS``) are the primary channel's post.
    posts: dict[str, Post] = Field(default_factory=dict)


# ``schema`` is the name the file carries; pydantic warns that it shadows the
# deprecated ``BaseModel.schema()`` classmethod, which nothing here calls.
warnings.filterwarnings(
    "ignore", message='Field name "schema" in "SystemFields" shadows', category=UserWarning
)


class SystemFields(BaseModel):
    id: str
    rev: int = 1
    fingerprint: str = ""
    sourceTag: str = ""
    sourcePath: str = ""
    duration: Optional[float] = None
    language: Optional[str] = None
    renders: list[RenderEntry] = Field(default_factory=list)
    history: list[HistoryEntry] = Field(default_factory=list)
    createdAt: str = ""
    updatedAt: str = ""
    publishedAt: Optional[str] = None
    scratch: bool = False
    #: Derived at read time from ``sourcePath`` — stored in the file only so the
    #: shape stays flat for the MCP client; ``LibraryStore.get`` recomputes it.
    missing_media: bool = False
    #: The stored shape: 1 (or absent) is the pre-posts file ``record_upgrade``
    #: upgrades at read time; the store always writes 2.
    schema: int = 1


class VideoRecord(SystemFields, AuthoredFields):
    """``record.json`` — the durable, backend-owned dossier."""


class RecordPatch(AuthoredFields):
    """A partial write. Only fields in ``model_fields_set`` are applied, and a
    field is **replaced**, never deep-merged (a list patch is the new list)."""

    model_config = ConfigDict(extra="forbid")

    title_options: Optional[list[str]] = None
    title: Optional[str] = None
    description: Optional[str] = None
    short_description: Optional[str] = None
    chapters: Optional[list[Chapter]] = None
    tags: Optional[list[str]] = None
    hashtags: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    summary_md: Optional[str] = None
    highlights: Optional[list[Highlight]] = None
    quotes: Optional[list[Quote]] = None
    tools_mentioned: Optional[list[str]] = None
    links: Optional[list[Link]] = None
    shorts: Optional[Shorts] = None
    thumbnail: Optional[Thumbnail] = None
    speakers: Optional[dict[str, Speaker]] = None
    collection_id: Optional[str] = None
    #: Merged per language on PATCH (``localized.py``): ``null`` removes a language.
    localized: Optional[dict[str, Optional[LocalizedFields]]] = None
    publish: Optional[Publish] = None
    external_refs: Optional[list[ExternalRef]] = None
    #: Merged per channel, then per field (``post_merge.py``): ``null`` removes a post.
    posts: Optional[dict[str, Optional[PostPatch]]] = None


AUTHORED_FIELDS: frozenset[str] = frozenset(AuthoredFields.model_fields)
SYSTEM_FIELDS: frozenset[str] = frozenset(SystemFields.model_fields)


# --- derived state -----------------------------------------------------------

def derive_status(
    record: VideoRecord,
    has_segments: bool,
    *,
    posts: Optional[Mapping[str, Post]] = None,
) -> Status:
    """The §2.3 ladder, highest rung first. Never stored on the record.

    ``published`` is any visible post with a URL or id, ``drafted`` any visible
    post with a description, caption or text. The store passes ``posts`` (a
    record it loaded, whose root fields are only the primary post's projection,
    so a hidden primary post counts for nothing). Without it, the root fields of
    a record built in memory count as well.
    """
    visible = [post for post in (record.posts if posts is None else posts).values()
               if not post.hidden]
    legacy = posts is None
    if any(post.published.url or post.published.id for post in visible) or (
        legacy and record.publish.youtube.videoId
    ):
        return "published"
    if any((post.description + post.caption + post.text).strip() for post in visible) or (
        legacy and record.description.strip()
    ):
        return "drafted"
    if record.renders:
        return "captioned"
    if has_segments:
        return "transcribed"
    return "imported"


def captions_newer_than_published(
    record: VideoRecord, transcript_updated_at: Optional[str]
) -> bool:
    """True when the stored transcript changed after the video was published —
    the flag that keeps the status rail honest (§2.3).

    Raises ``ValueError`` on a timestamp that is not ISO-8601; ``publishedAt``
    can arrive from outside (a pasted YouTube response), so it is parsed rather
    than string-compared.
    """
    if not record.publishedAt or not transcript_updated_at:
        return False
    return _parse_iso(transcript_updated_at) > _parse_iso(record.publishedAt)


def _parse_iso(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Not an ISO-8601 timestamp: {value!r}") from exc
