"""Copy for platform: the record as a LinkedIn, X or Instagram post (publish-editors C1).

Clipboard text only: nothing is posted and there is no OAuth. Each renderer
reads the same record (or its ``lang`` localized view) and effective brief as
the YouTube package and lays out one post. Pure: no I/O, no store.

| platform  | text                                               | video URL           | hashtags              | limit        |
|-----------|----------------------------------------------------|---------------------|-----------------------|--------------|
| LinkedIn  | hook, rest of the description, "In this video:"    | ``Watch: <url>``    | the first 5           | 3000 chars   |
| X         | title, else short description                      | the URL             | as many as still fit  | 280 weighted |
| Instagram | short description, else the first paragraph        | ``Link in bio``     | at most 30, one block | 2200 chars   |

The brief's footer (and a collection's slots, which only expand inside it) is a
YouTube-description convention and is never printed here.

**Findings are reported, never enforced by cutting prose** — X only drops
hashtags from the end until the post fits:

| rule                                                        | severity | field                   |
|-------------------------------------------------------------|----------|-------------------------|
| ``linkedin_max_chars`` / ``x_max_chars`` / ``instagram_max_chars`` | hard | ``package.<platform>`` |
| ``video_url_missing`` (the placeholder printed)             | style    | ``package.<platform>``  |
| ``linkedin_hashtags`` (fewer than 3)                        | style    | ``package.linkedin``    |
| ``instagram_hashtags_trimmed`` (more than 30, the rest dropped) | style | ``package.instagram``  |

**Counting** is ``len()`` of the text, except on X, where every ``http(s)://``
URL, and the placeholder that stands for one, weighs ``X_URL_WEIGHT``. X's
heavier weighting of emoji and CJK characters is **not** modelled.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

from backend.library.brief import Brief
from backend.library.collection_store import Collection, effective_brief
from backend.library.package import FULL_VIDEO_URL_PLACEHOLDER, chapter_lines, hashtags
from backend.library.schemas import VideoRecord
from backend.library.violation import Violation, hard, style

logger = logging.getLogger(__name__)

LINKEDIN = "linkedin"
X = "x"
INSTAGRAM = "instagram"
#: The clipboard posts, in the order a menu lists them.
PLATFORMS = (LINKEDIN, X, INSTAGRAM)

LINKEDIN_MAX_CHARS = 3000
LINKEDIN_MAX_HASHTAGS = 5
LINKEDIN_MIN_HASHTAGS = 3
#: Chapters listed under "In this video:".
LINKEDIN_MAX_MOMENTS = 5
X_MAX_WEIGHTED_CHARS = 280
#: What X's link shortener makes every URL count, whatever its real length.
X_URL_WEIGHT = 23
INSTAGRAM_MAX_CHARS = 2200
INSTAGRAM_MAX_HASHTAGS = 30

WATCH_LABEL = "Watch: "
MOMENTS_HEADER = "In this video:"
#: Instagram captions don't link, so the URL is never printed there.
LINK_IN_BIO = "Link in bio"
BLOCK_SEPARATOR = "\n\n"
HASHTAG_SEPARATOR = " "
PACKAGE_FIELD = "package.{platform}"
UNSUPPORTED = "No {platform!r} post layout; CapForge renders {supported}"

#: Every URL X would shorten, plus the placeholder a URL will replace.
X_URL_RE = re.compile(rf"https?://\S+|{re.escape(FULL_VIDEO_URL_PLACEHOLDER)}")
#: A blank line (spaces allowed) between two paragraphs, however many there are.
PARAGRAPH_BREAK_RE = re.compile(r"\n\s*\n")


class UnsupportedPlatform(ValueError):
    """A platform with no post layout."""


@dataclass(frozen=True)
class PlatformPost:
    """One post as pasted, and what still keeps it from pasting cleanly."""

    text: str
    violations: tuple[Violation, ...] = ()


def render_platform_post(
    record: VideoRecord,
    brief: Brief,
    platform: str,
    *,
    collection: Optional[Collection] = None,
) -> PlatformPost:
    """``record`` as a ``platform`` post. ``brief`` is the channel brief; the
    collection's overrides are applied here, as the YouTube package does.

    Raises :class:`UnsupportedPlatform` for a platform not in :data:`PLATFORMS`.
    """
    renderer = _RENDERERS.get(platform)
    if renderer is None:
        raise UnsupportedPlatform(
            UNSUPPORTED.format(platform=platform, supported=", ".join(PLATFORMS))
        )
    effective = effective_brief(brief, collection)
    tags = tuple(hashtags(effective.default_hashtags, record.hashtags))
    post = renderer(record, tags)
    logger.debug(
        "Rendered a %s post for %s: %d characters, %d finding(s)",
        platform, record.id, len(post.text), len(post.violations),
    )
    return post


def weighted_x_length(text: str) -> int:
    """X's count: every URL (and the video URL placeholder) is ``X_URL_WEIGHT``,
    every other character is one. Emoji and CJK weighting is not modelled."""
    urls = X_URL_RE.findall(text)
    return len(text) - sum(len(url) for url in urls) + X_URL_WEIGHT * len(urls)


# --- the three renderers ---------------------------------------------------------

def render_linkedin(record: VideoRecord, tags: Sequence[str]) -> PlatformPost:
    """The hook, the rest of the description, the moments, the link, the hashtags.

    The hook is the short description, and then the whole description follows;
    without one, the description's first paragraph is the hook.
    """
    short = record.short_description.strip()
    paragraphs = _paragraphs(record.description)
    lead = [short, *paragraphs] if short else paragraphs
    moments = chapter_lines(record.chapters)[:LINKEDIN_MAX_MOMENTS]
    url = _video_url(record)
    text = _blocks([
        *lead,
        "\n".join([MOMENTS_HEADER, *moments]) if moments else "",
        f"{WATCH_LABEL}{url or FULL_VIDEO_URL_PLACEHOLDER}",
        _tag_line(tags[:LINKEDIN_MAX_HASHTAGS]),
    ])
    found = [
        *_length_findings(LINKEDIN, len(text), LINKEDIN_MAX_CHARS, "characters"),
        *_url_findings(LINKEDIN, url),
    ]
    if len(tags) < LINKEDIN_MIN_HASHTAGS:
        found.append(style(
            _field(LINKEDIN), "linkedin_hashtags",
            f"The post has {len(tags)} hashtag(s); LinkedIn posts do best with "
            f"{LINKEDIN_MIN_HASHTAGS} to {LINKEDIN_MAX_HASHTAGS}",
        ))
    return PlatformPost(text, tuple(found))


def render_x(record: VideoRecord, tags: Sequence[str]) -> PlatformPost:
    """The title, the URL, and as many whole hashtags as still fit in 280."""
    prose = record.title.strip() or record.short_description.strip()
    url = _video_url(record)
    head = [prose, url or FULL_VIDEO_URL_PLACEHOLDER]
    kept = tuple(tags)
    while kept and weighted_x_length(_blocks([*head, _tag_line(kept)])) > X_MAX_WEIGHTED_CHARS:
        kept = kept[:-1]
    text = _blocks([*head, _tag_line(kept)])
    found = [
        *_length_findings(X, weighted_x_length(text), X_MAX_WEIGHTED_CHARS,
                          f"weighted characters (every URL counts {X_URL_WEIGHT})"),
        *_url_findings(X, url),
    ]
    return PlatformPost(text, tuple(found))


def render_instagram(record: VideoRecord, tags: Sequence[str]) -> PlatformPost:
    """The caption, "Link in bio", and at most 30 hashtags in one block."""
    paragraphs = _paragraphs(record.description)
    caption = record.short_description.strip() or (paragraphs[0] if paragraphs else "")
    text = _blocks([caption, LINK_IN_BIO, _tag_line(tags[:INSTAGRAM_MAX_HASHTAGS])])
    found = [*_length_findings(INSTAGRAM, len(text), INSTAGRAM_MAX_CHARS, "characters")]
    dropped = len(tags) - INSTAGRAM_MAX_HASHTAGS
    if dropped > 0:
        found.append(style(
            _field(INSTAGRAM), "instagram_hashtags_trimmed",
            f"{dropped} hashtag(s) beyond Instagram's {INSTAGRAM_MAX_HASHTAGS} were "
            "left out of the post",
        ))
    return PlatformPost(text, tuple(found))


_RENDERERS: dict[str, Callable[[VideoRecord, Sequence[str]], PlatformPost]] = {
    LINKEDIN: render_linkedin,
    X: render_x,
    INSTAGRAM: render_instagram,
}


# --- helpers ---------------------------------------------------------------------

def _field(platform: str) -> str:
    return PACKAGE_FIELD.format(platform=platform)


def _video_url(record: VideoRecord) -> str:
    return (record.publish.youtube.url or "").strip()


def _paragraphs(text: str) -> list[str]:
    """Non-empty paragraphs, trimmed, with every line ending normalised to ``\\n``."""
    normalised = text.replace("\r\n", "\n").replace("\r", "\n")
    return [part.strip() for part in PARAGRAPH_BREAK_RE.split(normalised) if part.strip()]


def _blocks(parts: Sequence[str]) -> str:
    return BLOCK_SEPARATOR.join(part for part in parts if part)


def _tag_line(tags: Sequence[str]) -> str:
    return HASHTAG_SEPARATOR.join(tags)


def _length_findings(platform: str, length: int, limit: int, unit: str) -> list[Violation]:
    if length <= limit:
        return []
    return [hard(
        _field(platform), f"{platform}_max_chars",
        f"The post is {length} {unit}; the limit is {limit}. Shorten the fields it "
        "is built from; it won't paste as-is",
    )]


def _url_findings(platform: str, url: str) -> list[Violation]:
    if url:
        return []
    return [style(
        _field(platform), "video_url_missing",
        f"The post prints {FULL_VIDEO_URL_PLACEHOLDER} until the published YouTube "
        "URL is recorded (publish.youtube.url)",
    )]
