"""Run `npx hyperframes render` on a generated project folder (Phase A).

Kept separate from the project generator so the file-writing path has no
dependency on Node being installed. This module shells out to the HyperFrames
CLI and streams its frame-capture progress back to a callback.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional


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

    tail: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        tail.append(line.rstrip())
        if len(tail) > 12:
            tail.pop(0)
        match = _FRAME_RE.search(line)
        if match and on_progress:
            current, total = int(match.group(1)), int(match.group(2))
            pct = (current / total * _CAPTURE_PCT_CEILING) if total else 0.0
            on_progress(min(_CAPTURE_PCT_CEILING, pct), f"Rendering frame {current}/{total}")
    proc.wait()

    if proc.returncode != 0:
        raise HyperframesRenderError(
            f"HyperFrames render failed (exit {proc.returncode}):\n" + "\n".join(tail[-8:])
        )
    if not out.exists():
        raise HyperframesRenderError("HyperFrames render produced no output file")
    if on_progress:
        on_progress(100.0, "HyperFrames render complete")
    return str(out)
