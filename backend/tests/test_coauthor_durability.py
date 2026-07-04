"""Phase 3 — co-author durability across backend crashes/restarts.

Guarantees under test:
  1. The co-author marker round-trips and is kept as history on exit (not deleted).
  2. ``coauthor_active()`` rehydrates from the marker alone when the in-memory
     global was reset by a crash, and self-heals the global.
  3. ``export_hyperframes_project`` REFUSES to scaffold over an active co-author
     project (byte-identical index.html) unless ``force_scaffold=True``.
  4. ``sync_companions`` behaviour is unchanged (still preserves index.html).
  5. Simulated crash: fresh app process (globals reset) still reports co-author
     mode and never re-scaffolds over the agent's index.html.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from backend.exporters.hyperframes_project import (
    CoauthorClobberError,
    COAUTHOR_MARKER,
    coauthor_project_dir,
    export_hyperframes_project,
    read_coauthor_marker,
    seed_coauthor_project,
    sync_companions,
    write_coauthor_marker,
)
from backend.models.schemas import VideoRenderConfig


# ── 1. marker read/write round-trip ──────────────────────────────────────────

def test_marker_missing_reads_as_none(tmp_path):
    assert read_coauthor_marker(tmp_path) is None


def test_marker_write_then_read_round_trip(tmp_path):
    write_coauthor_marker(tmp_path, True, source="/media/clip.mp4")
    marker = read_coauthor_marker(tmp_path)
    assert marker is not None
    assert marker["active"] is True
    assert marker["source"] == "/media/clip.mp4"
    assert "entered_at" in marker and marker["entered_at"]
    assert "updated_at" in marker and marker["updated_at"]


def test_marker_exit_keeps_file_as_history(tmp_path):
    write_coauthor_marker(tmp_path, True, source="/media/clip.mp4")
    entered = read_coauthor_marker(tmp_path)["entered_at"]
    write_coauthor_marker(tmp_path, False)  # exit — no source passed
    assert (tmp_path / COAUTHOR_MARKER).exists()  # NOT deleted
    marker = read_coauthor_marker(tmp_path)
    assert marker["active"] is False
    assert marker["source"] == "/media/clip.mp4"  # provenance carried over
    # entered_at reflects the ENTER, not the exit; updated_at is stamped on exit.
    assert marker["entered_at"] == entered
    assert "updated_at" in marker and marker["updated_at"]
    # No tmp file left behind by the atomic write.
    assert not (tmp_path / (COAUTHOR_MARKER + ".tmp")).exists()


def test_marker_updated_at_always_set_entered_at_only_on_active(tmp_path):
    # Exit written with no prior marker: updated_at set, entered_at omitted
    # (there is no enter time to report).
    write_coauthor_marker(tmp_path, False, source="/media/clip.mp4")
    marker = read_coauthor_marker(tmp_path)
    assert marker["active"] is False
    assert marker["updated_at"]
    assert "entered_at" not in marker


def test_corrupt_marker_reads_as_none(tmp_path):
    (tmp_path / COAUTHOR_MARKER).write_text("{not json", encoding="utf-8")
    assert read_coauthor_marker(tmp_path) is None


# ── 2. coauthor_active() rehydration + self-heal ─────────────────────────────

@pytest.fixture
def main_module():
    """Import backend.main with heavy ML deps stubbed (dev venv lacks whisperx).

    Only stubs modules that are absent, and removes the stubs it inserted on
    teardown so it does not pollute sys.modules for tests that import the real
    modules (e.g. test_realign.py).
    """
    inserted = []
    for name in ("whisperx", "torch", "torchaudio"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
            inserted.append(name)
    import backend.main as m

    yield m

    for name in inserted:
        sys.modules.pop(name, None)


def test_coauthor_active_true_from_marker_alone_and_self_heals(main_module, tmp_path):
    m = main_module
    m.current_coauthor = False  # simulate a crash wiping the in-memory flag
    write_coauthor_marker(tmp_path, True, source="/media/clip.mp4")

    assert m.coauthor_active(tmp_path) is True
    assert m.current_coauthor is True  # global self-healed for later fast paths


def test_coauthor_active_false_without_marker(main_module, tmp_path):
    m = main_module
    m.current_coauthor = False
    assert m.coauthor_active(tmp_path) is False
    assert m.current_coauthor is False


def test_coauthor_active_false_when_marker_inactive(main_module, tmp_path):
    m = main_module
    m.current_coauthor = False
    write_coauthor_marker(tmp_path, False, source="/media/clip.mp4")
    assert m.coauthor_active(tmp_path) is False


# ── 3. clobber guard on export ───────────────────────────────────────────────

def test_export_refuses_over_active_marker_without_force(transcription_result, tmp_path):
    project = Path(seed_coauthor_project(transcription_result, VideoRenderConfig(), str(tmp_path)))
    agent_html = "<!doctype html><html><!-- agent authored --></html>"
    (project / "index.html").write_text(agent_html, encoding="utf-8")
    write_coauthor_marker(project, True, source=transcription_result.audio_path)

    with pytest.raises(CoauthorClobberError):
        export_hyperframes_project(transcription_result, VideoRenderConfig(), str(tmp_path))

    # index.html left byte-identical — nothing was clobbered.
    assert (project / "index.html").read_text() == agent_html


def test_export_proceeds_with_force_scaffold(transcription_result, tmp_path):
    project = Path(seed_coauthor_project(transcription_result, VideoRenderConfig(), str(tmp_path)))
    (project / "index.html").write_text("AGENT", encoding="utf-8")
    write_coauthor_marker(project, True, source=transcription_result.audio_path)

    # The one legitimate caller (initial seed) forces through and re-scaffolds.
    export_hyperframes_project(
        transcription_result, VideoRenderConfig(), str(tmp_path), force_scaffold=True
    )
    assert 'class="cgroup"' in (project / "index.html").read_text()  # real scaffold


def test_export_ok_when_no_active_marker(transcription_result, tmp_path):
    project = Path(seed_coauthor_project(transcription_result, VideoRenderConfig(), str(tmp_path)))
    (project / "index.html").write_text("STALE", encoding="utf-8")
    write_coauthor_marker(project, False, source=transcription_result.audio_path)
    # Inactive marker → no guard, normal re-scaffold allowed.
    export_hyperframes_project(transcription_result, VideoRenderConfig(), str(tmp_path))
    assert 'class="cgroup"' in (project / "index.html").read_text()


def test_export_scaffolds_over_active_marker_when_no_index_html(
    transcription_result, tmp_path
):
    """FIX 2 crash-ordering guarantee: _coauthor_enter writes the durable marker
    BEFORE seeding index.html. If the process dies in that window, a restart finds
    an active marker but NO index.html — the export path (via _coauthor_project's
    _scaffold) must scaffold cleanly, WITHOUT raising CoauthorClobberError, because
    there is nothing agent-authored to clobber yet."""
    project = coauthor_project_dir(transcription_result, str(tmp_path))
    project.mkdir(parents=True, exist_ok=True)
    # Marker active, but no index.html was ever written (crash right after marker).
    write_coauthor_marker(project, True, source=transcription_result.audio_path)
    assert not (project / "index.html").exists()

    # No force needed: the guard only fires when an index.html exists.
    export_hyperframes_project(transcription_result, VideoRenderConfig(), str(tmp_path))
    assert 'class="cgroup"' in (project / "index.html").read_text()
    # Marker still active — the crash-recovery scaffold does not flip mode off.
    assert read_coauthor_marker(project)["active"] is True


# ── 4. sync_companions unchanged ─────────────────────────────────────────────

def test_sync_companions_still_preserves_index_with_marker_present(
    transcription_result, tmp_path
):
    project = Path(seed_coauthor_project(transcription_result, VideoRenderConfig(), str(tmp_path)))
    write_coauthor_marker(project, True, source=transcription_result.audio_path)
    agent_html = "<!doctype html><html><!-- owned --></html>"
    (project / "index.html").write_text(agent_html, encoding="utf-8")

    sync_companions(transcription_result, VideoRenderConfig(), str(project))

    assert (project / "index.html").read_text() == agent_html


# ── 5. simulated crash: fresh app, globals reset, endpoint rehydrates ────────

def test_simulated_crash_endpoint_rehydrates_and_never_clobbers(
    main_module, transcription_result, tmp_path, monkeypatch
):
    from fastapi.testclient import TestClient

    m = main_module
    # Pin the workspace under a temp CAPFORGE_HOME so we control the project dir.
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))
    workspace = m.hyperframes_workspace(transcription_result.audio_path)
    project_dir = coauthor_project_dir(transcription_result, workspace)
    project_dir.mkdir(parents=True, exist_ok=True)

    # Agent had authored index.html and the durable marker says co-author is active.
    agent_html = "<!doctype html><html><!-- agent survived the crash --></html>"
    (project_dir / "index.html").write_text(agent_html, encoding="utf-8")
    write_coauthor_marker(project_dir, True, source=transcription_result.audio_path)

    # Simulate the crash/restart: in-memory globals reset, but a result is loaded.
    m.current_coauthor = False
    m.current_result = transcription_result

    client = TestClient(m.app)
    resp = client.get("/api/coauthor")  # ungated UI mirror
    assert resp.status_code == 200
    assert resp.json()["coauthor"] is True  # rehydrated from the marker
    assert m.current_coauthor is True  # global healed

    # The agent's index.html is untouched by the rehydration path.
    assert (project_dir / "index.html").read_text() == agent_html


# ── 6. preview transitions: enter → sync path, exit → re-scaffold ────────────

def _preview_setup(m, transcription_result, tmp_path, monkeypatch):
    """Shared wiring for the preview-frame transition tests.

    Returns ``(client, project_dir, calls)`` where ``calls`` records which of the
    two composition paths the preview took. The token gate is overridden and the
    two heavy composition calls (sync vs scaffold) plus the snapshot are stubbed,
    so the test isolates ONLY the sync-vs-rescaffold DECISION."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))
    workspace = m.hyperframes_workspace(transcription_result.audio_path)
    project_dir = coauthor_project_dir(transcription_result, workspace)
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "index.html").write_text("<!-- agent owns this -->", encoding="utf-8")

    monkeypatch.setattr(m, "current_result", transcription_result)
    monkeypatch.setattr(
        m, "current_ui_state", {"render": {"config": VideoRenderConfig().model_dump()}}
    )

    calls: list[str] = []
    monkeypatch.setattr(m, "sync_companions", lambda *a, **k: calls.append("sync"))

    def _scaffold(*_a, **_k):
        calls.append("scaffold")
        return str(project_dir)

    monkeypatch.setattr(m, "ensure_hyperframes_project", _scaffold)
    monkeypatch.setattr(m, "snapshot_hyperframes_project", lambda *a, **k: b"PNG")

    m.app.dependency_overrides[m.require_agent_token] = lambda: None
    client = TestClient(m.app)
    return client, project_dir, calls


