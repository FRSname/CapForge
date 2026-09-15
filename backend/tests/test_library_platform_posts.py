"""Copy for platform: LinkedIn, X and Instagram posts (publish-editors C1).

The formatters are pure and read the same record and effective brief as the
YouTube package. Findings are reported and never enforced by cutting prose.
"""

from __future__ import annotations

import pytest

from backend.library.brief import Brief
from backend.library.collection_store import Collection
from backend.library.localized import localize_record
from backend.library.package import FULL_VIDEO_URL_PLACEHOLDER
from backend.library.platform_posts import (
    INSTAGRAM,
    INSTAGRAM_MAX_CHARS,
    INSTAGRAM_MAX_HASHTAGS,
    LINKEDIN,
    LINKEDIN_MAX_CHARS,
    LINKEDIN_MAX_HASHTAGS,
    LINKEDIN_MAX_MOMENTS,
    PLATFORMS,
    X,
    X_MAX_WEIGHTED_CHARS,
    X_URL_WEIGHT,
    PlatformPost,
    UnsupportedPlatform,
    render_platform_post,
    weighted_x_length,
)
from backend.library.schemas import (
    Chapter,
    LocalizedFields,
    Publish,
    VideoRecord,
    YouTubePublish,
)
from backend.tests.test_library_package import full_brief, full_record

URL = "https://youtu.be/abc123"
NO_URL = Publish(youtube=YouTubePublish(url=None))
TAGS_LINE = "#CapForge #captions #Whisper"


def post(record: VideoRecord, platform: str, brief: Brief | None = None, **kw) -> PlatformPost:
    return render_platform_post(record, brief if brief is not None else full_brief(), platform, **kw)


def rules(result: PlatformPost) -> list[tuple[str, str, str]]:
    return [(v.field, v.rule, v.severity) for v in result.violations]


def sparse() -> VideoRecord:
    return VideoRecord(id="b" * 32, sourcePath="/videos/sparse.mp4")


def with_tags(record: VideoRecord, count: int) -> VideoRecord:
    return record.model_copy(update={"hashtags": [f"tag{i}" for i in range(count)]})


# --- the layouts on a full record ---------------------------------------------------

def test_the_linkedin_post_on_a_full_record() -> None:
    result = post(full_record(), LINKEDIN)

    assert result.text == (
        "How CapForge renders captions locally.\n\n"
        "The render farm was the bottleneck.\n\n"
        "Here is the pipeline we run instead.\n\n"
        "In this video:\n"
        "00:00 Intro\n"
        "01:01 The pipeline\n"
        "1:01:01 Wrap up\n\n"
        f"Watch: {URL}\n\n"
        f"{TAGS_LINE}"
    )
    assert result.violations == ()


def test_the_x_post_on_a_full_record() -> None:
    result = post(full_record(), X)

    assert result.text == f"Captions without a render farm\n\n{URL}\n\n{TAGS_LINE}"
    assert result.violations == ()


def test_the_instagram_post_on_a_full_record() -> None:
    result = post(full_record(), INSTAGRAM)

    assert result.text == f"How CapForge renders captions locally.\n\nLink in bio\n\n{TAGS_LINE}"
    assert URL not in result.text
    assert result.violations == ()


def test_no_post_prints_the_footer_or_the_brief_boilerplate() -> None:
    for platform in PLATFORMS:
        text = post(full_record(), platform).text
        assert "Subscribe for more." not in text and "Recorded at PyCon" not in text
        assert "https://capforge.app" not in text
        assert "=" * 69 not in text


def test_a_collection_footer_is_not_printed_either() -> None:
    collection = Collection.model_validate({
        "id": "uck26", "name": "UCK 26", "slots": {"event": "UCK"},
        "createdAt": "2026-09-15T00:00:00Z", "updatedAt": "2026-09-15T00:00:00Z",
        "overrides": {"footer": "Recorded at {{event}}.", "default_hashtags": ["#UCK"]},
    })
    result = post(full_record(), LINKEDIN, collection=collection)

    assert "Recorded at" not in result.text
    assert result.text.endswith("#UCK #captions #Whisper")


# --- the layouts on a sparse record -------------------------------------------------

def test_the_linkedin_post_on_an_empty_record() -> None:
    result = post(sparse(), LINKEDIN, Brief())

    assert result.text == f"Watch: {FULL_VIDEO_URL_PLACEHOLDER}"
    assert rules(result) == [
        ("package.linkedin", "video_url_missing", "style"),
        ("package.linkedin", "linkedin_hashtags", "style"),
    ]


def test_the_x_post_on_an_empty_record() -> None:
    result = post(sparse(), X, Brief())

    assert result.text == FULL_VIDEO_URL_PLACEHOLDER
    assert rules(result) == [("package.x", "video_url_missing", "style")]


