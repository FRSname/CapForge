"""Per-language publish fields (publish-editors Part B, decisions 1–4 and 6).

The pure half: the per-language merge, the localized view of a record, what the
package's NOTES say about it, the derived ``languages`` list, and the rules a
``localized`` value is judged by.
"""

from __future__ import annotations

from typing import Any, Optional

import pytest

from backend.library.brief import Brief, HouseRules
from backend.library.localized import (
    LANG_CODE_RE,
    NOT_TRANSLATED_NOTE,
    OMITTED_NOTE,
    UnknownLanguage,
    derive_languages,
    inherit_localized,
    localize_record,
    localized_notes,
    merge_localized,
    merge_localized_fields,
    resolve_language,
    untranslated_fields,
)
from backend.library.schemas import (
    Chapter,
    Highlight,
    LocalizedFields,
    RecordPatch,
    Shorts,
    VideoRecord,
)
from backend.library.validate import hard_violations, validate_fields, validate_record

PL = LocalizedFields(title="Napisy bez farmy", description="Opis po polsku.")
DE = LocalizedFields(title="Untertitel ohne Renderfarm")


def record(**over: Any) -> VideoRecord:
    base: dict[str, Any] = {
        "id": "c" * 32,
        "sourcePath": "/videos/talk.mp4",
        "language": "en",
        "title": "Captions without a render farm",
        "title_options": ["Captions without a render farm", "Ship captions fast"],
        "description": "The render farm was the bottleneck.",
        "short_description": "Local captions.",
        "chapters": [
            Chapter(start_s=0, title="Intro"),
            Chapter(start_s=60, title="Pipeline"),
            Chapter(start_s=180, title="Wrap up"),
        ],
        "tags": ["captions", "whisper"],
        "hashtags": ["captions"],
        "highlights": [Highlight(text="Why a farm is wrong", start_s=1, end_s=2)],
        "shorts": Shorts(caption="One laptop, one pass."),
        "localized": {"pl": PL, "de": DE},
    }
    return VideoRecord(**{**base, **over})


def found(fields: dict, *, brief: Optional[Brief] = None,
          source_language: Optional[str] = None) -> list[tuple[str, str, str]]:
    return [
        (v.field, v.rule, v.severity)
        for v in validate_fields(
            fields, duration=None, brief=brief, source_language=source_language
        )
    ]


# --- merge_localized ----------------------------------------------------------

def test_an_omitted_language_is_inherited() -> None:
    merged = merge_localized({"pl": PL}, {"de": DE})

    assert merged == {"pl": PL, "de": DE}
    assert list(merged) == ["pl", "de"]


def test_a_language_set_to_null_is_removed() -> None:
    assert merge_localized({"pl": PL, "de": DE}, {"pl": None}) == {"de": DE}


def test_null_for_a_language_that_is_not_stored_is_a_no_op() -> None:
    assert merge_localized({"pl": PL}, {"fr": None}) == {"pl": PL}


def test_an_object_replaces_that_languages_fields_wholesale() -> None:
    replaced = merge_localized({"pl": PL, "de": DE}, {"pl": LocalizedFields(title="Nowy")})

    assert replaced["pl"] == LocalizedFields(title="Nowy")
    assert replaced["pl"].description is None  # not inherited from the stored pl
    assert list(replaced) == ["pl", "de"]  # a replaced language keeps its place


def test_merge_never_mutates_its_inputs_or_aliases_their_objects() -> None:
    stored = {"pl": PL.model_copy(deep=True)}
    sent = {"de": DE.model_copy(deep=True), "pl": None}
    stored_before = {k: v.model_dump() for k, v in stored.items()}

    merged = merge_localized(stored, sent)
    merged_again = merge_localized(stored, {"de": sent["de"]})

    assert stored == {"pl": PL} and list(stored) == ["pl"]
    assert {k: v.model_dump() for k, v in stored.items()} == stored_before
    assert sent == {"de": DE, "pl": None}
    assert merged is not stored
    assert merged["de"] is not sent["de"]
    assert merged_again["pl"] is not stored["pl"]


def test_inherit_completes_a_partial_patch_from_the_stored_record() -> None:
    patch = RecordPatch.model_validate({"localized": {"de": {"title": "Neu"}}})

    completed = inherit_localized({"pl": PL}, patch)

    assert completed is not patch
    assert completed.localized == {"pl": PL, "de": LocalizedFields(title="Neu")}
    assert "localized" in completed.model_fields_set
    assert set(patch.localized) == {"de"}  # the patch itself is untouched


def test_inherit_leaves_a_patch_without_localized_alone() -> None:
    patch = RecordPatch(title="T")

    assert inherit_localized({"pl": PL}, patch) is patch


