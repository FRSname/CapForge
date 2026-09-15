"""Duration at import — one ffprobe call, so a fresh library card knows its length.

``VideoRecord.duration`` used to arrive only with the first project PUT (from the
transcript), so a card imported a moment ago showed ``--:--``. The poster pool
task (``posters.ensure_media_facts``) now asks this module first and stores the
answer through ``LibraryStore.set_probed_duration``, which never overrides a
transcript-derived duration.

**Nothing here raises.** No binary, a non-zero exit, a timeout, unparsable
output, ``N/A`` (a container with no duration) or a non-finite or non-positive
number all come back as ``None`` and a log line: a record without a duration
is a card that shows ``--:--``, never a failed import.

ffprobe is looked for the way the rest of the backend does it: the bundled
binary Electron injects (``CAPFORGE_FFPROBE``), then the file beside ffmpeg
(``video_render._find_ffmpeg``, imported lazily so ``backend.library`` stays
import-light), then ``PATH``. The finder and the runner are injectable and
resolved per call, so the tests never need a real binary.
"""

from __future__ import annotations

import logging
import math
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional, Union

logger = logging.getLogger(__name__)

#: Reading a container's duration is near-instant; a stuck ffprobe (a network
#: share gone quiet) is killed rather than holding the single poster worker.
PROBE_TIMEOUT_S = 10.0
#: The bundled binary Electron injects (``electron/python-manager.js``).
FFPROBE_ENV = "CAPFORGE_FFPROBE"
FFPROBE_NAME = "ffprobe"
FFMPEG_NAME = "ffmpeg"
#: How much of ffprobe's stdout/stderr a log line quotes.
LOG_EXCERPT_CHARS = 200

Finder = Callable[[], str]
Which = Callable[[str], Optional[str]]
Runner = Callable[[list[str], float], subprocess.CompletedProcess]
PathLike = Union[str, os.PathLike]


def _default_ffmpeg() -> str:
    # Lazy: the exporters pull in Pillow; the library package must not.
    from backend.exporters.video_render import _find_ffmpeg

    return _find_ffmpeg()


def _ffmpeg_or_none(find_ffmpeg: Optional[Finder]) -> Optional[Path]:
    try:
        return Path((find_ffmpeg or _default_ffmpeg)())
    except (FileNotFoundError, ImportError) as exc:
        logger.debug("No ffmpeg to find ffprobe beside: %s", exc)
        return None


def find_ffprobe(*, find_ffmpeg: Optional[Finder] = None, which: Which = shutil.which) -> str:
    """The ffprobe to run: bundled, else beside ffmpeg, else on ``PATH``.

    Only the *file name* is rewritten (``ffmpeg.exe`` → ``ffprobe.exe``), so a
    folder that happens to be called ``ffmpeg-7.0`` is left alone.
    """
    bundled = os.environ.get(FFPROBE_ENV)
    if bundled and os.path.isfile(bundled):
        return bundled
    ffmpeg = _ffmpeg_or_none(find_ffmpeg)
    if ffmpeg is not None:
        sibling = ffmpeg.with_name(ffmpeg.name.replace(FFMPEG_NAME, FFPROBE_NAME))
        if sibling != ffmpeg and sibling.is_file():
            return str(sibling)
    on_path = which(FFPROBE_NAME)
    if on_path:
        return on_path
    raise FileNotFoundError(
        f"ffprobe not found ({FFPROBE_ENV}, beside ffmpeg, or on PATH)"
    )


def _default_ffprobe() -> str:
    return find_ffprobe()


def _run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
    """The one subprocess call — replaced by the tests."""
    return subprocess.run(
        cmd,
        capture_output=True,
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _excerpt(output: Union[bytes, str, None]) -> str:
    if isinstance(output, bytes):
        output = output.decode("utf-8", errors="replace")
    return (output or "").strip()[:LOG_EXCERPT_CHARS]


def parse_duration(stdout: Union[bytes, str, None]) -> Optional[float]:
    """ffprobe's bare ``format=duration`` value, or ``None`` when it is unusable."""
    try:
        text = stdout.decode("ascii") if isinstance(stdout, bytes) else (stdout or "")
        value = float(text.strip())
    except (UnicodeDecodeError, ValueError):
        return None
    return value if math.isfinite(value) and value > 0 else None


def probe_duration(
    source: PathLike,
    *,
    find_ffprobe: Optional[Finder] = None,
    run: Optional[Runner] = None,
) -> Optional[float]:
    """Seconds of media in ``source``, or ``None`` (logged). Never raises."""
    try:
        ffprobe = (find_ffprobe or _default_ffprobe)()
    except FileNotFoundError as exc:
        logger.warning("Duration probe skipped, no ffprobe: %s", exc)
        return None
    cmd = [
        ffprobe, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(source),
    ]
    try:
        proc = (run or _run)(cmd, PROBE_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Duration probe failed for %s: %s", source, exc)
        return None
    if proc.returncode != 0:
        logger.info(
            "No duration for %s: ffprobe exited %s: %s",
            source, proc.returncode, _excerpt(proc.stderr),
        )
        return None
    seconds = parse_duration(proc.stdout)
    if seconds is None:
        logger.info("No usable duration for %s: ffprobe said %r", source, _excerpt(proc.stdout))
    return seconds
