"""The package route's formats, and its answer for a clipboard post (publish-editors C1).

Kept out of ``router_publish.py`` for its size ceiling: the route reads the
store and localizes the record; this composes the ``platform`` answer. Pure.

A post's ``violations`` are the record's own findings first, exactly as the
YouTube package reports them (the record's hard and style rules under the
effective brief; with ``lang``, addressed under ``localized.<lang>``), then the
post's ``package.<platform>`` findings. The YouTube package's
``package.description`` findings are not repeated, because no post prints the
assembled description. ``description`` is ``None`` for the same reason.
"""

from __future__ import annotations

from typing import Optional

from backend.library.brief import Brief
from backend.library.collection_store import Collection, effective_brief
from backend.library.platform_posts import PLATFORMS, render_platform_post
from backend.library.schemas import VideoRecord
from backend.library.validate import validate_record
from backend.library.validate_localized import view_findings

#: YouTube's upload package, then the clipboard posts; anything else is a 400.
YOUTUBE = "youtube"
PACKAGE_PLATFORMS = (YOUTUBE, *PLATFORMS)
UNSUPPORTED_PLATFORM = "Unsupported platform {platform!r}; CapForge renders {supported} packages"


def unsupported_platform_detail(platform: str) -> str:
    """The 400's ``detail``, naming every platform that is supported."""
    return UNSUPPORTED_PLATFORM.format(
        platform=platform, supported=", ".join(repr(name) for name in PACKAGE_PLATFORMS)
    )


def platform_package(
    record: VideoRecord,
    view: VideoRecord,
    lang: Optional[str],
    brief: Brief,
    *,
    collection: Optional[Collection],
    duration: Optional[float],
    platform: str,
) -> dict:
    """``{platform, text, violations, description: None}`` for a post.

    ``view`` is ``record`` localized into ``lang`` (``record`` itself when
    ``lang`` is None); ``brief`` is the channel brief, under ``collection``.
    """
    found = validate_record(view, duration=duration, brief=effective_brief(brief, collection))
    if lang is not None:
        found = view_findings(found, record, lang)
    post = render_platform_post(view, brief, platform, collection=collection)
    return {
        "platform": platform,
        "text": post.text,
        "violations": [violation.model_dump() for violation in (*found, *post.violations)],
        "description": None,
    }
