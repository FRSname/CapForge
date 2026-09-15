"""The rules for per-language fields (publish-editors Part B, decision 3).

Called from ``validate.py``, which runs its own title, description and tag rules
over each language (:func:`language_views`) and re-addresses what they find
(:func:`readdress`), so a localized title is judged by exactly the rule a root
title is. Nothing here imports ``validate.py``.

| rule                      | severity | field                                |
|---------------------------|----------|--------------------------------------|
| ``localized_lang_code``   | hard     | ``localized.<lang>``                 |
| ``localized_is_source``   | hard     | ``localized.<lang>``                 |
| root hard rules           | hard     | ``localized.<lang>.<field>``         |
| root style rules          | style    | ``localized.<lang>.<field>``         |
| ``localized_chapter_count``| style   | ``localized.<lang>.chapter_titles``  |
"""

from __future__ import annotations

from typing import Mapping, Optional, Sequence

from backend.library.localized import LANG_CODE_RE, LOCALIZED, translated_fields
from backend.library.schemas import Chapter, LocalizedFields, RecordPatch, VideoRecord
from backend.library.violation import Violation, hard, style

#: The root fields whose rules a language's text is judged by.
JUDGED_AS_ROOT = ("title", "description", "short_description", "tags")
CHAPTER_TITLES = "chapter_titles"

LocalizedPatch = Optional[Mapping[str, Optional[LocalizedFields]]]


def language_field(lang: str, field: Optional[str] = None) -> str:
    return f"{LOCALIZED}.{lang}" if field is None else f"{LOCALIZED}.{lang}.{field}"


def language_views(localized: LocalizedPatch) -> list[tuple[str, RecordPatch]]:
    """Each language's text as a root-shaped patch; a ``null`` language is skipped."""
    return [
        (lang, RecordPatch(
            title=fields.title,
            description=fields.description,
            short_description=fields.short_description,
            tags=list(fields.tags),
        ))
        for lang, fields in (localized or {}).items()
        if fields is not None
    ]


def readdress(lang: str, found: Sequence[Violation]) -> list[Violation]:
    """Root findings moved under ``localized.<lang>``."""
    return [_moved(violation, language_field(lang, violation.field)) for violation in found]


def key_findings(localized: LocalizedPatch, source_language: Optional[str]) -> list[Violation]:
    """A key that is not a language code, or one that is the source language."""
    found: list[Violation] = []
    for lang in localized or {}:
        if not LANG_CODE_RE.fullmatch(lang):
            found.append(hard(
                language_field(lang), "localized_lang_code",
                f"{lang!r} is not a language code; use one like \"pl\", \"de\" or \"pt-BR\"",
            ))
        elif source_language is not None and lang == source_language:
            found.append(hard(
                language_field(lang), "localized_is_source",
                f"{lang!r} is this video's source language; that text belongs in the "
                "root fields, not under localized",
            ))
    return found


def chapter_count_findings(
    localized: LocalizedPatch, chapters: Optional[Sequence[Chapter]]
) -> list[Violation]:
    """More chapter titles than chapters. Quiet when the chapters are unknown."""
    if chapters is None:
        return []
    return [
        style(
            language_field(lang, CHAPTER_TITLES), "localized_chapter_count",
            f"{lang} has {len(fields.chapter_titles)} chapter titles for "
            f"{len(chapters)} chapters; the extra titles are ignored",
        )
        for lang, fields in (localized or {}).items()
        if fields is not None and len(fields.chapter_titles) > len(chapters)
    ]


def view_findings(
    found: Sequence[Violation], record: VideoRecord, lang: str
) -> list[Violation]:
    """Findings on a localized view, addressed the way ``PATCH`` addresses them.

    A finding on a field ``lang`` translated is moved under ``localized.<lang>``;
    one on a field that fell back to the source keeps its root name, because
    the root field is what needs the fix. ``localized_chapter_count`` for ``lang``
    follows (the view itself carries no ``localized``).
    """
    translated = translated_fields(record, lang) & frozenset(JUDGED_AS_ROOT)
    moved = [
        _moved(violation, language_field(lang, violation.field))
        if violation.field in translated else violation
        for violation in found
    ]
    count = chapter_count_findings({lang: record.localized[lang]}, record.chapters)
    return [*moved, *count]


def _moved(violation: Violation, field: str) -> Violation:
    return Violation(**{**violation.model_dump(), "field": field})
