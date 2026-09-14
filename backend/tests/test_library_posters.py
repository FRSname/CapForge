"""Posters at import (v3.0 #6): the grab, its atomicity, the derived flag,
the create route's background task and the startup backfill.

ffmpeg is never run — ``posters._run`` is replaced by a writer that behaves
like it (writes the output path it was given, or fails)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend.library import posters
from backend.library.store import LibraryStore

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    AGENT_HEADER,
    AGENT_TOKEN,
    client,
    home,
    main_module,
)

FAKE_FFMPEG = "/fake/ffmpeg"
JPEG_BYTES = b"\xff\xd8\xff\xe0" * 4


def fake_ffmpeg(monkeypatch, *, fail_first: int = 0, ok: bool = True) -> list[list[str]]:
    """Replace the subprocess call: succeed (writing a JPEG) or fail, and log argv."""
    calls: list[list[str]] = []

    def run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
        calls.append(cmd)
        out = Path(cmd[-1])
        if ok and len(calls) > fail_first:
            out.write_bytes(JPEG_BYTES)
            return subprocess.CompletedProcess(cmd, 0, b"", b"")
        return subprocess.CompletedProcess(cmd, 1, b"", b"Output file is empty, nothing was encoded")

    monkeypatch.setattr(posters, "_run", run)
    return calls


def find_fake() -> str:
    return FAKE_FFMPEG


def media(tmp_path: Path, name: str = "talk.mp4") -> Path:
    """A fake media file whose bytes depend on its name — records are keyed by
    a content fingerprint, so two identical files would be one record."""
    p = tmp_path / name
    p.write_bytes(f"media-bytes:{name}".encode() * 100)
    return p


# --- the grab -----------------------------------------------------------------

def test_poster_time_is_a_tenth_in_clamped_and_one_second_when_unknown() -> None:
    assert posters.poster_time(None) == 1.0
    assert posters.poster_time(0) == 1.0
    assert posters.poster_time(29.04) == pytest.approx(2.904)
    assert posters.poster_time(2.0) == 0.5
    assert posters.poster_time(3600.0) == 30.0


def test_grab_writes_the_poster_atomically(tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    dest = tmp_path / "poster.jpg"
    assert posters.grab_poster(media(tmp_path), dest, 2.9, ffmpeg=FAKE_FFMPEG) is True
    assert dest.read_bytes() == JPEG_BYTES
    # No temp file survives, and the temp name was never a servable asset name.
    assert sorted(p.name for p in tmp_path.iterdir()) == ["poster.jpg", "talk.mp4"]
    cmd = calls[0]
    assert cmd[0] == FAKE_FFMPEG
    assert cmd[cmd.index("-ss") + 1] == "2.900"
    assert f"scale={posters.POSTER_WIDTH}:-2" in cmd
    assert cmd[-1].startswith(str(tmp_path / ".poster-"))


def test_a_failed_grab_leaves_nothing_behind(tmp_path, monkeypatch) -> None:
    fake_ffmpeg(monkeypatch, ok=False)
    dest = tmp_path / "poster.jpg"
    assert posters.grab_poster(media(tmp_path), dest, 1.0, ffmpeg=FAKE_FFMPEG) is False
    assert not dest.exists()
    assert [p.name for p in tmp_path.iterdir()] == ["talk.mp4"]


def test_grab_survives_a_missing_binary(tmp_path, monkeypatch) -> None:
    def run(cmd, timeout):
        raise FileNotFoundError(cmd[0])

    monkeypatch.setattr(posters, "_run", run)
    assert posters.grab_poster(media(tmp_path), tmp_path / "poster.jpg", 1.0, ffmpeg="nope") is False


# --- ensure_poster --------------------------------------------------------------

def test_ensure_poster_retries_at_zero_when_the_first_frame_fails(tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch, fail_first=1)
    folder = tmp_path / "rec"
    folder.mkdir()
    assert posters.ensure_poster(folder, str(media(tmp_path)), 29.0, find_ffmpeg=find_fake) is True
    assert [c[c.index("-ss") + 1] for c in calls] == ["2.900", "0.000"]
    assert posters.has_poster(folder)


def test_ensure_poster_is_idempotent(tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    folder = tmp_path / "rec"
    folder.mkdir()
    (folder / "poster.jpg").write_bytes(JPEG_BYTES)
    assert posters.ensure_poster(folder, str(media(tmp_path)), 29.0, find_ffmpeg=find_fake) is True
    assert calls == []


def test_ensure_poster_never_raises(tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    folder = tmp_path / "rec"
    folder.mkdir()
    # Media gone: nothing to grab from, no ffmpeg call.
    assert posters.ensure_poster(folder, str(tmp_path / "gone.mp4"), 10.0, find_ffmpeg=find_fake) is False
    assert calls == []

    def no_ffmpeg() -> str:
        raise FileNotFoundError("FFmpeg not found")

    assert posters.ensure_poster(folder, str(media(tmp_path)), 10.0, find_ffmpeg=no_ffmpeg) is False
    assert calls == []


# --- the record view and the backfill -------------------------------------------

def test_poster_is_derived_from_the_file_and_backfilled(tmp_path, monkeypatch) -> None:
    store = LibraryStore(tmp_path / "library")
    record = store.create(str(media(tmp_path)))
    assert store.list()[0]["poster"] is False

    calls = fake_ffmpeg(monkeypatch)
    assert posters.backfill_posters(store, find_ffmpeg=find_fake) == 1
    assert store.list()[0]["poster"] is True
    assert store.has_poster(store.get(record.id))
    # A second pass finds nothing to do.
    assert posters.backfill_posters(store, find_ffmpeg=find_fake) == 0
    assert len(calls) == 1


def test_backfill_skips_missing_media_and_honours_the_limit(tmp_path, monkeypatch) -> None:
    store = LibraryStore(tmp_path / "library")
    gone = media(tmp_path, "gone.mp4")
    store.create(str(gone))
    gone.unlink()
    for i in range(3):
        store.create(str(media(tmp_path, f"talk{i}.mp4")))
    calls = fake_ffmpeg(monkeypatch)
    assert posters.backfill_posters(store, limit=2, find_ffmpeg=find_fake) == 2
    assert len(calls) == 2
    assert sum(1 for row in store.list() if row["poster"]) == 2


# --- the route ------------------------------------------------------------------

def test_create_route_grabs_the_poster_in_the_background(client, home, tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    monkeypatch.setattr(posters, "_default_ffmpeg", find_fake)
    source = media(tmp_path)
    headers = {AGENT_HEADER: AGENT_TOKEN}
    res = client.post("/api/library", json={"source_path": str(source)}, headers=headers)
    assert res.status_code == 201
    # The response itself is pre-grab: the flag is derived from the file.
    assert res.json()["poster"] is False
    # TestClient runs background tasks before returning, so the next read has it.
    video_id = res.json()["id"]
    assert len(calls) == 1
    assert client.get(f"/api/library/{video_id}", headers=headers).json()["poster"] is True
    asset = client.get(f"/api/library/{video_id}/asset/poster.jpg", headers=headers)
    assert asset.status_code == 200 and asset.content == JPEG_BYTES
    # A second create (fingerprint hit) does not grab again.
    res2 = client.post("/api/library", json={"source_path": str(source)}, headers=headers)
    assert res2.status_code == 200 and res2.json()["poster"] is True
    assert len(calls) == 1
