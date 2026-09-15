"""Per-language fields over the token-gated boundary (publish-editors Part B).

``PATCH`` merges ``localized`` per language under the write lock, the package and
the validators take ``lang``, and the single-record view derives ``languages``.
"""

from __future__ import annotations

import logging

import pytest

from backend.library import posters
from backend.library import router as library_router
from backend.library.paths import PROJECT_FILE, record_dir
from backend.library.router_publish import locked_refusal
from backend.library.schemas import RecordPatch

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    LEGAL_CHAPTERS,
    agent,
    client,
    create,
    home,
    main_module,
    media,
    project,
    transcribed_record,
)

PL = {"title": "Napisy bez farmy", "description": "Opis po polsku."}
DE = {
    "title": "Untertitel ohne Renderfarm",
    "description": "Die Renderfarm war der Engpass.",
    "chapter_titles": ["Einleitung", "", "Ende"],
}
OVER_LIMIT_BYTES = 6000


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def read(client, video_id: str) -> dict:
    r = client.get(f"/api/library/{video_id}", headers=agent())
    assert r.status_code == 200, r.text
    return r.json()


def patch(client, video_id: str, body: dict, rev: int):
    return client.patch(
        f"/api/library/{video_id}", json=body, headers=agent(**{"If-Match": str(rev)})
    )


def patched(client, video_id: str, body: dict) -> dict:
    r = patch(client, video_id, body, read(client, video_id)["rev"])
    assert r.status_code == 200, r.text
    return r.json()


def rules(response) -> list[tuple[str, str]]:
    return [(v["field"], v["rule"]) for v in response.json()["violations"]]


def package(client, video_id: str, **params):
    return client.get(f"/api/library/{video_id}/package", params=params, headers=agent())


def validate(client, **body):
    return client.post("/api/library/validate", json=body, headers=agent())


# --- PATCH merges per language -----------------------------------------------------

def test_two_single_language_patches_both_land(client, media) -> None:
    video_id = transcribed_record(client, media)

    patched(client, video_id, {"localized": {"pl": PL}})
    body = patched(client, video_id, {"localized": {"de": DE}})

    assert set(body["localized"]) == {"pl", "de"}
    assert body["localized"]["pl"]["title"] == PL["title"]
    assert body["history"][-1]["field"] == "localized"
    assert read(client, video_id)["localized"] == body["localized"]


def test_null_removes_one_language_and_keeps_the_rest(client, media) -> None:
    video_id = transcribed_record(client, media)
    patched(client, video_id, {"localized": {"pl": PL, "de": DE}})

    body = patched(client, video_id, {"localized": {"pl": None}})

    assert list(body["localized"]) == ["de"]


def test_resending_a_stored_language_is_a_no_op(client, media) -> None:
    video_id = transcribed_record(client, media)
    rev = patched(client, video_id, {"localized": {"pl": PL, "de": DE}})["rev"]

    body = patched(client, video_id, {"localized": {"pl": PL}})

    assert body["rev"] == rev


def test_an_oversized_localized_description_is_refused_and_writes_nothing(client, media) -> None:
    video_id = transcribed_record(client, media)
    before = patched(client, video_id, {"localized": {"de": DE}})

    r = patch(client, video_id, {"localized": {"pl": {"description": "x" * OVER_LIMIT_BYTES}}},
              before["rev"])

    assert r.status_code == 422
    assert rules(r) == [("localized.pl.description", "description_max_bytes")]
    assert read(client, video_id) == before


@pytest.mark.parametrize("key,rule", [("en", "localized_is_source"), ("Polish", "localized_lang_code")])
def test_a_bad_language_key_is_refused(client, media, key: str, rule: str) -> None:
    video_id = transcribed_record(client, media)

    r = patch(client, video_id, {"localized": {key: PL}}, read(client, video_id)["rev"])

    assert r.status_code == 422
    assert rules(r) == [(f"localized.{key}", rule)]
    assert read(client, video_id)["localized"] == {}


def test_under_the_lock_the_merge_reads_the_fresh_record(client, media) -> None:
    video_id = transcribed_record(client, media)
    patched(client, video_id, {"localized": {"pl": PL}})
    store = library_router.get_store()
    stale = store.get(video_id)
    patched(client, video_id, {"localized": {"de": DE}})  # lands after the stale read

    refusal, completed = locked_refusal(
        store, stale, RecordPatch.model_validate({"localized": {"fr": {"title": "Sous-titres"}}})
    )
    refused, _ = locked_refusal(
        store, stale, RecordPatch.model_validate({"localized": {"EN": {"title": "x"}}})
    )

    assert refusal is None
    assert list(completed.localized) == ["pl", "de", "fr"]
    assert refused is not None and refused.status_code == 422


# --- the package in one language -----------------------------------------------------

def localized_record(client, media) -> str:
    video_id = transcribed_record(client, media)
    patched(client, video_id, {
        "title": "Captions without a render farm",
        "title_options": ["Ship captions fast"],
        "description": "The render farm was the bottleneck.",
        "chapters": LEGAL_CHAPTERS,
        "highlights": [{"text": "Why a farm is wrong", "start_s": 1, "end_s": 2}],
        "tags": ["captions"],
        "localized": {"pl": PL, "de": DE},
    })
    return video_id


