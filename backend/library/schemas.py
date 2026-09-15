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

from datetime import datetime
from typing import Any, Literal, Optional

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


AUTHORED_FIELDS: frozenset[str] = frozenset(AuthoredFields.model_fields)
SYSTEM_FIELDS: frozenset[str] = frozenset(SystemFields.model_fields)


# --- derived state -----------------------------------------------------------

def derive_status(record: VideoRecord, has_segments: bool) -> Status:
    """The §2.3 ladder, highest rung first. Never stored on the record."""
    if record.publish.youtube.videoId:
        return "published"
    if record.description.strip():
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
