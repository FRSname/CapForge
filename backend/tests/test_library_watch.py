"""``watch.FolderWatcher`` — the import-only watch folder, driven tick by tick.

No sleeps: every test calls ``tick()`` (or the loop body ``run_once()``)
synchronously. Plan: docs/plans/library-folder-import.md (Backend → Watch)."""

from __future__ import annotations

import asyncio
import json
import os
import threading
from pathlib import Path

import pytest

from backend.library import watch
from backend.library.index import LibraryIndex
from backend.library.store import LibraryStore
from backend.library.watch import (
    WATCH_FILE,
    WATCH_STABLE_POLLS,
    FolderWatcher,
    WatchConfig,
)


@pytest.fixture
def home(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "home"
    monkeypatch.setenv("CAPFORGE_HOME", str(path))
    return path


@pytest.fixture
def store(home: Path):
    s = LibraryStore(home / "library")
    yield s
    s.close()


@pytest.fixture
def calls() -> list[tuple[tuple[str, ...], tuple[str, ...]]]:
    return []


@pytest.fixture
def watcher(store, calls):
    return FolderWatcher(store, lambda created, relinked: calls.append((created, relinked)))


@pytest.fixture
def inbox(tmp_path: Path) -> Path:
    folder = tmp_path / "inbox"
    folder.mkdir()
    return folder


def clip(folder: Path, name: str, body: bytes | None = None) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(body if body is not None else f"media:{name}".encode() * 64)
    return p


def settle(w: FolderWatcher, ticks: int = WATCH_STABLE_POLLS):
    return [w.tick() for _ in range(ticks)][-1]


def test_no_folder_is_a_no_op_tick(watcher, calls):
    result = watcher.tick()
    assert result.created == () and result.relinked == ()
    assert calls == []
    status = watcher.status()
    assert (status.folder, status.available, status.importedCount) == (None, False, 0)


def test_a_file_imports_once_stable_for_two_polls(watcher, store, inbox, calls):
    clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))

    first = watcher.tick()
    assert first.created == () and calls == []
    second = watcher.tick()
    assert len(second.created) == 1
    assert calls == [(second.created, ())]
    assert [v["id"] for v in store.list()] == list(second.created)
    assert watcher.status().importedCount == 1
    assert watcher.status().lastScanAt


def test_a_file_still_being_written_waits(watcher, store, inbox, calls):
    watcher.set_folder(str(inbox))
    growing = clip(inbox, "render.mp4", b"a" * 100)
    watcher.tick()
    growing.write_bytes(b"a" * 200)  # the size changed between polls
    assert watcher.tick().created == ()
    assert store.list() == []
    assert len(watcher.tick().created) == 1
    assert len(calls) == 1


def test_an_mtime_change_alone_also_restarts_the_count(watcher, store, inbox):
    watcher.set_folder(str(inbox))
    p = clip(inbox, "render.mp4")
    watcher.tick()
    st = p.stat()
    os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert watcher.tick().created == ()
    assert len(watcher.tick().created) == 1


def test_nothing_happening_does_not_notify(watcher, inbox, calls):
    watcher.set_folder(str(inbox))
    settle(watcher, 4)
    assert calls == []


def test_seen_is_persisted_and_survives_a_new_watcher(store, inbox, calls, watcher):
    media = clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))
    (record_id,) = settle(watcher).created
    config = WatchConfig.model_validate(json.loads((store.root / WATCH_FILE).read_text()))
    st = media.stat()
    assert config.folder == str(inbox.resolve())
    assert config.seen == {str(inbox.resolve() / "take1.mp4"): f"{st.st_size}-{st.st_mtime_ns}"}

    store.remove(record_id)
    fresh = FolderWatcher(store, lambda c, r: calls.append((c, r)))
    assert fresh.status().folder == str(inbox.resolve())
    settle(fresh, 3)
    assert store.list() == []
    assert len(calls) == 1  # only the first watcher's import


