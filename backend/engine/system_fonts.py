"""Discover installed font families and resolve them to local font files.

The UI and export pipeline share this index so the searchable picker only
offers faces that Pillow can actually load. Results are cached for the process
lifetime; scanning a typical system font directory takes a fraction of a second.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from PIL import ImageFont


FONT_EXTENSIONS = {".ttf", ".otf", ".ttc", ".otc", ".dfont"}
COLLECTION_EXTENSIONS = {".ttc", ".otc", ".dfont"}
BOLD_STYLE_TOKENS = ("bold", "black", "heavy", "semibold", "semi bold", "demi")
ITALIC_STYLE_TOKENS = ("italic", "oblique")
REGULAR_STYLE_TOKENS = ("regular", "normal", "roman", "book")


@dataclass(frozen=True)
class SystemFontFace:
    """One loadable face in an installed font file or collection."""

    family: str
    style: str
    path: str
    index: int = 0

    @property
    def bold(self) -> bool:
        style = self.style.casefold()
        return any(token in style for token in BOLD_STYLE_TOKENS)

    @property
    def italic(self) -> bool:
        style = self.style.casefold()
        return any(token in style for token in ITALIC_STYLE_TOKENS)


def _system_font_directories() -> tuple[Path, ...]:
    if sys.platform == "win32":
        windir = Path(os.environ.get("WINDIR", "C:/Windows"))
        local_app_data = os.environ.get("LOCALAPPDATA")
        directories = [windir / "Fonts"]
        if local_app_data:
            directories.append(Path(local_app_data) / "Microsoft" / "Windows" / "Fonts")
        return tuple(directories)
    if sys.platform == "darwin":
        return (
            Path.home() / "Library" / "Fonts",
            Path("/Library/Fonts"),
            Path("/Network/Library/Fonts"),
            Path("/System/Library/Fonts"),
            Path("/System/Library/Fonts/Supplemental"),
        )
    return (
        Path.home() / ".fonts",
        Path.home() / ".local" / "share" / "fonts",
        Path("/usr/local/share/fonts"),
        Path("/usr/share/fonts"),
    )


def _windows_registry_font_paths() -> list[Path]:
    """Return registered Windows font paths, including per-user installations."""

    if sys.platform != "win32":
        return []
    try:
        import winreg
    except ImportError:
        return []

    windir_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    user_fonts = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts"
    registry_key = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
    entries: list[Path] = []

    for root, relative_base in (
        (winreg.HKEY_LOCAL_MACHINE, windir_fonts),
        (winreg.HKEY_CURRENT_USER, user_fonts),
    ):
        try:
            with winreg.OpenKey(root, registry_key) as key:
                value_count = winreg.QueryInfoKey(key)[1]
                for index in range(value_count):
                    _name, value, _kind = winreg.EnumValue(key, index)
                    if not isinstance(value, str):
                        continue
                    expanded = Path(os.path.expandvars(value))
                    entries.append(expanded if expanded.is_absolute() else relative_base / expanded)
        except OSError:
            continue
    return entries


def _system_font_paths() -> tuple[str, ...]:
    paths: dict[str, str] = {}
    candidates: list[Path] = _windows_registry_font_paths()
    for directory in _system_font_directories():
        if not directory.is_dir():
            continue
        try:
            candidates.extend(path for path in directory.rglob("*") if path.is_file())
        except OSError:
            continue

    for path in candidates:
        if path.suffix.casefold() not in FONT_EXTENSIONS:
            continue
        try:
            absolute = str(path.expanduser().resolve())
        except OSError:
            absolute = str(path.expanduser().absolute())
        paths.setdefault(os.path.normcase(absolute), absolute)
    return tuple(sorted(paths.values(), key=str.casefold))


def _scan_font_paths(paths: Iterable[str]) -> tuple[SystemFontFace, ...]:
    faces: list[SystemFontFace] = []
    for path in paths:
        max_faces = 64 if Path(path).suffix.casefold() in COLLECTION_EXTENSIONS else 1
        for index in range(max_faces):
            try:
                font = ImageFont.truetype(path, 12, index=index)
                family, style = font.getname()
            except (OSError, ValueError):
                break
            family = str(family).strip()
            if family:
                faces.append(
                    SystemFontFace(
                        family=family,
                        style=str(style or "Regular").strip(),
                        path=path,
                        index=index,
                    )
                )
    return tuple(faces)


@lru_cache(maxsize=1)
def system_font_faces() -> tuple[SystemFontFace, ...]:
    return _scan_font_paths(_system_font_paths())


def list_system_font_families() -> list[str]:
    """Return unique installed family names sorted for display."""

    families: dict[str, str] = {}
    for face in system_font_faces():
        families.setdefault(face.family.casefold(), face.family)
    return sorted(families.values(), key=str.casefold)


def find_system_font_face(family: str, bold: bool = False) -> SystemFontFace | None:
    """Resolve a family to its closest upright regular/bold installed face."""

    normalized = family.strip().casefold()
    if not normalized:
        return None
    matches = [face for face in system_font_faces() if face.family.casefold() == normalized]
    if not matches:
        return None

    def score(face: SystemFontFace) -> tuple[int, int, int, str, int]:
        style = face.style.casefold()
        return (
            0 if face.bold == bold else 1,
            1 if face.italic else 0,
            0 if any(token in style for token in REGULAR_STYLE_TOKENS) else 1,
            face.path.casefold(),
            face.index,
        )

    return min(matches, key=score)


def clear_system_font_cache() -> None:
    """Clear the process cache (primarily useful for tests or a future refresh UI)."""

    system_font_faces.cache_clear()
