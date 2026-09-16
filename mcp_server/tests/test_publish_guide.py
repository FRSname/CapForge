"""The publish guide (`mcp_server/publish_guide/`) must not drift from the tool surface.

creator-hub-vision §7 #5: "A test must assert every tool named in the guide exists
on the server, or it drifts." The guide is prose the agent follows literally, and
the prompts are its entry points — a renamed tool would silently break both.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from mcp_server import publish_guide
from mcp_server.knowledge import TopicNotFound

from .test_bundled_skills import _TOOL_REF, MCP_DIR, MOMENT_KINDS, _registered_tools

PROMPT_NAMES = {name for _, name, _ in publish_guide.PROMPTS}
#: `find_video_moments(kind=…)` values the guide may name — parameters, not tools.
KINDS = MOMENT_KINDS | {"pause"}
#: Backticked snake_case names that are record fields, shape keys or another
#: server's tool, not CapForge tools. A new one fails the drift test until it is
#: filed here — which is the point: the list is read, not guessed.
NOT_TOOLS = KINDS | PROMPT_NAMES | {
    # dossier fields and their shape keys (backend/library/schemas.py)
    "title_options", "short_description", "summary_md", "tools_mentioned",
    "external_refs", "clip_suggestions", "visual_suggestion", "start_s", "end_s",
    # tool parameters the guide spells out
    "video_id", "segments_only", "include_scratch", "youtube_video_id", "published_at",
    # the Update-conf MCP's tool, reached only when that server is connected
    "set_session_enrichment",
    # collections: the record field, brief/override fields, a detail key, a rule
    "collection_id", "description_template", "recorded_at_line", "default_hashtags",
    "link_rows", "house_rules", "effective_brief", "unknown_slot", "unknown_collection",
    # nested collections: the tree fields a collection row carries
    "parent_id", "total_members",
    # shorts and thumbnail rules (backend/library/validate_media.py)
    "candidates_managed", "cover_not_a_candidate", "thumbnail_recommended",
    "clip_order", "clip_past_end", "shorts_clip_length",
    # localized fields and their rules (backend/library/validate_localized.py)
    "chapter_titles", "shorts_caption", "localized_lang_code", "localized_is_source",
    "localized_chapter_count", "title_max_chars", "description_max_bytes",
    "tags_max_chars", "no_angle_brackets",
    # channels: context/profile fields, a list key, the refusal reasons (channel_tools.py)
    "title_style", "example_titles", "example_slugs", "primary_id", "channel_is_primary",
    "primary_not_youtube",
    # posts per channel: a get_channel parameter, its answer key, the refusal rules
    # (docs/plans/multi-channel-pr2-contract.md)
    "include_recent_posts", "recent_posts", "field_not_on_platform", "unknown_channel",
    "ambiguous_post_field", "no_post",
    # platform post findings (backend/library/platform_posts.py)
    "video_url_missing", "linkedin_max_chars", "x_max_chars", "instagram_max_chars",
}

#: The built-in template slots, shared with the backend and the renderer.
BUILTIN_SLOTS_FIXTURE = MCP_DIR.parent / "backend" / "tests" / "fixtures" / "builtin_slots.json"


def _guide_texts() -> dict[str, str]:
    texts = {"INDEX.md": publish_guide.GUIDE.read_index()}
    for tid in publish_guide.TOPICS:
        texts[tid] = publish_guide.GUIDE.read_topic(tid)
    return texts


# --- the manifest ---------------------------------------------------------

def test_every_manifest_topic_has_a_shipped_file() -> None:
    for tid, (filename, desc) in publish_guide.TOPICS.items():
        path = publish_guide._GUIDE_DIR / filename
        assert path.is_file(), f"missing file for topic '{tid}': {filename}"
        assert desc.strip(), f"topic '{tid}' has an empty description"
        assert len(path.read_text(encoding="utf-8")) > 300, f"topic '{tid}' is a stub"


def test_the_topics_of_the_plan() -> None:
    """vision §3.4 names the set, library-collections adds `collections` and
    publish-editors Part B adds `localized`; a topic added or dropped is a plan change."""
    assert list(publish_guide.TOPICS) == [
        "workflow", "breakdown", "description", "chapters", "thumbnails", "shorts", "batch",
        "collections", "channels", "localized",
    ]


def test_the_localized_topic_states_the_merge_and_the_language_loop() -> None:
    topic = " ".join(publish_guide.GUIDE.read_topic("localized").split())
    for name in ("get_ui_state", "get_track", "set_video_meta", "validate_video",
                 "get_upload_package", "localized_is_source", "localized_lang_code"):
        assert name in topic, name
    assert "null" in topic and "one language per call" in topic.lower()
    assert topic.index("set_video_meta") < topic.index("get_upload_package")


def test_index_lists_every_topic_and_the_operating_model() -> None:
    index = publish_guide.GUIDE.read_index()
    assert "Operating model" in index
    for tid in publish_guide.TOPICS:
        assert f"`{tid}`" in index, f"topic '{tid}' missing from INDEX.md"
    for name in PROMPT_NAMES:
        assert f"**{name}**" in index, f"prompt '{name}' missing from INDEX.md"


def test_no_orphan_files_in_guide_dir() -> None:
    mapped = {fn for fn, _ in publish_guide.TOPICS.values()} | {"INDEX.md"}
    on_disk = {p.name for p in Path(publish_guide._GUIDE_DIR).glob("*.md")}
    assert on_disk == mapped, f"orphan/missing files: {on_disk ^ mapped}"


def test_unknown_and_traversal_ids_are_refused() -> None:
    with pytest.raises(TopicNotFound):
        publish_guide.GUIDE.read_topic("does-not-exist")
    with pytest.raises(TopicNotFound):
        publish_guide.GUIDE.read_topic("../server")
    # The tool answers with the message, never raises into the MCP layer.
    assert publish_guide.publish_guide("../server").startswith("Unknown topic")
    assert "Operating model" in publish_guide.publish_guide()


def test_the_packaged_app_ships_the_topic_files() -> None:
    """electron-builder's `files` is an allowlist by glob — knowledge/ and
    skills/ are listed explicitly, and so must this directory be, or the
    installed app has the tool and none of its text."""
    import json

    files = json.loads((MCP_DIR.parent / "package.json").read_text(encoding="utf-8"))["build"]["files"]
    assert "mcp_server/publish_guide/**/*.md" in files


def test_guide_and_topic_text_never_raise_into_the_mcp_layer() -> None:
    assert publish_guide.GUIDE.guide() == publish_guide.GUIDE.read_index()
    assert publish_guide.GUIDE.guide("shorts") == publish_guide.GUIDE.read_topic("shorts")
    assert publish_guide.GUIDE.topic_text("nope").startswith("Unknown topic 'nope'. Available: workflow")


# --- the drift test -------------------------------------------------------

@pytest.mark.parametrize("name", ["INDEX.md", *publish_guide.TOPICS])
def test_every_tool_the_guide_names_exists(name: str) -> None:
    tools = _registered_tools()
    referenced = set(_TOOL_REF.findall(_guide_texts()[name])) - NOT_TOOLS
    unknown = referenced - tools
    assert not unknown, f"publish_guide/{name} names tools that do not exist: {sorted(unknown)}"


@pytest.mark.parametrize("fn,name,_desc", publish_guide.PROMPTS, ids=[n for _, n, _ in publish_guide.PROMPTS])
def test_every_tool_a_prompt_names_exists_and_it_points_at_the_guide(fn, name, _desc) -> None:
    text = fn("abc123") if name != "batch_publish" else fn("transcribed")
    referenced = set(_TOOL_REF.findall(text)) - NOT_TOOLS
    unknown = referenced - _registered_tools()
    assert not unknown, f"prompt '{name}' names tools that do not exist: {sorted(unknown)}"
    assert "publish_guide" in referenced, f"prompt '{name}' must send the agent to the guide first"
    assert ("abc123" in text) or ("transcribed" in text), "the argument must reach the prompt text"


def test_the_collections_topic_lists_every_builtin_slot() -> None:
    """The slot list is copy, so it is pinned to the shared fixture."""
    slots = json.loads(BUILTIN_SLOTS_FIXTURE.read_text(encoding="utf-8"))["slots"]
    topic = publish_guide.GUIDE.read_topic("collections")
    missing = [s for s in slots if f"{{{{{s}}}}}" not in topic]
    assert not missing, f"collections.md does not list built-in slots: {missing}"


def test_the_collections_topic_states_the_rules_an_agent_breaks() -> None:
    topic = " ".join(publish_guide.GUIDE.read_topic("collections").split())
    assert "set_video_meta" in topic and "collection_id" in topic
    assert "unknown_slot" in topic
    assert "orphan" in topic
    assert "never paste" in topic.lower()


def test_batch_reads_the_collection_once_and_never_rewrites_descriptions() -> None:
    batch = " ".join(publish_guide.GUIDE.read_topic("batch").split())
    assert "get_collection" in batch
    assert "get_upload_package" in batch and "never rewrit" in batch.lower()


def test_batch_publish_prompt_scopes_to_a_collection_when_given_one() -> None:
    scoped = publish_guide.batch_publish("drafted", collection="uck26")
    assert "uck26" in scoped and "drafted" in scoped
    assert "get_collection" in scoped
    unscoped = publish_guide.batch_publish("drafted")
    assert "get_collection" not in unscoped and "collection=" not in unscoped


def test_the_workflow_has_an_other_platforms_note() -> None:
    """Multi-channel PR 4 dropped `platform=`: a social post is a channel's post."""
    workflow = " ".join(publish_guide.GUIDE.read_topic("workflow").split())
    assert "Other platforms" in workflow
    note = workflow[workflow.index("Other platforms"):]
    for words in ('get_upload_package(video_id, channel="filip-li")', "no `platform`",
                  "video_url_missing", "nothing is posted", "no_post"):
        assert words in note, words
    assert "platform=" not in workflow


