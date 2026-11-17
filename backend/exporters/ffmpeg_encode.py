"""CapForge — FFmpeg encode & mux logic for subtitle video export.

Extracted from video_render.py (Phase 5B refactor): owns ffmpeg argument
construction and the encode/mux subprocess pipelines for the overlay
(WebM/MOV/MP4) and baked-MP4 export branches.

Pixel rendering (`_render_frame` and every helper it calls) is NOT here — it
stays in video_render.py, which is the parity source of truth pinned by the
golden-frame tests. This module only pipes already-rendered RGBA frame bytes
(via `_FrameSource`) into ffmpeg and builds the command lines/filter chains.

See CLAUDE.md "Overlay MOV premultiplied alpha convention" and "BT.709 color
tagging convention" for the encode-side invariants preserved here verbatim —
in particular the premultiply-first `-vf` ordering in the MOV branch and the
BT.709 matrix+tags coupling, which must always change together.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Optional

from PIL import ImageFont

from backend.exporters.video_render import _FrameSource, _check_cancel
from backend.models.schemas import JobStatus, ProgressUpdate, VideoRenderConfig

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Video encoder
# ---------------------------------------------------------------------------

# All user-facing video encodes (overlay MP4/MOV, baked MP4 — never the
# straight-alpha WebM branch, which is untagged by VP9/browser convention)
# force the RGB->YUV conversion to BT.709 limited range AND tag the output
# streams to match, so NLEs (Premiere in particular) stop guessing the
# range/matrix and mis-rendering colors/alpha. ``scale=out_color_matrix=...``
# must be paired with the matching output tags below, or a matrix-without-tags
# (or tags-without-matrix) mismatch reintroduces a subtle hue/contrast shift.
_BT709_SCALE_FILTER = "scale=out_color_matrix=bt709"
_BT709_TAGS: list[str] = [
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-color_range", "tv",
]

# The baked path holds a batch of decoded frames in memory while the pool
# composites them. Bound that batch by BYTES, not frame count: an RGB frame is
# 6.2 MB at 1080p but 24.9 MB at 4K, so a frame-count batch that is
# comfortable at 1080p would hold ~1 GB of raw + composited frames at 4K.
_BAKED_BATCH_MAX_BYTES = 256 * 1024 * 1024


def _render_overlay(
    ffmpeg_path: str,
    output_path: str,
    config: VideoRenderConfig,
    groups: list[dict],
    duration: float,
    font: ImageFont.FreeTypeFont,
    report: Callable[[str, float], None],
) -> str:
    """Render transparent overlay (webm / mov / mp4)."""
    import threading

    total_frames = int(duration * config.fps)

    if config.output_format == "webm":
        ffmpeg_cmd = [
            ffmpeg_path, "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", f"{config.resolution_w}x{config.resolution_h}",
            "-r", str(config.fps),
            "-i", "pipe:0",
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-auto-alt-ref", "0",
            "-b:v", "2M",
            "-deadline", "realtime",
            "-cpu-used", "8",
            "-row-mt", "1",
            "-an",
            output_path,
        ]
    elif config.output_format == "mp4":
        ffmpeg_cmd = [
            ffmpeg_path, "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", f"{config.resolution_w}x{config.resolution_h}",
            "-r", str(config.fps),
            "-i", "pipe:0",
            "-vf", f"{_BT709_SCALE_FILTER}:out_range=tv,format=yuv420p",
            "-c:v", "libx264",
            "-preset", "medium",
            "-b:v", config.video_bitrate,
            "-pix_fmt", "yuv420p",
            *_BT709_TAGS,
            "-an",
            output_path,
        ]
    else:
        # ProRes 4444 convention is premultiplied alpha (Premiere/FCP un-premultiply
        # on import); WebM stays straight (VP9 convention). ``premultiply`` must
        # run first (it operates in RGBA, before any RGB<->YUV conversion); the
        # trailing ``format=`` forces the explicit ``scale`` filter to perform
        # the RGBA->YUVA conversion itself with the 709 matrix, instead of an
        # auto-inserted scaler using default (unspecified) coefficients.
        #
        # ``-movflags write_colr``: verified empirically (both Homebrew ffmpeg
        # 8.0.1 and the bundled resources/bin-mac/ffmpeg 8.1) that the mov
        # muxer otherwise writes NO ``colr`` atom at all for a prores_ks
        # stream — none of the four ``-color_*``/``-colorspace`` tags below
        # reach the container without it, even though the pixel data itself
        # is correctly BT.709/limited-range converted by the ``-vf`` chain
        # above. ffmpeg's own `-h muxer=mov` flags this option "Experimental,
        # may be renamed or changed, do not use from scripts" — it is used
        # here anyway because omitting it leaves the ProRes overlay (the
        # branch this whole fix targets) completely untagged, which defeats
        # the purpose; even with it, only ``color_space`` (matrix) lands in
        # the atom (the mov muxer only ever emits the legacy 3-field 'nclc'
        # colr variant for ProRes, which has no range bit, and — for reasons
        # not fully understood, reproduced across every codec tested,
        # including ffv1/mkv and libx264/mp4 — ``color_primaries``/
        # ``color_trc`` never propagate through this ffmpeg build's generic
        # AVCodecContext options for ANY codec). Revisit if a future ffmpeg
        # upgrade renames/removes the flag (build will need to re-verify).
        ffmpeg_cmd = [
            ffmpeg_path, "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", f"{config.resolution_w}x{config.resolution_h}",
            "-r", str(config.fps),
            "-i", "pipe:0",
            "-vf", f"premultiply=inplace=1,{_BT709_SCALE_FILTER}:out_range=tv,format=yuva444p10le",
            "-c:v", "prores_ks",
            "-profile:v", "4444",
            "-movflags", "write_colr",
            "-pix_fmt", "yuva444p10le",
            "-vendor", "apl0",
            "-threads", "0",
            *_BT709_TAGS,
            "-an",
            output_path,
        ]

    logger.info("FFmpeg overlay command: %s", " ".join(ffmpeg_cmd))

    stderr_chunks: list[bytes] = []

    def _drain_stderr(stream):
        try:
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    break
                stderr_chunks.append(chunk)
        except Exception:
            pass

    proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    stderr_thread = threading.Thread(target=_drain_stderr, args=(proc.stderr,), daemon=True)
    stderr_thread.start()

    report("Rendering frames…", 5)

    # Frame source: owns the frame→group lookup, blank-frame fast path and the
    # frame-dedup LRU cache (see _FrameSource / _frame_state_key above).
    source = _FrameSource(config, font, groups, total_frames)

    # Number of parallel workers: use half the CPU cores (Pillow is CPU-bound
    # but also does GIL-releasing work via libjpeg/zlib; 4 workers typically
    # gives 2–3× speedup on modern CPUs without thrashing).
    n_workers = max(1, min(os.cpu_count() or 2, 8) // 2)
    BATCH = n_workers * 4  # frames per batch submitted to the pool
    report_interval = max(1, total_frames // 50)

    try:
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            frame_num = 0
            while frame_num < total_frames:
                _check_cancel()
                batch_end = min(frame_num + BATCH, total_frames)
                results = source.render_batch(pool, range(frame_num, batch_end))
                for fn in range(frame_num, batch_end):
                    proc.stdin.write(results[fn])
                    if fn % report_interval == 0:
                        pct = 5 + (fn / total_frames) * 90
                        report(f"Rendering frame {fn}/{total_frames}…", min(pct, 95))
                frame_num = batch_end

        proc.stdin.close()
        logger.info(
            "Frame dedup stats: %d cache hits, %d misses, %d uncached (animating), %d blank",
            source.hits, source.misses, source.uncached_renders, source.blank_frames,
        )
        report("Encoding video (finalizing)…", 96, JobStatus.ENCODING)
        proc.wait(timeout=1800)
        stderr_thread.join(timeout=5)

        if proc.returncode != 0:
            stderr_text = b"".join(stderr_chunks).decode(errors="replace")
            raise RuntimeError(f"FFmpeg failed (code {proc.returncode}): {stderr_text[:500]}")

    except Exception:
        proc.kill()
        raise

    report(f"Video saved: {output_path}", 100)
    logger.info("Rendered overlay video: %s", output_path)
    return output_path


def _render_baked(
    ffmpeg_path: str,
    source_video_path: Optional[str],
    output_path: str,
    config: VideoRenderConfig,
    groups: list[dict],
    duration: float,
    font: ImageFont.FreeTypeFont,
    report: Callable[[str, float], None],
) -> str:
    """Render subtitles baked onto the source video as H.264 MP4."""
    import json
    import threading

    if not source_video_path or not os.path.isfile(source_video_path):
        raise FileNotFoundError(
            f"Source video not found for baked render: {source_video_path}"
        )

    # Probe source video to get its native resolution and fps
    ffprobe_path = shutil.which("ffprobe")
    if not ffprobe_path:
        # Derive from ffmpeg path
        ffprobe_path = str(Path(ffmpeg_path).parent / Path(ffmpeg_path).name.replace("ffmpeg", "ffprobe"))
    probe_cmd = [
        ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-select_streams", "v:0",
        source_video_path,
    ]
    try:
        probe_result = subprocess.run(
            probe_cmd, capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        probe_data = json.loads(probe_result.stdout)
        stream = probe_data["streams"][0]
        src_w = int(stream["width"])
        src_h = int(stream["height"])
    except Exception as e:
        logger.warning("Could not probe source video, using config resolution: %s", e)
        src_w = config.resolution_w
        src_h = config.resolution_h

    # Target resolution is what the user chose in the UI
    out_w = config.resolution_w
    out_h = config.resolution_h

    fps = config.fps
    total_frames = int(duration * fps)

    report("Decoding source video…", 2)

    # Scale source video to fit target resolution (letterbox with black padding)
    scale_filter = (
        f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease,"
        f"pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2:color=black"
    )

    # Decoder: read source video scaled to target resolution as raw RGB frames
    decode_cmd = [
        ffmpeg_path, "-y",
        "-i", source_video_path,
        "-vf", scale_filter,
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{out_w}x{out_h}",
        "-r", str(fps),
        "-an",
        "pipe:1",
    ]

    # Encoder: write composited frames as H.264 MP4 with audio from source
    encode_cmd = [
        ffmpeg_path, "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{out_w}x{out_h}",
        "-r", str(fps),
        "-i", "pipe:0",
        "-i", source_video_path,
        "-map", "0:v",
        "-map", "1:a?",
        "-vf", f"{_BT709_SCALE_FILTER}:out_range=tv,format=yuv420p",
        "-c:v", "libx264",
        "-preset", "medium",
        "-b:v", config.video_bitrate,
        "-pix_fmt", "yuv420p",
        *_BT709_TAGS,
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_path,
    ]

    logger.info("FFmpeg decode command: %s", " ".join(decode_cmd))
    logger.info("FFmpeg encode command: %s", " ".join(encode_cmd))

    stderr_chunks_dec: list[bytes] = []
    stderr_chunks_enc: list[bytes] = []

    def _drain(stream, buf):
        try:
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    break
                buf.append(chunk)
        except Exception:
            pass

    decode_proc = subprocess.Popen(
        decode_cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    encode_proc = subprocess.Popen(
        encode_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    threading.Thread(target=_drain, args=(decode_proc.stderr, stderr_chunks_dec), daemon=True).start()
    threading.Thread(target=_drain, args=(encode_proc.stderr, stderr_chunks_enc), daemon=True).start()

    report("Compositing subtitles onto video…", 5)

    frame_size = out_w * out_h * 3  # rgb24
    report_interval = max(1, total_frames // 50)

    # Frame source with dedup cache — identical overlay frames (between word
    # highlight changes / outside animation windows) are rendered once.
    source = _FrameSource(config, font, groups, total_frames)

    # Same worker heuristic as the overlay path: Pillow is CPU-bound but
    # releases the GIL for the heavy pixel work, so half the cores gives a
    # 2-3x speedup without thrashing against the two ffmpeg processes.
    n_workers = max(1, min(os.cpu_count() or 2, 8) // 2)
    # Half the budget each for the queued-but-uncomposited frames and the batch
    # in flight, so peak decoded-frame memory stays inside the budget.
    batch_size = max(
        1, min(n_workers * 4, (_BAKED_BATCH_MAX_BYTES // 2) // frame_size)
    )

    # Decoding must overlap compositing, not alternate with it. Reading a whole
    # batch on this thread leaves the decoder stalled on a full pipe buffer for
    # as long as the batch takes to composite, which costs more than the
    # parallel composite wins. A reader thread keeps the decoder draining while
    # the pool works; the bounded queue applies the backpressure.
    frame_queue: "queue.Queue[Optional[tuple[int, bytes]]]" = queue.Queue(
        maxsize=batch_size
    )

    # Set on cancel/failure so the reader cannot sit blocked on a full queue
    # forever after the consumer is gone — this runs inside a long-lived
    # server process, where that would leak the thread and its queued frames.
    stop_reading = threading.Event()

    def _put(item: Optional[tuple[int, bytes]]) -> bool:
        """Queue `item`, giving up if the consumer has stopped. True if queued."""
        while not stop_reading.is_set():
            try:
                frame_queue.put(item, timeout=0.5)
                return True
            except queue.Full:
                continue
        return False

    def _read_frames() -> None:
        try:
            for fn in range(total_frames):
                raw = decode_proc.stdout.read(frame_size)
                if not raw or len(raw) < frame_size:
                    # Source video ended before expected duration
                    break
                if not _put((fn, raw)):
                    return
        except Exception:
            logger.exception("Baked render: decoder read thread failed")
        finally:
            _put(None)  # sentinel: no more frames

    reader = threading.Thread(target=_read_frames, daemon=True)
    reader.start()

    try:
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            source_ended = False
            while not source_ended:
                _check_cancel()

                batch: list[tuple[int, bytes]] = []
                while len(batch) < batch_size:
                    try:
                        item = frame_queue.get(timeout=0.5)
                    except queue.Empty:
                        # Nothing decoded yet. Composite what has arrived; with
                        # an empty batch, keep waiting — but stay responsive to
                        # Cancel while a stalled decoder produces nothing.
                        if batch:
                            break
                        _check_cancel()
                        continue
                    if item is None:
                        source_ended = True
                        break
                    batch.append(item)
                    if frame_queue.empty():
                        # Don't wait to fill the batch — composite what has
                        # arrived so the pool and the decoder stay busy.
                        break

                if not batch:
                    break

                composited = source.composite_batch(pool, batch)
                for fn, _raw in batch:
                    encode_proc.stdin.write(composited[fn])
                    if fn % report_interval == 0:
                        pct = 5 + (fn / total_frames) * 90
                        report(
                            f"Rendering frame {fn}/{total_frames}…",
                            min(pct, 95),
                        )

        reader.join(timeout=30)
        decode_proc.stdout.close()
        encode_proc.stdin.close()
        logger.info(
            "Frame dedup stats: %d cache hits, %d misses, %d uncached (animating), %d blank",
            source.hits, source.misses, source.uncached_renders, source.blank_frames,
        )
        report("Encoding video (finalizing)…", 96, JobStatus.ENCODING)
        decode_proc.wait(timeout=60)
        encode_proc.wait(timeout=1800)

        if encode_proc.returncode != 0:
            stderr_text = b"".join(stderr_chunks_enc).decode(errors="replace")
            raise RuntimeError(f"FFmpeg encode failed (code {encode_proc.returncode}): {stderr_text[:500]}")

    except Exception:
        # Release the reader before killing ffmpeg: it may be blocked putting a
        # frame onto a queue nobody will drain again.
        stop_reading.set()
        while not frame_queue.empty():
            try:
                frame_queue.get_nowait()
            except queue.Empty:
                break
        decode_proc.kill()
        encode_proc.kill()
        raise

    report(f"Video saved: {output_path}", 100)
    logger.info("Rendered baked subtitle video: %s", output_path)
    return output_path
