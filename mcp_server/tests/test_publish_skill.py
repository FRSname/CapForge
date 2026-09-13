"""The shipped `capforge-publish` skill must not drift from the tool surface.

creator-hub-vision §7 #5: "A test must assert every tool named in the guide exists
on the server, or it drifts." The skill is prose the agent follows literally, so a
renamed tool would silently break every publish run.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

MCP_DIR = Path(__file__).resolve().parents[1]
SKILL_DIR = MCP_DIR / "skills" / "capforge-publish"
SKILL = SKILL_DIR / "SKILL.md"

# Backticked snake_case identifiers, e.g. `get_status` or `get_transcript(...)`.
_TOOL_REF = re.compile(r"`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\(|`)")

# The `find_semantic_moments(kind)` values the skill names are parameters, not tools.
MOMENT_KINDS = {"numbers", "cta", "speaker_change"}

# Tools the workflow cannot work without.
REQUIRED_TOOLS = {
    "get_status",
    "get_transcript",
    "find_semantic_moments",
    "find_moments",
    "get_workspace",
    "read_workspace_file",
    "write_workspace_file",
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


def _skill_text() -> str:
    return SKILL.read_text(encoding="utf-8")


def test_skill_has_frontmatter_name_and_description() -> None:
    text = _skill_text()
    assert text.startswith("---\n")
    head = text.split("---", 2)[1]
    assert re.search(r"^name: capforge-publish$", head, re.M)
    desc = re.search(r'^description: "(.+)"$', head, re.M)
    assert desc and len(desc.group(1)) > 40


def test_every_tool_the_skill_names_exists() -> None:
    tools = _registered_tools()
    assert REQUIRED_TOOLS <= tools, f"server lost: {REQUIRED_TOOLS - tools}"
    referenced = set(_TOOL_REF.findall(_skill_text())) - MOMENT_KINDS
    unknown = referenced - tools
    assert not unknown, f"SKILL.md names tools that do not exist: {sorted(unknown)}"
    assert REQUIRED_TOOLS <= referenced, f"SKILL.md no longer uses: {REQUIRED_TOOLS - referenced}"


def test_moment_kinds_match_the_detector() -> None:
    source = (MCP_DIR / "server.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "find_semantic_moments")
    doc = ast.get_docstring(fn) or ""
    for kind in MOMENT_KINDS:
        assert f'"{kind}"' in doc, f"find_semantic_moments no longer documents kind {kind!r}"


def test_skill_saves_into_the_sanctioned_notes_file() -> None:
    """The day-zero convention: one text package at notes/youtube.txt."""
    text = _skill_text()
    assert 'write_workspace_file("notes/youtube.txt"' in text
    assert 'read_workspace_file("notes/youtube.txt")' in text


def test_example_channel_file_ships() -> None:
    example = SKILL_DIR / "examples" / "conference-channel.md"
    assert example.is_file()
    assert "Channel notes" in example.read_text(encoding="utf-8")
