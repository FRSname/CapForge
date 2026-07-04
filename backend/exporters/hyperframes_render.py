"""Run `npx hyperframes render` on a generated project folder (Phase A).

Kept separate from the project generator so the file-writing path has no
dependency on Node being installed. This module shells out to the HyperFrames
CLI and streams its frame-capture progress back to a callback.
"""

from __future__ import annotations

import logging
import os
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from .hyperframes_version import MIN_SUPPORTED, check_cli_compat
from .node_runtime import hyperframes_argv, hyperframes_env

logger = logging.getLogger(__name__)

_VIDEO_EXTS = {".mp4", ".webm", ".mov"}


class HyperframesRenderError(RuntimeError):
    """Base error for a failed/unavailable HyperFrames CLI run.

    Kept as the base of the taxonomy so every existing
    ``except HyperframesRenderError`` handler keeps catching all variants.
    Subclasses set a machine-readable :attr:`code` and a human :attr:`remedy`;
    the constructor also carries an optional :attr:`detail` (stderr/stdout tail).
    """

    code: str = "render_failed"
    remedy: str = ""

    def __init__(self, message: str, *, detail: str = "", remedy: Optional[str] = None):
        super().__init__(message)
        self.detail = detail
        if remedy is not None:
            self.remedy = remedy


class HyperframesUnavailableError(HyperframesRenderError):
    """The CLI/Node runtime isn't installed or couldn't be launched."""

    code = "cli_unavailable"
    remedy = (
        "Open the HyperFrames panel and run the one-time setup (it downloads the "
        "bundled Node 22 engine + render browser), or use the file-only export."
    )


class HyperframesVersionError(HyperframesRenderError):
    """The installed CLI is older than the minimum supported version."""

    code = "cli_incompatible"
    remedy = "Open Settings → HyperFrames → Reinstall to update the engine."


class HyperframesTimeoutError(HyperframesRenderError):
    """The CLI ran past its wall-clock budget and was killed."""

    code = "timeout"
    remedy = (
        "Try a lower quality/resolution, or raise the limit via "
        "CAPFORGE_HYPERFRAMES_RENDER_TIMEOUT / CAPFORGE_HYPERFRAMES_SNAPSHOT_TIMEOUT."
    )


class HyperframesCancelledError(HyperframesRenderError):
    """The render was cancelled by the user."""

    code = "cancelled"


# CLI prints lines like "Capturing frame 30/120 (4 workers)".
_FRAME_RE = re.compile(r"Capturing frame (\d+)\s*/\s*(\d+)")

# Frame capture is the long pole; reserve the last slice for encode/assemble.
_CAPTURE_PCT_CEILING = 95.0


def _env_timeout(var: str, default: int) -> int:
    """Read a positive-int timeout override from ``var``; fall back on anything odd."""
    raw = os.environ.get(var)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning("Ignoring non-integer %s=%r; using %ss", var, raw, default)
        return default
    return value if value > 0 else default


# Wall-clock budgets. Module-level so a test can monkeypatch them; read at call
# time so an env override applied before import takes effect.
SNAPSHOT_TIMEOUT_S = _env_timeout("CAPFORGE_HYPERFRAMES_SNAPSHOT_TIMEOUT", 120)
RENDER_TIMEOUT_S = _env_timeout("CAPFORGE_HYPERFRAMES_RENDER_TIMEOUT", 3600)

# How often the snapshot heartbeat emits a "still working" tick.
_SNAPSHOT_HEARTBEAT_S = 5.0


def _popen_session_kwargs() -> dict:
    """Popen kwargs that let us kill the whole process tree later.

    HyperFrames spawns a headless Chrome; ``proc.kill()`` alone leaves those
    children alive. On POSIX ``start_new_session=True`` puts the child in its own
    process group so ``os.killpg`` reaps the tree; on Windows a new process group
    lets ``taskkill /T`` walk the tree.
    """
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _kill_process_tree(proc: "subprocess.Popen") -> None:
    """Force-kill ``proc`` and every child it spawned (Chrome workers included)."""
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                capture_output=True,
                check=False,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        # Already gone / race with natural exit — fall back to a direct kill.
        try:
            proc.kill()
        except OSError:
            pass
    try:
        proc.wait(timeout=5)
    except Exception:  # noqa: BLE001 - never let cleanup mask the original failure
        pass


