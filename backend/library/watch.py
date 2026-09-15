"""The import-only watch folder (v3.0 3s).

One folder, polled every ``WATCH_INTERVAL_S`` by a daemon thread that exists
only while CapForge runs (decision D9: quit means quit). Nothing is transcribed:
a new recording becomes a library record and the window is told
(``library_changed``) so the list refetches.

Three rules carry the design (docs/plans/library-folder-import.md):

- **A file is imported only once its size + mtime are unchanged for
  ``WATCH_STABLE_POLLS`` consecutive polls** — the fingerprint includes both,
  so a render still being written would mint a record the finished file no
  longer matches.
- **Every path imported (or refused for a reason other than vanishing) is
  remembered in ``seen``** and never imported again. Fingerprint lookup ignores
  ``.removed/`` and ``.trash/``, so without it Remove would be undone on the
  next tick. Changing the folder resets ``seen``; a seen path that has left the
  folder is forgotten (unless the scan was truncated).
- **``tick()`` is synchronous** — the unit the tests drive; the thread only
  calls it on a timer and logs whatever it raises.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import threading
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.library import fs
from backend.library.folder_import import FolderImport, import_paths
from backend.library.media_scan import scan_media
from backend.library.paths import capforge_home
from backend.library.schemas import Actor

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.store import LibraryStore

logger = logging.getLogger(__name__)

#: Lives at the library root, beside the record folders (a file, so record
#: iteration skips it).
WATCH_FILE = "watch.json"
WATCH_INTERVAL_S = 10.0
WATCH_STABLE_POLLS = 2
#: A watched import is the user's own folder at work — not an agent.
WATCH_ACTOR: Actor = "user"
LIBRARY_CHANGED_EVENT = "library_changed"
WATCH_THREAD_NAME = "library-watch"
#: How long ``stop()`` waits for an in-flight tick before giving up on the join.
STOP_JOIN_TIMEOUT_S = 5.0

#: ``notify(created_ids, relinked_ids)`` — called only when either is non-empty.
Notify = Callable[[tuple[str, ...], tuple[str, ...]], None]
#: ``notify(video_id)`` — the poster pool stored a probed duration or a poster.
NotifyUpdated = Callable[[str], None]
Broadcast = Callable[[dict], Awaitable[None]]
Stat = tuple[int, int]


class WatchConfig(BaseModel):
    """``watch.json``: the folder and every path already taken from it."""

    model_config = ConfigDict(extra="forbid")

    folder: Optional[str] = None
    #: absolute path -> ``"{size}-{mtime_ns}"`` at the time it was imported.
    seen: dict[str, str] = Field(default_factory=dict)


@dataclass(frozen=True)
class WatchStatus:
    """The ``/api/library/watch`` body; field names are the wire names."""

    folder: Optional[str]
    available: bool
    lastScanAt: Optional[str]
    importedCount: int

    def to_wire(self) -> dict:
        return dataclasses.asdict(self)


@dataclass(frozen=True)
class WatchTick:
    """What one poll did."""

    created: tuple[str, ...] = ()
    relinked: tuple[str, ...] = ()
    failed: tuple[tuple[str, str], ...] = ()
    #: Paths still waiting to be seen stable.
    pending: int = 0


@dataclass(frozen=True)
class _Pending:
    stat: Stat
    polls: int


@dataclass(frozen=True)
class _PollOutcome:
    """What an unlocked pass computed, for ``_commit`` to apply or drop."""

    imported: FolderImport = FolderImport()
    pending: dict[str, _Pending] = dataclasses.field(default_factory=dict)
    #: The next ``seen``; ``None`` when the pass never scanned.
    seen: Optional[dict[str, str]] = None
    scanned_at: Optional[str] = None


def _advance(
    paths: tuple[Path, ...], seen: dict[str, str], pending: dict[str, _Pending]
) -> dict[str, _Pending]:
    """The pending map after this poll: +1 for an unchanged stat, else 1."""
    advanced: dict[str, _Pending] = {}
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        stat = _stat(path)
        if stat is None:
            continue
        previous = pending.get(key)
        polls = previous.polls + 1 if previous is not None and previous.stat == stat else 1
        advanced[key] = _Pending(stat=stat, polls=polls)
    return advanced


def _remembered(
    seen: dict[str, str],
    scanned: tuple[Path, ...],
    truncated: bool,
    pending: dict[str, _Pending],
    ready: list[str],
    result: FolderImport,
) -> dict[str, str]:
    """The next ``seen``: this poll's imports added, departed paths forgotten.

    A failure because the file vanished is retried if it comes back; any other
    failure (a corrupt file) is remembered so it is not retried every interval.
    A truncated scan forgets nothing — it did not see every path.
    """
    failed = {path for path, _ in result.failed}
    taken = {
        path: _seen_value(pending[path].stat)
        for path in ready
        if path not in failed or Path(path).is_file()
    }
    present = {str(path) for path in scanned}
    kept = seen if truncated else {p: v for p, v in seen.items() if p in present}
    return {**kept, **taken}


def validate_watch_folder(raw: str) -> str:
    """The resolved folder to watch, or ``ValueError`` with a user-facing sentence."""
    if not raw or not raw.strip():
        raise ValueError("Choose a folder to watch.")
    folder = Path(raw).expanduser()
    if not folder.is_absolute():
        raise ValueError(f"The watch folder must be an absolute path: {raw}")
    if not folder.is_dir():
        raise ValueError(f"The watch folder does not exist or is not a folder: {folder}")
    resolved = folder.resolve()
    home = capforge_home().expanduser().resolve()
    if resolved == home or home in resolved.parents:
        raise ValueError(
            f"The watch folder cannot be inside CapForge's own data folder ({home})."
        )
    return str(resolved)


def _now_iso() -> str:
    from backend.library.store import _now_iso as store_now  # local: store imports heavy deps

    return store_now()


def _stat(path: Path) -> Optional[Stat]:
    try:
        st = path.stat()
    except OSError:
        return None  # vanished between the scan and the stat — next tick decides
    return (st.st_size, st.st_mtime_ns)


def _seen_value(stat: Stat) -> str:
    return f"{stat[0]}-{stat[1]}"


def _read_config(path: Path) -> WatchConfig:
    """A missing file is "not watching"; an unreadable one is logged and ignored."""
    if not path.is_file():
        return WatchConfig()
    try:
        return WatchConfig.model_validate(fs.read_json(path))
    except (OSError, ValueError) as exc:
        logger.warning("Ignoring an unreadable watch folder file %s: %s", path, exc)
        return WatchConfig()


def _log_only(created: tuple[str, ...], relinked: tuple[str, ...]) -> None:
    logger.info("Watch folder: %d created, %d relinked", len(created), len(relinked))


class FolderWatcher:
    """Polls one folder and imports what settles there. Thread-safe."""

    def __init__(
        self,
        store: "LibraryStore",
        notify: Notify,
        *,
        interval_s: float = WATCH_INTERVAL_S,
    ) -> None:
        self.interval_s = interval_s
        self._store = store
        self._notify = notify
        self._file = Path(store.root) / WATCH_FILE
        # Guards config + pending + counters: set_folder/status run on request
        # threads, tick on ours. Never held across a scan or an import.
        self._lock = threading.RLock()
        # Held by tick() alone, for the whole pass: two passes never overlap.
        self._tick_lock = threading.Lock()
        self._config = _read_config(self._file)
        self._pending: dict[str, _Pending] = {}
        self._last_scan_at: Optional[str] = None
        self._imported_count = 0
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # --- state -----------------------------------------------------------------

    def status(self) -> WatchStatus:
        with self._lock:
            folder = self._config.folder
            last, count = self._last_scan_at, self._imported_count
        return WatchStatus(
            folder=folder,
            available=folder is not None and Path(folder).is_dir(),
            lastScanAt=last,
            importedCount=count,
        )

    def set_folder(self, folder: Optional[str]) -> WatchStatus:
        """Watch ``folder`` (validated) or stop with ``None``; wakes the loop.

        A different folder resets ``seen``, so choosing a folder imports what is
        already in it; choosing the same folder again changes nothing.
        """
        resolved = None if folder is None else validate_watch_folder(folder)
        with self._lock:
            if resolved != self._config.folder:
                self._config = WatchConfig(folder=resolved)
                self._pending = {}
                self._save()
                logger.info("Watch folder set to %s", resolved)
        self._wake.set()
        return self.status()

    def _save(self) -> None:
        fs.write_json_atomic(self._file, self._config.model_dump())

    # --- one poll --------------------------------------------------------------

    def tick(self) -> WatchTick:
        """Scan, advance the stability count, import what settled, notify.

        Three steps, so a pass over a slow drive never blocks ``status()`` or
        ``set_folder()`` (both take only ``_lock``): snapshot under the lock,
        scan + import outside it, commit under it — and only if the folder is
        still the one the pass scanned. ``_tick_lock`` keeps passes serial.
        """
        with self._tick_lock:
            with self._lock:
                folder, seen, pending = self._config.folder, self._config.seen, self._pending
            outcome = self._poll(folder, seen, pending)
            with self._lock:
                self._commit(folder, outcome)
        result = outcome.imported
        if result.created or result.relinked:
            self._notify(result.created, result.relinked)
        return WatchTick(
            created=result.created,
            relinked=result.relinked,
            failed=result.failed,
            pending=len(outcome.pending),
        )

    def _poll(
        self, folder: Optional[str], seen: dict[str, str], pending: dict[str, "_Pending"]
    ) -> "_PollOutcome":
        """The unlocked part of a tick; reads only its snapshot, writes no state."""
        if folder is None or not Path(folder).is_dir():
            return _PollOutcome()  # not watching, or the drive is unplugged: quiet
        try:
            scan = scan_media(Path(folder), recursive=True)
        except (NotADirectoryError, FileNotFoundError):
            logger.info("Watch folder vanished mid-scan: %s", folder)
            return _PollOutcome()
        scanned_at = _now_iso()
        advanced = _advance(scan.paths, seen, pending)
        ready = [path for path, entry in advanced.items() if entry.polls >= WATCH_STABLE_POLLS]
        imported = (
            import_paths(self._store, [Path(p) for p in ready], by=WATCH_ACTOR)
            if ready else FolderImport()
        )
        return _PollOutcome(
            imported=imported,
            pending={p: e for p, e in advanced.items() if p not in ready},
            seen=_remembered(seen, scan.paths, scan.truncated, advanced, ready, imported),
            scanned_at=scanned_at,
        )

    def _commit(self, folder: Optional[str], outcome: "_PollOutcome") -> None:
        """Apply a pass's state; the caller holds ``_lock``."""
        if self._config.folder != folder:
            logger.info(
                "Watch folder changed from %s during a poll; its state is dropped "
                "(%d record(s) it imported are kept)",
                folder, len(outcome.imported.created) + len(outcome.imported.relinked),
            )
            return
        self._pending = outcome.pending
        if outcome.scanned_at is not None:
            self._last_scan_at = outcome.scanned_at
        self._imported_count += len(outcome.imported.created) + len(outcome.imported.relinked)
        if outcome.seen is not None and outcome.seen != self._config.seen:
            self._config = self._config.model_copy(update={"seen": outcome.seen})
            self._save()

    # --- the thread --------------------------------------------------------------

    def run_once(self) -> Optional[WatchTick]:
        """The loop body: one tick; anything it raises is logged, never fatal."""
        try:
            return self.tick()
        except Exception:
            logger.error("Watch folder poll failed", exc_info=True)
            return None

    def _run(self) -> None:
        while not self._stopping.is_set():
            self.run_once()
            self._wake.wait(self.interval_s)
            self._wake.clear()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stopping.clear()
        self._thread = threading.Thread(target=self._run, name=WATCH_THREAD_NAME, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopping.set()
        self._wake.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(STOP_JOIN_TIMEOUT_S)
            if thread.is_alive():
                logger.warning("Watch folder thread did not stop within %.0fs", STOP_JOIN_TIMEOUT_S)


# --- one watcher per library root ------------------------------------------------

#: Keyed by the store's root, like ``router._STORES``. The first caller's
#: ``notify`` is kept — ``main.py``'s startup creates it before any request can.
_WATCHERS: dict[str, FolderWatcher] = {}
_WATCHERS_LOCK = threading.Lock()


def get_watcher(store: "LibraryStore", notify: Optional[Notify] = None) -> FolderWatcher:
    key = str(store.root)
    with _WATCHERS_LOCK:
        watcher = _WATCHERS.get(key)
        if watcher is None:
            watcher = FolderWatcher(store, notify or _log_only)
            _WATCHERS[key] = watcher
    return watcher


def stop_watchers() -> None:
    """Stop and forget every watcher (shutdown, and tests)."""
    with _WATCHERS_LOCK:
        watchers = list(_WATCHERS.values())
        _WATCHERS.clear()
    for watcher in watchers:
        watcher.stop()


def make_notify(loop: asyncio.AbstractEventLoop, broadcast: Broadcast) -> Notify:
    """A ``notify`` that hops from the watcher thread onto the server's loop."""

    def notify(created: tuple[str, ...], relinked: tuple[str, ...]) -> None:
        _send(loop, broadcast, {
            "type": LIBRARY_CHANGED_EVENT,
            "created": list(created),
            "relinked": list(relinked),
        })

    return notify


def make_updated_notify(loop: asyncio.AbstractEventLoop, broadcast: Broadcast) -> NotifyUpdated:
    """The poster pool's notify: the same event and hop, the id under ``updated``.

    Pool threads are not the event loop, so this is ``make_notify``'s hop, not a
    new event type — the list refetches either way.
    """

    def notify(video_id: str) -> None:
        _send(loop, broadcast, {
            "type": LIBRARY_CHANGED_EVENT,
            "created": [],
            "relinked": [],
            "updated": [video_id],
        })

    return notify


def _send(loop: asyncio.AbstractEventLoop, broadcast: Broadcast, payload: dict) -> None:
    """Schedule ``broadcast(payload)`` on ``loop`` from any thread.

    A closed loop (the server shut down while a pool task or poll was running)
    is logged, not raised — the caller is a background thread with no one to
    tell.
    """
    if loop.is_closed():
        logger.warning("library_changed not sent, the server loop is closed: %s", payload)
        return
    coro = broadcast(payload)
    try:
        future = asyncio.run_coroutine_threadsafe(coro, loop)
    except RuntimeError as exc:  # closed between the check and the call
        coro.close()
        logger.warning("library_changed not sent: %s", exc)
        return
    future.add_done_callback(_log_broadcast_failure)


def _log_broadcast_failure(future: "Future[Any]") -> None:
    if future.cancelled():
        return
    exc = future.exception()
    if exc is not None:
        logger.warning("library_changed broadcast failed: %s", exc, exc_info=exc)