def test_a_removed_records_file_is_not_reimported(watcher, store, inbox):
    clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))
    (record_id,) = settle(watcher).created
    store.remove(record_id)
    settle(watcher, 3)
    assert store.list() == []


def test_a_failed_import_of_an_existing_file_is_not_retried(watcher, store, inbox, monkeypatch):
    clip(inbox, "corrupt.mp4")
    watcher.set_folder(str(inbox))
    attempts: list[str] = []

    def failing(self, source_path, *, scratch=False):
        attempts.append(str(source_path))
        raise OSError("boom")

    monkeypatch.setattr(LibraryStore, "create_or_get", failing)
    settle(watcher, 4)
    assert len(attempts) == 1


def test_a_vanished_file_is_forgotten_not_seen(watcher, store, inbox, monkeypatch):
    p = clip(inbox, "flaky.mp4")
    watcher.set_folder(str(inbox))
    watcher.tick()

    real = watch.import_paths

    def vanish_then_import(store_, paths, *, by):
        p.unlink()
        return real(store_, paths, by=by)

    monkeypatch.setattr(watch, "import_paths", vanish_then_import)
    watcher.tick()
    config = WatchConfig.model_validate(json.loads((store.root / WATCH_FILE).read_text()))
    assert config.seen == {}


def test_changing_the_folder_resets_seen(watcher, store, inbox, tmp_path):
    clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))
    (record_id,) = settle(watcher).created
    other = tmp_path / "other"
    other.mkdir()
    watcher.set_folder(str(other))
    config = WatchConfig.model_validate(json.loads((store.root / WATCH_FILE).read_text()))
    assert config.folder == str(other.resolve()) and config.seen == {}

    # choosing a folder imports what is already in it — the old one included
    store.remove(record_id)
    watcher.set_folder(str(inbox))
    assert len(settle(watcher).created) == 1


def test_setting_the_same_folder_keeps_seen(watcher, store, inbox):
    clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))
    (record_id,) = settle(watcher).created
    store.remove(record_id)
    watcher.set_folder(str(inbox))
    settle(watcher, 3)
    assert store.list() == []


def test_none_stops_watching(watcher, store, inbox):
    watcher.set_folder(str(inbox))
    status = watcher.set_folder(None)
    assert status.folder is None and status.available is False
    clip(inbox, "take1.mp4")
    settle(watcher, 3)
    assert store.list() == []


def test_a_vanished_folder_is_a_quiet_tick(watcher, inbox, calls):
    watcher.set_folder(str(inbox))
    inbox.rmdir()
    result = watcher.tick()
    assert result.created == () and calls == []
    status = watcher.status()
    assert status.folder == str(inbox.resolve()) and status.available is False


@pytest.mark.parametrize("bad", ["relative/folder", ""])
def test_set_folder_refuses_a_relative_path(watcher, bad):
    with pytest.raises(ValueError):
        watcher.set_folder(bad)


def test_set_folder_refuses_a_missing_folder_or_a_file(watcher, tmp_path):
    with pytest.raises(ValueError):
        watcher.set_folder(str(tmp_path / "missing"))
    file = clip(tmp_path, "a.mp4")
    with pytest.raises(ValueError):
        watcher.set_folder(str(file))


def test_set_folder_refuses_the_library_home_and_anything_inside_it(watcher, home):
    inside = home / "library" / "exports"
    inside.mkdir(parents=True)
    for folder in (home, inside):
        with pytest.raises(ValueError, match="CapForge"):
            watcher.set_folder(str(folder))


def test_an_invalid_watch_file_reads_as_not_watching(store, caplog):
    store.root.mkdir(parents=True, exist_ok=True)
    (store.root / WATCH_FILE).write_text('{"folder": 3, "surprise": true}')
    w = FolderWatcher(store, lambda c, r: None)
    assert w.status().folder is None
    assert "watch" in caplog.text.lower()


