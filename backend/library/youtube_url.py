"""The video id inside a YouTube URL: the backend's one copy (PR 2 contract → Merge).

A ``posts.<id>.published.url`` written without an ``id`` on a YouTube channel
gets its id from here (``post_merge.py``). The MCP server cannot import
``backend``, so its client-side check keeps its own reader.
"""

from __future__ import annotations

from typing import Optional
from urllib.parse import parse_qs, urlparse

#: Path prefixes whose next segment is the video id.
YOUTUBE_PATH_PREFIXES = ("/shorts/", "/live/", "/embed/", "/v/")
SHORT_HOST = "youtu.be"
WATCH_HOSTS = ("youtube.com", "music.youtube.com")
WATCH_QUERY_KEY = "v"
HOST_PREFIXES = ("www.", "m.")


def youtube_id_from_url(url: str) -> Optional[str]:
    """``youtu.be/<id>``, ``watch?v=<id>``, ``/shorts|live|embed|v/<id>``; else None."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    for prefix in HOST_PREFIXES:
        host = host.removeprefix(prefix)
    path = parsed.path or ""
    if host == SHORT_HOST:
        return path.strip("/").split("/")[0] or None
    if host not in WATCH_HOSTS:
        return None
    watch = parse_qs(parsed.query).get(WATCH_QUERY_KEY, [None])[0]
    if watch:
        return watch
    for prefix in YOUTUBE_PATH_PREFIXES:
        if path.startswith(prefix):
            return path[len(prefix):].split("/")[0] or None
    return None
