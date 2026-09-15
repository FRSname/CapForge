"""The publish validators — YouTube's limits and the brief's house rules.

**One implementation, in Python** (plan §3.3): the Publish panel, the MCP tools
and ``PATCH /api/library/{id}`` all call this module, and the renderer only
*formats*. A rule added here is live everywhere without a twin to keep in sync.

Two severities, and they mean different things:

* ``hard`` — YouTube rejects it or the chapter list is unusable. ``PATCH``
  **refuses** a write that carries one.
* ``style`` — the channel brief's house rules. They fire only when the brief
  asks for them, and they never block a write.

A style rule describes *written* content: an empty description is "not written
yet", not "1800 characters short", so the length and count windows stay quiet
until there is something to measure.
"""

from __future__ import annotations

from typing import Any, Literal, Mapping, Optional, Sequence

from pydantic import BaseModel, ConfigDict, ValidationError

from backend.library.brief import Brief, CountWindow, HouseRules
from backend.library.collection_store import Collection
from backend.library.package import (
    AssembledDescription,
    assemble_description,
    format_timestamp,
)
from backend.library.schemas import AUTHORED_FIELDS, Chapter, RecordPatch, VideoRecord

Severity = Literal["hard", "style"]

#: YouTube's own limits.
TITLE_MAX_CHARS = 100
DESCRIPTION_MAX_BYTES = 5000
TAGS_MAX_CHARS = 500
#: A chapter list YouTube will honour: at least three, at least 10s apart.
CHAPTERS_MIN = 3
CHAPTER_MIN_GAP_S = 10
#: What the viewer sees before "more".
HOOK_CHARS = 150

#: Neither may appear in a title, description or tag — YouTube strips markup.
ANGLE_BRACKETS = ("<", ">")
#: Em dash and en dash; a dash *between two digits* is a range, not prose.
DASH_CHARS = "—–"
#: The fields the ``no_em_dashes`` house rule reads (every plain-text field a
#: viewer sees; ``summary_md`` is markdown for reuse elsewhere, so it is out).
DASH_FIELDS = ("title", "description", "short_description")
#: A finding about the pasted DESCRIPTION text rather than any one record field.
PACKAGE_DESCRIPTION_FIELD = "package.description"


class Violation(BaseModel):
    """One finding, addressed to a field the Publish panel can highlight."""

    model_config = ConfigDict(frozen=True)

    field: str
    rule: str
    message: str
    severity: Severity


def validate_fields(
    fields: Mapping[str, Any],
    *,
    duration: Optional[float],
    brief: Optional[Brief],
) -> list[Violation]:
    """Every violation in ``fields``; style rules only when ``brief`` asks.

    ``fields`` is external data (a draft from the panel, a patch from the
    agent), so it is validated at this boundary: an unknown key or a malformed
    chapter raises ``ValueError`` rather than being quietly ignored. Absent
    fields are simply not checked — nothing here is "required".
    """
    try:
        patch = RecordPatch.model_validate(dict(fields))
    except ValidationError as exc:
        raise ValueError(f"Not a set of authored fields: {exc}") from exc
    found = _hard_rules(patch, duration)
    if brief is not None:
        found += _style_rules(patch, brief.house_rules)
    return found


def hard_violations(
    fields: Mapping[str, Any],
    *,
    duration: Optional[float],
    brief: Optional[Brief] = None,
) -> list[Violation]:
    """Only the findings that must block a write."""
    return [v for v in validate_fields(fields, duration=duration, brief=brief)
            if v.severity == "hard"]


def authored_fields(record: VideoRecord) -> dict[str, Any]:
    """The half of the dossier a human or the agent wrote — never ``rev`` or
    ``sourcePath``, which no rule may ever be run against."""
    dumped = record.model_dump()
    return {name: dumped[name] for name in AUTHORED_FIELDS}


def validate_record(
    record: VideoRecord,
    *,
    duration: Optional[float],
    brief: Optional[Brief],
) -> list[Violation]:
    """The same rules over the stored dossier's **authored** half."""
    return validate_fields(authored_fields(record), duration=duration, brief=brief)


# --- the assembled package and membership ------------------------------------

