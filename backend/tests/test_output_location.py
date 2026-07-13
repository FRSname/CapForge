"""Tests for HyperFrames output-directory resolution.

The bug: a relative ``output_dir`` (the schema default ``"output"``) resolved
against the backend CWD, hiding renders inside the packaged app. The resolver
must fall back to the source file's folder unless given an absolute path.
"""

from pathlib import Path

from backend.exporters.hyperframes_project import hyperframes_workspace, resolve_output_dir


def _make_source(tmp_path: Path) -> Path:
    src = tmp_path / "clips" / "interview.mp4"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_bytes(b"\x00")
    return src


def test_empty_output_dir_falls_back_to_source_folder(tmp_path):
    src = _make_source(tmp_path)
    assert resolve_output_dir("", str(src)) == str(src.resolve().parent)


def test_none_output_dir_falls_back_to_source_folder(tmp_path):
    src = _make_source(tmp_path)
    assert resolve_output_dir(None, str(src)) == str(src.resolve().parent)


def test_relative_default_output_falls_back_to_source_folder(tmp_path):
    # "output" is the schema default — must NOT resolve against the CWD.
    src = _make_source(tmp_path)
    assert resolve_output_dir("output", str(src)) == str(src.resolve().parent)


def test_absolute_output_dir_is_honoured(tmp_path):
    src = _make_source(tmp_path)
    chosen = tmp_path / "elsewhere"
    chosen.mkdir()
    assert resolve_output_dir(str(chosen), str(src)) == str(chosen)


def test_traversal_output_dir_falls_back_to_source_folder(tmp_path):
    # A relative `..`-traversal string (e.g. from an untrusted client) is not
    # absolute, so it's treated the same as an empty/relative value — never
    # honoured literally. Part of the Phase 1 export/render-endpoint sandbox.
    src = _make_source(tmp_path)
    assert resolve_output_dir("../../../tmp/evil", str(src)) == str(src.resolve().parent)


# --- hyperframes_workspace: the canonical shared project parent dir ------------


def test_workspace_is_under_capforge_home(tmp_path, monkeypatch):
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))
    src = _make_source(tmp_path)
    ws = hyperframes_workspace(str(src))
    assert ws.startswith(str(tmp_path / "studio"))


def test_workspace_is_deterministic_for_same_source(tmp_path, monkeypatch):
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))
    src = _make_source(tmp_path)
    assert hyperframes_workspace(str(src)) == hyperframes_workspace(str(src))


def test_workspace_differs_for_same_stem_in_different_folders(tmp_path, monkeypatch):
    # Two "interview.mp4" files in different dirs must NOT collide onto one
    # workspace — that's what would make one Studio show another's content.
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))
    a = tmp_path / "a" / "interview.mp4"
    b = tmp_path / "b" / "interview.mp4"
    for p in (a, b):
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"\x00")
    assert hyperframes_workspace(str(a)) != hyperframes_workspace(str(b))
