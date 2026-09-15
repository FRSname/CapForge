"""Posters and duration — one JPEG frame per record, grabbed at import (v3.0 #6).

The card needs a picture and the record folder is where sidecars live
(``poster.jpg`` on the asset allowlist, ``paths.ASSET_NAME_RE``). The grab is
one ffmpeg call, written atomically (a dot-prefixed temp file in the same
folder — never servable — then ``os.replace``), grabbed whenever a record is
minted and backfilled at startup for records that predate this or whose grab
failed. Nothing here ever fails an import: a record
without a poster is a card with a placeholder.

The same pool task first probes the media's duration when the record has none
(``media_probe``, one ffprobe call), stores it through
``LibraryStore.set_probed_duration`` (no ``rev`` bump; a transcript's duration
always wins) and grabs the poster *at* that duration, so the frame lands a tenth
of the way in instead of at 1 s. When either landed it tells ``on_changed(id)``
— ``router`` wires that to the ``library_changed`` event's ``updated`` key.

Where it runs: ``LibraryStore`` calls ``start_grab`` from its ``on_created``
hook (wired once in ``router.get_store``), so *every* path that mints a record
— the create route, project import, the studio migration, the agent's
``load_video``/``transcribe`` — gets a poster without remembering to ask;
``start_backfill`` runs once at startup for records from before this or whose
grab failed. Both go through one single-worker pool, so ffmpeg never runs more
than once at a time and the caller never waits.

The library package stays import-light — ffmpeg is found through
``backend.exporters.video_render._find_ffmpeg`` lazily, and the finder is
injectable so the tests never need a real binary.
"""

from __future__ import annotations

import logging
import os
import subprocess
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Optional

from backend.library.errors import RecordNotFound

logger = logging.getLogger(__name__)

#: The asset name the route serves (must stay on ``paths.ASSET_NAME_RE``).
POSTER_NAME = "poster.jpg"
#: Card posters are small; 640 wide covers a 2× 260 px hero.
POSTER_WIDTH = 640
#: ffmpeg ``-q:v`` for MJPEG: 2 is best, 31 worst; 4 is ~90 KB at 640 wide.
POSTER_JPEG_QUALITY = 4
#: Where the frame is taken: a tenth of the way in, clamped — the opening
#: second is usually a title card or a black frame, and half a minute is
#: enough into any talk to see the speaker.
POSTER_AT_FRACTION = 0.1
POSTER_MIN_AT_S = 0.5
POSTER_MAX_AT_S = 30.0
#: With no duration on the record yet (a fresh import), one second in.
POSTER_UNKNOWN_DURATION_AT_S = 1.0
#: A single-frame decode should be near-instant; a stuck ffmpeg is killed.
GRAB_TIMEOUT_S = 30.0
#: The startup backfill is bounded so a huge library cannot pin ffmpeg for long.
BACKFILL_MAX_RECORDS = 200

FfmpegFinder = Callable[[], str]
#: ``probe(source_path) -> seconds | None`` — ``media_probe.probe_duration``.
Probe = Callable[[str], Optional[float]]
#: ``on_changed(video_id)`` — a record's probed duration or poster landed.
OnChanged = Callable[[str], None]


def poster_path(record_folder: Path) -> Path:
    return Path(record_folder) / POSTER_NAME


def has_poster(record_folder: Path) -> bool:
    return poster_path(record_folder).is_file()


def poster_time(duration: Optional[float]) -> float:
    """Seconds into the media to grab from, from the duration when known."""
    if duration is None or duration <= 0:
        return POSTER_UNKNOWN_DURATION_AT_S
    return min(max(duration * POSTER_AT_FRACTION, POSTER_MIN_AT_S), POSTER_MAX_AT_S)


def _default_ffmpeg() -> str:
    # Lazy: keeps ``backend.library`` importable without Pillow and the exporters.
    from backend.exporters.video_render import _find_ffmpeg

    return _find_ffmpeg()


def _default_probe(source: str) -> Optional[float]:
    # Resolved per call (like the ffmpeg finder) so the tests can swap it.
    from backend.library.media_probe import probe_duration

    return probe_duration(source)


def _run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
    """The one subprocess call — patched by the tests."""
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def _discard(tmp: Path) -> None:
    try:
        tmp.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Could not remove a poster temp file: %s", tmp, exc_info=True)


