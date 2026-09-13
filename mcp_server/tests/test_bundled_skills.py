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

# Tools a given skill cannot work without (keyed by folder name).
REQUIRED_TOOLS = {
    "capforge-publish": {
        "get_status",
        "get_transcript",
        "find_semantic_moments",
        "find_moments",
        "get_workspace",
        "read_workspace_file",
        "write_workspace_file",
    },
}


def _registered_tools() -> set[str]:
    """Names of every `@mcp.tool()` function across the server modules (source
    parse, so the test needs neither the `mcp` package nor a running app)."""
    names: set[str] = set()
    for module in ("server.py", "tracks.py"):
        tree = ast.parse((MCP_DIR / module).read_text(encoding="utf-8"))
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


def test_publish_skill_saves_into_the_sanctioned_notes_file() -> None:
    """The day-zero convention: one text package at notes/youtube.txt."""
    text = _skill_text(SKILLS_DIR / "capforge-publish")
    assert 'write_workspace_file("notes/youtube.txt"' in text
    assert 'read_workspace_file("notes/youtube.txt")' in text


def test_publish_example_channel_file_ships() -> None:
    example = SKILLS_DIR / "capforge-publish" / "examples" / "conference-channel.md"
    assert example.is_file()
    assert "Channel notes" in example.read_text(encoding="utf-8")