def test_the_instagram_post_on_an_empty_record() -> None:
    result = post(sparse(), INSTAGRAM, Brief())

    assert result.text == "Link in bio"
    assert result.violations == ()


def test_without_a_short_description_linkedin_leads_with_the_first_paragraph() -> None:
    record = full_record().model_copy(update={
        "short_description": "", "chapters": [],
        "description": "First paragraph.\r\n\r\n\r\nSecond one.\n  \nThird one.",
    })

    text = post(record, LINKEDIN).text

    assert text.startswith("First paragraph.\n\nSecond one.\n\nThird one.\n\nWatch: ")
    assert "\r" not in text and "In this video:" not in text


def test_without_a_short_description_instagram_uses_the_first_paragraph() -> None:
    record = full_record().model_copy(update={"short_description": "  "})

    assert post(record, INSTAGRAM).text.startswith("The render farm was the bottleneck.\n\nLink in bio")


def test_without_a_title_x_uses_the_short_description() -> None:
    record = full_record().model_copy(update={"title": " "})

    assert post(record, X).text.startswith("How CapForge renders captions locally.\n\n")


def test_linkedin_lists_at_most_five_titled_chapters() -> None:
    chapters = [Chapter(start_s=60 * i, title=f"Part {i}" if i != 1 else " ") for i in range(8)]
    record = full_record().model_copy(update={"chapters": chapters})

    text = post(record, LINKEDIN).text

    lines = text.split("In this video:\n", 1)[1].split("\n\n", 1)[0].split("\n")
    assert len(lines) == LINKEDIN_MAX_MOMENTS
    assert lines == ["00:00 Part 0", "02:00 Part 2", "03:00 Part 3", "04:00 Part 4", "05:00 Part 5"]


def test_rendering_is_deterministic_and_never_mutates_its_inputs() -> None:
    record, brief = full_record(), full_brief()
    before = (record.model_dump(), brief.model_dump())

    for platform in PLATFORMS:
        assert post(record, platform, brief) == post(record, platform, brief)

    assert (record.model_dump(), brief.model_dump()) == before


def test_an_unknown_platform_is_refused() -> None:
    with pytest.raises(UnsupportedPlatform, match="tiktok"):
        post(full_record(), "tiktok")


# --- hashtags -------------------------------------------------------------------------

def test_linkedin_prints_the_first_five_hashtags() -> None:
    text = post(with_tags(full_record(), 9), LINKEDIN, Brief()).text

    assert text.endswith("\n\n#tag0 #tag1 #tag2 #tag3 #tag4")
    assert LINKEDIN_MAX_HASHTAGS == 5


@pytest.mark.parametrize("count,flagged", [(0, True), (2, True), (3, False), (6, False)])
def test_linkedin_flags_fewer_than_three_hashtags(count: int, flagged: bool) -> None:
    result = post(with_tags(full_record(), count), LINKEDIN, Brief())

    assert (("package.linkedin", "linkedin_hashtags", "style") in rules(result)) is flagged


def test_instagram_keeps_thirty_hashtags_in_one_block_and_reports_the_rest() -> None:
    at_cap = post(with_tags(full_record(), INSTAGRAM_MAX_HASHTAGS), INSTAGRAM, Brief())
    over = post(with_tags(full_record(), INSTAGRAM_MAX_HASHTAGS + 4), INSTAGRAM, Brief())

    assert at_cap.violations == ()
    block = over.text.rsplit("\n\n", 1)[1]
    assert block.split(" ") == [f"#tag{i}" for i in range(INSTAGRAM_MAX_HASHTAGS)]
    assert rules(over) == [("package.instagram", "instagram_hashtags_trimmed", "style")]
    assert "4" in over.violations[0].message


def test_hashtags_come_from_the_brief_defaults_then_the_record_deduped() -> None:
    brief = Brief(default_hashtags=["Whisper", "#Brand"])

    assert post(full_record(), INSTAGRAM, brief).text.endswith("#Whisper #Brand #captions")


def test_x_drops_hashtags_from_the_end_until_the_post_fits() -> None:
    # 240 + "\n\n" + 23 (the URL) = 265; all three tags make 286, two make 279.
    title = "T" * 240
    record = full_record().model_copy(update={"title": title, "hashtags": ["alpha", "beta", "gamma"]})

    result = post(record, X, Brief())

    assert result.text == f"{title}\n\n{URL}\n\n#alpha #beta"
    assert weighted_x_length(result.text) == 279 <= X_MAX_WEIGHTED_CHARS
    assert result.violations == ()


def test_x_never_cuts_the_prose_and_drops_every_hashtag_when_nothing_fits() -> None:
    title = "T" * 300
    record = full_record().model_copy(update={"title": title})

    result = post(record, X)

    assert result.text == f"{title}\n\n{URL}"
    assert rules(result) == [("package.x", "x_max_chars", "hard")]
    assert str(weighted_x_length(result.text)) in result.violations[0].message