def _remove_quietly(path: Path) -> None:
    """Delete ``path`` if present; log but don't raise on failure."""
    try:
        if path.exists():
            path.unlink()
    except OSError:
        logger.warning("Could not remove %s", path, exc_info=True)

# The HyperFrames CLI's --fps accepts integers in this range (render --help,
# v0.7.21: "Accepts integer (24, 25, 30, 50, 60, 120, 240) … Range 1-240").
_HYPERFRAMES_FPS_MIN = 1
_HYPERFRAMES_FPS_MAX = 240


def _render_fps(fps: int) -> int:
    """Clamp a requested fps to the HyperFrames CLI's supported 1-240 range.

    The CLI renders the output container at exactly this rate (verified: a 25fps
    request yields ``r_frame_rate=25/1``), so the source video's fps passes
    straight through — no snapping to a fixed {24,30,60} set is needed on
    v0.7.21+. ``config.fps`` is already Pydantic-validated to 1-120; clamping
    here too means a stray value can never form an out-of-range CLI argument.
    """
    return max(_HYPERFRAMES_FPS_MIN, min(_HYPERFRAMES_FPS_MAX, int(fps)))


def _hyperframes_cmd() -> list[str]:
    """Argv prefix to run the HyperFrames CLI, or raise if Node is unavailable."""
    argv = hyperframes_argv()
    if argv is None:
        raise HyperframesUnavailableError(
            "HyperFrames rendering isn't set up yet. Open the HyperFrames panel and "
            "run the one-time setup (it downloads the bundled Node 22 engine + render "
            "browser), or use the file-only HyperFrames export."
        )
    return argv


def _gate_cli_compat(project_dir: str | None = None) -> None:
    """Refuse a too-old HyperFrames CLI early, with a clear remediation message.

    Only an explicitly-detected old version blocks (``ok is False``). A failed
    probe (``ok is None`` — no Node, launch/timeout error, unknown output) DEGRADES
    to a warning and proceeds: version-gating must never brick a render that worked
    before this shipped. See docs/plans/hyperframes-integration-hardening.md Phase 1.
    """
    compat = check_cli_compat(project_dir)
    if compat["ok"] is False:
        reason = compat["reasons"][0] if compat["reasons"] else (
            f"HyperFrames CLI is older than {MIN_SUPPORTED}; "
            "open Settings → HyperFrames → Reinstall"
        )
        raise HyperframesVersionError(reason)
    if compat["ok"] is None:
        logger.warning(
            "HyperFrames CLI version unknown (probe failed); proceeding without a "
            "compatibility check"
        )


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


def _clear_stale_partials(final: Path) -> None:
    """Remove leftover ``<stem>.partial.*`` from a previous crashed run.

    Scoped to THIS render's stem so a concurrent/unrelated file in the same
    directory is never touched — and it only ever removes our own partial names,
    never a real output the CLI produced under ``renders/``.
    """
    parent = final.parent
    if not parent.is_dir():
        return
    for stale in parent.glob(f"{final.stem}.partial.*"):
        _remove_quietly(stale)


