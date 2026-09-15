"""Thumbnail frames — still JPEGs a cover is picked from (publish-editors Part A).

``grab_frames`` and ``frame_upload.upload_frame`` (an image the user chose,
which also becomes the cover) are the only ways a name enters
``thumbnail.candidates``, and ``delete_frame`` the only way one leaves: candidates are *files* in the record
folder (``thumbnails/<32-hex>.jpg``, on the asset allowlist), so only the code
that creates and deletes the files may change the list. A ``PATCH`` that
changes it is refused (``validate_media.candidates_findings``).

The order of a grab is what keeps the store responsive: the times are checked,
then ffmpeg runs once per time — sequentially, **outside** the store's write
lock — and only the append is locked (``store_frames``), where the candidate
limit is checked again against a fresh read. A frame that could not be kept
is reported in ``failed`` and the rest still land; a write that fails removes
the files it grabbed, so nothing is left unreferenced.

Frames are app-generated sidecars, not user media, so deleting one deletes its
file ("the backend never deletes a user file" is about media and records).
"""

from __future__ import annotations

import logging
import math
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional, Sequence, Union

from backend.library import frame_grab, fs
from backend.library.errors import FrameNotFound, FramesRefused, ScratchReadOnly
from backend.library.paths import THUMBNAILS_DIR, record_dir
from backend.library.schemas import VideoRecord

__all__ = [
    "FRAME_JPEG_QUALITY",
    "FRAME_MAX_HEIGHT",
    "FRAME_MAX_WIDTH",
    "FRAME_NAME_RE",
    "FRAME_RETRY_JPEG_QUALITY",
    "FRAMES_PER_REQUEST",
    "MAX_CANDIDATES",
    "THUMBNAIL_MAX_BYTES",
    "THUMBNAILS_DIR",
    "FailedFrame",
    "FramesResult",
    "GrabbedFrame",
    "check_room",
    "check_times",
    "delete_frame",
    "grab_frame_file",
    "grab_frames",
    "known_duration",
    "require_editable",
]

logger = logging.getLogger(__name__)

#: YouTube's thumbnail is 1280×720; the cap is a 1280 box, so a 16:9 source is
#: 1280 wide, a 9:16 source 720 wide and vertical, and nothing is upscaled.
FRAME_MAX_WIDTH = 1280
FRAME_MAX_HEIGHT = FRAME_MAX_WIDTH
#: ffmpeg ``-q:v`` for MJPEG: 2 is best, 31 worst.
FRAME_JPEG_QUALITY = 3
#: The one re-encode a frame over ``THUMBNAIL_MAX_BYTES`` gets.
FRAME_RETRY_JPEG_QUALITY = 8
#: YouTube refuses a custom thumbnail over 2 MB.
THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024
FRAMES_PER_REQUEST = 8
MAX_CANDIDATES = 24

FRAME_SUFFIX = ".jpg"
FRAME_NAME_RE = re.compile(r"^[0-9a-f]{32}\.jpg$")
#: A grabbed frame waits under this dot-prefixed name (never servable) until
#: its size is known to be within the limit.
STAGING_PREFIX = ".staging-"

MEDIA_MISSING_REASON = "The source media is missing: {path}"
NO_FFMPEG_REASON = "ffmpeg is not available: {error}"
NO_FRAME_REASON = "ffmpeg produced no frame at {at:g}s"
OVERSIZE_REASON = (
    "The frame at {at:g}s is {size} bytes even at a lower quality; "
    "YouTube allows {limit} bytes"
)

FfmpegFinder = Callable[[], str]


@dataclass(frozen=True)
class GrabbedFrame:
    time_s: float
    name: str


@dataclass(frozen=True)
class FailedFrame:
    time_s: float
    reason: str


@dataclass(frozen=True)
class FramesResult:
    """What a grab did; ``record`` is the stored record after it (unchanged, and
    at the same ``rev``, when nothing landed)."""

    frames: tuple[GrabbedFrame, ...]
    failed: tuple[FailedFrame, ...]
    record: VideoRecord


# --- checks ---------------------------------------------------------------------

def require_editable(record: VideoRecord) -> None:
    """A scratch record's dossier is read-only until it is promoted (409)."""
    if record.scratch:
        raise ScratchReadOnly(
            f"Record {record.id} is scratch; promote it before changing its thumbnail"
        )


def known_duration(store: Any, record: VideoRecord) -> Optional[float]:
    """The video's length: the record's own value, else the transcript's."""
    if record.duration is not None:
        return record.duration
    transcript = store.get_transcript(record.id, segments_only=True)
    return transcript.get("duration") if transcript else None


def check_room(stored: int, adding: int) -> None:
    """Refuse a grab that would take the record past ``MAX_CANDIDATES``."""
    if stored + adding > MAX_CANDIDATES:
        raise FramesRefused(
            f"The record has {stored} of {MAX_CANDIDATES} thumbnail frames; "
            f"{adding} more would pass the limit. Delete a frame first."
        )


def check_times(times: Any, *, duration: Optional[float], stored: int) -> tuple[float, ...]:
    """The requested times as floats, or ``FramesRefused`` saying what is wrong.

    ``times`` is external data (a request body, an agent's list), so every entry
    is checked: a finite number of seconds, not negative, and not past the end
    when the duration is known.
    """
    if not isinstance(times, (list, tuple)) or not times:
        raise FramesRefused("Pass at least one time, in seconds, to grab a frame at.")
    if len(times) > FRAMES_PER_REQUEST:
        raise FramesRefused(
            f"At most {FRAMES_PER_REQUEST} frames can be grabbed per request; "
            f"{len(times)} times were sent."
        )
    checked = tuple(_check_time(value, duration) for value in times)
    check_room(stored, len(checked))
    return checked


