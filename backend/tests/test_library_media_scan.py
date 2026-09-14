"""``media_scan.scan_media`` — the one walk folder import and the watcher share.

Plan: docs/plans/library-folder-import.md (Backend → media_scan.py)."""

from __future__ import annotations

import dataclasses
import json
import os
from pathlib import Path

import pytest

from backend.library import media_scan
from backend.library.media_scan import MEDIA_EXTENSIONS, ScanResult, scan_media

FIXTURE = Path(__file__).parent / "fixtures" / "media_extensions.json"


def touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(f"bytes:{path.name}".encode())
    return path


def names(result: ScanResult) -> list[str]:
    return [p.name for p in result.paths]


def test_extension_set_equals_the_shared_fixture() -> None:
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))["extensions"]
    assert MEDIA_EXTENSIONS == frozenset(expected)
    assert all(ext == ext.lower() and not ext.startswith(".") for ext in MEDIA_EXTENSIONS)


def test_only_media_files_in_sorted_order_with_absolute_paths(tmp_path: Path) -> None:
    for name in ("b.mp4", "a.wav", "notes.txt", "c.mov", "poster.jpg"):
        touch(tmp_path / name)
    result = scan_media(tmp_path)
    assert names(result) == ["a.wav", "b.mp4", "c.mov"]
    assert all(p.is_absolute() for p in result.paths)
    assert result.truncated is False


def test_suffix_match_is_case_insensitive(tmp_path: Path) -> None:
    touch(tmp_path / "LOUD.MP4")
    touch(tmp_path / "Mixed.WaV")
    assert names(scan_media(tmp_path)) == ["LOUD.MP4", "Mixed.WaV"]


def test_hidden_files_and_hidden_directories_are_skipped(tmp_path: Path) -> None:
    touch(tmp_path / ".hidden.mp4")
    touch(tmp_path / ".cache" / "inside.mp4")
    touch(tmp_path / "visible.mp4")
    assert names(scan_media(tmp_path)) == ["visible.mp4"]


def test_recurses_depth_first_sorted_per_directory(tmp_path: Path) -> None:
    touch(tmp_path / "b" / "two.mp4")
    touch(tmp_path / "a" / "one.mp4")
    touch(tmp_path / "top.mp4")
    touch(tmp_path / "a" / "deeper" / "zero.mp4")
    assert names(scan_media(tmp_path)) == ["zero.mp4", "one.mp4", "two.mp4", "top.mp4"]


def test_non_recursive_only_reads_the_top_level(tmp_path: Path) -> None:
    touch(tmp_path / "sub" / "nested.mp4")
    touch(tmp_path / "top.mp4")
    result = scan_media(tmp_path, recursive=False)
    assert names(result) == ["top.mp4"]
    assert result.truncated is False


def test_a_symlinked_directory_is_not_followed(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    touch(outside / "elsewhere.mp4")
    folder = tmp_path / "folder"
    touch(folder / "real.mp4")
    os.symlink(outside, folder / "link", target_is_directory=True)
    assert names(scan_media(folder)) == ["real.mp4"]


def test_a_symlinked_file_is_not_a_regular_file(tmp_path: Path) -> None:
    outside = touch(tmp_path / "outside.mp4")
    folder = tmp_path / "folder"
    folder.mkdir()
    os.symlink(outside, folder / "alias.mp4")
    assert names(scan_media(folder)) == []


def test_depth_cap_sets_truncated(tmp_path: Path) -> None:
    touch(tmp_path / "d1" / "d2" / "ok.mp4")
    touch(tmp_path / "d1" / "d2" / "d3" / "too-deep.mp4")
    result = scan_media(tmp_path, max_depth=2)
    assert names(result) == ["ok.mp4"]
    assert result.truncated is True


def test_depth_cap_default_reaches_four_levels_below(tmp_path: Path) -> None:
    deep = tmp_path.joinpath(*[f"d{i}" for i in range(1, media_scan.SCAN_MAX_DEPTH + 1)])
    touch(deep / "deepest.mp4")
    result = scan_media(tmp_path)
    assert names(result) == ["deepest.mp4"]
    assert result.truncated is False


def test_file_cap_sets_truncated(tmp_path: Path) -> None:
    for i in range(5):
        touch(tmp_path / f"clip{i}.mp4")
    result = scan_media(tmp_path, max_files=3)
    assert names(result) == ["clip0.mp4", "clip1.mp4", "clip2.mp4"]
    assert result.truncated is True


def test_exactly_the_cap_is_not_truncated(tmp_path: Path) -> None:
    for i in range(3):
        touch(tmp_path / f"clip{i}.mp4")
    assert scan_media(tmp_path, max_files=3).truncated is False


def test_a_non_directory_raises(tmp_path: Path) -> None:
    file = touch(tmp_path / "clip.mp4")
    with pytest.raises(NotADirectoryError):
        scan_media(file)
    with pytest.raises(NotADirectoryError):
        scan_media(tmp_path / "missing")


def test_scan_result_is_frozen(tmp_path: Path) -> None:
    result = scan_media(tmp_path)
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.truncated = True  # type: ignore[misc]
