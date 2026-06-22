"""Tests for HyperFrames output-directory resolution.

The bug: a relative ``output_dir`` (the schema default ``"output"``) resolved
against the backend CWD, hiding renders inside the packaged app. The resolver
must fall back to the source file's folder unless given an absolute path.
"""

from pathlib import Path

from backend.exporters.hyperframes_project import resolve_output_dir


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
