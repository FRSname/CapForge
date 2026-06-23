"""Co-author mode: CapForge seeds a starter project the agent then owns, and
only ever refreshes its companion files — never the agent's index.html.

The native/custom caption sub-composition path needs Node (install/inject), so
it's exercised by the caption tests; here we pin the classic path + the core
durability guarantee (agent edits to index.html survive a sync)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.exporters.hyperframes_project import (
    coauthor_project_dir,
    seed_coauthor_project,
    sync_companions,
)
from backend.models.schemas import VideoRenderConfig


def _seed(result, tmp_path: Path) -> Path:
    project = seed_coauthor_project(result, VideoRenderConfig(), str(tmp_path))
    return Path(project)


def test_seed_creates_a_working_starter_project(transcription_result, tmp_path):
    project = _seed(transcription_result, tmp_path)
    assert project == coauthor_project_dir(transcription_result, str(tmp_path))
    assert (project / "index.html").exists()
    assert (project / "transcript.json").exists()
    # The starter renders real captions so the agent builds on a working base.
    assert 'class="cgroup"' in (project / "index.html").read_text()


def test_sync_preserves_the_agent_authored_index_html(transcription_result, tmp_path):
    project = _seed(transcription_result, tmp_path)
    # Agent takes ownership of index.html and authors something of their own.
    agent_html = "<!doctype html><html><!-- agent owns this now --></html>"
    (project / "index.html").write_text(agent_html, encoding="utf-8")

    sync_companions(transcription_result, VideoRenderConfig(), str(project))

    assert (project / "index.html").read_text() == agent_html


def test_sync_refreshes_transcript_without_touching_index(transcription_result, tmp_path):
    project = _seed(transcription_result, tmp_path)
    (project / "index.html").write_text("AGENT", encoding="utf-8")
    (project / "transcript.json").write_text("[]", encoding="utf-8")  # stale

    result = sync_companions(transcription_result, VideoRenderConfig(), str(project))

    words = json.loads((project / "transcript.json").read_text())
    assert len(words) == 6  # fixture has 6 words — transcript regenerated
    assert result["transcript"] == "transcript.json"
    assert (project / "index.html").read_text() == "AGENT"


def test_sync_classic_captions_stay_in_index(transcription_result, tmp_path):
    """Classic captions live inline in the agent's index.html, so there's no
    separate captions sub-composition to regenerate (captions == None)."""
    project = _seed(transcription_result, tmp_path)
    result = sync_companions(transcription_result, VideoRenderConfig(), str(project))
    assert result["captions"] is None


def test_sync_on_missing_project_raises(transcription_result, tmp_path):
    with pytest.raises(FileNotFoundError):
        sync_companions(
            transcription_result, VideoRenderConfig(), str(tmp_path / "nope-hyperframes")
        )
