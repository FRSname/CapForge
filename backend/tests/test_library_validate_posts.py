"""One channel's post judged by its platform (docs/plans/multi-channel-pr2-contract.md)."""

from __future__ import annotations

import pytest

from backend.library.channels import Channel, ChannelBook, ChannelProfile
from backend.library.platforms import (
    INSTAGRAM_MAX_HASHTAGS,
    INSTAGRAM_MAX_MENTIONS,
    LINKEDIN_MIN_HASHTAGS,
    TIKTOK_MAX_CAPTION_UTF16,
    X_MAX_WEIGHTED_CHARS,
    X_URL_WEIGHT,
)
from backend.library.record_projection import project
from backend.library.schemas import Post, PostPublished, RecordPatch, Thumbnail, VideoRecord
from backend.library.validate import TITLE_MAX_CHARS
from backend.library.validate_posts import (
    ambiguous_findings,
    pasted_text,
    patch_post_findings,
    post_findings,
    unknown_channel_findings,
)

FRAME = "b" * 32 + ".jpg"
EMOJI = "\N{GRINNING FACE}"  # 2 UTF-16 units


def channel(cid: str, platform: str, **profile) -> Channel:
    return Channel(id=cid, platform=platform, name=cid.title(), createdAt="t", updatedAt="t",
                   profile=ChannelProfile(**profile))


MAIN = channel("main", "youtube")
TT = channel("tt", "tiktok")
IG = channel("ig", "instagram")
LI = channel("li", "linkedin")
XX = channel("xx", "x")
BOOK = ChannelBook(primary_id="main", channels=[MAIN, TT, IG, LI, XX])


def judge(ch: Channel, post: Post, *, with_style: bool = True, **record) -> list[tuple[str, str, str]]:
    base = VideoRecord(id="e" * 32, title="Library name", language="en",
                       thumbnail=Thumbnail(candidates=[FRAME]), **record)
    loaded = project(base.model_copy(update={"posts": {ch.id: post}}), "main")
    found = post_findings(loaded, ch, collection=None, duration=None, with_style=with_style)
    return [(v.field, v.rule, v.severity) for v in found]