def package_violations(
    record: VideoRecord,
    brief: Brief,
    *,
    collection: Optional[Collection] = None,
    diarized_ids: Sequence[str] = (),
) -> list[Violation]:
    """Findings on the DESCRIPTION the package pastes (collections plan, 4–5).

    That text is more than the record's ``description``: the recorded-at line,
    highlights, chapters, links, speakers, footer and hashtags all count toward
    YouTube's limit. ``brief`` is the channel brief; ``collection`` is applied
    here. These never block a record write — they are brief/collection problems.
    """
    return assembled_violations(
        assemble_description(record, brief, collection=collection, diarized_ids=diarized_ids)
    )


def assembled_violations(assembled: AssembledDescription) -> list[Violation]:
    """:func:`package_violations` over a body already assembled — the package route
    validates the very ``description`` it returns, rather than a second rendering."""
    found = [
        _hard(PACKAGE_DESCRIPTION_FIELD, "unknown_slot",
              f"{{{{{name}}}}} is not a slot the channel brief or the collection "
              "defines; it is pasted as written")
        for name in assembled.unknown_slots
    ]
    size = len(assembled.body.encode("utf-8"))
    if size > DESCRIPTION_MAX_BYTES:
        found.append(_hard(PACKAGE_DESCRIPTION_FIELD, "description_max_bytes",
                           f"The assembled description is {size} bytes; "
                           f"YouTube allows {DESCRIPTION_MAX_BYTES}"))
    found += _angle_brackets(
        assembled.body, PACKAGE_DESCRIPTION_FIELD, "The assembled description"
    )
    return found


def unknown_collection_violation(collection_id: str) -> Violation:
    """The refusal for a ``collection_id`` that names no collection (decision 6)."""
    return _hard("collection_id", "unknown_collection",
                 f"No collection has the id {collection_id!r}; create it first "
                 "or set collection_id to null")


# --- hard rules --------------------------------------------------------------

def _hard(field: str, rule: str, message: str) -> Violation:
    return Violation(field=field, rule=rule, message=message, severity="hard")


def _hard_rules(patch: RecordPatch, duration: Optional[float]) -> list[Violation]:
    return [
        *_title_rules(patch),
        *_description_rules(patch),
        *_tag_rules(patch),
        *_chapter_rules(patch.chapters, duration),
    ]


def _title_rules(patch: RecordPatch) -> list[Violation]:
    found: list[Violation] = []
    title = patch.title or ""
    if len(title) > TITLE_MAX_CHARS:
        found.append(_hard("title", "title_max_chars",
                           f"The title is {len(title)} characters; "
                           f"YouTube allows {TITLE_MAX_CHARS}"))
    found += _angle_brackets(title, "title", "The title")
    for index, option in enumerate(patch.title_options or []):
        if len(option) > TITLE_MAX_CHARS:
            found.append(_hard(f"title_options[{index}]", "title_max_chars",
                               f"Title option {index + 1} is {len(option)} characters; "
                               f"YouTube allows {TITLE_MAX_CHARS}"))
    return found


def _description_rules(patch: RecordPatch) -> list[Violation]:
    found: list[Violation] = []
    description = patch.description or ""
    size = len(description.encode("utf-8"))
    if size > DESCRIPTION_MAX_BYTES:
        found.append(_hard("description", "description_max_bytes",
                           f"The description is {size} bytes; "
                           f"YouTube allows {DESCRIPTION_MAX_BYTES}"))
    found += _angle_brackets(description, "description", "The description")
    return found


def _tag_rules(patch: RecordPatch) -> list[Violation]:
    tags = patch.tags
    if tags is None:
        return []
    found: list[Violation] = []
    line = ", ".join(tags)
    if len(line) > TAGS_MAX_CHARS:
        found.append(_hard("tags", "tags_max_chars",
                           f"The tags line is {len(line)} characters; "
                           f"YouTube allows {TAGS_MAX_CHARS}"))
    found += _angle_brackets(line, "tags", "Tags")
    return found


def _angle_brackets(text: str, field: str, subject: str) -> list[Violation]:
    if not any(bracket in text for bracket in ANGLE_BRACKETS):
        return []
    return [_hard(field, "no_angle_brackets", f"{subject} must not contain < or >")]


