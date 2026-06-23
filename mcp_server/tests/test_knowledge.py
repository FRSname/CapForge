"""Unit tests for the vendored HyperFrames creative library."""

from __future__ import annotations

from pathlib import Path

import pytest

from mcp_server import knowledge


def test_every_manifest_topic_has_a_shipped_file() -> None:
    """The manifest is the allowlist — each id must resolve to a real vendored file."""
    for tid, (filename, desc) in knowledge.TOPICS.items():
        path = knowledge._KNOWLEDGE_DIR / filename
        assert path.is_file(), f"missing vendored file for topic '{tid}': {filename}"
        assert desc.strip(), f"topic '{tid}' has an empty description"
        assert path.read_text(encoding="utf-8").strip(), f"topic '{tid}' file is empty"


def test_index_exists_and_lists_known_topics() -> None:
    index = knowledge.read_index()
    assert "Operating model" in index
    # Every manifest id should be referenced in the entry's topic table.
    for tid in knowledge.TOPICS:
        assert f"`{tid}`" in index, f"topic '{tid}' missing from INDEX.md"


def test_index_documents_coauthor_mode() -> None:
    """The guide must authorize co-author mode and NOT carry the old blanket
    prohibition that misled the agent into scaffolding a standalone project."""
    index = knowledge.read_index()
    assert "Co-author mode" in index
    assert "enter_coauthor_mode" in index
    assert "You do NOT scaffold a HyperFrames project" not in index


def test_read_topic_returns_content_for_a_known_id() -> None:
    body = knowledge.read_topic("captions")
    assert len(body) > 100


def test_read_topic_rejects_unknown_id() -> None:
    with pytest.raises(knowledge.TopicNotFound):
        knowledge.read_topic("does-not-exist")


def test_read_topic_blocks_path_traversal() -> None:
    """A traversal-style argument isn't in the manifest, so it must be refused."""
    with pytest.raises(knowledge.TopicNotFound):
        knowledge.read_topic("../server")


def test_list_topics_matches_manifest() -> None:
    listed = {t["id"] for t in knowledge.list_topics()}
    assert listed == set(knowledge.TOPICS)


def test_no_orphan_files_in_knowledge_dir() -> None:
    """Every .md (except INDEX) should be reachable through the manifest."""
    mapped = {fn for fn, _ in knowledge.TOPICS.values()} | {"INDEX.md"}
    on_disk = {p.name for p in Path(knowledge._KNOWLEDGE_DIR).glob("*.md")}
    assert on_disk == mapped, f"orphan/missing files: {on_disk ^ mapped}"
