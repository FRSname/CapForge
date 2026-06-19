"""Run `npx hyperframes render` on a generated project folder (Phase A).

Kept separate from the project generator so the file-writing path has no
dependency on Node being installed. This module shells out to the HyperFrames
CLI and streams its frame-capture progress back to a callback.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

_VIDEO_EXTS = {".mp4", ".webm", ".mov"}


class HyperframesRenderError(RuntimeError):
    """Raised when the HyperFrames CLI is unavailable or the render fails."""


# CLI prints lines like "Capturing frame 30/120 (4 workers)".
_FRAME_RE = re.compile(r"Capturing frame (\d+)\s*/\s*(\d+)")

# Frame capture is the long pole; reserve the last slice for encode/assemble.
_CAPTURE_PCT_CEILING = 95.0


def _resolve_npx() -> str:
    npx = shutil.which("npx")
    if not npx:
        raise HyperframesRenderError(
            "Node.js (npx) was not found on PATH. HyperFrames rendering needs "
            "Node.js 22+. Install Node, or use the file-only HyperFrames export."
        )
    return npx


def _discover_output(project_dir: str, out: Path, video_format: str) -> Optional[Path]:
    """Find the rendered video when the CLI wrote it somewhere other than `out`.

    Some CLI versions ignore an absolute ``--output`` and emit to the project's
    default ``renders/`` directory. Checks there first, then any video under the
    project (excluding the copied source and `out`), newest first.
    """
    ext = ".webm" if video_format == "webm" else f".{video_format}"
    renders = Path(project_dir) / "renders"
    candidates: list[Path] = []
    if renders.is_dir():
        candidates = [p for p in renders.glob(f"*{ext}") if p.is_file()]
    if not candidates:
        candidates = [
            p
            for p in Path(project_dir).rglob("*")
            if p.is_file()
            and p.suffix.lower() in _VIDEO_EXTS
            and p.stem != "source"
            and p.resolve() != out.resolve()
        ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def render_hyperframes_project(
    project_dir: str,
    output_path: str,
    quality: str = "draft",
    video_format: str = "mp4",
    on_progress: Optional[Callable[[float, str], None]] = None,
) -> str:
    """Render the composition at `project_dir` to `output_path`; return the path.

    Streams the CLI's "Capturing frame X/Y" lines into `on_progress` (capped at
    95%); the final encode/assemble completes the bar.
    """
    npx = _resolve_npx()
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        npx, "-y", "hyperframes", "render",
        "--quality", quality,
        "--format", video_format,
        "--output", str(out),
    ]
    logger.info("HyperFrames render: %s (cwd=%s)", " ".join(cmd), project_dir)
    if on_progress:
        on_progress(1.0, "Starting HyperFrames render…")

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(project_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError as exc:  # npx vanished between which() and exec
        raise HyperframesRenderError(f"Failed to launch HyperFrames: {exc}") from exc

    lines: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        lines.append(line.rstrip())
        match = _FRAME_RE.search(line)
        if match and on_progress:
            current, total = int(match.group(1)), int(match.group(2))
            pct = (current / total * _CAPTURE_PCT_CEILING) if total else 0.0
            on_progress(min(_CAPTURE_PCT_CEILING, pct), f"Rendering frame {current}/{total}")
    proc.wait()

    tail = "\n".join(lines[-15:])
    if proc.returncode != 0:
        logger.error(
            "HyperFrames render failed (exit %s):\n%s", proc.returncode, "\n".join(lines)
        )
        raise HyperframesRenderError(
            f"HyperFrames render failed (exit {proc.returncode}):\n{tail}"
        )

    # Exit 0 but no file at the requested path: relocate from the default
    # `renders/` dir if the CLI wrote there (some versions ignore --output).
    if not out.exists():
        produced = _discover_output(project_dir, out, video_format)
        if produced is not None:
            logger.warning("HyperFrames wrote %s instead of %s — relocating.", produced, out)
            shutil.move(str(produced), str(out))

    if not out.exists():
        logger.error(
            "HyperFrames exited 0 but produced no file at %s.\nCLI output:\n%s",
            out, "\n".join(lines),
        )
        raise HyperframesRenderError(
            f"HyperFrames render finished but produced no output file at {out}.\n"
            f"CLI output (tail):\n{tail}"
        )

    if on_progress:
        on_progress(100.0, "HyperFrames render complete")
    return str(out)