def test_seen_is_pruned_for_paths_that_left_the_folder(watcher, store, inbox):
    media = clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))
    settle(watcher)
    media.unlink()
    watcher.tick()
    config = WatchConfig.model_validate(json.loads((store.root / WATCH_FILE).read_text()))
    assert config.seen == {}


def test_a_moved_file_arriving_in_the_folder_relinks(watcher, store, inbox, tmp_path, calls):
    media = clip(tmp_path / "elsewhere", "take1.mp4")
    record = store.create(media)
    os.replace(media, inbox / "take1.mp4")
    watcher.set_folder(str(inbox))
    result = settle(watcher)
    assert result.relinked == (record.id,) and result.created == ()
    assert calls == [((), (record.id,))]


def test_a_raising_tick_does_not_kill_the_loop(watcher, inbox, monkeypatch, caplog):
    watcher.set_folder(str(inbox))

    def explode():
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(watcher, "tick", explode)
    assert watcher.run_once() is None
    assert "disk on fire" in caplog.text
    monkeypatch.undo()
    clip(inbox, "take1.mp4")
    watcher.run_once()
    assert len(watcher.run_once().created) == 1


def test_start_and_stop_run_a_daemon_thread(store, inbox):
    ticked = threading.Event()
    w = FolderWatcher(store, lambda c, r: None, interval_s=3600.0)
    original = w.tick
    w.tick = lambda: (ticked.set(), original())[1]  # type: ignore[method-assign]
    w.start()
    try:
        assert ticked.wait(5.0)
    finally:
        w.stop()
    assert w._thread is None


def test_get_watcher_is_cached_per_root(store, tmp_path):
    first = watch.get_watcher(store)
    assert watch.get_watcher(store) is first
    other = LibraryStore(tmp_path / "other-library")
    try:
        assert watch.get_watcher(other) is not first
    finally:
        other.close()
        watch.stop_watchers()


def test_make_notify_broadcasts_library_changed_on_the_loop():
    sent: list[dict] = []

    async def broadcast(payload: dict) -> None:
        sent.append(payload)

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        notify = watch.make_notify(loop, broadcast)
        done = threading.Event()
        thread = threading.Thread(target=lambda: (notify(("a",), ("b", "c")), done.set()))
        thread.start()
        await loop.run_in_executor(None, done.wait)
        for _ in range(10):
            if sent:
                break
            await asyncio.sleep(0)

    asyncio.run(scenario())
    assert sent == [{"type": "library_changed", "created": ["a"], "relinked": ["b", "c"]}]


# --- the index lock ----------------------------------------------------------