def grab_poster(source: Path, dest: Path, at_s: float, *, ffmpeg: str) -> bool:
    """One frame at ``at_s`` from ``source`` → ``dest``, atomically.

    False when ffmpeg produced nothing — an audio-only source, an unreadable
    file, a seek past the end — so the caller can retry at 0 or give up.
    """
    dest = Path(dest)
    tmp = dest.with_name(f".{dest.stem}-{uuid.uuid4().hex}.jpg")
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{at_s:.3f}", "-i", str(source),
        # Cap at POSTER_WIDTH without upscaling a narrower source. The quotes
        # are for ffmpeg's filtergraph parser, not a shell: a bare comma inside
        # min() would split the chain ("No such filter: 'iw):-2'").
        "-frames:v", "1", "-vf", f"scale=w='min({POSTER_WIDTH},iw)':h=-2",
        "-q:v", str(POSTER_JPEG_QUALITY), "-f", "image2", str(tmp),
    ]
    try:
        proc = _run(cmd, GRAB_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Poster grab failed for %s: %s", source, exc)
        _discard(tmp)
        return False
    if proc.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
        stderr = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
        logger.info("No poster frame at %.1fs for %s: %s", at_s, source, stderr[:200])
        _discard(tmp)
        return False
    os.replace(tmp, dest)
    return True


def ensure_poster(
    record_folder: Path,
    source_path: str,
    duration: Optional[float],
    *,
    find_ffmpeg: Optional[FfmpegFinder] = None,
) -> bool:
    """Grab the poster unless one exists. Never raises.

    A first grab at ``poster_time`` is retried at 0 s (a clip shorter than the
    minimum, a stream that only decodes from its first keyframe).
    """
    dest = poster_path(record_folder)
    if dest.is_file():
        return True
    source = Path(source_path)
    if not source.is_file():
        return False
    try:
        # Resolved per call, not bound as a default, so a test (or a future
        # settings override) can swap the finder after import.
        ffmpeg = (find_ffmpeg or _default_ffmpeg)()
    except FileNotFoundError as exc:
        logger.warning("Poster skipped, no ffmpeg: %s", exc)
        return False
    at = poster_time(duration)
    if grab_poster(source, dest, at, ffmpeg=ffmpeg):
        return True
    return at > 0 and grab_poster(source, dest, 0.0, ffmpeg=ffmpeg)


def ensure_poster_for(store: Any, record: Any, **kw: Any) -> bool:
    """``ensure_poster`` addressed by a record — the background-task entry."""
    from .paths import record_dir

    folder = record_dir(record.id, scratch=record.scratch, root=store.root)
    return ensure_poster(folder, record.sourcePath, record.duration, **kw)


def _tell(on_changed: Optional[OnChanged], video_id: str) -> None:
    """Report a change; a failing listener is logged, never fails the task."""
    if on_changed is None:
        return
    try:
        on_changed(video_id)
    except Exception:
        logger.warning("Media-changed listener failed for record %s", video_id, exc_info=True)


def _probe_into_store(store: Any, record: Any, probe: Optional[Probe]) -> bool:
    """Probe and store the duration; True only when the store took it."""
    seconds = (probe or _default_probe)(record.sourcePath)
    return seconds is not None and store.set_probed_duration(record.id, seconds)


def ensure_media_facts(
    store: Any,
    record: Any,
    *,
    probe: Optional[Probe] = None,
    find_ffmpeg: Optional[FfmpegFinder] = None,
    on_changed: Optional[OnChanged] = None,
) -> bool:
    """The per-record pool task: the duration when unknown, then the poster at it.

    The record is re-read first (it may have been relinked, promoted or removed
    since it was queued) and again after the probe, so a transcript duration
    that landed meanwhile is the one ``poster_time`` uses. True — and one
    ``on_changed`` call — when either the duration or the poster was stored.
    """
    try:
        current = store.get(record.id)
    except RecordNotFound:
        return False  # removed before the pool reached it
    if not Path(current.sourcePath).is_file():
        return False
    duration_set = False
    if current.duration is None:
        duration_set = _probe_into_store(store, current, probe)
        try:
            current = store.get(record.id)
        except RecordNotFound:
            return False
    poster_set = not store.has_poster(current) and ensure_poster_for(
        store, current, find_ffmpeg=find_ffmpeg
    )
    changed = bool(duration_set or poster_set)
    if changed:
        _tell(on_changed, current.id)
    return changed


def backfill_posters(
    store: Any,
    *,
    limit: int = BACKFILL_MAX_RECORDS,
    find_ffmpeg: Optional[FfmpegFinder] = None,
    probe: Optional[Probe] = None,
    on_changed: Optional[OnChanged] = None,
) -> int:
    """Startup pass: a duration and a poster for every real record missing one.

    Bounded by ``limit`` records examined; returns how many changed. Records
    whose media is gone are skipped (nothing to read) and scratch records are
    not listed at all.
    """
    changed = 0
    examined = 0
    for summary in store.list():
        if examined >= limit:
            break
        if summary.get("missing_media"):
            continue
        if summary.get("poster") and summary.get("duration") is not None:
            continue
        examined += 1
        try:
            record = store.get(summary["id"])
        except RecordNotFound:
            continue  # removed between the list and now — nothing to do
        if ensure_media_facts(
            store, record, probe=probe, find_ffmpeg=find_ffmpeg, on_changed=on_changed
        ):
            changed += 1
    return changed


# --- scheduling ------------------------------------------------------------
# One worker: a poster is a single frame and a probe a header read, and two
# ffmpeg processes racing a transcription for the disk is worse than a card
# that fills in a second later. ffprobe runs here too, never on a request thread.

_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="poster")


def _guarded(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run a poster task; a failure is logged, never lost inside a Future."""
    try:
        return fn(*args, **kwargs)
    except Exception:
        logger.error("Poster task %s failed", getattr(fn, "__name__", fn), exc_info=True)
        return None


def start_grab(store: Any, record: Any, on_changed: Optional[OnChanged] = None) -> Future:
    """Probe + grab for ``record`` off the calling thread — the ``on_created`` hook."""
    return _POOL.submit(_guarded, ensure_media_facts, store, record, on_changed=on_changed)


def start_backfill(store: Any, on_changed: Optional[OnChanged] = None) -> Future:
    """The startup pass, off the event loop; startup never waits on ffmpeg."""
    return _POOL.submit(_guarded, backfill_posters, store, on_changed=on_changed)
