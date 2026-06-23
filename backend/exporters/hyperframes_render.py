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

from .node_runtime import hyperframes_argv, hyperframes_env

logger = logging.getLogger(__name__)

_VIDEO_EXTS = {".mp4", ".webm", ".mov"}


class HyperframesRenderError(RuntimeError):
    """Raised when the HyperFrames CLI is unavailable or the render fails."""


# CLI prints lines like "Capturing frame 30/120 (4 workers)".
_FRAME_RE = re.compile(r"Capturing frame (\d+)\s*/\s*(\d+)")

# Frame capture is the long pole; reserve the last slice for encode/assemble.
_CAPTURE_PCT_CEILING = 95.0


def _hyperframes_cmd() -> list[str]:
    """Argv prefix to run the HyperFrames CLI, or raise if Node is unavailable."""
    argv = hyperframes_argv()
    if argv is None:
        raise HyperframesRenderError(
            "HyperFrames rendering isn't set up yet. Open the HyperFrames panel and "
            "run the one-time setup (it downloads the bundled Node 22 engine + render "
            "browser), or use the file-only HyperFrames export."
        )
    return argv


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
    hf = _hyperframes_cmd()
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        *hf, "render",
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
            env=hyperframes_env(),
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


def snapshot_hyperframes_project(project_dir: str, t: float) -> bytes:
    """Capture a SINGLE frame of the composition at time `t` as PNG bytes.

    Uses `npx hyperframes snapshot --at <t>` — one frame instead of the whole
    video, so the agent can preview a caption style / effect placement fast
    (seconds, not minutes). `--describe false` skips the optional Gemini vision
    pass. Returns the PNG bytes for the agent to view.
    """
    snaps = Path(project_dir) / "snapshots"
    cmd = [*_hyperframes_cmd(), "snapshot", "--at", f"{float(t):g}", "--describe", "false"]
    logger.info("HyperFrames snapshot: %s (cwd=%s)", " ".join(cmd), project_dir)
    try:
        proc = subprocess.run(
            cmd, cwd=str(project_dir), env=hyperframes_env(),
            capture_output=True, text=True, timeout=120,
        )
    except FileNotFoundError as exc:
        raise HyperframesRenderError(f"Failed to launch HyperFrames: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise HyperframesRenderError("HyperFrames snapshot timed out.") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-600:]
        logger.error("HyperFrames snapshot failed (exit %s):\n%s", proc.returncode, tail)
        raise HyperframesRenderError(f"HyperFrames snapshot failed (exit {proc.returncode}):\n{tail}")
    pngs = [p for p in snaps.glob("*.png") if p.is_file()] if snaps.is_dir() else []
    if not pngs:
        raise HyperframesRenderError("HyperFrames snapshot produced no PNG.")
    return max(pngs, key=lambda p: p.stat().st_mtime).read_bytes()


# Subcommands the co-author agent may run: read-only project dev-loop checks
# only. Deliberately excludes networked/stateful/costly commands (init, publish,
# auth, cloud, lambda, tts, transcribe, remove-background) and render/snapshot
# (those have dedicated endpoints with progress + frame return).
CLI_ALLOWED_SUBCOMMANDS = frozenset({"lint", "inspect", "compositions", "info", "docs"})

# Flags an agent may pass after the subcommand. Anything else (e.g. --config,
# --output, --open, or a path) is rejected so a flag value can't redirect the CLI
# to read/write outside the project. Numeric values (for `inspect --at <t>`) pass.
_CLI_SAFE_FLAGS = frozenset({"--json", "--quiet", "--at"})
_CLI_NUMERIC = re.compile(r"-?\d+(\.\d+)?$")

_CLI_TIMEOUT_SECONDS = 120


def _validate_cli_args(args: list[str]) -> None:
    """Allow only safe flags + numeric values after the subcommand — blocks
    flag/path injection (--config /etc/…, --output /tmp/…, docs --open, …)."""
    for a in args[1:]:
        if a in _CLI_SAFE_FLAGS or _CLI_NUMERIC.match(a):
            continue
        raise HyperframesRenderError(
            f"Argument '{a}' isn't allowed for co-author CLI runs — only "
            f"{', '.join(sorted(_CLI_SAFE_FLAGS))} and numeric values are permitted."
        )


def run_hyperframes_cli(
    project_dir: str, args: list[str], timeout: float = _CLI_TIMEOUT_SECONDS
) -> dict:
    """Run one allowlisted HyperFrames CLI subcommand in ``project_dir``.

    Powers the co-author agent's dev loop (``lint`` / ``inspect`` /
    ``compositions`` / ``info`` / ``docs``). The subcommand (``args[0]``) is
    checked against :data:`CLI_ALLOWED_SUBCOMMANDS` *before* anything is launched,
    so a rejection never depends on Node being present. Returns
    ``{ ok, exit_code, stdout, stderr, command }`` (output tail-truncated).
    """
    if not args:
        raise HyperframesRenderError("No CLI subcommand given.")
    sub = args[0]
    if sub not in CLI_ALLOWED_SUBCOMMANDS:
        raise HyperframesRenderError(
            f"Subcommand '{sub}' is not allowed in co-author mode. Allowed: "
            f"{', '.join(sorted(CLI_ALLOWED_SUBCOMMANDS))}. Use render_hyperframes / "
            "preview_hyperframes_frame for rendering and previews."
        )
    _validate_cli_args(args)
    cmd = [*_hyperframes_cmd(), *args]
    logger.info("HyperFrames CLI: %s (cwd=%s)", " ".join(cmd), project_dir)
    try:
        proc = subprocess.run(
            cmd, cwd=str(project_dir), env=hyperframes_env(),
            capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise HyperframesRenderError(f"Failed to launch HyperFrames: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise HyperframesRenderError(
            f"HyperFrames '{sub}' timed out after {timeout}s."
        ) from exc
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stdout": (proc.stdout or "")[-8000:],
        "stderr": (proc.stderr or "")[-4000:],
        "command": " ".join(["hyperframes", *args]),
    }
