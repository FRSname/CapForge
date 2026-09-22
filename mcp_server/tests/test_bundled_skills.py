"""Bundled skills (`mcp_server/skills/*/SKILL.md`) must not drift from the tool surface.

creator-hub-vision §7 #5: "A test must assert every tool named in the guide exists
on the server, or it drifts." A skill is prose the agent follows literally, so a
renamed tool would silently break every run. Every folder under `skills/` is a
skill the app lists, seeds a user copy of, and installs — so each one is checked.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

MCP_DIR = Path(__file__).resolve().parents[1]
SKILLS_DIR = MCP_DIR / "skills"
SKILL_DIRS = sorted(p for p in SKILLS_DIR.iterdir() if (p / "SKILL.md").is_file())

# Backticked snake_case identifiers, e.g. `get_status` or `get_transcript(...)`.
_TOOL_REF = re.compile(r"`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\(|`)")

# The `find_semantic_moments(kind)` values a skill may name are parameters, not tools.
MOMENT_KINDS = {"numbers", "cta", "speaker_change"}

# Tools a given skill cannot work without (keyed by folder name). Only
# snake_case names can be required: `_TOOL_REF` never sees a single-word tool
# such as `render`, `export` or `emphasize`.
REQUIRED_TOOLS = {
    # The publish loop of docs/plans/publish-workspace.md: read the record and
    # the brief, write fields, validate, render the package, mark it published.
    "capforge-publish": {
        "get_video",
        "get_brief",
        "set_video_meta",
        "validate_video",
        "get_upload_package",
        "find_video_moments",
        "get_transcript",
        "mark_published",
        # A member of a collection publishes under its effective brief.
        "get_collection",
        # Multi-channel PR 2: every channel's context is read before its post.
        "get_channel",
    },
    # The channel setup interview: read what exists, write only what the user said.
    "capforge-init": {
        "list_channels",
        "get_channel",
        "set_channel",
    },
    # Transcript cleanup: fillers, misheard names, split/merged tokens — in the
    # open session, timing never moved.
    "capforge-cleanup": {
        "get_ui_state",
        "open_video",
        "get_transcript",
        "remove_filler_words",
        "update_words",
        "find_moments",
        "get_video",
        "get_channel",
    },
    # The translation loop of docs/caption-tracks.md plus the localized half.
    "capforge-translate": {
        "get_ui_state",
        "open_video",
        # Step 1 reads the record before offering the metadata half, so the
        # scope question is asked against what actually exists.
        "get_video",
        "create_track",
        "set_track_text",
        "get_track",
        "reflow_track",
        "check_layout",
        "render_frame",
        "set_video_meta",
        "validate_video",
        "get_upload_package",
    },
    # A read-only pre-upload checklist over the record, the package, every
    # channel and language, the transcript and the open captions.
    "capforge-preflight": {
        "get_video",
        "validate_video",
        "get_upload_package",
        "check_chapters",
        "list_channels",
        "get_collection",
        "get_video_transcript",
        "get_ui_state",
        "check_layout",
    },
    # Caption style: preset, tweak, emphasis, look + measure, a folder at a time.
    "capforge-style": {
        "get_ui_state",
        "open_video",
        "list_presets",
        "apply_preset",
        "set_style",
        "render_frame",
        "check_layout",
        "find_moments",
        "find_semantic_moments",
        "list_videos",
    },
    # Clip candidates: hunt, time from the transcript, write `shorts` and the
    # short-form channels' posts. CapForge cuts nothing.
    "capforge-clips": {
        "get_video",
        "get_video_transcript",
        "find_video_moments",
        "set_video_meta",
        "validate_video",
        "list_channels",
        "get_channel",
        "grab_frames",
        "mark_published",
    },
}

# Modules whose tools are decorated inline with `@mcp.tool()`.
_DECORATED_MODULES = ("server.py",)

# Modules that hand `register()` a `TOOLS` tuple instead (server.py is at its
# size ceiling, so the newer groups live beside it and register the same way).
_TOOL_GROUP_MODULES = (
    "channel_tools.py", "collection_tools.py", "library.py", "publish.py", "publish_guide.py", "tracks.py",
)


def _decorated_tools(tree: ast.Module) -> set[str]:
    """Every function carrying an `@mcp.tool()` decorator in one module."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        for dec in node.decorator_list:
            target = dec.func if isinstance(dec, ast.Call) else dec
            if (
                isinstance(target, ast.Attribute)
                and target.attr == "tool"
                and isinstance(target.value, ast.Name)
                and target.value.id == "mcp"
            ):
                names.add(node.name)
    return names


