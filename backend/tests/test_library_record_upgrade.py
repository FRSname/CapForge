"""``record_upgrade.upgrade_record``: schema 1 → 2, pure and idempotent.

docs/plans/multi-channel-pr2-contract.md → Upgrade.
"""

from __future__ import annotations

import copy

import pytest

from backend.library.record_upgrade import CURRENT_SCHEMA, upgrade_record
from backend.library.schemas import Post, VideoRecord
from backend.tests.library_v1_fixtures import COVER, FIXTURES, fixture

PRIMARY = "harbour-channel"
VIDEO_ID = "a" * 32


def v1(name: str) -> dict:
    return fixture(name, VIDEO_ID, "/media/talk.mp4")


def test_the_full_record_moves_every_projected_field_into_the_primary_post():
    raw = v1("full")

    out = upgrade_record(raw, PRIMARY)

    assert out["schema"] == CURRENT_SCHEMA
    post = Post.model_validate(out["posts"][PRIMARY])
    assert post.title == raw["title"]
    assert post.description == raw["description"]
    assert post.short_description == raw["short_description"]
    assert post.tags == raw["tags"] and post.hashtags == raw["hashtags"]
    assert post.localized["pl"].title == "Marynowanie tablic pływów"
    assert post.cover == COVER
    assert post.published.model_dump() == {
        "id": "tideVid0001", "url": "https://youtu.be/tideVid0001",
        "at": "2026-08-03T08:00:00Z",
    }
    assert post.hidden is False and post.caption == "" and post.text == ""


def test_the_moved_fields_leave_the_root_and_the_rest_stays():
    raw = v1("full")

    out = upgrade_record(raw, PRIMARY)

    for name in ("description", "short_description", "tags", "hashtags", "localized"):
        assert name not in out, name
    assert "cover" not in out["thumbnail"]
    assert out["thumbnail"]["candidates"] == raw["thumbnail"]["candidates"]
    assert out["thumbnail"]["ideas"] == raw["thumbnail"]["ideas"]
    assert "youtube" not in out["publish"]
    assert out["publish"]["pushes"] == raw["publish"]["pushes"]
    assert out["title"] == raw["title"], "the root title is copied, never moved"
    assert out["shorts"] == raw["shorts"], "the Shorts caption stays at the root"
    for name in ("chapters", "keywords", "speakers", "renders", "history", "rev", "publishedAt"):
        assert out[name] == raw[name], name


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_every_upgraded_fixture_is_a_valid_record(name):
    record = VideoRecord.model_validate(upgrade_record(v1(name), PRIMARY))

    assert record.schema == CURRENT_SCHEMA


def test_a_record_with_nothing_written_gets_no_post():
    assert upgrade_record(v1("bare"), PRIMARY)["posts"] == {}


def test_a_title_alone_is_enough_for_a_post():
    out = upgrade_record(v1("title_only"), PRIMARY)

    assert out["posts"][PRIMARY]["title"] == "Untitled lighthouse"


def test_a_published_url_alone_is_enough_for_a_post():
    raw = v1("bare")
    raw["publish"]["youtube"]["url"] = "https://youtu.be/xyz"

    assert upgrade_record(raw, PRIMARY)["posts"][PRIMARY]["published"]["url"] == "https://youtu.be/xyz"


def test_the_input_is_never_mutated():
    raw = v1("full")
    before = copy.deepcopy(raw)

    upgrade_record(raw, PRIMARY)

    assert raw == before


def test_a_schema_2_dict_is_returned_unchanged_and_upgrading_twice_is_the_same():
    once = upgrade_record(v1("full"), PRIMARY)

    twice = upgrade_record(once, "another-channel")

    assert twice == once


def test_an_explicit_schema_1_is_upgraded():
    raw = {**v1("drafted"), "schema": 1}

    out = upgrade_record(raw, PRIMARY)

    assert out["schema"] == CURRENT_SCHEMA and out["posts"][PRIMARY]["description"]


def test_a_minimal_older_file_missing_most_keys_still_upgrades():
    raw = {"id": VIDEO_ID, "title": "Only a title", "rev": 1}

    out = upgrade_record(raw, PRIMARY)

    assert out["posts"][PRIMARY]["title"] == "Only a title"
    assert VideoRecord.model_validate(out).title == "Only a title"
