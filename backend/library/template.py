"""Description-template slots: ``{{slot}}`` substitution for the upload package.

Pure: no store, no brief, no I/O. ``package.py`` builds the slot map and this
module lays it out (docs/plans/library-collections.md, decision 4).

Three rules this module exists to hold:

* **One pass.** A slot's value is inserted as-is and never scanned again, so a
  value containing ``{{x}}`` cannot recurse or inject a second expansion.
* **An empty slot's line collapses, and nothing else does.** The blank lines an
  empty slot leaves behind are squeezed to one; blank lines the template author
  typed and blank lines *inside* a value are kept. That narrowness is what makes
  the built-in template byte-identical to the layout the package printed before
  templates existed (a description with a double blank line keeps it).
* **An unknown slot is never dropped.** It stays verbatim and is reported in
  ``Rendered.unknown`` so the package can list it and the validator can flag it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping

#: A custom slot name; the built-ins below all match it too.
SLOT_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
#: A ``{{ name }}`` reference. Braces around anything that is not a legal name
#: (``{{}}``, ``{{ Bad }}``) are ordinary text and are never reported.
SLOT_REFERENCE_RE = re.compile(r"\{\{\s*([a-z][a-z0-9_]{0,31})\s*\}\}")

#: Pinned by ``backend/tests/fixtures/builtin_slots.json`` (the renderer's copy
#: in ``lib/collections.ts`` is asserted against the same file).
BUILTIN_SLOTS: frozenset[str] = frozenset({
    "description", "title", "short_description",
    "recorded_at", "highlights", "chapters", "links", "speakers", "footer", "hashtags",
    "channel", "collection",
})

#: The DESCRIPTION block's order before templates existed; blank-line joined.
DEFAULT_SLOT_ORDER = (
    "description", "recorded_at", "highlights", "chapters",
    "links", "speakers", "footer", "hashtags",
)
DEFAULT_DESCRIPTION_TEMPLATE = "\n\n".join(f"{{{{{name}}}}}" for name in DEFAULT_SLOT_ORDER)

#: Private-use code points stand in for slots while the literal text is laid out;
#: the first ones the template does not already contain are used.
_SENTINEL_FIRST = 0xE000
_SENTINEL_LAST = 0xF8FF


@dataclass(frozen=True)
class Rendered:
    """The laid-out text plus every unknown slot name, in order of first use."""

    text: str
    unknown: tuple[str, ...] = ()


def validate_slot_names(slots: Mapping[str, str]) -> None:
    """Raise ``ValueError`` for a malformed name or one that shadows a built-in."""
    for name in slots:
        if not SLOT_NAME_RE.match(name):
            raise ValueError(
                f"{name!r} is not a slot name: use lower-case letters, digits and "
                "underscores, starting with a letter, at most 32 characters"
            )
        if name in BUILTIN_SLOTS:
            raise ValueError(f"{name!r} is a built-in slot and cannot be redefined")


def slot_references(template: str) -> tuple[str, ...]:
    """Every legal slot name ``template`` refers to, in order of first use."""
    return tuple(dict.fromkeys(SLOT_REFERENCE_RE.findall(template)))


def render_template(template: str, slots: Mapping[str, str]) -> Rendered:
    """Substitute ``slots`` into ``template`` once, collapse empty lines, strip."""
    empty, value_mark = _sentinels(template)
    values: list[str] = []
    unknown: list[str] = []

    def mark(match: "re.Match[str]") -> str:
        name = match.group(1)
        if name not in slots:
            if name not in unknown:
                unknown.append(name)
            return match.group(0)
        value = slots[name]
        if value == "":
            return empty
        values.append(value)
        return value_mark

    skeleton = _collapse_emptied_lines(SLOT_REFERENCE_RE.sub(mark, template), empty)
    return Rendered(_fill(skeleton.strip(), value_mark, values), tuple(unknown))


def _sentinels(template: str) -> tuple[str, str]:
    """Two characters the template does not contain: "empty slot" and "a value"."""
    free = (
        chr(code) for code in range(_SENTINEL_FIRST, _SENTINEL_LAST + 1)
        if chr(code) not in template
    )
    return next(free), next(free)


def _collapse_emptied_lines(skeleton: str, empty: str) -> str:
    """Drop lines that held only empty slots, squeezing the blank run they sat in.

    A run of blank-or-emptied lines between two content lines becomes at most one
    blank line **only if** it contains an emptied line; a run without one is the
    author's own spacing and is kept verbatim.
    """
    output: list[str] = []
    run: list[str] = []
    for line in skeleton.split("\n"):
        if line.replace(empty, "").strip() == "":
            run.append(line)
            continue
        output += _settle(run, empty)
        output.append(line.replace(empty, ""))
        run = []
    output += _settle(run, empty)
    return "\n".join(output)


def _settle(run: list[str], empty: str) -> list[str]:
    if not any(empty in line for line in run):
        return run
    return [""] if any(empty not in line for line in run) else []


def _fill(skeleton: str, value_mark: str, values: list[str]) -> str:
    """Put the values back in order; they are never scanned for slots again."""
    parts = skeleton.split(value_mark)
    filled = [parts[0]]
    for value, literal in zip(values, parts[1:]):
        filled += [value, literal]
    return "".join(filled)