def test_the_guide_reads_the_record_before_writing() -> None:
    """The workflow's one direction (fields in, package out) must be stated."""
    workflow = publish_guide.GUIDE.read_topic("workflow")
    assert "get_video" in workflow and "set_video_meta" in workflow
    assert workflow.index("get_video") < workflow.index("set_video_meta")
    assert "mark_published" in workflow


# --- registration ---------------------------------------------------------

class _Recorder:
    """Stands in for FastMCP: records what `register` hands it."""

    def __init__(self) -> None:
        self.tools: list[str] = []
        self.resources: list[str] = []
        self.prompts: list[tuple[str, str]] = []

    def tool(self):
        return lambda fn: self.tools.append(fn.__name__) or fn

    def resource(self, uri: str):
        return lambda fn: self.resources.append(uri) or fn

    def prompt(self, name: str, description: str):
        return lambda fn: self.prompts.append((name, description)) or fn


def test_register_adds_one_tool_two_resources_and_the_four_prompts() -> None:
    mcp = _Recorder()
    publish_guide.register(mcp)
    assert mcp.tools == ["publish_guide"]
    assert mcp.resources == [publish_guide.RESOURCE_ENTRY, publish_guide.RESOURCE_TOPIC]
    assert [n for n, _ in mcp.prompts] == ["breakdown", "describe", "chapters", "batch_publish"]
    assert all(d.strip() for _, d in mcp.prompts)