# --- the video URL -------------------------------------------------------------------

def test_weighted_x_length_counts_every_url_as_twenty_three() -> None:
    long_url = "https://example.com/" + "a" * 80
    assert weighted_x_length("hi") == 2
    assert weighted_x_length(long_url) == X_URL_WEIGHT
    assert weighted_x_length(f"a {long_url} b http://x.y") == len("a  b ") + 2 * X_URL_WEIGHT


def test_the_placeholder_is_weighted_as_the_url_it_stands_for() -> None:
    assert weighted_x_length(f"hi\n\n{FULL_VIDEO_URL_PLACEHOLDER}") == 4 + X_URL_WEIGHT


@pytest.mark.parametrize("platform,line", [
    (LINKEDIN, f"Watch: {FULL_VIDEO_URL_PLACEHOLDER}"),
    (X, FULL_VIDEO_URL_PLACEHOLDER),
])
def test_a_missing_url_prints_the_placeholder_and_reports_it(platform: str, line: str) -> None:
    record = full_record().model_copy(update={"publish": NO_URL})

    result = post(record, platform)

    assert f"\n\n{line}\n\n" in result.text
    assert rules(result) == [(f"package.{platform}", "video_url_missing", "style")]
    assert FULL_VIDEO_URL_PLACEHOLDER in result.violations[0].message


def test_instagram_needs_no_url() -> None:
    record = full_record().model_copy(update={"publish": NO_URL})

    result = post(record, INSTAGRAM)

    assert FULL_VIDEO_URL_PLACEHOLDER not in result.text
    assert result.violations == ()


# --- the length rules ----------------------------------------------------------------

def _linkedin_of_length(length: int) -> VideoRecord:
    """A LinkedIn post whose text is exactly ``length`` characters."""
    fixed = len(f"\n\nWatch: {URL}\n\n{TAGS_LINE}")
    return full_record().model_copy(update={
        "short_description": "S" * (length - fixed), "description": "", "chapters": [],
    })


def _instagram_of_length(length: int) -> VideoRecord:
    fixed = len(f"\n\nLink in bio\n\n{TAGS_LINE}")
    return full_record().model_copy(update={"short_description": "S" * (length - fixed)})


def _x_of_length(length: int) -> VideoRecord:
    fixed = 2 + X_URL_WEIGHT  # "\n\n" + the URL; no hashtags in an empty brief
    return full_record().model_copy(update={"title": "T" * (length - fixed), "hashtags": []})


@pytest.mark.parametrize("platform,build,limit,rule,brief", [
    (LINKEDIN, _linkedin_of_length, LINKEDIN_MAX_CHARS, "linkedin_max_chars", None),
    (INSTAGRAM, _instagram_of_length, INSTAGRAM_MAX_CHARS, "instagram_max_chars", None),
    (X, _x_of_length, X_MAX_WEIGHTED_CHARS, "x_max_chars", Brief()),
])
def test_each_length_rule_at_and_over_the_limit(platform, build, limit, rule, brief) -> None:
    at = post(build(limit), platform, brief)
    over = post(build(limit + 1), platform, brief)

    measure = weighted_x_length if platform == X else len
    assert measure(at.text) == limit and measure(over.text) == limit + 1
    assert rule not in [v.rule for v in at.violations]
    assert (f"package.{platform}", rule, "hard") in rules(over)
    assert str(limit) in next(v.message for v in over.violations if v.rule == rule)


def test_the_limits_are_the_platforms_own() -> None:
    assert (LINKEDIN_MAX_CHARS, X_MAX_WEIGHTED_CHARS, INSTAGRAM_MAX_CHARS) == (3000, 280, 2200)
    assert (X_URL_WEIGHT, INSTAGRAM_MAX_HASHTAGS) == (23, 30)


# --- a localized view flows through --------------------------------------------------

def test_a_localized_view_substitutes_its_fields_in_every_post() -> None:
    record = full_record().model_copy(update={
        "language": "en",
        "localized": {"de": LocalizedFields(
            title="Untertitel ohne Renderfarm",
            short_description="Wie CapForge lokal rendert.",
            hashtags=["Untertitel"],
            chapter_titles=["Einleitung"],
        )},
    })
    view = localize_record(record, "de")

    linkedin = post(view, LINKEDIN).text
    assert linkedin.startswith("Wie CapForge lokal rendert.\n\n")
    assert "00:00 Einleitung\n01:01 The pipeline" in linkedin
    assert linkedin.endswith("#CapForge #captions #Untertitel")
    assert post(view, X).text.startswith("Untertitel ohne Renderfarm\n\n")
    assert post(view, INSTAGRAM).text.startswith("Wie CapForge lokal rendert.\n\nLink in bio")
