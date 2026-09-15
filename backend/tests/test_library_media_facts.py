"""Duration at import: the store write, the per-record pool task, the startup
backfill and the ``library_changed`` event that tells the window.

A fresh card used to show ``--:--`` until the first project PUT. Now the pool
task that grabs the poster probes the duration first (so the poster lands a
tenth of the way in, not at 1 s), stores it without bumping ``rev`` (a system
field — a bump would 409 an agent's pending ``If-Match``) and says so.

No binary runs: the probe is a fake and ``posters._run`` is the poster suite's
fake ffmpeg.
"""

from __future__ import annotations

import asyncio
import math
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.library import posters, watch
from backend.library.store import LibraryStore
from backend.tests.test_library_posters import fake_ffmpeg, find_fake, media
from backend.tests.test_library_routes import (  # noqa: F401 - fixtures
    AGENT_HEADER,
    AGENT_TOKEN,
    LOCAL_TOKEN,
    home,
    main_module,
)

#: The lock test waits this long to see the writer blocked; it bounds a wait.
BLOCKED_WINDOW_S = 0.3
JOIN_TIMEOUT_S = 10.0
#: How long the end-to-end test polls for the broadcast to reach the loop.
BROADCAST_WAIT_S = 5.0
POLL_STEP_S = 0.02