def test_preview_after_enter_uses_sync_path_not_rescaffold(
    main_module, transcription_result, tmp_path, monkeypatch
):
    """In co-author mode (active marker + agent index.html) a preview must REFRESH
    companions only — never regenerate the composition the agent authored."""
    m = main_module
    try:
        client, project_dir, calls = _preview_setup(
            m, transcription_result, tmp_path, monkeypatch
        )
        write_coauthor_marker(project_dir, True, source=transcription_result.audio_path)
        m.current_coauthor = False  # force the durable-marker consult

        resp = client.post("/api/agent/preview-hyperframes-frame", json={"t": 0.5})

        assert resp.status_code == 200
        assert calls == ["sync"]  # synced, did NOT re-scaffold
    finally:
        m.app.dependency_overrides.clear()


def test_preview_after_exit_rescaffolds_not_sync(
    main_module, transcription_result, tmp_path, monkeypatch
):
    """Once co-author mode is exited (marker inactive) a preview re-scaffolds the
    Studio project — even though a stale index.html is still on disk — so the
    preview reflects live UI config again instead of the abandoned authored file."""
    m = main_module
    try:
        client, project_dir, calls = _preview_setup(
            m, transcription_result, tmp_path, monkeypatch
        )
        write_coauthor_marker(project_dir, False, source=transcription_result.audio_path)
        m.current_coauthor = False

        resp = client.post("/api/agent/preview-hyperframes-frame", json={"t": 0.5})

        assert resp.status_code == 200
        assert calls == ["scaffold"]  # re-scaffolded, did NOT sync the stale index
    finally:
        m.app.dependency_overrides.clear()