def render_hyperframes_project(
    project_dir: str,
    output_path: str,
    quality: str = "draft",
    video_format: str = "mp4",
    fps: int = 30,
    on_progress: Optional[Callable[[float, str], None]] = None,
    cancel_event: Optional[threading.Event] = None,
) -> str:
    """Render the composition at `project_dir` to `output_path`; return the path.

    Streams the CLI's "Capturing frame X/Y" lines into `on_progress` (capped at
    95%); the final encode/assemble completes the bar.

    The CLI writes to a sibling ``<stem>.partial<ext>`` first and we ``os.replace``
    it into place only on success, so a reader never sees a half-written file. A
    set ``cancel_event`` (polled while streaming) or the ``RENDER_TIMEOUT_S`` budget
    kills the whole process tree and removes the partial before raising.
    """
    _gate_cli_compat(project_dir)
    hf = _hyperframes_cmd()
    final = Path(output_path)
    final.parent.mkdir(parents=True, exist_ok=True)

    # Stage to a sibling partial in the SAME directory so the final os.replace is
    # atomic (same filesystem). Clear any leftover partial from an earlier crash.
    partial = final.with_name(f"{final.stem}.partial{final.suffix}")
    _clear_stale_partials(final)

    cmd = [
        *hf, "render",
        "--quality", quality,
        "--format", video_format,
        "--fps", str(_render_fps(fps)),
        "--output", str(partial),
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
            **_popen_session_kwargs(),
        )
    except FileNotFoundError as exc:  # npx vanished between which() and exec
        _remove_quietly(partial)
        raise HyperframesUnavailableError(f"Failed to launch HyperFrames: {exc}") from exc

    # Read stdout on a background thread so the main loop can poll the cancel
    # event and the wall-clock deadline even while the CLI is silent (startup /
    # final encode) — a blocking `for line in proc.stdout` couldn't do either.
    line_q: "queue.Queue[Optional[str]]" = queue.Queue()

    def _pump() -> None:
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                line_q.put(line)
        finally:
            line_q.put(None)  # EOF sentinel

    reader = threading.Thread(target=_pump, daemon=True)
    reader.start()

    lines: list[str] = []
    deadline = time.monotonic() + RENDER_TIMEOUT_S
    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                logger.info("HyperFrames render cancelled — killing process tree.")
                _kill_process_tree(proc)
                raise HyperframesCancelledError("HyperFrames render cancelled.")
            if time.monotonic() > deadline:
                logger.error("HyperFrames render exceeded %ss — killing.", RENDER_TIMEOUT_S)
                _kill_process_tree(proc)
                raise HyperframesTimeoutError(
                    f"HyperFrames render timed out after {RENDER_TIMEOUT_S}s."
                )
            try:
                line = line_q.get(timeout=0.5)
            except queue.Empty:
                continue
            if line is None:
                break
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
                f"HyperFrames render failed (exit {proc.returncode}):\n{tail}",
                detail=tail,
            )

        # Exit 0 but no partial at the requested path: relocate from the default
        # `renders/` dir if the CLI wrote there (some versions ignore --output).
        if not partial.exists():
            produced = _discover_output(project_dir, partial, video_format)
            if produced is not None and produced.resolve() != partial.resolve():
                logger.warning(
                    "HyperFrames wrote %s instead of %s — relocating.", produced, partial
                )
                shutil.move(str(produced), str(partial))

        if not partial.exists():
            logger.error(
                "HyperFrames exited 0 but produced no file at %s.\nCLI output:\n%s",
                partial, "\n".join(lines),
            )
            raise HyperframesRenderError(
                f"HyperFrames render finished but produced no output file at {final}.\n"
                f"CLI output (tail):\n{tail}",
                detail=tail,
            )

        # Atomic publish: the reader only ever sees a complete file.
        os.replace(str(partial), str(final))
    except BaseException:
        # Any failure/cancel/timeout: never leave a half-written partial behind.
        _remove_quietly(partial)
        raise

    if on_progress:
        on_progress(100.0, "HyperFrames render complete")
    return str(final)


