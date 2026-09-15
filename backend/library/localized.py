"""Per-language publish fields: the merge, the localized view, and ``languages``
(publish-editors Part B, decisions 1, 4 and 6). Pure: no I/O, no store.

**``localized`` merges per language.** A ``PATCH`` carrying
``{localized: {pl: {...}}}`` keeps every language it omits, removes a language
sent as ``null`` and replaces a language sent as an object — so an agent writing
``pl`` never erases ``de``. ``localized: null`` clears every language.

**The localized view** (:func:`localize_record`) is the record as its package is
rendered in one language: the translated title, description, short description,
tags, hashtags, chapter titles (by index) and Shorts caption replace the source
ones where they are filled in, and ``title_options`` and ``highlights`` — source
prose with no localized counterpart — are dropped. The view is never stored.
"""

from __future__ import annotations

import re
from typing import Any, Mapping, Optional, Sequence

from pydantic import ValidationError

from backend.library.schemas import Chapter, LocalizedFields, RecordPatch, VideoRecord

#: The codes ``create_track`` and ``lib/languages.ts`` use: ``pl``, ``de``, ``pt-BR``.
LANG_CODE_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
LOCALIZED = "localized"
#: The stored project's translated tracks, and the key naming each one's language.
TRACKS_KEY = "tracks"
TRACK_LANG_KEY = "lang"

#: The fields a translation substitutes, in the order NOTES lists them.
SUBSTITUTED_FIELDS = (
    "title", "description", "short_description", "tags", "hashtags",
    "chapter_titles", "shorts_caption",
)
#: Brief boilerplate has no per-language version; NOTES says so when it prints.
FOOTER_FIELD = "footer"
NOT_TRANSLATED_NOTE = "Not translated (source text used): "
OMITTED_NOTE = "Omitted (source language only): title options, highlights"
NOTE_SEPARATOR = ", "
UNKNOWN_LANGUAGE = (
    "Record {id} has no localized fields for {lang!r}; languages with fields: {known}"
)
NO_LANGUAGES = "none"

LocalizedMap = Mapping[str, LocalizedFields]
LocalizedPatch = Mapping[str, Optional[LocalizedFields]]


class UnknownLanguage(LookupError):
    """A ``lang`` that is neither the source language nor a ``localized`` key."""


# --- the merge ------------------------------------------------------------------

def merge_localized(stored: LocalizedMap, patch_value: LocalizedPatch) -> dict[str, LocalizedFields]:
    """``stored`` with ``patch_value`` applied per language, as a new dict.

    Stored languages keep their order (a replaced one keeps its place); new ones
    follow in the patch's order. Every value is a fresh object, so the result
    aliases neither argument, and neither argument is mutated.
    """
    removed = {lang for lang, fields in patch_value.items() if fields is None}
    sent = {lang: fields for lang, fields in patch_value.items() if fields is not None}
    kept = {
        lang: _fresh(sent.get(lang, fields))
        for lang, fields in stored.items()
        if lang not in removed
    }
    added = {lang: _fresh(fields) for lang, fields in sent.items() if lang not in stored}
    return {**kept, **added}


def inherit_localized(stored: LocalizedMap, patch: RecordPatch) -> RecordPatch:
    """``patch`` with its ``localized`` merged over ``stored``; the same patch when
    it carries no ``localized``. ``localized: null`` becomes ``{}``."""
    if LOCALIZED not in patch.model_fields_set:
        return patch
    merged = {} if patch.localized is None else merge_localized(stored, patch.localized)
    return patch.model_copy(update={LOCALIZED: merged})


def merge_localized_fields(stored: LocalizedMap, fields: Mapping[str, Any]) -> dict:
    """The dict form, for a draft sent to ``/validate`` with a ``video_id``.

    A value that is not an object is left for ``validate_fields`` to refuse.
    """
    merged = dict(fields)
    if LOCALIZED not in merged:
        return merged
    sent = merged[LOCALIZED]
    if sent is None:
        return {**merged, LOCALIZED: {}}
    if not isinstance(sent, Mapping):
        return merged
    kept = {
        lang: _copied(sent[lang]) if lang in sent else value.model_dump()
        for lang, value in stored.items()
        if not (lang in sent and sent[lang] is None)
    }
    added = {
        lang: _copied(value)
        for lang, value in sent.items()
        if value is not None and lang not in stored
    }
    return {**merged, LOCALIZED: {**kept, **added}}


def draft_record(record: VideoRecord, fields: Mapping[str, Any]) -> VideoRecord:
    """``record`` with an already merged draft laid over it (``None`` values skipped).

    Raises ``ValueError`` when ``fields`` is not a set of authored fields.
    """
    try:
        patch = RecordPatch.model_validate(dict(fields))
    except ValidationError as exc:
        raise ValueError(f"Not a set of authored fields: {exc}") from exc
    update = {
        name: getattr(patch, name)
        for name in patch.model_fields_set
        if getattr(patch, name) is not None
    }
    return record.model_copy(update=update, deep=True)


# --- the localized view ----------------------------------------------------------

def resolve_language(record: VideoRecord, lang: Optional[str]) -> Optional[str]:
    """The language to localize into, or None for the source package.

    Raises :class:`UnknownLanguage` for a ``lang`` with no localized fields.
    """
    if lang is None or lang == record.language:
        return None
    _fields_for(record, lang)
    return lang


