"""Platform facts, stated once: ids, editable fields, limits and how to count them.

docs/plans/multi-channel-pr1-contract.md → ``platforms.py``. This module is the
**one home of platform limits**: YouTube's come from ``validate.py`` (which
enforces them), and the LinkedIn / X / Instagram numbers ``platform_posts.py``
renders against live here and are imported back there. Never restate a number.

The table is served as ``GET /api/library/platforms`` so the renderer can meter a
field without a round trip. PR 1 only serves it; the validators that enforce the
TikTok/Instagram/LinkedIn/X limits per post arrive with posts (PR 2).

Units:

| unit       | counts                                                          |
|------------|-----------------------------------------------------------------|
| ``chars``  | Python ``len`` (code points)                                    |
| ``bytes``  | UTF-8 bytes                                                     |
| ``utf16``  | UTF-16 code units (TikTok): an emoji outside the BMP counts 2   |
| ``weighted`` | X: every ``http(s)://`` URL counts ``X_URL_WEIGHT``, every other code point 1 |
| ``items``  | list length                                                     |
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Optional, Pattern, Sequence, Union, get_args

from backend.library.validate import DESCRIPTION_MAX_BYTES, TAGS_MAX_CHARS, TITLE_MAX_CHARS

Platform = Literal["youtube", "tiktok", "instagram", "linkedin", "x"]
Unit = Literal["chars", "bytes", "utf16", "weighted", "items"]
Severity = Literal["hard", "style"]

#: Every platform id, in the order a menu lists them.
PLATFORM_IDS: tuple[str, ...] = get_args(Platform)
UNITS: tuple[str, ...] = get_args(Unit)

YOUTUBE: Platform = "youtube"
TIKTOK: Platform = "tiktok"
INSTAGRAM: Platform = "instagram"
LINKEDIN: Platform = "linkedin"
X: Platform = "x"

TIKTOK_MAX_CAPTION_UTF16 = 2200
TIKTOK_MAX_HASHTAGS = 5
INSTAGRAM_MAX_CHARS = 2200
INSTAGRAM_MAX_HASHTAGS = 30
INSTAGRAM_MAX_MENTIONS = 20
LINKEDIN_MAX_CHARS = 3000
LINKEDIN_MAX_HASHTAGS = 5
LINKEDIN_MIN_HASHTAGS = 3
X_MAX_WEIGHTED_CHARS = 280
#: What X's link shortener makes every URL count, whatever its real length.
X_URL_WEIGHT = 23

#: A URL as X's shortener sees one.
URL_RE = re.compile(r"https?://\S+")
UTF16_UNIT_BYTES = 2
UNKNOWN_UNIT = "Unknown unit {unit!r}; units are {units}"


@dataclass(frozen=True)
class PlatformLimit:
    """One limit on one field. ``min`` is set only where a floor is advised."""

    field: str
    max: int
    unit: Unit
    severity: Severity
    min: Optional[int] = None

    def served(self) -> dict:
        body = {"field": self.field, "max": self.max, "unit": self.unit, "severity": self.severity}
        return body if self.min is None else {**body, "min": self.min}


@dataclass(frozen=True)
class PlatformSpec:
    id: Platform
    label: str
    fields: tuple[str, ...]
    limits: tuple[PlatformLimit, ...]

    def served(self) -> dict:
        return {
            "id": self.id, "label": self.label, "fields": list(self.fields),
            "limits": [limit.served() for limit in self.limits],
        }


PLATFORM_SPECS: tuple[PlatformSpec, ...] = (
    PlatformSpec(YOUTUBE, "YouTube",
                 ("title", "description", "tags", "hashtags", "cover", "localized"), (
                     PlatformLimit("title", TITLE_MAX_CHARS, "chars", "hard"),
                     PlatformLimit("description", DESCRIPTION_MAX_BYTES, "bytes", "hard"),
                     PlatformLimit("tags", TAGS_MAX_CHARS, "chars", "hard"),
                 )),
    PlatformSpec(TIKTOK, "TikTok", ("caption", "hashtags", "cover"), (
        PlatformLimit("caption", TIKTOK_MAX_CAPTION_UTF16, "utf16", "hard"),
        PlatformLimit("hashtags", TIKTOK_MAX_HASHTAGS, "items", "style"),
    )),
    # ``mentions`` are counted inside the caption; they are not a field of their own.
    PlatformSpec(INSTAGRAM, "Instagram", ("caption", "hashtags", "cover"), (
        PlatformLimit("caption", INSTAGRAM_MAX_CHARS, "chars", "hard"),
        PlatformLimit("hashtags", INSTAGRAM_MAX_HASHTAGS, "items", "hard"),
        PlatformLimit("mentions", INSTAGRAM_MAX_MENTIONS, "items", "hard"),
    )),
    PlatformSpec(LINKEDIN, "LinkedIn", ("text", "hashtags", "cover"), (
        PlatformLimit("text", LINKEDIN_MAX_CHARS, "chars", "hard"),
        PlatformLimit("hashtags", LINKEDIN_MAX_HASHTAGS, "items", "style",
                      min=LINKEDIN_MIN_HASHTAGS),
    )),
    PlatformSpec(X, "X", ("text", "hashtags"), (
        PlatformLimit("text", X_MAX_WEIGHTED_CHARS, "weighted", "hard"),
    )),
)


def served_platforms() -> list[dict]:
    """The ``{platforms: [...]}`` body's list, freshly built on every call."""
    return [spec.served() for spec in PLATFORM_SPECS]


def weighted_length(
    text: str, *, url_weight: int = X_URL_WEIGHT, url_re: Pattern[str] = URL_RE
) -> int:
    """Every ``url_re`` match weighs ``url_weight``; every other code point one.
    X's heavier weighting of emoji and CJK characters is not modelled."""
    urls = url_re.findall(text)
    return len(text) - sum(len(url) for url in urls) + url_weight * len(urls)


def count(unit: str, value: Union[str, Sequence[object]], *, url_weight: int = X_URL_WEIGHT) -> int:
    """How long ``value`` is in ``unit``.

    Raises ``ValueError`` for an unknown unit and ``TypeError`` when ``value``
    is a string for ``items`` or a list for a text unit.
    """
    if unit not in UNITS:
        raise ValueError(UNKNOWN_UNIT.format(unit=unit, units=", ".join(UNITS)))
    if unit == "items":
        if isinstance(value, str) or not isinstance(value, (list, tuple)):
            raise TypeError(f"'items' counts a list, not {type(value).__name__}")
        return len(value)
    if not isinstance(value, str):
        raise TypeError(f"{unit!r} counts text, not {type(value).__name__}")
    if unit == "bytes":
        return len(value.encode("utf-8"))
    if unit == "utf16":
        return len(value.encode("utf-16-le")) // UTF16_UNIT_BYTES
    if unit == "weighted":
        return weighted_length(value, url_weight=url_weight)
    return len(value)
