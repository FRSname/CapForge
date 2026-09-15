"""Thumbnail frames (publish-editors Part A): the grab, its limits, the candidate
append and removal, and their locking against a ``PATCH``.

ffmpeg is never run — ``FakeFfmpeg`` stands in for the subprocess call and
writes a JPEG of a chosen size to the output path it was given.
"""

from __future__ import annotations

import math
import subprocess
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

import pytest

from backend.library import frame_grab, frames
from backend.library.errors import (
    FrameNotFound,
    FramesRefused,
    RecordNotFound,
    ScratchReadOnly,
    StaleRevision,
)
from backend.library.paths import RECORD_FILE, record_dir, resolve_asset
from backend.library.schemas import RecordPatch, VideoRecord
from backend.library.store import LibraryStore
from backend.tests.test_library_store_lock import clip, patch_until_it_lands, race

FAKE_FFMPEG = "/fake/ffmpeg"
JPEG_HEAD = b"\xff\xd8\xff\xe0"
SMALL_JPEG_BYTES = 256
#: How long the lock probe waits; ffmpeg under the lock would make it time out.
LOCK_PROBE_TIMEOUT_S = 1.0


class FakeFfmpeg:
    """Stands in for ``frame_grab._run``: a JPEG of the next size, or a failure."""

    def __init__(self, *, fail_at: Iterable[float] = (), sizes: Optional[list[int]] = None) -> None:
        self.calls: list[list[str]] = []
        self.fail_at = set(fail_at)
        self._sizes = list(sizes or [])

    def __call__(self, cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
        self.calls.append(cmd)
        if float(cmd[cmd.index("-ss") + 1]) in self.fail_at:
            return subprocess.CompletedProcess(cmd, 1, b"", b"Output file is empty")
        size = self._sizes.pop(0) if self._sizes else SMALL_JPEG_BYTES
        Path(cmd[-1]).write_bytes(JPEG_HEAD + b"\0" * (size - len(JPEG_HEAD)))
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    def arg(self, flag: str) -> list[str]:
        return [cmd[cmd.index(flag) + 1] for cmd in self.calls]


@pytest.fixture
def store(tmp_path: Path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


@pytest.fixture
def record(store: LibraryStore, tmp_path: Path) -> VideoRecord:
    return store.create(clip(tmp_path / "media", "talk.mp4"))


def grab(store: LibraryStore, video_id: str, times: Any, fake: Any, **kw: Any) -> frames.FramesResult:
    kw.setdefault("find_ffmpeg", lambda: FAKE_FFMPEG)
    return frames.grab_frames(store, video_id, times, by="agent", run=fake, **kw)


def thumbs(store: LibraryStore, record: VideoRecord) -> Path:
    return record_dir(record.id, root=store.root) / frames.THUMBNAILS_DIR


def files_in(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []


def names(count: int) -> list[str]:
    return [f"{index:032x}.jpg" for index in range(count)]


def with_cover(store: LibraryStore, video_id: str, cover: Optional[str]) -> VideoRecord:
    current = store.get(video_id)
    thumbnail = {**current.thumbnail.model_dump(), "cover": cover}
    return store.patch(video_id, RecordPatch(thumbnail=thumbnail), rev=current.rev, by="user")


# --- the format and the limits ------------------------------------------------

def test_the_limits_are_the_plans() -> None:
    assert frames.FRAME_MAX_WIDTH == 1280
    assert frames.FRAME_MAX_HEIGHT == frames.FRAME_MAX_WIDTH
    assert frames.FRAME_JPEG_QUALITY == 3
    assert frames.FRAME_RETRY_JPEG_QUALITY > frames.FRAME_JPEG_QUALITY
    assert frames.THUMBNAIL_MAX_BYTES == 2 * 1024 * 1024
    assert frames.FRAMES_PER_REQUEST == 8
    assert frames.MAX_CANDIDATES == 24


def test_frame_names_are_32_hex_jpegs() -> None:
    assert frames.FRAME_NAME_RE.match("a" * 32 + ".jpg")
    for bad in ("A" * 32 + ".jpg", "a" * 31 + ".jpg", "../record.jpg", "thumbnails/" + "a" * 32 + ".jpg"):
        assert not frames.FRAME_NAME_RE.match(bad)


# --- grabbing -------------------------------------------------------------------

def test_every_frame_lands_in_one_write(store, record) -> None:
    fake = FakeFfmpeg()

    result = grab(store, record.id, [1.0, 2.5, 4.0], fake)

    grabbed = [frame.name for frame in result.frames]
    assert [frame.time_s for frame in result.frames] == [1.0, 2.5, 4.0]
    assert all(frames.FRAME_NAME_RE.match(name) for name in grabbed)
    assert result.failed == ()
    stored = store.get(record.id)
    assert stored.thumbnail.candidates == grabbed
    assert stored.rev == record.rev + 1 == result.record.rev
    entry = stored.history[-1]
    assert (entry.field, entry.by) == ("thumbnail", "agent")
    assert entry.prev == {"ideas": [], "candidates": [], "cover": None}
    assert files_in(thumbs(store, record)) == sorted(grabbed)
    folder = record_dir(record.id, root=store.root)
    assert all(resolve_asset(folder, f"thumbnails/{name}") for name in grabbed)


def test_the_argv_is_the_thumbnail_format(store, record) -> None:
    fake = FakeFfmpeg()

    grab(store, record.id, [3.0], fake)

    assert fake.arg("-q:v") == [str(frames.FRAME_JPEG_QUALITY)]
    assert fake.arg("-vf") == [
        frame_grab.scale_filter(frames.FRAME_MAX_WIDTH, frames.FRAME_MAX_HEIGHT)
    ]
    assert fake.calls[0][0] == FAKE_FFMPEG


def test_appending_keeps_the_frames_already_there(store, record) -> None:
    first = grab(store, record.id, [1.0], FakeFfmpeg()).frames[0].name
    second = grab(store, record.id, [2.0], FakeFfmpeg()).frames[0].name

    assert store.get(record.id).thumbnail.candidates == [first, second]


def test_a_failed_time_is_reported_and_the_rest_still_land(store, record) -> None:
    fake = FakeFfmpeg(fail_at={2.5})

    result = grab(store, record.id, [1.0, 2.5, 4.0], fake)

    assert [frame.time_s for frame in result.frames] == [1.0, 4.0]
    assert [failure.time_s for failure in result.failed] == [2.5]
    assert result.failed[0].reason.strip()
    assert files_in(thumbs(store, record)) == sorted(f.name for f in result.frames)


def test_when_every_grab_fails_nothing_is_written(store, record) -> None:
    result = grab(store, record.id, [1.0, 2.0], FakeFfmpeg(fail_at={1.0, 2.0}))

    assert result.frames == ()
    assert len(result.failed) == 2
    assert result.record.rev == record.rev == store.get(record.id).rev
    assert store.get(record.id).thumbnail.candidates == []
    assert files_in(thumbs(store, record)) == []


def test_an_oversize_frame_is_re_encoded_once_at_a_lower_quality(store, record) -> None:
    fake = FakeFfmpeg(sizes=[frames.THUMBNAIL_MAX_BYTES + 1, SMALL_JPEG_BYTES])

    result = grab(store, record.id, [1.0], fake)

    assert len(result.frames) == 1
    assert fake.arg("-q:v") == [
        str(frames.FRAME_JPEG_QUALITY), str(frames.FRAME_RETRY_JPEG_QUALITY)
    ]
    written = thumbs(store, record) / result.frames[0].name
    assert written.stat().st_size <= frames.THUMBNAIL_MAX_BYTES
    assert files_in(thumbs(store, record)) == [result.frames[0].name]


def test_a_frame_still_oversize_after_the_retry_fails_and_leaves_nothing(store, record) -> None:
    oversize = frames.THUMBNAIL_MAX_BYTES + 1
    fake = FakeFfmpeg(sizes=[oversize, oversize])

    result = grab(store, record.id, [1.0], fake)

    assert result.frames == ()
    assert str(frames.THUMBNAIL_MAX_BYTES) in result.failed[0].reason
    assert len(fake.calls) == 2
    assert files_in(thumbs(store, record)) == []
    assert store.get(record.id).rev == record.rev


@pytest.mark.parametrize("times", [
    [],
    [-0.5],
    [math.nan],
    [math.inf],
    [True],
    ["1"],
    None,
    [0.5] * 9,
], ids=["empty", "negative", "nan", "inf", "bool", "string", "none", "over-per-request"])
def test_unusable_times_are_refused_before_ffmpeg_runs(store, record, times) -> None:
    fake = FakeFfmpeg()

    with pytest.raises(FramesRefused):
        grab(store, record.id, times, fake)

    assert fake.calls == []


def test_the_per_request_limit_is_named_in_the_refusal(store, record) -> None:
    with pytest.raises(FramesRefused, match=str(frames.FRAMES_PER_REQUEST)):
        grab(store, record.id, [0.5] * (frames.FRAMES_PER_REQUEST + 1), FakeFfmpeg())


def test_a_time_past_the_known_duration_is_refused(store, record) -> None:
    assert store.set_probed_duration(record.id, 10.0)
    fake = FakeFfmpeg()

    with pytest.raises(FramesRefused, match="10"):
        grab(store, record.id, [10.5], fake)
    assert fake.calls == []

    assert len(grab(store, record.id, [10.0], fake).frames) == 1


def test_with_no_known_duration_any_finite_time_reaches_ffmpeg(store, record) -> None:
    fake = FakeFfmpeg()

    grab(store, record.id, [3600.0], fake)

    assert len(fake.calls) == 1


def test_the_candidate_limit_counts_what_is_already_stored(store, record) -> None:
    store.add_thumbnail_candidates(record.id, names(frames.MAX_CANDIDATES - 2), by="user")
    fake = FakeFfmpeg()

    with pytest.raises(FramesRefused, match=str(frames.MAX_CANDIDATES)):
        grab(store, record.id, [1.0, 2.0, 3.0], fake)
    assert fake.calls == []

    grab(store, record.id, [1.0, 2.0], fake)
    assert len(store.get(record.id).thumbnail.candidates) == frames.MAX_CANDIDATES


def test_the_limit_is_rechecked_under_the_lock_and_the_grabbed_files_go(store, record) -> None:
    fake = FakeFfmpeg()

    def filling(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
        if not fake.calls:  # another writer fills the list while ffmpeg runs
            store.add_thumbnail_candidates(record.id, names(frames.MAX_CANDIDATES), by="user")
        return fake(cmd, timeout)

    with pytest.raises(FramesRefused):
        grab(store, record.id, [1.0], filling)

    assert files_in(thumbs(store, record)) == []
    assert store.get(record.id).thumbnail.candidates == names(frames.MAX_CANDIDATES)


def test_missing_media_fails_every_time_without_a_write(store, record) -> None:
    Path(record.sourcePath).unlink()
    fake = FakeFfmpeg()

    result = grab(store, record.id, [1.0, 2.0], fake)

    assert result.frames == ()
    assert [failure.time_s for failure in result.failed] == [1.0, 2.0]
    assert fake.calls == []
    assert store.get(record.id).rev == record.rev


def test_no_ffmpeg_fails_every_time_without_a_write(store, record) -> None:
    def missing() -> str:
        raise FileNotFoundError("ffmpeg not found")

    result = grab(store, record.id, [1.0], FakeFfmpeg(), find_ffmpeg=missing)

    assert result.frames == ()
    assert "ffmpeg" in result.failed[0].reason
    assert store.get(record.id).rev == record.rev


def test_an_unknown_record_is_not_found(store) -> None:
    with pytest.raises(RecordNotFound):
        grab(store, "f" * 32, [1.0], FakeFfmpeg())


def test_a_scratch_record_is_read_only(store, tmp_path) -> None:
    scratch = store.create(clip(tmp_path / "media", "scratch.mp4"), scratch=True)
    fake = FakeFfmpeg()

    with pytest.raises(ScratchReadOnly):
        grab(store, scratch.id, [1.0], fake)
    with pytest.raises(ScratchReadOnly):
        store.add_thumbnail_candidates(scratch.id, names(1), by="agent")
    assert fake.calls == []


def test_ffmpeg_never_runs_under_the_write_lock(store, record) -> None:
    fake = FakeFfmpeg()
    free: list[bool] = []

    def probing(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
        def probe() -> None:
            acquired = store.write_lock.acquire(timeout=LOCK_PROBE_TIMEOUT_S)
            if acquired:
                store.write_lock.release()
            free.append(acquired)

        thread = threading.Thread(target=probe)
        thread.start()
        thread.join()
        return fake(cmd, timeout)

    grab(store, record.id, [1.0, 2.0], probing)

    assert free == [True, True]


# --- deleting -------------------------------------------------------------------

def test_deleting_a_frame_removes_the_candidate_and_the_file(store, record) -> None:
    first, second = (f.name for f in grab(store, record.id, [1.0, 2.0], FakeFfmpeg()).frames)
    before = store.get(record.id)

    after = frames.delete_frame(store, record.id, first, by="user")

    assert after.thumbnail.candidates == [second]
    assert after.rev == before.rev + 1
    assert (after.history[-1].field, after.history[-1].by) == ("thumbnail", "user")
    assert files_in(thumbs(store, record)) == [second]


def test_deleting_the_cover_clears_it_and_any_other_frame_keeps_it(store, record) -> None:
    first, second, third = (
        f.name for f in grab(store, record.id, [1.0, 2.0, 3.0], FakeFfmpeg()).frames
    )
    with_cover(store, record.id, second)

    assert frames.delete_frame(store, record.id, first, by="user").thumbnail.cover == second
    assert frames.delete_frame(store, record.id, second, by="user").thumbnail.cover is None
    assert store.get(record.id).thumbnail.candidates == [third]


@pytest.mark.parametrize("name", [
    "0" * 32 + ".jpg",  # well formed, not a candidate
    "../" + RECORD_FILE,
    "thumbnails/" + "0" * 32 + ".jpg",
    RECORD_FILE,
])
def test_an_unknown_or_malformed_name_is_not_found(store, record, name) -> None:
    grab(store, record.id, [1.0], FakeFfmpeg())
    before = store.get(record.id)

    with pytest.raises(FrameNotFound):
        frames.delete_frame(store, record.id, name, by="user")

    assert store.get(record.id).rev == before.rev
    assert (record_dir(record.id, root=store.root) / RECORD_FILE).is_file()


def test_a_frame_whose_file_is_already_gone_is_still_removed(store, record) -> None:
    name = grab(store, record.id, [1.0], FakeFfmpeg()).frames[0].name
    (thumbs(store, record) / name).unlink()

    assert frames.delete_frame(store, record.id, name, by="user").thumbnail.candidates == []


def test_deleting_from_an_unknown_record_is_not_found(store) -> None:
    with pytest.raises(RecordNotFound):
        frames.delete_frame(store, "f" * 32, "0" * 32 + ".jpg", by="user")


# --- locking against a PATCH ----------------------------------------------------

def test_an_append_and_a_patch_both_land(store, record, monkeypatch) -> None:
    [name] = names(1)
    race(
        monkeypatch,
        slow=lambda: store.add_thumbnail_candidates(record.id, [name], by="agent"),
        fast=lambda: patch_until_it_lands(store, record.id, title="Raced"),
    )

    final = store.get(record.id)
    assert final.title == "Raced"
    assert final.thumbnail.candidates == [name]
    assert final.rev == record.rev + 2


def test_a_removal_and_a_patch_both_land(store, record, monkeypatch) -> None:
    first, second = names(2)
    store.add_thumbnail_candidates(record.id, [first, second], by="agent")
    start = store.get(record.id)

    race(
        monkeypatch,
        slow=lambda: store.remove_thumbnail_candidate(record.id, first, by="user"),
        fast=lambda: patch_until_it_lands(store, record.id, title="Raced"),
    )

    final = store.get(record.id)
    assert final.title == "Raced"
    assert final.thumbnail.candidates == [second]
    assert final.rev == start.rev + 2


def test_a_patch_holding_the_old_rev_cannot_drop_a_frame(store, record) -> None:
    old_rev = store.get(record.id).rev
    store.add_thumbnail_candidates(record.id, names(1), by="agent")

    with pytest.raises(StaleRevision):
        store.patch(
            record.id, RecordPatch(thumbnail={"candidates": []}), rev=old_rev, by="user"
        )

    assert store.get(record.id).thumbnail.candidates == names(1)
