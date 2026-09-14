"""The publish guide — the shipped workflow knowledge for the publish loop.

creator-hub-vision §3.4: the agent driving CapForge over MCP never sees the
bundled ``capforge-publish`` skill (that is Claude Code's copy); over MCP it
only sees tool docstrings. This module ships the same workflow as a pull-on-
demand topic set, the ``publish_guide(topic?)`` tool, the
``capforge://publish`` resources, and the ``@mcp.prompt()`` prompts Claude
Desktop lists as slash commands. Same shape as ``publish.py``: ``TOOLS``,
``register(mcp)``, **no import of ``server``**.

The manifest is the allowlist (``knowledge.TopicSet``), and
``tests/test_publish_guide.py`` asserts every tool a topic or prompt names
exists on the server — a renamed tool would otherwise break the workflow
silently (vision §7 #5).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from .knowledge import TopicNotFound, TopicSet

_GUIDE_DIR = Path(__file__).parent / "publish_guide"

#: topic id -> (filename, one-line description). Keep in sync with INDEX.md.
TOPICS: dict[str, tuple[str, str]] = {
    "workflow": ("workflow.md", "The loop: read the record and the brief, write structured fields, validate, read the package back, mark published. Start here."),
    "breakdown": ("breakdown.md", "The transcript breakdown: summary_md, timed highlights and quotes, tools mentioned, speakers — the fields every other topic draws on."),
    "description": ("description.md", "Title, title options, description, short description, tags, hashtags, keywords — YouTube's limits and the brief's house rules."),
    "chapters": ("chapters.md", "Chapters as seconds from real moments: the five hard rules, the candidates, the dry run, the short-video exception."),
    "thumbnails": ("thumbnails.md", "Thumbnail ideas as text (label, type, headline, subtext, visual suggestion) — CapForge generates no images."),
    "shorts": ("shorts.md", "The Shorts caption and 2–3 clip candidates as timestamps; CapForge cuts nothing."),
    "batch": ("batch.md", "Publishing a set of videos: list by status, one record per call, revs, what to report, scratch runs."),
}

GUIDE = TopicSet(_GUIDE_DIR, TOPICS)

#: The resource URIs, so the test and server.py agree on them.
RESOURCE_ENTRY = "capforge://publish"
RESOURCE_TOPIC = "capforge://publish/{topic}"


def publish_guide(topic: Optional[str] = None) -> str:
    """The CapForge publish workflow — how to turn a video's transcript into a
    copy-ready YouTube upload package written onto its library record.

    Call with NO topic FIRST: returns the operating model (the record is the
    source, the package is a rendering; the brief is binding; every write
    carries a rev) and the topic index. Then call with a `topic` id
    ("workflow", "breakdown", "description", "chapters", "thumbnails",
    "shorts", "batch") to pull that reference on demand. Consult this BEFORE
    writing publish fields with set_video_meta.
    """
    if not topic:
        return GUIDE.read_index()
    try:
        return GUIDE.read_topic(topic)
    except TopicNotFound as exc:
        return str(exc)


def _entry_resource() -> str:
    """Publish guide entry: operating model + topic index."""
    return GUIDE.read_index()


def _topic_resource(topic: str) -> str:
    """One publish guide topic by id (see the entry resource)."""
    try:
        return GUIDE.read_topic(topic)
    except TopicNotFound as exc:
        return str(exc)


# --- Prompts -------------------------------------------------------------
# Each returns the user turn Claude Desktop sends when the slash command is
# picked. They are entry points, not the workflow: the detail lives in the
# topic each one names, so the two cannot drift apart.


def breakdown(video_id: str) -> str:
    return (
        f"Break down the CapForge video `{video_id}` from its transcript. "
        "First read `publish_guide(\"breakdown\")` and follow it: read the record with "
        "`get_video` and the transcript with `get_video_transcript`, time the highlights "
        "and quotes with `find_video_moments`, then write `summary_md`, `highlights`, "
        "`quotes`, `tools_mentioned` and `speakers` in one `set_video_meta` call, run "
        "`validate_video`, and show me the summary and the highlights with their timestamps."
    )


def describe(video_id: str) -> str:
    return (
        f"Write the YouTube upload package for the CapForge video `{video_id}`. "
        "First read `publish_guide(\"workflow\")` and `publish_guide(\"description\")` and "
        "follow them: read the record with `get_video` and the channel brief with "
        "`get_brief`, read the transcript, write the title, title options, description, "
        "short description, tags, hashtags and keywords with `set_video_meta`, fix every "
        "finding `validate_video` reports, then read `get_upload_package` and show me the "
        "package ready to copy."
    )


def chapters(video_id: str) -> str:
    return (
        f"Propose chapters for the CapForge video `{video_id}`. First read "
        "`publish_guide(\"chapters\")` and follow it: find candidates with "
        "`find_video_moments` (`kind=\"pause\"` and `kind=\"speaker_change\"`), name each "
        "chapter in at most six words, dry-run the list with `check_chapters`, write it "
        "with `set_video_meta` only when the dry run is clean, and show me the list as "
        "timestamps and titles."
    )


def batch_publish(status: str = "transcribed") -> str:
    return (
        f"Publish every CapForge video whose status is `{status}`. First read "
        "`publish_guide(\"batch\")` and follow it: list them with `list_videos`, then for "
        "each one in turn run the workflow (breakdown, description, chapters, validate, "
        "package) with one record per call, and finish with a table of video, title, "
        "status and any finding still open. Stop and ask before touching a record that "
        "already has a description."
    )


#: (function, prompt name, one-line description) — the slash commands.
PROMPTS: tuple[tuple[Any, str, str], ...] = (
    (breakdown, "breakdown", "Summary, timed highlights and quotes for one video, written onto its record."),
    (describe, "describe", "The YouTube upload package for one video: title, description, tags, validated."),
    (chapters, "chapters", "Chapter candidates from the transcript's pauses and speaker changes, dry-run first."),
    (batch_publish, "batch_publish", "Run the publish workflow over every video with a given status, one at a time."),
)

#: The one tool this module contributes.
TOOLS = (publish_guide,)


def register(mcp: Any) -> None:
    """Register the guide tool, the two resources and the prompts on the server."""
    for tool in TOOLS:
        mcp.tool()(tool)
    mcp.resource(RESOURCE_ENTRY)(_entry_resource)
    mcp.resource(RESOURCE_TOPIC)(_topic_resource)
    for fn, name, description in PROMPTS:
        mcp.prompt(name=name, description=description)(fn)
