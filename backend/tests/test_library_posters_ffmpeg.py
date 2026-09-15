"""Posters (and the import-time duration probe) against the real ffmpeg binaries (v3.0 #6).

``test_library_posters.py`` replaces the subprocess call, so it can only pin the
argv it expects — and it pinned a ``-vf`` that ffmpeg's filtergraph parser
rejects (a bare comma inside ``min(640,iw)`` splits the filter chain), which
failed every grab in the app while the suite stayed green. This file hands the
argv to ffmpeg itself. Import-light on purpose (no FastAPI), so it runs in the
CI job that installs ffmpeg; skipped where there is no binary.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from backend.library import posters

FFMPEG = shutil.which("ffmpeg")

pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not installed")

#: Long enough that the default grab time (a tenth in, clamped to 0.5 s) is
#: inside the clip.
CLIP_SECONDS = 2
WIDE = (1280, 720)
NARROW = (320, 180)


def clip(tmp_path: Path, size: tuple[int, int]) -> Path:
    """A tiny synthetic video of ``size``, made by ffmpeg's lavfi source."""
    out = tmp_path / f"clip-{size[0]}x{size[1]}.mp4"
    subprocess.run(
        [
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"testsrc=size={size[0]}x{size[1]}:rate=10:duration={CLIP_SECONDS}",
            "-pix_fmt", "yuv420p", str(out),
        ],
        check=True,
        capture_output=True,
        timeout=posters.GRAB_TIMEOUT_S,
    )
    return out


def test_a_wide_source_is_capped_at_the_poster_width(tmp_path: Path) -> None:
    dest = tmp_path / posters.POSTER_NAME
    assert posters.grab_poster(clip(tmp_path, WIDE), dest, 0.5, ffmpeg=FFMPEG) is True
    with Image.open(dest) as img:
        assert img.format == "JPEG"
        assert img.size == (posters.POSTER_WIDTH, 360)


def test_a_narrow_source_is_never_upscaled(tmp_path: Path) -> None:
    dest = tmp_path / posters.POSTER_NAME
    assert posters.grab_poster(clip(tmp_path, NARROW), dest, 0.5, ffmpeg=FFMPEG) is True
    with Image.open(dest) as img:
        assert img.size == NARROW


def test_ensure_poster_end_to_end(tmp_path: Path) -> None:
    folder = tmp_path / "record"
    folder.mkdir()
    source = clip(tmp_path, WIDE)
    assert posters.ensure_poster(folder, str(source), float(CLIP_SECONDS), find_ffmpeg=lambda: FFMPEG)
    assert posters.has_poster(folder)
    # Only the poster — no dot-prefixed temp file left behind.
    assert [p.name for p in folder.iterdir()] == [posters.POSTER_NAME]


FFPROBE = shutil.which("ffprobe")


@pytest.mark.skipif(FFPROBE is None, reason="ffprobe not installed")
def test_probe_duration_reads_a_real_clip(tmp_path: Path) -> None:
    """The duration a fresh card shows, from the real ffprobe argv."""
    from backend.library import media_probe

    seconds = media_probe.probe_duration(clip(tmp_path, NARROW), find_ffprobe=lambda: FFPROBE)
    assert seconds == pytest.approx(float(CLIP_SECONDS), abs=0.1)


# --- thumbnail frames (publish-editors Part A) -----------------------------------

FULL_HD = (1920, 1080)
VERTICAL = (1080, 1920)


def grab_thumbnail(tmp_path: Path, size: tuple[int, int]) -> Path:
    from backend.library import frames

    folder = tmp_path / "thumbnails"
    outcome = frames.grab_frame_file(clip(tmp_path, size), folder, 0.5, ffmpeg=FFMPEG)
    assert isinstance(outcome, frames.GrabbedFrame), outcome
    written = folder / outcome.name
    assert [p.name for p in folder.iterdir()] == [outcome.name]
    assert written.stat().st_size <= frames.THUMBNAIL_MAX_BYTES
    return written


def test_a_16_9_source_yields_a_1280_wide_frame(tmp_path: Path) -> None:
    with Image.open(grab_thumbnail(tmp_path, FULL_HD)) as img:
        assert img.format == "JPEG"
        assert img.size == (1280, 720)


def test_a_9_16_source_yields_a_720_wide_vertical_frame(tmp_path: Path) -> None:
    with Image.open(grab_thumbnail(tmp_path, VERTICAL)) as img:
        assert img.size == (720, 1280)


def test_a_small_source_frame_is_never_upscaled(tmp_path: Path) -> None:
    with Image.open(grab_thumbnail(tmp_path, NARROW)) as img:
        assert img.size == NARROW