def snapshot_hyperframes_project(
    project_dir: str,
    t: float,
    on_progress: Optional[Callable[[str], None]] = None,
) -> bytes:
    """Capture a SINGLE frame of the composition at time `t` as PNG bytes.

    Uses `npx hyperframes snapshot --at <t>` — one frame instead of the whole
    video, so the agent can preview a caption style / effect placement fast
    (seconds, not minutes). `--describe false` skips the optional Gemini vision
    pass. Returns the PNG bytes for the agent to view.

    Old PNGs in ``snapshots/`` are cleared first so the frame-time picker (and its
    mtime fallback) can never return a stale frame from a previous preview. If
    ``on_progress`` is given it receives a coarse heartbeat (~every 5s) while the
    CLI is still running, so a long capture doesn't look hung.
    """
    _gate_cli_compat(project_dir)
    snaps = Path(project_dir) / "snapshots"
    # Stale-artifact hygiene: a leftover PNG from a prior run would poison the
    # closest-to-`t` picker (and especially the mtime fallback).
    if snaps.is_dir():
        for stale in snaps.glob("*.png"):
            _remove_quietly(stale)

    cmd = [*_hyperframes_cmd(), "snapshot", "--at", f"{float(t):g}", "--describe", "false"]
    logger.info("HyperFrames snapshot: %s (cwd=%s)", " ".join(cmd), project_dir)
    try:
        proc = subprocess.Popen(
            cmd, cwd=str(project_dir), env=hyperframes_env(),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            **_popen_session_kwargs(),
        )
    except FileNotFoundError as exc:
        raise HyperframesUnavailableError(f"Failed to launch HyperFrames: {exc}") from exc

    # Drain stdout on a thread so a chatty CLI can't deadlock on a full pipe while
    # we poll for the deadline / heartbeat.
    captured: list[str] = []

    def _drain() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            captured.append(line)

    reader = threading.Thread(target=_drain, daemon=True)
    reader.start()

    deadline = time.monotonic() + SNAPSHOT_TIMEOUT_S
    next_beat = time.monotonic() + _SNAPSHOT_HEARTBEAT_S
    while proc.poll() is None:
        now = time.monotonic()
        if now > deadline:
            logger.error("HyperFrames snapshot exceeded %ss — killing.", SNAPSHOT_TIMEOUT_S)
            _kill_process_tree(proc)
            raise HyperframesTimeoutError(
                f"HyperFrames snapshot timed out after {SNAPSHOT_TIMEOUT_S}s."
            )
        if on_progress and now >= next_beat:
            on_progress("Still capturing preview…")
            next_beat = now + _SNAPSHOT_HEARTBEAT_S
        time.sleep(0.2)
    reader.join(timeout=2)

    if proc.returncode != 0:
        tail = "".join(captured).strip()[-600:]
        logger.error("HyperFrames snapshot failed (exit %s):\n%s", proc.returncode, tail)
        raise HyperframesRenderError(
            f"HyperFrames snapshot failed (exit {proc.returncode}):\n{tail}", detail=tail
        )
    pngs = [p for p in snaps.glob("*.png") if p.is_file()] if snaps.is_dir() else []
    if not pngs:
        raise HyperframesRenderError("HyperFrames snapshot produced no PNG.")
    # The CLI (>= 0.7.25) may save extra frames beyond the requested one (an
    # auto-added end-of-timeline frame), and it writes them AFTER the requested
    # frame — so "newest mtime" can return the wrong (often caption-less) frame.
    # Prefer the snapshot whose filename timestamp (frame-NN-at-<t>s.png) is
    # closest to the requested time; fall back to mtime for older CLI names.
    def _at_time(p: Path) -> Optional[float]:
        m = re.search(r"-at-([0-9]+(?:\.[0-9]+)?)s\.png$", p.name)
        return float(m.group(1)) if m else None

    timed = [(p, at) for p in pngs if (at := _at_time(p)) is not None]
    if timed:
        return min(timed, key=lambda pa: abs(pa[1] - float(t)))[0].read_bytes()
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
        raise HyperframesUnavailableError(f"Failed to launch HyperFrames: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise HyperframesTimeoutError(
            f"HyperFrames '{sub}' timed out after {timeout}s."
        ) from exc
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stdout": (proc.stdout or "")[-8000:],
        "stderr": (proc.stderr or "")[-4000:],
        "command": " ".join(["hyperframes", *args]),
    }