def test_localized_null_clears_every_language() -> None:
    completed = inherit_localized({"pl": PL}, RecordPatch.model_validate({"localized": None}))

    assert completed.localized == {}


def test_the_dict_form_merges_a_draft_per_language() -> None:
    fields = {"title": "T", "localized": {"de": {"title": "Neu"}, "pl": None}}

    merged = merge_localized_fields({"pl": PL, "fr": DE}, fields)

    assert merged["title"] == "T"
    assert set(merged["localized"]) == {"fr", "de"}
    assert merged["localized"]["de"]["title"] == "Neu"
    assert fields == {"title": "T", "localized": {"de": {"title": "Neu"}, "pl": None}}
    assert merge_localized_fields({"pl": PL}, {"title": "T"}) == {"title": "T"}


# --- language codes and the source language -----------------------------------

@pytest.mark.parametrize("code", ["pl", "de", "fil", "pt-BR", "zh-Hant", "es-419"])
def test_language_codes_that_tracks_use_are_accepted(code: str) -> None:
    assert LANG_CODE_RE.match(code)
    assert found({"localized": {code: {"title": "T"}}}) == []


@pytest.mark.parametrize("code", ["PL", "p", "polish", "pt_BR", "pt-", "", "en-a"])
def test_a_bad_language_key_is_hard(code: str) -> None:
    assert found({"localized": {code: {"title": "T"}}}) == [
        (f"localized.{code}", "localized_lang_code", "hard")
    ]


def test_a_key_equal_to_the_source_language_is_hard() -> None:
    assert found({"localized": {"en": {"title": "T"}}}, source_language="en") == [
        ("localized.en", "localized_is_source", "hard")
    ]
    assert found({"localized": {"en": {"title": "T"}}}) == []  # no source known


def test_validate_record_knows_the_records_source_language() -> None:
    rules = [v.rule for v in validate_record(
        record(localized={"en": LocalizedFields(title="T")}), duration=None, brief=None
    )]

    assert rules == ["localized_is_source"]


# --- per-language hard rules ----------------------------------------------------

def test_every_root_hard_rule_applies_per_language() -> None:
    fields = {"localized": {"pl": {
        "title": "T" * 101,
        "description": "ż" * 2501,  # 5002 bytes
        "tags": ["t" * 501],
    }}}

    assert sorted(found(fields)) == [
        ("localized.pl.description", "description_max_bytes", "hard"),
        ("localized.pl.tags", "tags_max_chars", "hard"),
        ("localized.pl.title", "title_max_chars", "hard"),
    ]


@pytest.mark.parametrize("field,value", [
    ("title", "a <b> title"), ("description", "x > y"), ("tags", ["<tag>"]),
])
def test_angle_brackets_are_hard_in_every_localized_text(field: str, value: Any) -> None:
    assert found({"localized": {"de": {field: value}}}) == [
        (f"localized.de.{field}", "no_angle_brackets", "hard")
    ]


def test_a_null_language_in_a_draft_is_not_judged() -> None:
    assert found({"localized": {"pl": None}}) == []


def test_hard_violations_carries_the_source_language_through() -> None:
    rules = [v.rule for v in hard_violations(
        {"localized": {"en": {}}}, duration=None, source_language="en"
    )]

    assert rules == ["localized_is_source"]


# --- per-language style rules ---------------------------------------------------

def test_more_chapter_titles_than_chapters_is_style() -> None:
    fields = {
        "chapters": [{"start_s": 0, "title": "A"}],
        "localized": {"pl": {"chapter_titles": ["A", "B"]}},
    }

    styled = [finding for finding in found(fields, brief=Brief()) if finding[2] == "style"]

    assert styled == [("localized.pl.chapter_titles", "localized_chapter_count", "style")]
    assert [f for f in found(fields) if f[2] == "style"] == []  # only with a brief


def test_chapter_count_is_quiet_when_the_draft_carries_no_chapters() -> None:
    assert found({"localized": {"pl": {"chapter_titles": ["A"]}}}, brief=Brief()) == []


def test_the_briefs_style_rules_apply_to_the_localized_title_and_description() -> None:
    brief = Brief(house_rules=HouseRules(
        no_em_dashes=True, description_chars=(10, 20), hook_first_150=True
    ))
    fields = {"localized": {"de": {"title": "Eins — zwei", "description": "a\nb"}}}

    assert sorted(found(fields, brief=brief)) == [
        ("localized.de.description", "description_chars", "style"),
        ("localized.de.description", "hook_first_150", "style"),
        ("localized.de.title", "no_em_dashes", "style"),
    ]


# --- localize_record --------------------------------------------------------------

