"""Reusable effect-template library (Phase 2).

A *template* is an EffectClip prototype with its timing stripped — a saved
"look" (a brand logo, a lower-third style, a marker colour) that the user, or
the connected Claude agent, can drop into any project. Examples the user gave:
"I have a logo and some transitions I like across projects — save this effect so
we can reuse it."

Templates live OUTSIDE any project folder, in the same ``~/.capforge`` home the
agent discovery file uses (see ``backend/agent_bridge.py``), so they:
  - survive the throwaway HyperFrames project folders, and
  - are reachable by BOTH the renderer (via ``/api/effect-templates``) and the
    MCP agent (whose tools hit the same backend) — Electron app-data would only
    be reachable by the renderer.

Asset-backed effects (``logo`` / ``b_roll``) get their image copied into
``<home>/templates/assets/`` and the ``variables.src`` path rewritten, so a
template never points at a project path that may later be deleted.

All mutators are immutable (read → new list → write); they never edit the passed
effect or the on-disk list in place.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Optional
from uuid import uuid4

from backend.models.schemas import EffectClip

# Effect types whose ``variables.src`` is an on-disk asset to copy into the store.
_ASSET_TYPES = {"logo", "b_roll"}


def _home() -> Path:
    """Resolve the CapForge data home. ``CAPFORGE_HOME`` overrides the default
    (``~/.capforge``) — used by tests for isolation, and available to Electron."""
    override = os.environ.get("CAPFORGE_HOME")
    return Path(override) if override else Path.home() / ".capforge"


def _templates_file() -> Path:
    return _home() / "effect-templates.json"


def _assets_dir() -> Path:
    return _home() / "templates" / "assets"


def _read() -> list[dict]:
    """Load saved templates (returns ``[]`` when the store doesn't exist yet)."""
    try:
        raw = json.loads(_templates_file().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []
    templates = raw.get("templates") if isinstance(raw, dict) else raw
    return templates if isinstance(templates, list) else []


def _write(templates: list[dict]) -> None:
    home = _home()
    home.mkdir(parents=True, exist_ok=True)
    _templates_file().write_text(
        json.dumps({"version": 1, "templates": templates}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _store_asset(src: str) -> str:
    """Copy an asset into the template store under a unique name; return its path.

    A uuid prefix keeps two logos that share a filename from colliding. Uses
    ``shutil.copy`` (not ``copy2``) because ``copystat`` fails on macOS files
    carrying special flags — the same trap handled in hyperframes_project.py.
    """
    src_path = Path(src)
    assets = _assets_dir()
    assets.mkdir(parents=True, exist_ok=True)
    dest = assets / f"{uuid4().hex[:8]}-{src_path.name}"
    shutil.copy(src_path, dest)
    return str(dest)


def list_templates() -> list[dict]:
    """All saved templates, each carrying its own ``name``."""
    return _read()


def get_template(name: str) -> Optional[dict]:
    """The template named ``name``, or ``None``."""
    for t in _read():
        if t.get("name") == name:
            return t
    return None


def save_template(name: str, effect: dict) -> dict:
    """Save ``effect`` (an EffectClip-shaped dict) as a reusable template ``name``.

    Timing (``start`` / ``duration`` / ``id`` / ``source_word_id``) is dropped —
    a template is a look, not a placement. Overwrites any existing template with
    the same name. For asset-backed types the image is copied into the store.
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("Template name is required")

    variables = dict(effect.get("variables") or {})
    if effect.get("type") in _ASSET_TYPES:
        src = variables.get("src")
        if src and Path(str(src)).exists():
            variables["src"] = _store_asset(str(src))

    template = {
        "name": name,
        "type": effect.get("type", "logo"),
        "track_index": int(effect.get("track_index", 1)),
        "anchor_x": float(effect.get("anchor_x", 0.5)),
        "anchor_y": float(effect.get("anchor_y", 0.5)),
        "variables": variables,
        "created_by": effect.get("created_by", "user"),
    }
    others = [t for t in _read() if t.get("name") != name]
    _write([*others, template])
    return template


def delete_template(name: str) -> bool:
    """Remove a template by name. Returns ``True`` if one was removed."""
    templates = _read()
    remaining = [t for t in templates if t.get("name") != name]
    if len(remaining) == len(templates):
        return False
    _write(remaining)
    return True


def apply_template(name: str, start: float, duration: float = 2.0) -> EffectClip:
    """Instantiate a fresh ``EffectClip`` from template ``name`` at ``start``.

    Raises ``KeyError`` if no such template exists. The new clip gets a fresh id
    (EffectClip's default_factory) and the given timing.
    """
    t = get_template(name)
    if t is None:
        raise KeyError(f"No effect template named {name!r}")
    return EffectClip(
        type=t.get("type", "logo"),
        start=float(start),
        duration=float(duration),
        track_index=int(t.get("track_index", 1)),
        anchor_x=float(t.get("anchor_x", 0.5)),
        anchor_y=float(t.get("anchor_y", 0.5)),
        variables=dict(t.get("variables") or {}),
        created_by=t.get("created_by", "user"),
    )