def test_without_lang_or_with_the_source_language_the_package_is_unchanged(client, media) -> None:
    video_id = localized_record(client, media)

    plain = package(client, video_id)
    source = package(client, video_id, lang="en")

    assert plain.status_code == source.status_code == 200
    assert source.json() == plain.json()
    assert "Ship captions fast" in plain.json()["text"]
    assert "Not translated" not in plain.json()["text"]


def test_the_german_package_is_rendered_from_the_localized_view(client, media) -> None:
    video_id = localized_record(client, media)

    body = package(client, video_id, lang="de").json()
    text = body["text"]

    assert text.startswith("TITLE OPTIONS\n1. Untertitel ohne Renderfarm\n\n")
    assert "Ship captions fast" not in text and "Captions without a render farm" not in text
    assert "WHAT YOU'LL LEARN" not in text
    assert "00:00 Einleitung\n01:00 Middle\n03:00 Ende" in text
    assert "Not translated (source text used): tags, chapter titles\n" in text
    assert "Omitted (source language only): title options, highlights\n" in text
    assert body["description"].startswith("Die Renderfarm war der Engpass.")
    assert body["platform"] == "youtube"
    assert body["violations"] == []


def test_the_localized_packages_findings_name_the_localized_field(client, media) -> None:
    video_id = localized_record(client, media)
    client.patch("/api/library/brief", json={"house_rules": {"no_em_dashes": True}}, headers=agent())
    patched(client, video_id, {"localized": {"de": {**DE, "title": "Eins — zwei"}}})

    violations = package(client, video_id, lang="de").json()["violations"]

    assert [(v["field"], v["rule"]) for v in violations] == [("localized.de.title", "no_em_dashes")]


def test_an_unknown_lang_is_404_with_a_detail(client, media) -> None:
    video_id = localized_record(client, media)

    r = package(client, video_id, lang="fr")

    assert r.status_code == 404
    assert "fr" in r.json()["detail"]


# --- validate with lang ------------------------------------------------------------------

def test_validate_with_lang_merges_the_draft_per_language(client, media) -> None:
    video_id = localized_record(client, media)
    draft = {"localized": {"de": {"title": "T" * 101}}}  # pl is not in the draft

    r = validate(client, video_id=video_id, fields=draft, lang="de")
    kept = validate(client, video_id=video_id, fields={"localized": {"fr": {"title": "x"}}}, lang="pl")

    assert r.status_code == 200, r.text
    assert [(v["field"], v["rule"]) for v in r.json()["violations"]] == [
        ("localized.de.title", "title_max_chars")
    ]
    assert kept.status_code == 200, kept.text


def test_validate_with_an_unknown_lang_is_404_and_without_a_record_is_422(client, media) -> None:
    video_id = localized_record(client, media)

    assert validate(client, video_id=video_id, lang="fr").status_code == 404
    assert validate(client, fields={"title": "T"}, lang="de").status_code == 422


def test_validate_with_the_source_language_is_todays_answer(client, media) -> None:
    video_id = localized_record(client, media)
    draft = {"title": "T" * 101}

    assert validate(client, video_id=video_id, fields=draft, lang="en").json() == (
        validate(client, video_id=video_id, fields=draft).json()
    )


def test_validate_without_lang_judges_a_partial_localized_draft_merged(client, media) -> None:
    video_id = localized_record(client, media)

    r = validate(client, video_id=video_id, fields={"localized": {"en": {"title": "x"}}})

    assert [(v["field"], v["rule"]) for v in r.json()["violations"]] == [
        ("localized.en", "localized_is_source")
    ]


# --- derived languages -------------------------------------------------------------------

def test_a_record_with_no_project_lists_only_its_localized_languages(client, media) -> None:
    rec = create(client, media)
    patched(client, rec["id"], {"localized": {"pl": PL}})

    assert read(client, rec["id"])["languages"] == ["pl"]


def test_languages_read_the_stored_projects_tracks(client, media) -> None:
    rec = create(client, media)
    snapshot = {**project(), "tracks": [{"id": "t1", "label": "Polish", "lang": "pl"}]}
    assert client.put(f"/api/library/{rec['id']}/project", json=snapshot, headers=agent()).status_code == 200
    patched(client, rec["id"], {"localized": {"de": DE, "pl": PL}})

    assert read(client, rec["id"])["languages"] == ["en", "pl", "de"]


def test_a_corrupt_project_is_logged_and_skipped(client, media, caplog) -> None:
    video_id = transcribed_record(client, media)
    patched(client, video_id, {"localized": {"de": DE}})
    store = library_router.get_store()
    (record_dir(video_id, scratch=False, root=store.root) / PROJECT_FILE).write_text("{not json")

    with caplog.at_level(logging.WARNING):
        languages = read(client, video_id)["languages"]

    assert languages == ["en", "de"]
    assert any(video_id in message for message in caplog.messages)


def test_the_list_summary_stays_cheap_and_carries_no_languages(client, media) -> None:
    create(client, media)

    videos = client.get("/api/library", headers=agent()).json()["videos"]

    assert videos and all("languages" not in video for video in videos)
