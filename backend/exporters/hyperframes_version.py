"""Detect the HyperFrames CLI version and gate the backend against incompatible ones.

The backend shells out to whatever HyperFrames CLI the Electron shell (or a system
``npx``) resolves. Different CLI versions honour different flags (``--fps`` landed
in 0.7.21) and behave differently (the snapshot picker's extra end-of-timeline
frame appears from 0.7.25). This module lets the render/snapshot paths refuse a
too-old CLI *clearly* instead of failing deep inside the subprocess with a cryptic
error, and lets ``/api/hyperframes/status`` report the version as a real preflight.

Probe findings (empirically verified against the installed CLI, 2026-07-03):
  * ``<argv> --version``  → prints a bare semver on stdout, e.g. ``0.7.26``.
    RELIABLE — this is the probe we use.
  * ``<argv> info --json`` → fails ("No composition found") outside a project dir,
    so it is NOT usable for a project-independent version probe.
  * ``<argv> render --help`` contains ``--fps`` from 0.7.21 onward (capability
    fallback signal, not needed while ``--version`` works).

Design constraints (see docs/plans/hyperframes-integration-hardening.md, Phase 1):
  * Reuse the SAME argv/env resolution as every other CLI call site
    (``hyperframes_argv`` / ``hyperframes_env`` from ``node_runtime``) — do not
    invent a second resolution path.
  * Probe LAZILY (first render/status/preview), never on import or app startup.
  * Cache per-process, keyed by the resolved CLI path. When a re-provision does
    change the resolved path (``CAPFORGE_NODE_BIN`` / ``CAPFORGE_HYPERFRAMES_CLI``
    → a new key), the next call re-probes on its own. But on frozen-env platforms
    (Windows), the running backend's environment is fixed at spawn time, so a
    post-spawn re-provision does NOT change *this* process's resolved path — the
    key stays the same and the stale version sticks. There the real recovery path
    is ``/api/hyperframes/status?probe=1``, which calls ``reset_version_cache``.
  * NEVER raise from the probe and NEVER add a dependency. A failed probe returns
    ``None`` and degrades to "unknown" (``compat_ok: null``) — it must never brick
    a render that worked before version-gating shipped.
"""

from __future__ import annotations

import logging
import re
import subprocess
from typing import Optional

from .node_runtime import hyperframes_argv, hyperframes_env

logger = logging.getLogger(__name__)

# First CLI version that accepts ``--fps`` (source fps passthrough). Older CLIs
# form an out-of-range/unknown argument and mis-render, so this is the floor.
MIN_SUPPORTED = "0.7.21"

# From this version the snapshot command may write an extra end-of-timeline frame;
# ``snapshot_hyperframes_project`` already picks the closest-time PNG to cope. Kept
# here as the single source of truth for HyperFrames version thresholds.
SNAPSHOT_EXTRA_FRAME_SINCE = "0.7.25"

# ``--version`` exits in <500ms; a small cap only guards against a wedged process
# without pinning an executor worker on the failure path.
_PROBE_TIMEOUT_SECONDS = 5

# Capture major.minor.patch plus an optional ``-<prerelease>`` identifier so a
# pre-release (e.g. ``0.7.21-rc.1``) can be sorted BELOW its release per semver.
_SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?")

# Per-process cache: resolved-CLI-path key → detected version string (or None).
# Keying on the argv (which embeds the CLI path) means a different install is a
# different key, so provisioning a new CLI re-probes without any explicit reset.
_version_cache: dict[str, Optional[str]] = {}


def reset_version_cache() -> None:
    """Drop the cached probe so the next ``get_cli_version`` re-runs the subprocess.

    Used by ``/api/hyperframes/status?probe=1`` to force a fresh read (e.g. right
    after a re-provision). The cache normally self-invalidates on a CLI-path change.
    """
    _version_cache.clear()


def _parse_semver(value: str) -> Optional[tuple[int, int, int, int]]:
    """Return a comparable ``(major, minor, patch, release_rank)`` from the first
    semver in `value`, else None.

    ``release_rank`` is ``0`` for a pre-release (``-rc.1``, ``-beta`` …) and ``1``
    for a full release, so a pre-release sorts BELOW its release per semver
    (``0.7.21-rc.1`` < ``0.7.21``). The exact pre-release identifier is not ranked
    further — this gate only needs "is it a pre-release of X", not rc.1 vs rc.2.
    """
    if not value:
        return None
    m = _SEMVER_RE.search(value)
    if not m:
        return None
    release_rank = 0 if m.group(4) else 1
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), release_rank)


# Parse the floor once at import so a malformed constant fails loudly here rather
# than silently degrading every compat check to "unknown".
_MIN_SUPPORTED_TUPLE = _parse_semver(MIN_SUPPORTED)
assert (
    _MIN_SUPPORTED_TUPLE is not None
), f"MIN_SUPPORTED={MIN_SUPPORTED!r} must be a valid semver"


def get_cli_version(project_dir: str | None = None) -> Optional[str]:
    """Detect the HyperFrames CLI semver via ``<argv> --version``; None on failure.

    Resolves the CLI exactly as the render/snapshot paths do (``hyperframes_argv``),
    caches the result per-process keyed on that resolved path, and never raises —
    any failure (no Node, launch error, timeout, unparseable output) yields None so
    callers can degrade gracefully.
    """
    argv = hyperframes_argv()
    if argv is None:
        return None

    key = "\x00".join(argv)
    if key in _version_cache:
        return _version_cache[key]

    version: Optional[str] = None
    try:
        proc = subprocess.run(
            [*argv, "--version"],
            cwd=str(project_dir) if project_dir else None,
            env=hyperframes_env(),
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
        if proc.returncode == 0:
            m = _SEMVER_RE.search((proc.stdout or "") + "\n" + (proc.stderr or ""))
            if m is not None:
                # Report the raw matched semver so a pre-release suffix survives
                # into the compat message instead of being normalised away.
                version = m.group(0)
        if version is None:
            logger.warning(
                "HyperFrames --version probe returned no semver (exit %s)",
                proc.returncode,
            )
    except (OSError, subprocess.SubprocessError) as exc:
        # OSError covers FileNotFoundError (bad argv); SubprocessError covers
        # TimeoutExpired. Either way: unknown version, never fatal.
        logger.warning("HyperFrames --version probe failed: %s", exc)
        version = None

    _version_cache[key] = version
    return version


def check_cli_compat(project_dir: str | None = None) -> dict:
    """Preflight the CLI version.

    Returns ``{"version": str|None, "ok": bool|None, "reasons": list[str]}``:
      * ``ok=True``  — version detected and >= :data:`MIN_SUPPORTED`.
      * ``ok=False`` — version detected but too old; ``reasons[0]`` is the
        user-facing remediation message.
      * ``ok=None``  — probe failed / version unknown. ``reasons`` is empty: the
        null state already means "unknown", so callers must DEGRADE (warn, do not
        block) rather than surface an internal diagnostic as user guidance.
    """
    version = get_cli_version(project_dir)
    parsed = _parse_semver(version) if version else None
    if parsed is None:
        return {"version": version, "ok": None, "reasons": []}

    if parsed < _MIN_SUPPORTED_TUPLE:
        return {
            "version": version,
            "ok": False,
            "reasons": [
                f"HyperFrames CLI {version} is older than {MIN_SUPPORTED}; "
                "open Settings → HyperFrames → Reinstall"
            ],
        }
    return {"version": version, "ok": True, "reasons": []}