def test_the_sqlite_index_survives_concurrent_threads(tmp_path):
    index = LibraryIndex(tmp_path / "library.db")
    index.reset()
    errors: list[BaseException] = []
    per_thread = 60

    def hammer(n: int) -> None:
        try:
            for i in range(per_thread):
                index.upsert(f"t{n}-{i}", f"title {n} {i}", "desc", "tags", "hello world")
                index.search("hello")
                index.delete(f"t{n}-{i - 1}")
        except BaseException as exc:  # noqa: BLE001 - collected and asserted below
            errors.append(exc)

    threads = [threading.Thread(target=hammer, args=(n,)) for n in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    try:
        assert errors == []
        assert sorted(index.search("hello")) == sorted(f"t{n}-{per_thread - 1}" for n in range(6))
    finally:
        index.close()


def test_the_index_owns_a_reentrant_lock(tmp_path):
    index = LibraryIndex(tmp_path / "library.db")
    try:
        assert type(index._lock) is type(threading.RLock())
    finally:
        index.close()


# --- a slow pass never blocks status() / set_folder() ---------------------------------

#: A lock-free call answers in microseconds; this only bounds a hang.
PROMPT_S = 2.0
TICK_JOIN_S = 10.0


def within(fn, timeout: float = PROMPT_S):
    """``(finished, result)`` for ``fn`` run on a helper thread, bounded by ``timeout``."""
    out: list = []
    t = threading.Thread(target=lambda: out.append(fn()), daemon=True)
    t.start()
    t.join(timeout)
    return (not t.is_alive(), out[0] if out else None)


@pytest.fixture
def blocked_import(monkeypatch):
    """``import_paths`` that parks inside the pass until ``release`` is set."""
    entered, release = threading.Event(), threading.Event()
    real = watch.import_paths

    def parked(store_, paths, *, by):
        entered.set()
        assert release.wait(TICK_JOIN_S), "the test never released the import"
        return real(store_, paths, by=by)

    monkeypatch.setattr(watch, "import_paths", parked)
    return entered, release


def start_tick_mid_import(w: FolderWatcher, entered: threading.Event) -> threading.Thread:
    """First tick sees the file; the second parks in the import on its own thread."""
    w.tick()
    ticking = threading.Thread(target=w.tick, daemon=True)
    ticking.start()
    assert entered.wait(TICK_JOIN_S), "the tick never reached the import"
    return ticking


def test_status_and_stop_answer_while_a_tick_is_importing(
    watcher, store, inbox, calls, blocked_import
):
    entered, release = blocked_import
    clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))
    ticking = start_tick_mid_import(watcher, entered)
    try:
        answered, status = within(watcher.status)
        assert answered, "status() waited for the import pass"
        assert status.folder == str(inbox.resolve())
        stopped, _ = within(lambda: watcher.set_folder(None))
        assert stopped, "set_folder(None) waited for the import pass"
    finally:
        release.set()
        ticking.join(TICK_JOIN_S)
    assert not ticking.is_alive()

    # the pass's record exists, so the window is still told about it …
    (created,) = [c for c, _ in calls]
    assert len(created) == 1 and [v["id"] for v in store.list()] == list(created)
    # … but nothing it learned about the old folder is committed
    config = WatchConfig.model_validate(json.loads((store.root / WATCH_FILE).read_text()))
    assert config.folder is None and config.seen == {}
    assert watcher.status().folder is None


def test_a_folder_change_mid_tick_leaves_the_new_folders_seen_empty(
    watcher, store, inbox, tmp_path, calls, blocked_import
):
    entered, release = blocked_import
    clip(inbox, "take1.mp4")
    other = tmp_path / "other"
    other.mkdir()
    watcher.set_folder(str(inbox))
    ticking = start_tick_mid_import(watcher, entered)
    try:
        switched, status = within(lambda: watcher.set_folder(str(other)))
        assert switched, "set_folder waited for the import pass"
        assert status.folder == str(other.resolve())
    finally:
        release.set()
        ticking.join(TICK_JOIN_S)
    assert not ticking.is_alive()

    config = WatchConfig.model_validate(json.loads((store.root / WATCH_FILE).read_text()))
    assert config.folder == str(other.resolve())
    assert config.seen == {}, "the old folder's pass wrote into the new folder's seen"
    assert len(calls) == 1 and len(calls[0][0]) == 1, "the created record was not notified"
    # the stale pass's pending state is gone too: the new folder's ticks import nothing
    settle(watcher, 3)
    assert len(calls) == 1


def test_ticks_never_overlap(watcher, store, inbox, monkeypatch):
    in_flight, peak = [0], [0]
    guard = threading.Lock()
    both_started = threading.Barrier(2)
    real = watch.scan_media

    def counting_scan(*args, **kwargs):
        with guard:
            in_flight[0] += 1
            peak[0] = max(peak[0], in_flight[0])
        try:
            release_other = threading.Event()
            release_other.wait(0.2)  # hold the pass open long enough for the other tick to try
            return real(*args, **kwargs)
        finally:
            with guard:
                in_flight[0] -= 1

    monkeypatch.setattr(watch, "scan_media", counting_scan)
    clip(inbox, "take1.mp4")
    watcher.set_folder(str(inbox))

    def run() -> None:
        both_started.wait()
        watcher.tick()

    threads = [threading.Thread(target=run, daemon=True) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(TICK_JOIN_S)
    assert peak[0] == 1
    # and the two serial ticks still count as two polls: the file imported once
    assert len(store.list()) == 1