def localize_record(record: VideoRecord, lang: str) -> VideoRecord:
    """The record as its ``lang`` package renders it; ``record`` is not mutated."""
    fields = _fields_for(record, lang)
    chapters = [
        _localized_chapter(chapter, fields.chapter_titles, index)
        for index, chapter in enumerate(record.chapters)
    ]
    shorts = record.shorts.model_copy(
        update={"caption": _text(fields.shorts_caption, record.shorts.caption)}, deep=True
    )
    return record.model_copy(update={
        "language": lang,
        "title": _text(fields.title, record.title),
        "description": _text(fields.description, record.description),
        "short_description": _text(fields.short_description, record.short_description),
        "tags": list(fields.tags) if _has_items(fields.tags) else list(record.tags),
        "hashtags": list(fields.hashtags) if _has_items(fields.hashtags) else list(record.hashtags),
        "chapters": chapters,
        "shorts": shorts,
        "title_options": [],
        "highlights": [],
        LOCALIZED: {},
    }, deep=True)


def translated_fields(record: VideoRecord, lang: str) -> frozenset[str]:
    """The substituted fields ``lang`` actually fills in."""
    fields = _fields_for(record, lang)
    filled = {
        "title": _filled(fields.title),
        "description": _filled(fields.description),
        "short_description": _filled(fields.short_description),
        "tags": _has_items(fields.tags),
        "hashtags": _has_items(fields.hashtags),
        "chapter_titles": _has_items(fields.chapter_titles),
        "shorts_caption": _filled(fields.shorts_caption),
    }
    return frozenset(name for name, is_filled in filled.items() if is_filled)


def untranslated_fields(record: VideoRecord, lang: str) -> tuple[str, ...]:
    """Substituted fields whose package text fell back to real source text."""
    fields = _fields_for(record, lang)
    fell_back = {
        "title": _filled(record.title) and not _filled(fields.title),
        "description": _filled(record.description) and not _filled(fields.description),
        "short_description": (
            _filled(record.short_description) and not _filled(fields.short_description)
        ),
        "tags": _has_items(record.tags) and not _has_items(fields.tags),
        "hashtags": _has_items(record.hashtags) and not _has_items(fields.hashtags),
        "chapter_titles": any(
            _filled(chapter.title) and _title_at(fields.chapter_titles, index) is None
            for index, chapter in enumerate(record.chapters)
        ),
        "shorts_caption": (
            _filled(record.shorts.caption) and not _filled(fields.shorts_caption)
        ),
    }
    return tuple(name for name in SUBSTITUTED_FIELDS if fell_back[name])


def localized_notes(record: VideoRecord, lang: str, *, footer: str) -> tuple[str, ...]:
    """The NOTES lines a ``lang`` package adds. ``footer`` is the effective brief's."""
    names = [*untranslated_fields(record, lang), *((FOOTER_FIELD,) if footer.strip() else ())]
    fallback = (
        (NOT_TRANSLATED_NOTE + NOTE_SEPARATOR.join(n.replace("_", " ") for n in names),)
        if names else ()
    )
    return (*fallback, OMITTED_NOTE)


# --- derived languages -------------------------------------------------------------

def derive_languages(record: VideoRecord, project: Optional[Mapping[str, Any]]) -> list[str]:
    """Source language, then the stored project's track languages, then the
    ``localized`` keys — de-duplicated in that order. A malformed ``tracks``
    value contributes nothing."""
    candidates = [record.language, *_track_languages(project), *record.localized]
    return list(dict.fromkeys(c for c in candidates if isinstance(c, str) and c))


# --- helpers ---------------------------------------------------------------------------

def _fields_for(record: VideoRecord, lang: str) -> LocalizedFields:
    fields = record.localized.get(lang)
    if fields is None:
        known = NOTE_SEPARATOR.join(record.localized) or NO_LANGUAGES
        raise UnknownLanguage(UNKNOWN_LANGUAGE.format(id=record.id, lang=lang, known=known))
    return fields


def _track_languages(project: Optional[Mapping[str, Any]]) -> list[Any]:
    if not isinstance(project, Mapping):
        return []
    tracks = project.get(TRACKS_KEY)
    if not isinstance(tracks, list):
        return []
    return [track.get(TRACK_LANG_KEY) for track in tracks if isinstance(track, Mapping)]


def _fresh(fields: LocalizedFields) -> LocalizedFields:
    return LocalizedFields.model_validate(fields.model_dump())


def _copied(value: Any) -> Any:
    return dict(value) if isinstance(value, Mapping) else value


def _filled(text: Optional[str]) -> bool:
    return text is not None and bool(text.strip())


def _has_items(items: Sequence[str]) -> bool:
    return any(item.strip() for item in items)


def _text(localized: Optional[str], source: str) -> str:
    return localized if localized is not None and _filled(localized) else source


def _title_at(titles: Sequence[str], index: int) -> Optional[str]:
    return titles[index] if index < len(titles) and _filled(titles[index]) else None


def _localized_chapter(chapter: Chapter, titles: Sequence[str], index: int) -> Chapter:
    title = _title_at(titles, index)
    return chapter.model_copy(update={"title": title} if title is not None else {})
