"""The channel brief — the library's one piece of *global* authored state.

Everything that used to live in the publish skill's "Channel notes" block moves
here (plan §Contracts → Backend): the channel identity, the boilerplate the
package pastes into every description, and the house rules the style validators
are gated on. One small JSON file at ``<library_root>/brief.json``, written
atomically like every other durable library file.

Two rules this module exists to hold:

* **A missing file is defaults, a corrupt file is an error.** Silently resetting
  a brief the user spent an afternoon writing would be worse than a 500.
* **A patch merges top-level fields and replaces each one.** ``house_rules`` is
  a single field, so a patch carries the whole block — the same "a list patch is
  the new list" rule ``RecordPatch`` follows.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.library import fs
from backend.library.schemas import Link

#: The brief's file name under the library root.
BRIEF_FILE = "brief.json"

#: An inclusive ``(low, high)`` count window, e.g. ``(1800, 2200)`` characters.
CountWindow = tuple[int, int]


class HouseRules(BaseModel):
    """The style rules ``validate.py`` runs **only when the brief asks**.

    ``hook_first_150`` is the one default-on rule: the first 150 characters of a
    YouTube description are what the viewer sees before "more", and a line break
    in there is a mistake in every channel's voice.
    """

    model_config = ConfigDict(extra="forbid")

    no_em_dashes: bool = False
    description_chars: Optional[CountWindow] = None
    keywords_terms: Optional[CountWindow] = None
    hook_first_150: bool = True


class Brief(BaseModel):
    """Channel-wide settings, edited in Settings → Channel or over MCP."""

    model_config = ConfigDict(extra="forbid")

    channel: str = ""
    audience: str = ""
    voice: str = ""
    #: Empty means "the transcript's language" — never a hardcoded default.
    language: str = ""
    footer: str = ""
    recorded_at_line: str = ""
    speaker_block: str = ""
    default_hashtags: list[str] = Field(default_factory=list)
    link_rows: list[Link] = Field(default_factory=list)
    house_rules: HouseRules = Field(default_factory=HouseRules)


class BriefPatch(Brief):
    """A partial write: only the fields in ``model_fields_set`` are applied."""

    model_config = ConfigDict(extra="forbid")

    channel: Optional[str] = None
    audience: Optional[str] = None
    voice: Optional[str] = None
    language: Optional[str] = None
    footer: Optional[str] = None
    recorded_at_line: Optional[str] = None
    speaker_block: Optional[str] = None
    default_hashtags: Optional[list[str]] = None
    link_rows: Optional[list[Link]] = None
    house_rules: Optional[HouseRules] = None


def brief_path(root: Path) -> Path:
    return Path(root) / BRIEF_FILE


def load_brief(root: Path) -> Brief:
    """The stored brief, or defaults when the file has never been written.

    Raises ``ValueError`` when the file exists but is not a readable brief —
    corrupt JSON or an unknown key. The caller sees the failure; the user's file
    is left exactly as it is.
    """
    path = brief_path(root)
    if not path.is_file():
        return Brief()
    try:
        raw = fs.read_json(path)
    except ValueError as exc:  # JSONDecodeError is a ValueError
        raise ValueError(f"{BRIEF_FILE} is not valid JSON: {exc}") from exc
    try:
        return Brief.model_validate(raw)
    except ValidationError as exc:
        raise ValueError(f"{BRIEF_FILE} is not a valid channel brief: {exc}") from exc


def save_brief(root: Path, patch: BriefPatch) -> Brief:
    """Merge ``patch`` into the stored brief, write it atomically, return it.

    The stored brief is never mutated: ``model_copy(update=...)`` builds a new
    one, exactly as ``LibraryStore.patch`` does for a record.
    """
    current = load_brief(root)
    update: dict[str, Any] = {
        name: getattr(patch, name)
        for name in Brief.model_fields
        if name in patch.model_fields_set
    }
    merged = current.model_copy(update=update)
    fs.write_json_atomic(brief_path(root), merged.model_dump(mode="json"))
    return merged
