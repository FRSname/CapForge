"""Posters against the real ffmpeg binary (v3.0 #6).

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
