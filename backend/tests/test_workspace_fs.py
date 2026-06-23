"""Trust-boundary tests for the co-author filesystem sandbox.

These guard a real attack surface (an agent writing/reading arbitrary disk), so
the traversal/symlink/extension cases are the point — keep them strict."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend import workspace_fs as wfs


@pytest.fixture
def root(tmp_path: Path) -> Path:
    (tmp_path / "compositions").mkdir()
    return tmp_path


# -- resolve_in_workspace (the sandbox) -----------------------------------

@pytest.mark.parametrize("bad", ["", "   ", "/etc/passwd", "../../etc/passwd",
                                  "compositions/../../escape", "a/../../b"])
def test_resolve_rejects_escapes(root, bad):
    with pytest.raises(wfs.WorkspaceError):
        wfs.resolve_in_workspace(root, bad)


def test_resolve_accepts_nested_relative(root):
    p = wfs.resolve_in_workspace(root, "compositions/effects/code.html")
    assert root.resolve() in p.parents


def test_resolve_blocks_symlink_escape(root, tmp_path):
    secret = tmp_path.parent / "outside"
    secret.mkdir(exist_ok=True)
    link = root / "compositions" / "link"
    try:
        os.symlink(secret, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable on this platform")
    with pytest.raises(wfs.WorkspaceError):
        wfs.resolve_in_workspace(root, "compositions/link/stolen.html")


# -- write_file -----------------------------------------------------------

def test_write_creates_file_and_parents(root):
    res = wfs.write_file(root, "compositions/new/code.html", "<div>hi</div>")
    assert (root / "compositions/new/code.html").read_text() == "<div>hi</div>"
    assert res["path"] == "compositions/new/code.html"


def test_write_rejects_disallowed_extension(root):
    with pytest.raises(wfs.WorkspaceError):
        wfs.write_file(root, "evil.sh", "#!/bin/sh\nrm -rf /")


def test_write_rejects_oversized(root, monkeypatch):
    monkeypatch.setattr(wfs, "MAX_FILE_BYTES", 8)
    with pytest.raises(wfs.WorkspaceError):
        wfs.write_file(root, "big.txt", "way too many bytes here")


# -- read_file ------------------------------------------------------------

def test_read_round_trips_text(root):
    wfs.write_file(root, "a.css", "body{}")
    assert wfs.read_file(root, "a.css") == "body{}"


def test_read_missing_raises(root):
    with pytest.raises(wfs.WorkspaceError):
        wfs.read_file(root, "compositions/ghost.html")


def test_read_binary_raises(root):
    (root / "blob.png").write_bytes(b"\x89PNG\x00\xff\xfe")
    with pytest.raises(wfs.WorkspaceError):
        wfs.read_file(root, "blob.png")


# -- import_path ----------------------------------------------------------

def test_import_folder_preserves_layout_and_filters(root, tmp_path):
    block = tmp_path.parent / "speaker-block"
    (block / "assets").mkdir(parents=True, exist_ok=True)
    (block / "block.html").write_text("<div>block</div>")
    (block / "README.md").write_text("instructions")
    (block / "assets" / "logo.svg").write_text("<svg/>")
    (block / "secret.sh").write_text("nope")  # disallowed → skipped

    res = wfs.import_path(root, str(block))

    assert "compositions/speaker-block/block.html" in res["imported"]
    assert "compositions/speaker-block/assets/logo.svg" in res["imported"]
    assert "compositions/speaker-block/README.md" in res["imported"]
    assert any("secret.sh" in s for s in res["skipped"])
    assert (root / "compositions/speaker-block/block.html").exists()


def test_import_single_file(root, tmp_path):
    src = tmp_path.parent / "lower-third.html"
    src.write_text("<div/>")
    res = wfs.import_path(root, str(src))
    assert res["imported"] == ["compositions/lower-third.html"]


def test_import_missing_source_raises(root):
    with pytest.raises(wfs.WorkspaceError):
        wfs.import_path(root, "/does/not/exist")


def test_import_rejects_sensitive_source(root, tmp_path, monkeypatch):
    """Importing from CapForge's own data home (token + discovery file) is refused."""
    fake_home = tmp_path.parent / "capforge-home"
    (fake_home).mkdir(exist_ok=True)
    (fake_home / "backend.json").write_text('{"token":"secret"}')
    monkeypatch.setenv("CAPFORGE_HOME", str(fake_home))
    with pytest.raises(wfs.WorkspaceError):
        wfs.import_path(root, str(fake_home))
    with pytest.raises(wfs.WorkspaceError):
        wfs.import_path(root, str(fake_home / "backend.json"))


def test_import_skips_symlinks_and_hidden(root, tmp_path):
    block = tmp_path.parent / "blk"
    (block / "assets").mkdir(parents=True, exist_ok=True)
    (block / "ok.html").write_text("<div/>")
    (block / ".env").write_text("SECRET=1")  # hidden → skipped
    secret_dir = tmp_path.parent / "outside-secret"
    secret_dir.mkdir(exist_ok=True)
    (secret_dir / "id_rsa.txt").write_text("PRIVATE KEY")
    try:
        os.symlink(secret_dir, block / "assets" / "leak")  # symlink → not followed
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable")
    res = wfs.import_path(root, str(block))
    assert "compositions/blk/ok.html" in res["imported"]
    assert not any("id_rsa" in p for p in res["imported"])
    assert not any(".env" in p for p in res["imported"])


def test_import_rejects_root_dest_subdir(root, tmp_path):
    src = tmp_path.parent / "x.html"
    src.write_text("<i/>")
    with pytest.raises(wfs.WorkspaceError):
        wfs.import_path(root, str(src), dest_subdir=".")


def test_list_tree_skips_symlinks(root, tmp_path):
    wfs.write_file(root, "index.html", "x")
    outside = tmp_path.parent / "out-tree"
    outside.mkdir(exist_ok=True)
    (outside / "secret.txt").write_text("s")
    try:
        os.symlink(outside, root / "link")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable")
    paths = {e["path"] for e in wfs.list_tree(root)}
    assert "index.html" in paths
    assert not any("secret.txt" in p for p in paths)


# -- list_tree ------------------------------------------------------------

def test_list_tree_skips_noise(root):
    wfs.write_file(root, "index.html", "x")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "junk.js").write_text("junk")
    paths = {e["path"] for e in wfs.list_tree(root)}
    assert "index.html" in paths
    assert not any("node_modules" in p for p in paths)