def test_a_tiktok_caption_is_counted_in_utf16_units_on_the_pasted_text():
    at_limit = EMOJI * (TIKTOK_MAX_CAPTION_UTF16 // 2)
    over = at_limit + "a"

    assert judge(TT, Post(caption=at_limit)) == []
    assert judge(TT, Post(caption=over)) == [("posts.tt.caption", "tiktok_max_chars", "hard")]


def test_the_hashtag_line_counts_toward_the_limit():
    body = "a" * (TIKTOK_MAX_CAPTION_UTF16 - 4)  # + "\n\n#b" = 2200 exactly
    tt_with_default = channel("tt", "tiktok", default_hashtags=["c"])

    assert pasted_text(Post(caption=body, hashtags=["b"]), TT) == body + "\n\n#b"
    assert judge(TT, Post(caption=body, hashtags=["b"])) == []
    assert ("posts.tt.caption", "tiktok_max_chars", "hard") in judge(
        tt_with_default, Post(caption=body, hashtags=["b"]))


def test_tiktok_hashtags_over_five_is_style():
    assert judge(TT, Post(caption="x", hashtags=list("abcdef"))) == [
        ("posts.tt.hashtags", "tiktok_hashtags", "style")]
    assert judge(TT, Post(caption="x", hashtags=list("abcdef")), with_style=False) == []


def test_instagram_hashtags_mentions_and_urls():
    many_tags = [f"t{i}" for i in range(INSTAGRAM_MAX_HASHTAGS + 1)]
    mentions = " ".join(f"@u{i}" for i in range(INSTAGRAM_MAX_MENTIONS + 1))

    assert judge(IG, Post(caption="x", hashtags=many_tags)) == [
        ("posts.ig.hashtags", "instagram_hashtags", "hard")]
    assert judge(IG, Post(caption=mentions)) == [("posts.ig.caption", "instagram_max_mentions", "hard")]
    assert judge(IG, Post(caption="see https://a.example")) == [
        ("posts.ig.caption", "instagram_caption_url", "style")]
    assert judge(IG, Post(caption="mail me at a@b.example")) == []


def test_linkedin_hashtag_window_is_style_and_quiet_without_a_body():
    few = ["a"] * 0 + ["a", "b"][: LINKEDIN_MIN_HASHTAGS - 1]

    assert judge(LI, Post(text="hello", hashtags=few)) == [("posts.li.hashtags", "linkedin_hashtags", "style")]
    assert judge(LI, Post(hashtags=few)) == []
    assert judge(LI, Post(text="hello", hashtags=list("abcdef"))) == [
        ("posts.li.hashtags", "linkedin_hashtags", "style")]


def test_x_counts_a_url_as_its_weight():
    url = "https://example.com/" + "p" * 100
    fits = "a" * (X_MAX_WEIGHTED_CHARS - X_URL_WEIGHT - 1) + " " + url

    assert judge(XX, Post(text=fits)) == []
    assert judge(XX, Post(text="a" + fits)) == [("posts.xx.text", "x_max_chars", "hard")]


@pytest.mark.parametrize("ch,post,field", [
    (TT, Post(title="Nope"), "title"),
    (TT, Post(tags=["a"]), "tags"),
    (MAIN, Post(caption="Nope"), "caption"),
    (IG, Post(localized={"de": {"title": "T"}}), "localized"),
    (XX, Post(cover=FRAME), "cover"),
])
def test_a_filled_field_the_platform_lacks_is_hard(ch, post, field):
    assert (f"posts.{ch.id}.{field}", "field_not_on_platform", "hard") in judge(ch, post)


def test_the_universal_fields_are_allowed_everywhere():
    post = Post(caption="x", language="de", hidden=True, published=PostPublished(url="https://t.example"))

    assert judge(TT, post) == []


def test_a_youtube_post_is_judged_by_todays_rules_under_its_own_address():
    found = judge(MAIN, Post(title="T" * (TITLE_MAX_CHARS + 1), description="a <b>",
                             localized={"en": {"title": "Source"}}))

    assert ("posts.main.title", "title_max_chars", "hard") in found
    assert ("posts.main.description", "no_angle_brackets", "hard") in found
    assert ("posts.main.localized.en", "localized_is_source", "hard") in found


def test_a_youtube_post_title_falls_back_to_the_root_and_record_findings_stay_out():
    found = judge(MAIN, Post(description="ok"),
                  chapters=[{"start_s": 5, "title": "Late start"}])

    assert found == []


def test_a_cover_that_is_not_a_candidate_is_hard_on_any_platform():
    assert judge(TT, Post(cover="c" * 32 + ".jpg")) == [("posts.tt.cover", "cover_not_a_candidate", "hard")]
    assert judge(TT, Post(cover=FRAME)) == []


def test_published_at_must_be_iso():
    assert judge(TT, Post(published=PostPublished(at="last tuesday"))) == [
        ("posts.tt.published.at", "published_at_iso", "hard")]


def test_unknown_channels_are_refused_but_removing_a_stored_post_is_not():
    patch = RecordPatch.model_validate({"posts": {"nope": {"caption": "x"}, "old": None, "gone": None}})

    found = unknown_channel_findings(patch, BOOK, {"old": Post()})

    assert [(v.field, v.rule) for v in found] == [("posts.nope", "unknown_channel"), ("posts.gone", "unknown_channel")]


@pytest.mark.parametrize("body,field", [
    ({"description": "a", "posts": {"main": {"description": "b"}}}, "description"),
    ({"localized": {}, "posts": {"main": {"localized": {}}}}, "localized"),
    ({"thumbnail": {"cover": None}, "posts": {"main": {"cover": None}}}, "cover"),
    ({"publish": {"youtube": {"url": "u"}}, "posts": {"main": {"published": {"url": "u"}}}}, "published"),
])
def test_a_projected_field_sent_both_ways_is_ambiguous(body, field):
    found = ambiguous_findings(RecordPatch.model_validate(body), "main")

    assert [(v.field, v.rule) for v in found] == [(f"posts.main.{field}", "ambiguous_post_field")]


@pytest.mark.parametrize("body", [
    {"title": "Library", "posts": {"main": {"title": "Post"}}},
    {"description": "a", "posts": {"main": {"tags": ["b"]}, "tt": {"description": "c"}}},
    {"thumbnail": {"ideas": []}, "posts": {"main": {"cover": None}}},
    {"publish": {"pushes": []}, "posts": {"main": {"published": {"url": "u"}}}},
])
def test_different_fields_or_channels_are_not_ambiguous(body):
    assert ambiguous_findings(RecordPatch.model_validate(body), "main") == []


def test_patch_post_findings_judges_only_the_written_posts_and_only_hard_rules():
    record = project(VideoRecord(id="f" * 32, posts={
        "ig": Post(caption="x", hashtags=[f"t{i}" for i in range(INSTAGRAM_MAX_HASHTAGS + 1)]),
        "tt": Post(caption="x", hashtags=list("abcdef")),
    }), "main")
    patch = RecordPatch.model_validate({"posts": {"tt": {"caption": "x"}}})

    found = patch_post_findings(record, patch, book=BOOK, stored_posts=record.posts, collection=None)

    assert found == []