@pytest.fixture
def store(tmp_path: Path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def project(duration: float = 4.0) -> dict:
    return {
        "version": 2,
        "transcriptionResult": {
            "segments": [{"start": 0.0, "end": 1.0, "text": "Hi", "words": []}],
            "language": "en",
            "duration": duration,
        },
    }


def drain_pool() -> None:
    """The pool has one worker, so a no-op queued now runs after every task before it."""
    posters._POOL.submit(lambda: None).result(timeout=JOIN_TIMEOUT_S)


# --- store.set_probed_duration ----------------------------------------------------

def test_a_probed_duration_fills_an_unknown_one_without_touching_rev(store, tmp_path) -> None:
    record = store.create(str(media(tmp_path)))
    assert store.set_probed_duration(record.id, 3.02) is True
    stored = store.get(record.id)
    assert stored.duration == 3.02
    # A system field: no rev bump (an agent's If-Match stays valid), no history,
    # and the Continue ordering (updatedAt) is left alone.
    assert stored.rev == record.rev == 1
    assert stored.history == []
    assert stored.updatedAt == record.updatedAt
    assert store.list()[0]["duration"] == 3.02


def test_a_known_duration_is_never_overwritten(store, tmp_path) -> None:
    record = store.create(str(media(tmp_path)))
    assert store.set_probed_duration(record.id, 3.0) is True
    assert store.set_probed_duration(record.id, 9.0) is False
    assert store.get(record.id).duration == 3.0


def test_a_transcript_duration_wins_in_either_order(store, tmp_path) -> None:
    first = store.create(str(media(tmp_path, "a.mp4")))
    store.put_project(first.id, project(duration=4.0))
    assert store.set_probed_duration(first.id, 3.0) is False
    assert store.get(first.id).duration == 4.0

    second = store.create(str(media(tmp_path, "b.mp4")))
    assert store.set_probed_duration(second.id, 3.0) is True
    store.put_project(second.id, project(duration=4.0))
    assert store.get(second.id).duration == 4.0


@pytest.mark.parametrize("seconds", [0.0, -1.0, math.nan, math.inf, -math.inf, None, "3.0", True])
def test_an_unusable_value_is_refused(store, tmp_path, seconds) -> None:
    record = store.create(str(media(tmp_path)))
    assert store.set_probed_duration(record.id, seconds) is False
    assert store.get(record.id).duration is None


def test_a_missing_record_is_false(store) -> None:
    assert store.set_probed_duration("0" * 32, 3.0) is False
    assert store.set_probed_duration("../not-an-id", 3.0) is False


def test_a_scratch_record_gets_its_duration_too(store, tmp_path) -> None:
    record = store.create(str(media(tmp_path)), scratch=True)
    assert store.set_probed_duration(record.id, 3.0) is True
    assert store.get(record.id).duration == 3.0


def test_the_write_holds_the_store_lock(store, tmp_path) -> None:
    record = store.create(str(media(tmp_path)))
    held, release = threading.Event(), threading.Event()
    results: list[bool] = []

    def holder() -> None:
        with store.write_lock:
            held.set()
            release.wait(JOIN_TIMEOUT_S)

    lock_thread = threading.Thread(target=holder)
    lock_thread.start()
    held.wait(JOIN_TIMEOUT_S)
    writer = threading.Thread(target=lambda: results.append(store.set_probed_duration(record.id, 3.0)))
    writer.start()
    writer.join(BLOCKED_WINDOW_S)
    try:
        assert writer.is_alive(), "set_probed_duration ran while another writer held the lock"
        assert store.get(record.id).duration is None
    finally:
        release.set()
        lock_thread.join(JOIN_TIMEOUT_S)
        writer.join(JOIN_TIMEOUT_S)
    assert results == [True]


# --- the per-record pool task -----------------------------------------------------

def test_the_probed_duration_feeds_the_poster_time(store, tmp_path, monkeypatch) -> None:
    order: list[str] = []
    calls = fake_ffmpeg(monkeypatch)
    real_run = posters._run

    def run(cmd, timeout):
        order.append("ffmpeg")
        return real_run(cmd, timeout)

    monkeypatch.setattr(posters, "_run", run)

    def probe(path: str) -> float:
        order.append("probe")
        return 29.0

    changed: list[str] = []
    record = store.create(str(media(tmp_path)))
    assert posters.ensure_media_facts(
        store, record, probe=probe, find_ffmpeg=find_fake, on_changed=changed.append
    ) is True
    assert order == ["probe", "ffmpeg"]
    assert calls[0][calls[0].index("-ss") + 1] == "2.900"  # a tenth of 29 s, not 1 s
    assert store.get(record.id).duration == 29.0
    assert store.get(record.id).rev == 1
    assert store.has_poster(record)
    assert changed == [record.id]  # once, though both changed


def test_nothing_changed_means_no_event_and_no_probe(store, tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    record = store.create(str(media(tmp_path)))
    store.set_probed_duration(record.id, 10.0)
    posters.poster_path(store._folder(record.id, scratch=False)).write_bytes(b"jpg")
    probed: list[str] = []
    changed: list[str] = []
    assert posters.ensure_media_facts(
        store, store.get(record.id), probe=probed.append, find_ffmpeg=find_fake,
        on_changed=changed.append,
    ) is False
    assert probed == [] and calls == [] and changed == []


def test_a_transcript_duration_is_used_without_probing(store, tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    record = store.create(str(media(tmp_path)))
    store.put_project(record.id, project(duration=100.0))
    probed: list[str] = []
    assert posters.ensure_media_facts(
        store, record, probe=probed.append, find_ffmpeg=find_fake
    ) is True
    assert probed == []
    assert calls[0][calls[0].index("-ss") + 1] == "10.000"


def test_a_failed_probe_still_grabs_at_one_second_and_reports_the_poster(store, tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    record = store.create(str(media(tmp_path)))
    changed: list[str] = []
    assert posters.ensure_media_facts(
        store, record, probe=lambda _: None, find_ffmpeg=find_fake, on_changed=changed.append
    ) is True
    assert calls[0][calls[0].index("-ss") + 1] == "1.000"
    assert store.get(record.id).duration is None
    assert changed == [record.id]


def test_a_probe_that_only_sets_duration_still_reports(store, tmp_path, monkeypatch) -> None:
    fake_ffmpeg(monkeypatch, ok=False)
    record = store.create(str(media(tmp_path)))
    changed: list[str] = []
    assert posters.ensure_media_facts(
        store, record, probe=lambda _: 5.0, find_ffmpeg=find_fake, on_changed=changed.append
    ) is True
    assert not store.has_poster(record)
    assert changed == [record.id]


def test_nothing_gained_means_no_event(store, tmp_path, monkeypatch) -> None:
    fake_ffmpeg(monkeypatch, ok=False)
    record = store.create(str(media(tmp_path)))
    changed: list[str] = []
    assert posters.ensure_media_facts(
        store, record, probe=lambda _: None, find_ffmpeg=find_fake, on_changed=changed.append
    ) is False
    assert changed == []


def test_missing_media_is_neither_probed_nor_grabbed(store, tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    source = media(tmp_path)
    record = store.create(str(source))
    source.unlink()
    probed: list[str] = []
    assert posters.ensure_media_facts(store, record, probe=probed.append, find_ffmpeg=find_fake) is False
    assert probed == [] and calls == []


def test_a_record_removed_before_the_task_runs_is_quiet(store, tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    record = store.create(str(media(tmp_path)))
    store.remove(record.id)
    changed: list[str] = []
    assert posters.ensure_media_facts(
        store, record, probe=lambda _: 3.0, find_ffmpeg=find_fake, on_changed=changed.append
    ) is False
    assert calls == [] and changed == []


def test_a_failing_listener_is_logged_not_raised(store, tmp_path, monkeypatch, caplog) -> None:
    fake_ffmpeg(monkeypatch)
    record = store.create(str(media(tmp_path)))

    def boom(video_id: str) -> None:
        raise RuntimeError("the loop is gone")

    with caplog.at_level("WARNING", logger="backend.library.posters"):
        assert posters.ensure_media_facts(
            store, record, probe=lambda _: 3.0, find_ffmpeg=find_fake, on_changed=boom
        ) is True
    assert "the loop is gone" in caplog.text
    assert store.get(record.id).duration == 3.0


def test_start_grab_runs_the_whole_task_on_the_pool(store, tmp_path, monkeypatch) -> None:
    fake_ffmpeg(monkeypatch)
    monkeypatch.setattr(posters, "_default_ffmpeg", find_fake)
    monkeypatch.setattr(posters, "_default_probe", lambda _: 3.0)
    record = store.create(str(media(tmp_path)))
    changed: list[str] = []
    seen_threads: list[str] = []

    def on_changed(video_id: str) -> None:
        seen_threads.append(threading.current_thread().name)
        changed.append(video_id)

    assert posters.start_grab(store, record, on_changed=on_changed).result(timeout=JOIN_TIMEOUT_S) is True
    assert changed == [record.id]
    assert seen_threads[0].startswith("poster")  # never the caller's thread
    assert store.get(record.id).duration == 3.0


# --- the startup backfill ------------------------------------------------------------

def test_backfill_picks_up_a_duration_only_gap(store, tmp_path, monkeypatch) -> None:
    calls = fake_ffmpeg(monkeypatch)
    record = store.create(str(media(tmp_path)))
    posters.poster_path(store._folder(record.id, scratch=False)).write_bytes(b"jpg")
    changed: list[str] = []
    assert posters.backfill_posters(
        store, find_ffmpeg=find_fake, probe=lambda _: 42.0, on_changed=changed.append
    ) == 1
    assert calls == []  # the poster was already there
    assert store.get(record.id).duration == 42.0
    assert changed == [record.id]


def test_backfill_skips_records_with_both_and_with_missing_media(store, tmp_path, monkeypatch) -> None:
    fake_ffmpeg(monkeypatch)
    done = store.create(str(media(tmp_path, "done.mp4")))
    store.set_probed_duration(done.id, 5.0)
    posters.poster_path(store._folder(done.id, scratch=False)).write_bytes(b"jpg")
    gone = media(tmp_path, "gone.mp4")
    store.create(str(gone))
    gone.unlink()
    probed: list[str] = []
    assert posters.backfill_posters(store, find_ffmpeg=find_fake, probe=probed.append) == 0
    assert probed == []


def test_start_backfill_passes_the_listener(store, tmp_path, monkeypatch) -> None:
    fake_ffmpeg(monkeypatch)
    monkeypatch.setattr(posters, "_default_ffmpeg", find_fake)
    monkeypatch.setattr(posters, "_default_probe", lambda _: 7.0)
    record = store.create(str(media(tmp_path)))
    changed: list[str] = []
    assert posters.start_backfill(store, on_changed=changed.append).result(timeout=JOIN_TIMEOUT_S) == 1
    assert changed == [record.id]


# --- the event ------------------------------------------------------------------------

def test_the_updated_notify_hops_onto_the_loop_with_the_updated_key() -> None:
    sent: list[dict] = []

    async def broadcast(payload: dict) -> None:
        sent.append(payload)

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        notify = watch.make_updated_notify(loop, broadcast)
        done = threading.Event()
        thread = threading.Thread(target=lambda: (notify("abc"), done.set()))
        thread.start()
        await loop.run_in_executor(None, done.wait)
        for _ in range(10):
            if sent:
                break
            await asyncio.sleep(0)

    asyncio.run(scenario())
    assert sent == [
        {"type": "library_changed", "created": [], "relinked": [], "updated": ["abc"]}
    ]


def test_notifying_a_closed_loop_is_logged_not_raised(caplog) -> None:
    loop = asyncio.new_event_loop()
    loop.close()

    async def broadcast(payload: dict) -> None:  # pragma: no cover - never awaited
        raise AssertionError("must not run")

    with caplog.at_level("WARNING", logger="backend.library.watch"):
        watch.make_updated_notify(loop, broadcast)("abc")
    assert "library_changed" in caplog.text


def test_get_store_hands_the_pool_task_the_registered_listener(home, tmp_path, monkeypatch) -> None:
    from backend.library import router as library_router

    fake_ffmpeg(monkeypatch)
    monkeypatch.setattr(posters, "_default_ffmpeg", find_fake)
    monkeypatch.setattr(posters, "_default_probe", lambda _: 3.0)
    changed: list[str] = []
    library_router.set_media_changed_listener(changed.append)
    try:
        record = library_router.get_store().create(str(media(tmp_path)))
        drain_pool()
        assert changed == [record.id]
        library_router.set_media_changed_listener(None)
        second = library_router.get_store().create(str(media(tmp_path, "b.mp4")))
        drain_pool()  # no listener: the task still stores, and says nothing
        assert changed == [record.id]
        assert library_router.get_store().get(second.id).duration == 3.0
    finally:
        library_router.set_media_changed_listener(None)
        library_router.reset_store_cache()


def test_startup_wires_library_changed_updated_end_to_end(main_module, home, tmp_path, monkeypatch) -> None:
    from backend.library import router as library_router

    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "LOCAL_TOKEN", LOCAL_TOKEN, raising=False)
    fake_ffmpeg(monkeypatch)
    monkeypatch.setattr(posters, "_default_ffmpeg", find_fake)
    monkeypatch.setattr(posters, "_default_probe", lambda _: 3.0)
    sent: list[dict] = []

    async def broadcast(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(m, "broadcast_event", broadcast)
    headers = {AGENT_HEADER: AGENT_TOKEN}
    try:
        with TestClient(m.app) as c:
            res = c.post("/api/library", json={"source_path": str(media(tmp_path))}, headers=headers)
            assert res.status_code == 201
            video_id = res.json()["id"]
            drain_pool()
            deadline = time.monotonic() + BROADCAST_WAIT_S
            while not sent and time.monotonic() < deadline:
                time.sleep(POLL_STEP_S)
            assert sent == [
                {"type": "library_changed", "created": [], "relinked": [], "updated": [video_id]}
            ]
            body = c.get(f"/api/library/{video_id}", headers=headers).json()
            assert body["duration"] == 3.0 and body["rev"] == 1 and body["poster"] is True
        assert library_router._media_listener is None  # shutdown unhooks the dead loop
    finally:
        library_router.set_media_changed_listener(None)
        library_router.reset_store_cache()