def test_the_localized_view_substitutes_every_translated_field() -> None:
    source = record(localized={"pl": LocalizedFields(
        title="Tytuł", description="Opis", short_description="Krótko",
        tags=["napisy"], hashtags=["napisy"], chapter_titles=["Wstęp", "Potok", "Koniec"],
        shorts_caption="Jeden laptop.",
    )})

    view = localize_record(source, "pl")

    assert (view.title, view.description, view.short_description) == ("Tytuł", "Opis", "Krótko")
    assert (view.tags, view.hashtags) == (["napisy"], ["napisy"])
    assert [c.title for c in view.chapters] == ["Wstęp", "Potok", "Koniec"]
    assert [c.start_s for c in view.chapters] == [0, 60, 180]
    assert view.shorts.caption == "Jeden laptop."
    assert (view.title_options, view.highlights, view.localized) == ([], [], {})
    assert view.language == "pl"


def test_empty_localized_fields_fall_back_to_the_source() -> None:
    source = record(localized={"de": LocalizedFields(title="  ", tags=[""])})

    view = localize_record(source, "de")

    assert view.title == source.title
    assert view.description == source.description
    assert view.tags == source.tags and view.hashtags == source.hashtags
    assert view.shorts.caption == source.shorts.caption
    assert [c.title for c in view.chapters] == ["Intro", "Pipeline", "Wrap up"]


@pytest.mark.parametrize("titles,expected", [
    (["Wstęp"], ["Wstęp", "Pipeline", "Wrap up"]),
    (["", "Potok"], ["Intro", "Potok", "Wrap up"]),
    (["A", "B", "C", "D", "E"], ["A", "B", "C"]),
])
def test_chapter_titles_substitute_by_index(titles: list[str], expected: list[str]) -> None:
    view = localize_record(record(localized={"pl": LocalizedFields(chapter_titles=titles)}), "pl")

    assert [c.title for c in view.chapters] == expected


def test_localizing_never_mutates_the_record() -> None:
    source = record()
    before = source.model_dump()

    localize_record(source, "pl")

    assert source.model_dump() == before


def test_an_unknown_language_raises() -> None:
    with pytest.raises(UnknownLanguage):
        localize_record(record(), "fr")


@pytest.mark.parametrize("lang,expected", [(None, None), ("en", None), ("pl", "pl")])
def test_resolve_language_maps_the_source_to_no_localization(lang, expected) -> None:
    assert resolve_language(record(), lang) == expected


def test_resolve_language_refuses_a_language_with_no_fields() -> None:
    with pytest.raises(UnknownLanguage, match="fr"):
        resolve_language(record(), "fr")


# --- untranslated fields and the NOTES lines -----------------------------------------

def test_untranslated_lists_only_fields_that_fell_back_to_real_source_text() -> None:
    source = record(short_description="", localized={"pl": LocalizedFields(
        title="Tytuł", chapter_titles=["Wstęp", "", "Koniec"]
    )})

    assert untranslated_fields(source, "pl") == (
        "description", "tags", "hashtags", "chapter_titles", "shorts_caption",
    )


def test_a_fully_translated_language_has_nothing_untranslated() -> None:
    source = record(localized={"pl": LocalizedFields(
        title="T", description="D", short_description="S", tags=["t"], hashtags=["h"],
        chapter_titles=["A", "B", "C"], shorts_caption="C",
    )})

    assert untranslated_fields(source, "pl") == ()
    assert localized_notes(source, "pl", footer="") == (OMITTED_NOTE,)


def test_the_notes_name_the_fallbacks_and_the_brief_footer() -> None:
    notes = localized_notes(record(), "de", footer="Subscribe.")

    assert notes == (
        f"{NOT_TRANSLATED_NOTE}description, short description, tags, hashtags, "
        "chapter titles, shorts caption, footer",
        OMITTED_NOTE,
    )
    assert NOT_TRANSLATED_NOTE == "Not translated (source text used): "
    assert OMITTED_NOTE == "Omitted (source language only): title options, highlights"


# --- derived languages -------------------------------------------------------------

def test_languages_are_source_then_tracks_then_localized_deduplicated() -> None:
    project = {"tracks": [{"lang": "de"}, {"lang": "uk"}, {"lang": "en"}]}

    assert derive_languages(record(), project) == ["en", "de", "uk", "pl"]


def test_languages_without_a_project_or_a_source_language() -> None:
    assert derive_languages(record(), None) == ["en", "pl", "de"]
    assert derive_languages(record(language=None, localized={}), None) == []


@pytest.mark.parametrize("project", [
    {}, {"tracks": "pl"}, {"tracks": [None, 3, {"lang": ""}, {"lang": 7}, {"label": "x"}]},
])
def test_a_malformed_tracks_list_contributes_nothing(project: dict) -> None:
    assert derive_languages(record(localized={}), project) == ["en"]