def _tool_group(tree: ast.Module) -> set[str]:
    """The names inside a module's `TOOLS = (…)` tuple — what `register()` adds."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "TOOLS" not in targets or not isinstance(node.value, (ast.Tuple, ast.List)):
            continue
        return {e.id for e in node.value.elts if isinstance(e, ast.Name)}
    return set()


def _parse(module: str) -> ast.Module:
    return ast.parse((MCP_DIR / module).read_text(encoding="utf-8"))


def _registered_tools() -> set[str]:
    """Every tool name the server registers, decorated or via a tool group (a
    source parse, so the test needs neither the `mcp` package nor a running app)."""
    names: set[str] = set()
    for module in _DECORATED_MODULES:
        names |= _decorated_tools(_parse(module))
    for module in _TOOL_GROUP_MODULES:
        names |= _tool_group(_parse(module))
    return names


def _skill_text(skill_dir: Path) -> str:
    return (skill_dir / "SKILL.md").read_text(encoding="utf-8")


def test_every_bundled_folder_is_a_skill() -> None:
    """A folder under skills/ without SKILL.md would be listed by the app as nothing."""
    folders = sorted(p for p in SKILLS_DIR.iterdir() if p.is_dir())
    assert folders == SKILL_DIRS, f"folders without SKILL.md: {set(folders) - set(SKILL_DIRS)}"
    assert SKILL_DIRS, "no bundled skills"


@pytest.mark.parametrize("skill_dir", SKILL_DIRS, ids=lambda p: p.name)
def test_skill_has_frontmatter_name_matching_its_folder(skill_dir: Path) -> None:
    text = _skill_text(skill_dir)
    assert text.startswith("---\n")
    head = text.split("---", 2)[1]
    assert re.search(rf"^name: {re.escape(skill_dir.name)}$", head, re.M), "frontmatter name must equal the folder name"
    desc = re.search(r'^description: "(.+)"$', head, re.M)
    assert desc and len(desc.group(1)) > 40, "description drives the app's skill list — keep it a real sentence"


@pytest.mark.parametrize("skill_dir", SKILL_DIRS, ids=lambda p: p.name)
def test_every_tool_the_skill_names_exists(skill_dir: Path) -> None:
    tools = _registered_tools()
    referenced = set(_TOOL_REF.findall(_skill_text(skill_dir))) - MOMENT_KINDS
    unknown = referenced - tools
    assert not unknown, f"{skill_dir.name}/SKILL.md names tools that do not exist: {sorted(unknown)}"
    required = REQUIRED_TOOLS.get(skill_dir.name, set())
    assert required <= tools, f"server lost: {required - tools}"
    assert required <= referenced, f"{skill_dir.name} no longer uses: {required - referenced}"


def test_moment_kinds_match_the_detector() -> None:
    source = (MCP_DIR / "server.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "find_semantic_moments")
    doc = ast.get_docstring(fn) or ""
    for kind in MOMENT_KINDS:
        assert f'"{kind}"' in doc, f"find_semantic_moments no longer documents kind {kind!r}"


def test_publish_skill_still_knows_the_optional_notes_file() -> None:
    """The package now lives on the record; the text file is the opt-in copy, at
    the day-zero path (docs/plans/publish-workspace.md §Skill port)."""
    text = _skill_text(SKILLS_DIR / "capforge-publish")
    assert 'write_workspace_file("notes/youtube.txt"' in text
    assert 'read_workspace_file("notes/youtube.txt")' in text


def test_publish_example_channel_file_ships() -> None:
    example = SKILLS_DIR / "capforge-publish" / "examples" / "conference-channel.md"
    assert example.is_file()
    assert "Channel notes" in example.read_text(encoding="utf-8")


def test_publish_skill_reads_each_channel_and_keeps_recent_posts_opt_in() -> None:
    """Multi-channel PR 2: a post is written in its channel's voice, from this video."""
    text = " ".join(_skill_text(SKILLS_DIR / "capforge-publish").split())
    assert "`get_channel(" in text
    assert (
        "Never pass include_recent_posts to get_channel unless the user asked you to take "
        "inspiration from older videos" in text
    )
    assert "never write a post for a channel whose context you have not read" in text.lower()
    assert "Settings → Channels" in text and "Settings → Channel;" not in text


def test_init_skill_interviews_and_never_invents() -> None:
    """/capforge-init fills Settings → Channels from the user's answers alone: it
    reads before it writes, confirms before it writes, keeps lists whole and
    never reaches for older posts or deletes on its own."""
    text = " ".join(_skill_text(SKILLS_DIR / "capforge-init").split())
    assert "Settings → Channels" in text
    assert "Never invent" in text
    assert "`list_channels()`" in text and "`get_channel(" in text
    assert "a list is replaced whole" in text.lower()
    assert "confirm before every write" in text.lower()
    assert "`delete_channel` only when the user asks" in text
    assert "include_recent_posts=True)` only when the user says yes" in text
    # The profile is pasted verbatim, so an event's boilerplate belongs on a folder.
    assert "folder" in text.lower() and "publish_guide(\"collections\")" in text
