"""Resolve the Node.js `npx` used to drive the HyperFrames CLI.

HyperFrames (`npx hyperframes …`) needs Node.js 22+. The Electron shell injects
``CAPFORGE_NPX`` when it has provisioned an app-managed Node runtime; otherwise we
fall back to a system ``npx`` on PATH. Centralised here so every HyperFrames call
site resolves it identically — env-managed first, PATH second.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


def _is_spawnable(p: str | None) -> bool:
    """False for Windows shim scripts the backend can't exec without a shell.

    Every HyperFrames call site spawns with ``shell=False`` (see
    ``hyperframes_render.py``); a ``.cmd``/``.bat`` shim can't be launched that
    way on Windows, so treating one as "found" only yields a confusing
    "Failed to launch" later. Reporting it as unavailable lets callers fall
    through to the app-managed ``[node, cli.js]`` or a clean "set up" message.
    """
    return bool(p) and Path(p).suffix.lower() not in {".cmd", ".bat"}


def find_npx() -> str | None:
    """Path to a *spawnable* ``npx``, preferring the app-managed Node runtime.

    Order: ``CAPFORGE_NPX`` (set by Electron when a bundled Node 22+ exists) →
    a system ``npx`` on PATH → ``None``. A Windows ``.cmd``/``.bat`` shim is
    skipped (the backend spawns ``shell=False`` and can't run it).
    """
    managed = os.environ.get("CAPFORGE_NPX")
    if managed and Path(managed).exists() and _is_spawnable(managed):
        return managed
    npx = shutil.which("npx")
    return npx if _is_spawnable(npx) else None


def hyperframes_argv() -> list[str] | None:
    """The argv *prefix* for invoking the HyperFrames CLI.

    Prefers the app-managed install, invoked as ``[node, cli.js]`` via
    ``CAPFORGE_NODE_BIN`` + ``CAPFORGE_HYPERFRAMES_CLI`` — a pinned, offline CLI
    that never touches the npm registry and, crucially, avoids the ``.cmd`` shim
    (Windows ``subprocess`` can't run a ``.cmd`` without a shell). Falls back to
    ``npx -y hyperframes`` (dev / system Node). ``None`` when no Node is available.

    Call sites append the subcommand, e.g. ``[*hyperframes_argv(), "render", …]``.
    """
    node = os.environ.get("CAPFORGE_NODE_BIN")
    cli = os.environ.get("CAPFORGE_HYPERFRAMES_CLI")
    if node and cli and Path(node).exists() and Path(cli).exists():
        return [node, cli]
    npx = find_npx()
    if npx:
        return [npx, "-y", "hyperframes"]
    return None


def _resolve_media_tool(env_var: str, exe: str) -> str | None:
    """A bundled binary (CapForge's ``CAPFORGE_*`` env) first, else one on PATH.

    Mirrors the backend's own ffmpeg discovery (see ``video_render._find_ffmpeg``):
    the app-bundled copy wins; otherwise fall back to a system install. Unlike
    npx, ffmpeg/ffprobe are real executables, so a PATH hit is spawnable.
    """
    bundled = os.environ.get(env_var)
    if bundled and Path(bundled).exists():
        return bundled
    return shutil.which(exe)


def hyperframes_env() -> dict[str, str]:
    """Environment for HyperFrames CLI subprocesses.

    The CLI encodes/probes video with ffmpeg/ffprobe and resolves them from
    ``FFMPEG_PATH``/``FFPROBE_PATH`` (and its own ``HYPERFRAMES_FFMPEG_PATH``/
    ``HYPERFRAMES_FFPROBE_PATH``) — it does NOT reliably read PATH. Resolve the
    same ffmpeg the backend would (CapForge's bundled ``CAPFORGE_FFMPEG`` first,
    then a system ffmpeg) and pin it onto those vars so the CLI uses it instead
    of failing with "FFmpeg not found". Inherits the rest of the backend env
    (PATH already carries the managed Node). No-op when no ffmpeg exists at all.
    """
    env = dict(os.environ)
    ffmpeg = _resolve_media_tool("CAPFORGE_FFMPEG", "ffmpeg")
    if ffmpeg:
        env["FFMPEG_PATH"] = ffmpeg
        env["HYPERFRAMES_FFMPEG_PATH"] = ffmpeg
    ffprobe = _resolve_media_tool("CAPFORGE_FFPROBE", "ffprobe")
    if ffprobe:
        env["FFPROBE_PATH"] = ffprobe
        env["HYPERFRAMES_FFPROBE_PATH"] = ffprobe
    return env
