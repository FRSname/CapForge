"""The pure half of a ``posts`` write: the merge, the YouTube id, ``apply_patch``."""

from __future__ import annotations

import pytest

from backend.library.post_merge import merge_post, merge_posts
from backend.library.record_patching import apply_patch, earliest_published_at
from backend.library.record_projection import project
from backend.library.schemas import (
    LocalizedFields,
    Post,
    PostPatch,
    PostPublished,
    RecordPatch,
    VideoRecord,
)
from backend.library.youtube_url import youtube_id_from_url

PRIMARY, TIKTOK = "main", "tt"
PLATFORMS = {PRIMARY: "youtube", TIKTOK: "tiktok"}


@pytest.mark.parametrize("url,expected", [
    ("https://youtu.be/abc123", "abc123"),
    ("https://www.youtube.com/watch?v=abc123&t=4", "abc123"),
    ("https://m.youtube.com/shorts/abc123", "abc123"),
    ("https://youtube.com/live/abc123/", "abc123"),
    ("https://vimeo.com/123", None),
    ("not a url", None),
])
def test_youtube_id_from_url(url, expected):
    assert youtube_id_from_url(url) == expected


def test_sent_fields_replace_and_omitted_fields_are_kept():
    stored = Post(caption="old", hashtags=["a"], cover="x.jpg")

    merged = merge_post(stored, PostPatch(caption="new"), platform="tiktok")

    assert (merged.caption, merged.hashtags, merged.cover) == ("new", ["a"], "x.jpg")


def test_a_field_sent_as_null_goes_back_to_its_default():
    merged = merge_post(Post(cover="x.jpg", tags=["a"]),
                        PostPatch.model_validate({"cover": None, "tags": None}), platform="youtube")

    assert merged.cover is None and merged.tags == []


def test_localized_merges_per_language():
    stored = Post(localized={"de": LocalizedFields(title="D"), "pl": LocalizedFields(title="P")})

    merged = merge_post(stored, PostPatch.model_validate({"localized": {"pl": None, "fr": {"title": "F"}}}),
                        platform="youtube")

    assert set(merged.localized) == {"de", "fr"}


def test_a_youtube_url_without_an_id_gets_the_id():
    merged = merge_post(None, PostPatch(published=PostPublished(url="https://youtu.be/q1")),
                        platform="youtube")

    assert merged.published.id == "q1"


def test_an_explicit_id_wins_and_other_platforms_derive_nothing():
    kept = merge_post(None, PostPatch(published=PostPublished(url="https://youtu.be/q1", id="mine")),
                      platform="youtube")
    tiktok = merge_post(None, PostPatch(published=PostPublished(url="https://youtu.be/q1")),
                        platform="tiktok")

    assert kept.published.id == "mine" and tiktok.published.id is None


def test_merge_posts_keeps_removes_and_adds_per_channel():
    stored = {PRIMARY: Post(description="d"), "gone": Post(caption="c")}

    merged = merge_posts(stored, {"gone": None, TIKTOK: PostPatch(caption="hi")}, platforms=PLATFORMS)

    assert list(merged) == [PRIMARY, TIKTOK]
    assert merged[PRIMARY] == stored[PRIMARY] and merged[TIKTOK].caption == "hi"


def loaded(**posts: Post) -> VideoRecord:
    return project(VideoRecord(id="c" * 32, title="Name", posts=posts), PRIMARY)


def test_apply_patch_root_and_primary_post_fields_both_land():
    outcome = apply_patch(
        loaded(main=Post(description="old")),
        RecordPatch.model_validate({"description": "root", "posts": {PRIMARY: {"tags": ["t"]}}}),
        primary_id=PRIMARY, platforms=PLATFORMS,
    )

    assert outcome.record.description == "root" and outcome.record.tags == ["t"]
    assert outcome.root_changed == ("description",) and outcome.posts_changed == (PRIMARY,)


def test_apply_patch_a_root_title_bridges_but_a_sent_post_title_wins():
    bridged = apply_patch(loaded(), RecordPatch(title="New"), primary_id=PRIMARY, platforms=PLATFORMS)
    both = apply_patch(loaded(), RecordPatch.model_validate(
        {"title": "Library", "posts": {PRIMARY: {"title": "Post"}}}), primary_id=PRIMARY, platforms=PLATFORMS)

    assert bridged.record.posts[PRIMARY].title == "New"
    assert both.record.title == "Library" and both.record.posts[PRIMARY].title == "Post"


def test_apply_patch_that_changes_nothing_is_no_change():
    record = loaded(main=Post(description="same"), tt=Post(caption="c"))

    outcome = apply_patch(record, RecordPatch.model_validate(
        {"description": "same", "posts": {TIKTOK: {"caption": "c"}, "absent": None}}),
        primary_id=PRIMARY, platforms=PLATFORMS)

    assert not outcome.changed and outcome.record == record


def test_apply_patch_published_at_is_the_earliest_visible_post():
    record = loaded(main=Post(published=PostPublished(url="u", at="2026-05-02T00:00:00Z")))

    outcome = apply_patch(record, RecordPatch.model_validate({"posts": {TIKTOK: {
        "published": {"url": "https://tiktok.example/1", "at": "2026-05-01T00:00:00Z"}}}}),
        primary_id=PRIMARY, platforms=PLATFORMS)

    assert outcome.published_at == "2026-05-01T00:00:00Z"


def test_earliest_published_at_skips_hidden_posts_and_a_stamp_that_is_not_iso():
    posts = {
        "a": Post(published=PostPublished(at="2026-01-01T00:00:00Z"), hidden=True),
        "b": Post(published=PostPublished(at="yesterday")),
        "c": Post(published=PostPublished(at="2026-03-01T00:00:00+00:00")),
    }

    assert earliest_published_at(posts) == "2026-03-01T00:00:00+00:00"
    assert earliest_published_at({}) is None


def test_apply_patch_the_legacy_root_publish_stamp_still_applies():
    outcome = apply_patch(loaded(), RecordPatch.model_validate(
        {"publish": {"youtube": {"videoId": "v", "publishedAt": "2026-09-01T10:00:00Z"}}}),
        primary_id=PRIMARY, platforms=PLATFORMS)

    assert outcome.published_at == "2026-09-01T10:00:00Z"
    assert outcome.record.posts[PRIMARY].published.id == "v"
