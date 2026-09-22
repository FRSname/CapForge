"""Equivalence + efficiency tests for the baked render's compositing path.

_render_baked decodes the source video to raw RGB, composites the caption
overlay onto each frame and pipes the result to the encoder. That per-frame
work is owned by _FrameSource.composite_batch(), which runs on a thread pool
(the baked twin of render_batch()). These tests drive the production method
directly, so a divergence from the straightforward serial composite fails
here rather than in a rendered video.
"""

from concurrent.futures import ThreadPoolExecutor

from PIL import Image

from backend.exporters.video_render import _FrameSource
import pytest

from backend.tests.test_render_dedup import (
    DURATION as DURATION_S,
    FPS,
    TOTAL_FRAMES,
    build_groups,
    load_font,
    make_config,
)

WIDTH, HEIGHT = 320, 180
FRAME_BYTES = WIDTH * HEIGHT * 3


def make_source(**overrides) -> tuple[_FrameSource, object, list[dict]]:
    config = make_config(**overrides)
    font = load_font(config)
    groups = build_groups()
    return _FrameSource(config, font, groups, TOTAL_FRAMES), config, groups


def fake_decoded_frame(fn: int) -> bytes:
    """A deterministic, non-uniform 'decoded' source frame.

    Varying per frame and per pixel catches a composite that silently reuses
    the wrong frame's pixels — a flat colour would not.
    """
    return bytes((fn * 7 + i * 13) % 256 for i in range(FRAME_BYTES))


def serial_composite(source: _FrameSource, fn: int, raw: bytes) -> bytes:
    """The straightforward serial composite, used as the reference."""
    src = Image.frombytes("RGB", (WIDTH, HEIGHT), raw)
    overlay = source.overlay_image(fn)
    if overlay is not None:
        src.paste(overlay, (0, 0), overlay)
    return src.tobytes()


def test_composite_batch_matches_serial_reference() -> None:
    """Parallel batched compositing must be byte-identical to the serial form."""
    batched, _, _ = make_source(animation="fade", word_transition="highlight")
    reference, _, _ = make_source(animation="fade", word_transition="highlight")

    raws = {fn: fake_decoded_frame(fn) for fn in range(TOTAL_FRAMES)}

    produced: dict[int, bytes] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for start in range(0, TOTAL_FRAMES, 16):
            chunk = range(start, min(start + 16, TOTAL_FRAMES))
            produced.update(
                batched.composite_batch(pool, [(fn, raws[fn]) for fn in chunk])
            )

    assert sorted(produced) == list(range(TOTAL_FRAMES))
    for fn in range(TOTAL_FRAMES):
        assert produced[fn] == serial_composite(reference, fn, raws[fn]), (
            f"frame {fn} (t={fn / FPS:.3f}s): batched composite differs from serial"
        )


def test_blank_frames_pass_decoded_bytes_through() -> None:
    """A frame with no caption must reuse the decoded bytes, not round-trip them.

    Compositing a fully transparent overlay is a no-op, so the RGB->PIL->RGB
    copy is pure waste. Identity (`is`) pins that the copy is really skipped.
    """
    source, _, _ = make_source()
    blank_frames = [
        fn for fn in range(TOTAL_FRAMES) if source.frame_group_indices[fn] is None
    ]
    assert blank_frames, "timeline has no gap frames to exercise"

    raws = {fn: fake_decoded_frame(fn) for fn in blank_frames}
    with ThreadPoolExecutor(max_workers=2) as pool:
        out = source.composite_batch(pool, [(fn, raws[fn]) for fn in blank_frames])

    for fn in blank_frames:
        assert out[fn] is raws[fn], f"frame {fn}: blank frame was copied, not passed through"


def test_captioned_frames_are_actually_composited() -> None:
    """Guard the fast path from swallowing frames that do have a caption."""
    source, _, _ = make_source()
    captioned = [
        fn for fn in range(TOTAL_FRAMES) if source.frame_group_indices[fn] is not None
    ]
    assert captioned, "timeline has no captioned frames to exercise"

    raws = {fn: fake_decoded_frame(fn) for fn in captioned}
    with ThreadPoolExecutor(max_workers=2) as pool:
        out = source.composite_batch(pool, [(fn, raws[fn]) for fn in captioned])

    assert any(out[fn] != raws[fn] for fn in captioned), (
        "no captioned frame changed — the overlay is not being composited"
    )
    for fn in captioned:
        assert len(out[fn]) == FRAME_BYTES


