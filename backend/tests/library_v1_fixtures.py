"""Synthetic schema-1 ``record.json`` bodies, shaped like the real ones.

Every root key a pre-posts build wrote is present, with the nesting it wrote
(``publish: {youtube: {videoId, url, publishedAt}, pushes: []}``,
``thumbnail: {ideas, candidates, cover}``, ``localized: {}``,
``shorts: {caption, clip_suggestions}``). All text is invented.
"""

from __future__ import annotations

import copy

COVER = "0123456789abcdef0123456789abcdef.jpg"
OTHER_FRAME = "fedcba9876543210fedcba9876543210.jpg"
CREATED = "2026-08-01T09:00:00Z"
UPDATED = "2026-08-02T10:30:00Z"


def _system(video_id: str, source_path: str) -> dict:
    return {
        "id": video_id,
        "rev": 7,
        "fingerprint": "f" * 40,
        "sourceTag": "abcd1234",
        "sourcePath": source_path,
        "duration": 600.0,
        "language": "en",
        "renders": [{"path": "/renders/out.mp4", "kind": "video", "at": UPDATED}],
        "history": [{"field": "title", "prev": "", "by": "agent", "at": UPDATED}],
        "createdAt": CREATED,
        "updatedAt": UPDATED,
        "publishedAt": None,
        "scratch": False,
        "missing_media": False,
    }


def _empty_authored() -> dict:
    return {
        "title_options": [],
        "title": "",
        "description": "",
        "short_description": "",
        "chapters": [],
        "tags": [],
        "hashtags": [],
        "keywords": [],
        "summary_md": "",
        "highlights": [],
        "quotes": [],
        "tools_mentioned": [],
        "links": [],
        "shorts": {"caption": "", "clip_suggestions": []},
        "thumbnail": {"ideas": [], "candidates": [], "cover": None},
        "speakers": {},
        "collection_id": None,
        "localized": {},
        "publish": {"youtube": {"videoId": None, "url": None, "publishedAt": None},
                    "pushes": []},
        "external_refs": [],
    }


def full_v1(video_id: str, source_path: str) -> dict:
    """Every authored field filled, published, one translation, a cover."""
    return {
        **_system(video_id, source_path),
        **_empty_authored(),
        "publishedAt": "2026-08-03T08:00:00Z",
        "title_options": ["Pickling the tide tables", "Tide tables, pickled"],
        "title": "Pickling the tide tables",
        "description": "A harbour clerk explains tide tables.\n\nThen she pickles them — carefully.",
        "short_description": "Tide tables, explained by a harbour clerk.",
        "chapters": [{"start_s": 0.0, "title": "Harbour"},
                     {"start_s": 60.0, "title": "Tables"},
                     {"start_s": 120.0, "title": "Jars"}],
        "tags": ["tides", "harbour", "pickling"],
        "hashtags": ["tides", "#harbour"],
        "keywords": ["tide tables", "harbour"],
        "summary_md": "- tides\n- jars",
        "highlights": [{"text": "The moon is late again", "start_s": 61.0, "end_s": 64.0}],
        "quotes": [{"text": "Brine keeps time.", "start_s": 130.0, "end_s": 132.0,
                    "speaker": "SPEAKER_00"}],
        "tools_mentioned": ["almanac"],
        "links": [{"label": "Harbour office", "url": "https://harbour.example"}],
        "shorts": {"caption": "Why the tide is late",
                   "clip_suggestions": [{"start_s": 61.0, "end_s": 90.0, "why": "the moon bit"}]},
        "thumbnail": {
            "ideas": [{"label": "A", "type": "face", "headline": "LATE TIDE",
                       "subtext": None, "visual_suggestion": "clerk with jar",
                       "recommended": True}],
            "candidates": [COVER, OTHER_FRAME],
            "cover": COVER,
        },
        "speakers": {"SPEAKER_00": {"name": "Wren Alder", "handle": "@wren", "url": None}},
        "localized": {"pl": {"title": "Marynowanie tablic pływów", "description": None,
                             "short_description": None, "tags": ["pływy"], "hashtags": [],
                             "chapter_titles": ["Port"], "shorts_caption": None}},
        "publish": {"youtube": {"videoId": "tideVid0001",
                                "url": "https://youtu.be/tideVid0001",
                                "publishedAt": "2026-08-03T08:00:00Z"},
                    "pushes": [{"target": "notes", "at": "2026-08-03T09:00:00Z"}]},
        "external_refs": [{"system": "notion", "id": "page-1", "url": None}],
    }


def drafted_v1(video_id: str, source_path: str) -> dict:
    """Written but not published: no cover, no translation."""
    return {
        **_system(video_id, source_path),
        **_empty_authored(),
        "title": "Knots for impatient sailors",
        "description": "Three knots, one minute each.",
        "tags": ["knots"],
        "hashtags": ["sailing"],
        "keywords": ["knots"],
    }


def title_only_v1(video_id: str, source_path: str) -> dict:
    return {**_system(video_id, source_path), **_empty_authored(), "title": "Untitled lighthouse"}


def bare_v1(video_id: str, source_path: str) -> dict:
    """Imported and nothing written: the upgrade gives it no post."""
    return {**_system(video_id, source_path), **_empty_authored()}


FIXTURES = {
    "full": full_v1,
    "drafted": drafted_v1,
    "title_only": title_only_v1,
    "bare": bare_v1,
}


def fixture(name: str, video_id: str, source_path: str) -> dict:
    return copy.deepcopy(FIXTURES[name](video_id, source_path))
