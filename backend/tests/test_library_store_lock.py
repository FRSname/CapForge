"""The store's write lock: no read-modify-write may interleave with another.

The watch-folder thread writes records while FastAPI's threadpool does, and
every mutating store method is ``get`` → ``model_copy`` → ``_persist``. Each
race test pauses a *slow* writer inside ``_persist`` (after it has read the
record) and lets a *fast* writer run. Without the lock the fast writer lands in
that gap and the slow one writes stale fields back over it; with the lock the
fast writer waits, so both effects survive and ``rev`` counts both.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Callable

import pytest

from backend.library import brief, fs
from backend.library.brief import BriefPatch, load_brief, save_brief
from backend.library.paths import PROJECT_FILE, RECORD_FILE, REMOVED_DIR_NAME
from backend.library.schemas import RecordPatch, RenderEntry, VideoRecord
from backend.library.store import LibraryStore, RecordNotFound, StaleRevision

#: How long the test waits for the fast writer before releasing the slow one.
#: Without the lock the fast writer finishes well inside it; with the lock it
#: is blocked for exactly this long. It bounds a wait, never paces a loop.
RACE_WINDOW_S = 0.5
JOIN_TIMEOUT_S = 10.0
SLOW_THREAD = "slow-writer"


@pytest.fixture
def store(tmp_path: Path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def clip(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(f"media:{folder.name}/{name}".encode() * 64)
    return p


def project(duration: float = 4.0) -> dict:
    return {
        "version": 2,
        "transcriptionResult": {
            "segments": [{"start": 0.0, "end": 1.0, "text": "Hi", "words": []}],
            "language": "en",
            "duration": duration,
        },
    }


def patch_until_it_lands(store: LibraryStore, video_id: str, **fields: Any) -> VideoRecord:
    """What a PATCH client does on a 409: re-read the rev and send again."""
    while True:
        current = store.get(video_id)
        try:
            return store.patch(video_id, RecordPatch(**fields), rev=current.rev, by="user")
        except StaleRevision:
            continue


class Thread(threading.Thread):
    """A thread that keeps what its target raised, so the test can assert on it."""

    def __init__(self, target: Callable[[], Any], name: str | None = None) -> None:
        super().__init__(name=name, daemon=True)
        self._fn = target
        self.error: BaseException | None = None
        self.done = threading.Event()

    def run(self) -> None:
        try:
            self._fn()
        except BaseException as exc:  # noqa: BLE001 - re-raised by finish()
            self.error = exc
        finally:
            self.done.set()

    def finish(self) -> None:
        self.join(JOIN_TIMEOUT_S)
        assert not self.is_alive(), f"{self.name} deadlocked"
        if self.error is not None:
            raise self.error


def pause_slow_writer_in(monkeypatch, owner: Any, attr: str) -> tuple[threading.Event, threading.Event]:
    """Make the slow thread's first call to ``owner.attr`` wait for ``release``."""
    paused, release = threading.Event(), threading.Event()
    real = getattr(owner, attr)

    def gated(*args: Any, **kwargs: Any) -> Any:
        if threading.current_thread().name == SLOW_THREAD and not paused.is_set():
            paused.set()
            assert release.wait(JOIN_TIMEOUT_S), "never released"
        return real(*args, **kwargs)

    monkeypatch.setattr(owner, attr, gated)
    return paused, release


def race(monkeypatch, slow: Callable[[], Any], fast: Callable[[], Any], *, gate=None) -> None:
    """Run ``fast`` while ``slow`` sits between its read and its write."""
    owner, attr = gate or (LibraryStore, "_persist")
    paused, release = pause_slow_writer_in(monkeypatch, owner, attr)
    slow_thread = Thread(slow, name=SLOW_THREAD)
    slow_thread.start()
    assert paused.wait(JOIN_TIMEOUT_S), "the slow writer never reached its write"
    fast_thread = Thread(fast, name="fast-writer")
    fast_thread.start()
    fast_thread.done.wait(RACE_WINDOW_S)
    release.set()
    slow_thread.finish()
    fast_thread.finish()


# --- every read-modify-write against a concurrent PATCH ---------------------------

SLOW_WRITES: dict[str, tuple[Callable[..., Any], Callable[[LibraryStore, VideoRecord, Path], bool]]] = {
    "patch": (
        lambda store, rec, moved: store.patch(rec.id, RecordPatch(title="Slow"), rev=rec.rev, by="user"),
        lambda store, final, moved: final.title == "Slow",
    ),
    "put_project": (
        lambda store, rec, moved: store.put_project(rec.id, project(duration=4.0)),
        lambda store, final, moved: final.duration == 4.0 and store.get_project(final.id) is not None,
    ),
    "add_render": (
        lambda store, rec, moved: store.add_render(
            rec.id, RenderEntry(path="/out/a.mp4", kind="baked", at="2026-09-14T00:00:00Z")
        ),
        lambda store, final, moved: len(final.renders) == 1,
    ),
    "relink": (
        lambda store, rec, moved: store.relink(rec.id, moved, by="user"),
        lambda store, final, moved: final.sourcePath == str(moved.resolve()),
    ),
}


@pytest.mark.parametrize("name", sorted(SLOW_WRITES))
def test_a_patch_racing_a_write_loses_nothing(store, tmp_path, monkeypatch, name):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    moved = tmp_path / "new" / "talk.mp4"
    moved.parent.mkdir()
    os.replace(media, moved)
    slow_write, landed = SLOW_WRITES[name]

    race(
        monkeypatch,
        slow=lambda: slow_write(store, record, moved),
        fast=lambda: patch_until_it_lands(store, record.id, description="Fast"),
    )

    final = store.get(record.id)
    assert final.description == "Fast", f"{name} wrote a stale description back"
    assert landed(store, final, moved), f"{name}'s own write was lost"
    assert final.rev == record.rev + 2, "two effective writes, two revs"