def test_overlay_image_reuses_precomputed_layout() -> None:
    """The baked path must share the per-group layout cache the overlay path uses.

    _render_frame's `precomp` holds the time-independent half of a frame (word
    measurements, RSVP line layout). Dropping it on continuously-animating
    frames re-measures every word each frame — up to 2.9x slower on a long
    RSVP reel.
    """
    source, _, _ = make_source(animation="fade", word_transition="bounce")

    animating = [
        fn
        for fn in range(TOTAL_FRAMES)
        if source.frame_group_indices[fn] is not None and source.frame_key(fn) is None
    ]
    assert animating, "timeline has no continuously-animating frames to exercise"

    fn = animating[0]
    gi = source.frame_group_indices[fn]
    assert source._precomp[gi] == {}, "precomp should start empty"

    source.overlay_image(fn)

    assert source._precomp[gi], (
        "overlay_image did not populate the group's precomp cache — it is "
        "re-measuring the layout on every animating frame"
    )


# ---------------------------------------------------------------------------
# Cancellation: the baked path runs a reader thread that feeds a bounded queue.
# Inside a long-lived server process, a cancelled render must not leave that
# thread blocked on a queue nobody drains — it would leak the thread and hold
# a batch of decoded frames (up to 128 MB) until the process exits.
# ---------------------------------------------------------------------------


def test_cancelled_render_releases_the_decoder_thread(tmp_path, monkeypatch) -> None:
    import threading

    from backend.exporters import ffmpeg_encode
    from backend.exporters.video_render import (
        RenderCancelled,
        cancel_render,
        _reset_cancel,
    )

    config = make_config()
    font = load_font(config)
    groups = build_groups()

    threads_before = set(threading.enumerate())

    class FakeStdout:
        """An endless decoder: always has another frame ready."""

        def __init__(self) -> None:
            self.closed_flag = False

        def read(self, n: int) -> bytes:
            return b"\x01" * n

        def close(self) -> None:
            self.closed_flag = True

    class FakeProc:
        def __init__(self) -> None:
            self.stdout = FakeStdout()
            self.stdin = self
            self.stderr = None
            self.returncode = 0
            self.killed = False

        def write(self, data: bytes) -> int:
            # Cancel partway through, the way the UI's Cancel button does.
            cancel_render()
            return len(data)

        def close(self) -> None:
            pass

        def wait(self, timeout=None) -> int:
            return 0

        def kill(self) -> None:
            self.killed = True

    procs = [FakeProc(), FakeProc()]
    monkeypatch.setattr(ffmpeg_encode.subprocess, "Popen", lambda *a, **k: procs.pop(0))
    monkeypatch.setattr(
        ffmpeg_encode.subprocess,
        "run",
        lambda *a, **k: type("R", (), {"stdout": '{"streams":[{"width":320,"height":180}]}'})(),
    )
    monkeypatch.setattr(ffmpeg_encode.threading, "Thread", threading.Thread)

    src = tmp_path / "src.mp4"
    src.write_bytes(b"not really a video")

    _reset_cancel()
    try:
        with pytest.raises(RenderCancelled):
            ffmpeg_encode._render_baked(
                "ffmpeg",
                str(src),
                str(tmp_path / "out.mp4"),
                config,
                groups,
                DURATION_S,
                font,
                lambda *a, **k: None,
            )
    finally:
        _reset_cancel()

    leaked = [
        t
        for t in threading.enumerate()
        if t not in threads_before and t.is_alive() and not t.name.startswith("Thread-drain")
    ]
    for t in leaked:
        t.join(timeout=5)
    still_alive = [t for t in leaked if t.is_alive()]
    assert not still_alive, (
        f"cancelled render leaked reader thread(s): {[t.name for t in still_alive]}"
    )