def _check_time(value: Any, duration: Optional[float]) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise FramesRefused(f"{value!r} is not a time in seconds.")
    if value < 0:
        raise FramesRefused(f"A frame time cannot be negative; got {value:g}s.")
    if duration is not None and value > duration:
        raise FramesRefused(
            f"{value:g}s is past the end of the video at {duration:g}s."
        )
    return float(value)


# --- one frame ------------------------------------------------------------------

def grab_frame_file(
    source: Path,
    folder: Path,
    at_s: float,
    *,
    ffmpeg: str,
    run: Optional[frame_grab.Runner] = None,
) -> Union[GrabbedFrame, FailedFrame]:
    """Grab one thumbnail frame into ``folder`` under a fresh name.

    A frame over ``THUMBNAIL_MAX_BYTES`` is re-encoded once at
    ``FRAME_RETRY_JPEG_QUALITY``; still over, it is a ``FailedFrame``. Only a
    kept frame ever appears under its final name.
    """
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{FRAME_SUFFIX}"
    staging = folder / f"{STAGING_PREFIX}{name}"
    size = 0
    for quality in (FRAME_JPEG_QUALITY, FRAME_RETRY_JPEG_QUALITY):
        grabbed = frame_grab.grab_frame(
            source, staging, at_s, ffmpeg=ffmpeg, max_width=FRAME_MAX_WIDTH,
            max_height=FRAME_MAX_HEIGHT, quality=quality, run=run,
        )
        if not grabbed:
            frame_grab.discard(staging)
            return FailedFrame(at_s, NO_FRAME_REASON.format(at=at_s))
        size = staging.stat().st_size
        if size <= THUMBNAIL_MAX_BYTES:
            fs.replace_with_retry(staging, folder / name)
            return GrabbedFrame(at_s, name)
        logger.info("Frame at %.3fs is %d bytes at -q:v %d", at_s, size, quality)
    frame_grab.discard(staging)
    return FailedFrame(
        at_s, OVERSIZE_REASON.format(at=at_s, size=size, limit=THUMBNAIL_MAX_BYTES)
    )


# --- the record -------------------------------------------------------------------

def _thumbnails(store: Any, record: VideoRecord) -> Path:
    return record_dir(record.id, scratch=record.scratch, root=store.root) / THUMBNAILS_DIR


def _all_failed(record: VideoRecord, times: Sequence[float], reason: str) -> FramesResult:
    return FramesResult((), tuple(FailedFrame(at, reason) for at in times), record)


def grab_frames(
    store: Any,
    video_id: str,
    times: Any,
    *,
    by: str,
    find_ffmpeg: Optional[FfmpegFinder] = None,
    run: Optional[frame_grab.Runner] = None,
) -> FramesResult:
    """Grab a frame at each time and append the kept ones to the candidates.

    Raises ``RecordNotFound``, ``ScratchReadOnly`` and ``FramesRefused`` (bad
    times, or no room) before ffmpeg runs. Missing media or no ffmpeg fail every
    time without a write. ``find_ffmpeg`` and ``run`` are test seams.
    """
    record = store.get(video_id)
    require_editable(record)
    wanted = check_times(
        times, duration=known_duration(store, record),
        stored=len(record.thumbnail.candidates),
    )
    source = Path(record.sourcePath)
    if not source.is_file():
        return _all_failed(record, wanted, MEDIA_MISSING_REASON.format(path=record.sourcePath))
    try:
        ffmpeg = (find_ffmpeg or frame_grab.default_ffmpeg)()
    except (FileNotFoundError, ImportError) as exc:
        logger.warning("Frame grab skipped, no ffmpeg: %s", exc)
        return _all_failed(record, wanted, NO_FFMPEG_REASON.format(error=exc))

    folder = _thumbnails(store, record)
    outcomes = [grab_frame_file(source, folder, at, ffmpeg=ffmpeg, run=run) for at in wanted]
    grabbed = tuple(o for o in outcomes if isinstance(o, GrabbedFrame))
    failed = tuple(o for o in outcomes if isinstance(o, FailedFrame))
    if not grabbed:
        return FramesResult((), failed, record)
    try:
        updated = store.add_thumbnail_candidates(
            video_id, [frame.name for frame in grabbed], by=by
        )
    except Exception:
        for frame in grabbed:  # never leave a file no record points at
            frame_grab.discard(folder / frame.name)
        raise
    return FramesResult(grabbed, failed, updated)


def delete_frame(store: Any, video_id: str, name: str, *, by: str) -> VideoRecord:
    """Remove one candidate (and the cover, if it was that frame), then its file.

    ``RecordNotFound`` for an unknown record, ``FrameNotFound`` for a name that
    is not one of its candidates — including any name that is not a frame name,
    so a path can never reach the filesystem.
    """
    if not isinstance(name, str) or not FRAME_NAME_RE.match(name):
        store.get(video_id)  # an unknown record answers as one
        raise FrameNotFound(f"Record {video_id} has no thumbnail frame {name!r}")
    record = store.remove_thumbnail_candidate(video_id, name, by=by)
    frame_grab.discard(_thumbnails(store, record) / name)
    return record
