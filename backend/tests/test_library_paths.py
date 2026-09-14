"""Library paths: CAPFORGE_HOME, the record layout, the asset allowlist."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.exporters.hyperframes_project import hyperframes_workspace
from backend.library import fs, paths


def test_capforge_home_honours_env(monkeypatch, tmp_path):
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path / "home"))
    assert paths.capforge_home() == tmp_path / "home"
    assert paths.library_root() == tmp_path / "home" / "library"


def test_capforge_home_defaults_to_dot_capforge(monkeypatch):
    monkeypatch.delenv("CAPFORGE_HOME", raising=False)
    assert paths.capforge_home() == Path.home() / ".capforge"


def test_record_dir_scratch_hides_under_dot_scratch(tmp_path):
    assert paths.record_dir("abc", root=tmp_path) == tmp_path / "abc"
    assert paths.record_dir("abc", scratch=True, root=tmp_path) == tmp_path / ".scratch" / "abc"


@pytest.mark.parametrize("name", [
    "poster.jpg", "peaks.bin", "thumbnails/0123abcd.jpg",
    "thumbnails/" + "a" * 64 + ".jpg",
])
def test_asset_allowlist_accepts_fixed_names(tmp_path, name):
    folder = tmp_path / "rec"
    (folder / "thumbnails").mkdir(parents=True)
    (folder / name).write_bytes(b"x")
    assert paths.resolve_asset(folder, name) == (folder / name).resolve()


@pytest.mark.parametrize("name", [
    "record.json", "../poster.jpg", "thumbnails/../record.json", "/etc/passwd",
    "poster.JPG", "thumbnails/zz.jpg", "thumbnails/abc.jpg", "thumbnails/0123abcd.png",
    "poster.jpg\n", "",
])
def test_asset_allowlist_rejects_everything_else(tmp_path, name):
    folder = tmp_path / "rec"
    folder.mkdir()
    (folder / "record.json").write_text("{}")
    (folder / "poster.jpg").write_bytes(b"x")
    assert paths.resolve_asset(folder, name) is None


def test_asset_missing_file_is_none(tmp_path):
    folder = tmp_path / "rec"
    folder.mkdir()
    assert paths.resolve_asset(folder, "poster.jpg") is None


@pytest.mark.skipif(os.name == "nt", reason="symlink creation needs privileges on Windows")
def test_asset_symlink_escaping_record_dir_is_rejected(tmp_path):
    folder = tmp_path / "rec"
    folder.mkdir()
    secret = tmp_path / "secret.jpg"
    secret.write_bytes(b"s")
    (folder / "poster.jpg").symlink_to(secret)
    assert paths.resolve_asset(folder, "poster.jpg") is None


def test_write_json_atomic_leaves_no_tmp_and_replaces(tmp_path):
    target = tmp_path / "deep" / "record.json"
    fs.write_json_atomic(target, {"rev": 1})
    fs.write_json_atomic(target, {"rev": 2})
    assert fs.read_json(target) == {"rev": 2}
    assert list(target.parent.iterdir()) == [target]


def test_write_json_atomic_failure_keeps_previous(tmp_path):
    target = tmp_path / "record.json"
    fs.write_json_atomic(target, {"rev": 1})
    with pytest.raises(TypeError):
        fs.write_json_atomic(target, {"bad": object()})
    assert fs.read_json(target) == {"rev": 1}
    assert not target.with_name("record.json.tmp").exists()


def test_source_tag_matches_studio_workspace_folder(tmp_path):
    media = tmp_path / "talk.mp4"
    media.write_bytes(b"0")
    assert Path(hyperframes_workspace(str(media))).name == fs.source_tag(media)


def test_fingerprint_changes_with_content_and_size(tmp_path):
    media = tmp_path / "a.mp4"
    media.write_bytes(b"a" * 10)
    f1 = fs.fingerprint(media)
    media.write_bytes(b"b" * 10)
    f2 = fs.fingerprint(media)
    media.write_bytes(b"a" * 3 * fs.FINGERPRINT_EDGE_BYTES)
    f3 = fs.fingerprint(media)
    assert len({f1, f2, f3}) == 3


def test_fingerprint_survives_a_move(tmp_path):
    media = tmp_path / "a.mp4"
    media.write_bytes(b"abc" * 1000)
    before = fs.fingerprint(media)
    moved = tmp_path / "sub" / "b.mp4"
    moved.parent.mkdir()
    os.rename(media, moved)
    assert fs.fingerprint(moved) == before


def test_fingerprint_missing_file_raises(tmp_path):
    with pytest.raises(OSError):
        fs.fingerprint(tmp_path / "nope.mp4")