def _chapter_rules(
    chapters: Optional[Sequence[Chapter]], duration: Optional[float]
) -> list[Violation]:
    if not chapters:
        return []  # an absent or empty list is not a thin chapter list
    found: list[Violation] = []
    if chapters[0].start_s != 0:
        found.append(_hard("chapters[0]", "chapters_start_at_zero",
                           "The first chapter must start at 00:00, not "
                           f"{format_timestamp(chapters[0].start_s)}"))
    if len(chapters) < CHAPTERS_MIN:
        found.append(_hard("chapters", "chapters_min",
                           f"YouTube needs at least {CHAPTERS_MIN} chapters; "
                           f"there are {len(chapters)}"))
    for index, chapter in enumerate(chapters):
        found += _chapter_position(chapters, index, duration)
    return found


def _chapter_position(
    chapters: Sequence[Chapter], index: int, duration: Optional[float]
) -> list[Violation]:
    """The per-chapter checks: inside the video, and after the one before it."""
    found: list[Violation] = []
    field = f"chapters[{index}]"
    start = chapters[index].start_s
    if duration is not None and start >= duration:
        found.append(_hard(field, "chapter_within_duration",
                           f"Chapter {index + 1} starts at {format_timestamp(start)}, "
                           f"at or past the end of the video at "
                           f"{format_timestamp(duration)}"))
    if index == 0:
        return found
    previous = chapters[index - 1].start_s
    if start <= previous:
        found.append(_hard(field, "chapters_ascending",
                           f"Chapter {index + 1} starts at {format_timestamp(start)}, "
                           f"at or before chapter {index} at "
                           f"{format_timestamp(previous)}"))
    elif start - previous < CHAPTER_MIN_GAP_S:
        found.append(_hard(field, "chapter_min_gap",
                           f"Chapter {index + 1} is {start - previous:g}s after the one "
                           f"before it; the minimum gap is {CHAPTER_MIN_GAP_S}s"))
    return found


# --- style rules -------------------------------------------------------------

def _style(field: str, rule: str, message: str) -> Violation:
    return Violation(field=field, rule=rule, message=message, severity="style")


def _style_rules(patch: RecordPatch, rules: HouseRules) -> list[Violation]:
    found: list[Violation] = []
    if rules.no_em_dashes:
        found += _dash_rule(patch)
    if rules.description_chars is not None:
        found += _description_window(patch, rules.description_chars)
    if rules.keywords_terms is not None:
        found += _keyword_window(patch, rules.keywords_terms)
    if rules.hook_first_150:
        found += _hook_rule(patch)
    return found


def _dash_rule(patch: RecordPatch) -> list[Violation]:
    found: list[Violation] = []
    for name in DASH_FIELDS:
        text = getattr(patch, name) or ""
        count = _loose_dashes(text)
        if count:
            found.append(_style(name, "no_em_dashes",
                                f"The brief forbids em and en dashes outside a number "
                                f"range; {name} has {count}"))
    return found


def _loose_dashes(text: str) -> int:
    """Dashes that are not a ``12-15`` style range between two digits."""
    count = 0
    for index, char in enumerate(text):
        if char not in DASH_CHARS:
            continue
        before = text[index - 1] if index else ""
        after = text[index + 1] if index + 1 < len(text) else ""
        if not (before.isdigit() and after.isdigit()):
            count += 1
    return count


def _description_window(patch: RecordPatch, window: CountWindow) -> list[Violation]:
    description = patch.description or ""
    low, high = window
    if not description.strip() or low <= len(description) <= high:
        return []
    return [_style("description", "description_chars",
                   f"The brief asks for {low} to {high} characters; the description "
                   f"has {len(description)}")]


def _keyword_window(patch: RecordPatch, window: CountWindow) -> list[Violation]:
    keywords = patch.keywords or []
    low, high = window
    if not keywords or low <= len(keywords) <= high:
        return []
    return [_style("keywords", "keywords_terms",
                   f"The brief asks for {low} to {high} keyword terms; "
                   f"there are {len(keywords)}")]


def _hook_rule(patch: RecordPatch) -> list[Violation]:
    description = patch.description or ""
    if not description.strip() or "\n" not in description[:HOOK_CHARS]:
        return []
    return [_style("description", "hook_first_150",
                   f"The first {HOOK_CHARS} characters are what YouTube shows before "
                   f'"more"; they must read as one paragraph with no line break')]