def test_a_relink_racing_a_patch_keeps_the_new_path(store, tmp_path, monkeypatch):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    moved = tmp_path / "new" / "talk.mp4"
    moved.parent.mkdir()
    os.replace(media, moved)

    race(
        monkeypatch,
        slow=lambda: store.patch(record.id, RecordPatch(title="Slow"), rev=record.rev, by="user"),
        fast=lambda: store.relink(record.id, moved, by="user"),
    )

    final = store.get(record.id)
    assert final.title == "Slow"
    assert final.sourcePath == str(moved.resolve()), "the patch wrote the old path back"
    assert final.rev == record.rev + 2
    assert sorted(h.field for h in final.history) == ["sourcePath", "title"]


def test_a_remove_racing_a_patch_never_resurrects_the_record(store, tmp_path, monkeypatch):
    record = store.create(clip(tmp_path / "a", "talk.mp4"))

    race(
        monkeypatch,
        slow=lambda: store.patch(record.id, RecordPatch(title="Slow"), rev=record.rev, by="user"),
        fast=lambda: store.remove(record.id),
    )

    with pytest.raises(RecordNotFound):
        store.get(record.id)
    assert not (store.root / record.id).exists(), "the patch recreated the removed folder"
    (parked,) = (store.root / REMOVED_DIR_NAME).iterdir()
    assert VideoRecord.model_validate(fs.read_json(parked / RECORD_FILE)).title == "Slow"


def test_a_promote_racing_a_put_project_keeps_the_snapshot(store, tmp_path, monkeypatch):
    record = store.create(clip(tmp_path / "a", "qa.mp4"), scratch=True)

    race(
        monkeypatch,
        slow=lambda: store.put_project(record.id, project()),
        fast=lambda: store.promote(record.id),
        gate=(fs, "write_json_atomic"),
    )

    final = store.get(record.id)
    assert final.scratch is False
    assert (store.root / record.id / PROJECT_FILE).is_file()
    assert not (store.root / ".scratch" / record.id).exists(), "a write landed in the moved folder"


def test_many_threads_patching_distinct_fields_plus_a_relink(store, tmp_path):
    media = clip(tmp_path / "old", "talk.mp4")
    record = store.create(media)
    moved = tmp_path / "new" / "talk.mp4"
    moved.parent.mkdir()
    os.replace(media, moved)
    writes: dict[str, Any] = {
        "title": "T", "description": "D", "short_description": "S", "summary_md": "M",
        "collection_id": "C", "tags": ["t"], "hashtags": ["#h"], "keywords": ["k"],
    }
    start = threading.Barrier(len(writes) + 1)

    def patcher(field: str, value: Any) -> Callable[[], None]:
        return lambda: (start.wait(), patch_until_it_lands(store, record.id, **{field: value}))

    threads = [Thread(patcher(f, v), name=f"patch-{f}") for f, v in writes.items()]
    threads.append(Thread(lambda: (start.wait(), store.relink(record.id, moved, by="user")), name="relink"))
    for t in threads:
        t.start()
    for t in threads:
        t.finish()

    final = store.get(record.id)
    for field, value in writes.items():
        assert getattr(final, field) == value, field
    assert final.sourcePath == str(moved.resolve())
    assert final.rev == 1 + len(writes) + 1
    assert len(final.history) == len(writes) + 1


# --- what must stay outside the lock --------------------------------------------------

def lock_is_free_elsewhere(store: LibraryStore) -> bool:
    """Whether another thread can take the write lock right now."""
    taken: list[bool] = []

    def probe() -> None:
        got = store.write_lock.acquire(timeout=RACE_WINDOW_S)
        if got:
            store.write_lock.release()
        taken.append(got)

    t = threading.Thread(target=probe)
    t.start()
    t.join(JOIN_TIMEOUT_S)
    return taken == [True]


def test_the_on_created_hook_runs_outside_the_lock(tmp_path):
    seen: list[bool] = []
    store = LibraryStore(tmp_path / "library", on_created=lambda s, rec: seen.append(lock_is_free_elsewhere(s)))
    try:
        store.create(clip(tmp_path / "a", "talk.mp4"))
        project_file = tmp_path / "imported.capforge"
        media = clip(tmp_path / "b", "other.mp4")
        fs.write_json_atomic(project_file, {**project(), "selectedFilePath": str(media)})
        store.import_project_file(project_file)
    finally:
        store.close()
    assert seen == [True, True]


def test_the_write_lock_is_reentrant(store, tmp_path):
    media = clip(tmp_path / "a", "qa.mp4")
    scratch = store.create(media, scratch=True)
    with store.write_lock:
        promoted, created = store.create_or_get(media)  # create_or_get → promote
    assert (promoted.id, promoted.scratch, created) == (scratch.id, False, False)


# --- the channel brief ----------------------------------------------------------------

def test_two_brief_saves_racing_keep_both_fields(tmp_path, monkeypatch):
    root = tmp_path / "library"

    race(
        monkeypatch,
        slow=lambda: save_brief(root, BriefPatch(speaker_block="Slow")),
        fast=lambda: save_brief(root, BriefPatch(default_hashtags=["#fast"])),
        gate=(brief.fs, "write_json_atomic"),
    )

    stored = load_brief(root)
    assert stored.speaker_block == "Slow"
    assert stored.default_hashtags == ["#fast"]
