"""The one-frame ffmpeg grab shared by posters and thumbnail frames (``frame_grab.py``).

ffmpeg is never run here — the runner is replaced by a writer that behaves like
it. ``test_library_posters_ffmpeg.py`` hands the same argv to the real binary.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Callable

import pytest

from backend.library import frame_grab

FAKE_FFMPEG = "/fake/ffmpeg"
JPEG_BYTES = b"\xff\xd8\xff\xe0" * 4
BOX = 1280
QUALITY = 3


def runner(
    calls: list[list[str]], *, code: int = 0, payload: bytes = JPEG_BYTES
) -> Callable[[list[str], float], subprocess.CompletedProcess]:
    """A stand-in for ``subprocess.run``: writes ``payload`` to the output path."""

    def run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
        calls.append(cmd)
        Path(cmd[-1]).write_bytes(payload)
        return subprocess.CompletedProcess(cmd, code, b"", b"boom")

    return run


def source(tmp_path: Path) -> Path:
    path = tmp_path / "talk.mp4"
    path.write_bytes(b"media" * 100)
    return path


def test_a_width_only_cap_is_the_poster_filter() -> None:
    assert frame_grab.scale_filter(640) == "scale=w='min(640,iw)':h=-2"


def test_a_box_cap_fits_both_edges_without_upscaling() -> None:
    assert frame_grab.scale_filter(BOX, BOX) == (
        f"scale=w='min({BOX},iw)':h='min({BOX},ih)':force_original_aspect_ratio=decrease"
    )


def test_grab_frame_writes_atomically_with_the_requested_format(tmp_path: Path) -> None:
    calls: list[list[str]] = []
    dest = tmp_path / "frame.jpg"

    ok = frame_grab.grab_frame(
        source(tmp_path), dest, 12.5, ffmpeg=FAKE_FFMPEG,
        max_width=BOX, max_height=BOX, quality=QUALITY, run=runner(calls),
    )

    assert ok is True
    assert dest.read_bytes() == JPEG_BYTES
    cmd = calls[0]
    assert cmd[0] == FAKE_FFMPEG
    assert cmd[cmd.index("-ss") + 1] == "12.500"
    assert cmd[cmd.index("-frames:v") + 1] == "1"
    assert cmd[cmd.index("-q:v") + 1] == str(QUALITY)
    assert cmd[cmd.index("-vf") + 1] == frame_grab.scale_filter(BOX, BOX)
    # The temp name is dot-prefixed (never a servable asset name) and gone after.
    assert Path(cmd[-1]).name.startswith(".frame-")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["frame.jpg", "talk.mp4"]


@pytest.mark.parametrize("code,payload", [(1, JPEG_BYTES), (0, b""), (1, b"")])
def test_a_failed_grab_leaves_nothing_behind(tmp_path: Path, code: int, payload: bytes) -> None:
    calls: list[list[str]] = []
    dest = tmp_path / "frame.jpg"

    ok = frame_grab.grab_frame(
        source(tmp_path), dest, 1.0, ffmpeg=FAKE_FFMPEG,
        max_width=BOX, quality=QUALITY, run=runner(calls, code=code, payload=payload),
    )

    assert ok is False
    assert [p.name for p in tmp_path.iterdir()] == ["talk.mp4"]


@pytest.mark.parametrize("error", [
    FileNotFoundError("/fake/ffmpeg"),
    subprocess.TimeoutExpired(["ffmpeg"], 30.0),
])
def test_a_runner_that_raises_is_a_failed_grab(tmp_path: Path, error: Exception) -> None:
    def run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
        raise error

    ok = frame_grab.grab_frame(
        source(tmp_path), tmp_path / "frame.jpg", 1.0, ffmpeg=FAKE_FFMPEG,
        max_width=BOX, quality=QUALITY, run=run,
    )

    assert ok is False
    assert [p.name for p in tmp_path.iterdir()] == ["talk.mp4"]


def test_the_default_runner_is_resolved_per_call(tmp_path: Path, monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(frame_grab, "_run", runner(calls))

    assert frame_grab.grab_frame(
        source(tmp_path), tmp_path / "frame.jpg", 0.0, ffmpeg=FAKE_FFMPEG,
        max_width=BOX, quality=QUALITY,
    )
    assert len(calls) == 1