def test_real_fastmcp_lists_the_prompts_and_serves_the_resources() -> None:
    """Against the SDK itself, when it is installed (the app's runtime ships it)."""
    fastmcp = pytest.importorskip("mcp.server.fastmcp")
    import asyncio

    mcp = fastmcp.FastMCP("capforge-test")
    publish_guide.register(mcp)
    prompts = asyncio.run(mcp.list_prompts())
    assert {p.name for p in prompts} == PROMPT_NAMES
    by_name = {p.name: p for p in prompts}
    assert [(a.name, a.required) for a in by_name["describe"].arguments] == [("video_id", True)]
    assert [(a.name, a.required) for a in by_name["batch_publish"].arguments] == [
        ("status", False), ("collection", False),
    ]
    scoped = asyncio.run(mcp.get_prompt("batch_publish", {"collection": "uck26"}))
    assert "uck26" in scoped.messages[0].content.text
    rendered = asyncio.run(mcp.get_prompt("chapters", {"video_id": "vid_9"}))
    assert "vid_9" in rendered.messages[0].content.text
    entry = asyncio.run(mcp.read_resource(publish_guide.RESOURCE_ENTRY))
    assert "Operating model" in list(entry)[0].content
    topic = asyncio.run(mcp.read_resource("capforge://publish/chapters"))
    assert "five hard rules" in list(topic)[0].content
    assert {t.name for t in asyncio.run(mcp.list_tools())} == {"publish_guide"}


def test_the_channels_topic_states_posts_and_the_recent_posts_opt_in() -> None:
    topic = " ".join(publish_guide.GUIDE.read_topic("channels").split())
    for name in ("posts", "set_video_meta", "validate_video", "get_upload_package",
                 "mark_published", "include_recent_posts", "hidden", "primary channel's post"):
        assert name in topic, name
    assert "only when the user explicitly asks" in topic
    assert "copy" in topic  # the reason: old posts pull a draft toward a copy
