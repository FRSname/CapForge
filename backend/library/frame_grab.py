"""One JPEG frame out of a video with ffmpeg — shared by posters and thumbnail frames.

``posters.py`` grabs a small card poster and ``frames.py`` grabs thumbnail
candidates; both are this one call with a different size and quality. The frame
is written atomically: ffmpeg writes a dot-prefixed temp file in the destination
folder (never a servable asset name, ``paths.ASSET_NAME_RE``) and a successful
grab is ``os.replace``d into place, so a failed or killed grab leaves nothing.

Nothing here raises for a failed grab — no binary, a non-zero exit, a timeout
or an empty output are all ``False`` and a log line; the caller decides whether
that is a placeholder card or a ``failed`` frame. It never runs under the
store's write lock (``locking.py``): the callers grab first and write after.

The library package stays import-light: ffmpeg is found through
``backend.exporters.video_render._find_ffmpeg`` lazily, and both the finder and
the runner are resolved per call so the tests never need a real binary.
"""

from __future__ import annotations

import logging
import os
import subprocess
import uuid
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

#: A single-frame decode should be near-instant; a stuck ffmpeg is killed.
GRAB_TIMEOUT_S = 30.0
#: How much of ffmpeg's stderr a log line quotes.
LOG_EXCERPT_CHARS = 200

#: ``run(argv, timeout)`` — ``subprocess.run`` in production, a fake in tests.
Runner = Callable[[list[str], float], subprocess.CompletedProcess]


def default_ffmpeg() -> str:
    """The ffmpeg the exporters use. Lazy: the exporters pull in Pillow."""
    from backend.exporters.video_render import _find_ffmpeg

    return _find_ffmpeg()


def _run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
    """The one subprocess call — replaced by the tests."""
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def scale_filter(max_width: int, max_height: Optional[int] = None) -> str:
    """The ``-vf`` value: a cap that never upscales a smaller source.

    Width only keeps the aspect ratio with an even height (the poster). With a
    height too, the frame fits inside the ``max_width`` × ``max_height`` box, so
    a 9:16 source stays vertical. The quotes are for ffmpeg's filtergraph
    parser, not a shell: a bare comma inside ``min()`` would split the chain.
    """
    if max_height is None:
        return f"scale=w='min({max_width},iw)':h=-2"
    return (
        f"scale=w='min({max_width},iw)':h='min({max_height},ih)'"
        ":force_original_aspect_ratio=decrease"
    )


def discard(path: Path) -> None:
    """Remove a temp or refused frame; a file already gone is fine, anything
    else is logged (the frame is unreferenced either way)."""
    try:
        Path(path).unlink()
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Could not remove a frame file: %s", path, exc_info=True)


def grab_frame(
    source: Path,
    dest: Path,
    at_s: float,
    *,
    ffmpeg: str,
    max_width: int,
    quality: int,
    max_height: Optional[int] = None,
    run: Optional[Runner] = None,
) -> bool:
    """One frame at ``at_s`` from ``source`` → ``dest``, atomically.

    ``quality`` is ffmpeg's MJPEG ``-q:v`` (2 best, 31 worst). False when ffmpeg
    produced nothing — an audio-only source, an unreadable file, a seek past the
    end — and then no file is left behind.
    """
    dest = Path(dest)
    tmp = dest.with_name(f".{dest.stem}-{uuid.uuid4().hex}.jpg")
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{at_s:.3f}", "-i", str(source),
        "-frames:v", "1", "-vf", scale_filter(max_width, max_height),
        "-q:v", str(quality), "-f", "image2", str(tmp),
    ]
    try:
        proc = (run or _run)(cmd, GRAB_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Frame grab failed for %s: %s", source, exc)
        discard(tmp)
        return False
    if proc.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
        stderr = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
        logger.info(
            "No frame at %.3fs for %s: %s", at_s, source, stderr[:LOG_EXCERPT_CHARS]
        )
        discard(tmp)
        return False
    os.replace(tmp, dest)
    return True
