"""The YouTube upload package — the record rendered as the text the user pastes.

The layout is pinned by a golden file (``fixtures/package_golden.txt``) built
from a fully populated record and brief; the rest of the file covers the two
behaviours the golden cannot show: sections whose data is empty are **dropped**,
and the two placeholders the skill promises are printed *and* listed in NOTES.

``format_timestamp`` is pinned by ``fixtures/timestamp_cases.json``, the shared
fixture the renderer's ``lib/youtubeRules.ts`` twin is asserted against (the
RSVP precedent — one formula, two implementations, one fixture).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.library.brief import Brief
from backend.library.package import format_timestamp, render_youtube_package
from backend.library.schemas import (
    Chapter,
    ClipSuggestion,
    Highlight,
    Link,
    Publish,
    Shorts,
    Speaker,
    Thumbnail,
    ThumbnailIdea,
    VideoRecord,
    YouTubePublish,
)

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN = FIXTURES / "package_golden.txt"
TIMESTAMP_CASES = json.loads((FIXTURES / "timestamp_cases.json").read_text(encoding="utf-8"))

DURATION_S = 3724.0
SOURCE_NAME = "talk.mp4"
RULE = "=" * 69


def full_brief() -> Brief:
    return Brief(
        channel="CapForge",
        audience="Video editors",
        voice="plain",
        footer="Subscribe for more.\nMade with CapForge.",
        recorded_at_line="Recorded at PyCon 2026, 14 September.",
        speaker_block="Speaker: {{name}} ({{handle}})\n{{url}}",
        default_hashtags=["#CapForge", "captions"],
        link_rows=[Link(label="CapForge", url="https://capforge.app")],
    )


def full_record() -> VideoRecord:
    return VideoRecord(
        id="a" * 32,
        sourcePath="/videos/talk.mp4",
        title="Captions without a render farm",
        title_options=[
            "Captions without a render farm",
            "How we ship captions in minutes",
        ],
        description=(
            "The render farm was the bottleneck.\n\n"
            "Here is the pipeline we run instead."
        ),
        short_description="How CapForge renders captions locally.",
        chapters=[
            Chapter(start_s=0, title="Intro"),
            Chapter(start_s=61.25, title="The pipeline"),
            Chapter(start_s=3661, title="Wrap up"),
        ],
        tags=["captions", "whisper", "ffmpeg"],
        hashtags=["captions", "#Whisper"],
        keywords=["captions", "alignment"],
        highlights=[
            Highlight(text="Why a render farm is the wrong tool", start_s=10, end_s=20),
            Highlight(text="How word alignment survives an edit", start_s=100, end_s=120),
        ],
        links=[Link(label="Repo", url="https://github.com/capforge/capforge")],
        shorts=Shorts(
            caption="The render farm was the bottleneck.\nOne laptop, one pass.",
            clip_suggestions=[
                ClipSuggestion(start_s=61.25, end_s=95, why="A self-contained claim"),
                ClipSuggestion(start_s=3661, end_s=3700, why="The demo that failed"),
            ],
        ),
        thumbnail=Thumbnail(ideas=[
            ThumbnailIdea(
                label="Farm", type="text", headline="No render farm",
                visual_suggestion="A dark server rack, crossed out",
            ),
            ThumbnailIdea(
                label="Laptop", type="face", headline="One laptop",
                visual_suggestion="Speaker at a laptop, captions on screen",
                recommended=True,
            ),
        ]),
        speakers={"SPEAKER_00": Speaker(
            name="Ada Lovelace", handle="@ada", url="https://ada.example"
        )},
        publish=Publish(youtube=YouTubePublish(url="https://youtu.be/abc123")),
    )


def render(record: VideoRecord, brief: Brief, *, duration=DURATION_S) -> str:
    return render_youtube_package(
        record, brief, duration=duration, source_name=SOURCE_NAME
    )


# --- format_timestamp --------------------------------------------------------

@pytest.mark.parametrize(
    "case", TIMESTAMP_CASES, ids=[str(c["seconds"]) for c in TIMESTAMP_CASES]
)
def test_format_timestamp_matches_the_shared_fixture(case):
    assert format_timestamp(case["seconds"]) == case["expected"]


def test_the_timestamp_fixture_covers_the_boundaries_the_renderer_twin_needs():
    """A fixture the TS twin is pinned against has to carry the hour boundary."""
    covered = {case["seconds"] for case in TIMESTAMP_CASES}
    assert {0, 59.9, 60, 3599, 3600, 3661, 36000} <= covered
    assert any(case["seconds"] < 0 for case in TIMESTAMP_CASES)
    assert len(TIMESTAMP_CASES) >= 12


# --- the golden --------------------------------------------------------------

def test_a_full_record_renders_the_golden_package():
    assert render(full_record(), full_brief()) == GOLDEN.read_text(encoding="utf-8")


def test_the_golden_uses_the_skills_rule_width():
    assert RULE in GOLDEN.read_text(encoding="utf-8")
    assert len(RULE) == 69


def test_the_section_order_is_the_skills_order():
    lines = render(full_record(), full_brief()).splitlines()
    headers = [
        "TITLE OPTIONS", "DESCRIPTION", "TAGS", "SHORT DESCRIPTION",
        "SHORTS", "THUMBNAIL IDEAS", "NOTES",
    ]

    positions = [lines.index(h) for h in headers]

    assert positions == sorted(positions)


def test_rendering_never_mutates_the_record_or_the_brief():
    record, brief = full_record(), full_brief()

    render(record, brief)

    assert record == full_record() and brief == full_brief()


def test_the_chosen_title_leads_the_options_even_when_it_is_not_one_of_them():
    record = full_record().model_copy(update={
        "title": "The title the user picked",
        "title_options": ["A", "B"],
    })

    lines = render(record, full_brief()).splitlines()

    assert lines[:4] == [
        "TITLE OPTIONS", "1. The title the user picked", "2. A", "3. B"
    ]


# --- dropped sections --------------------------------------------------------

def empty_record() -> VideoRecord:
    return VideoRecord(id="b" * 32, sourcePath="/videos/talk.mp4")


def test_an_empty_record_renders_notes_and_nothing_else():
    text = render_youtube_package(
        empty_record(), Brief(), duration=None, source_name=SOURCE_NAME
    )

    assert text == "\n".join([
        RULE, "NOTES", RULE,
        f"Source: CapForge transcript, {SOURCE_NAME}",
        "Description: 0 characters, 0 bytes",
        "Shorts caption: 0 characters",
        "Chapters: none",
        "",
    ])


@pytest.mark.parametrize("header", [
    "TITLE OPTIONS", "DESCRIPTION", "TAGS", "SHORT DESCRIPTION", "SHORTS",
    "THUMBNAIL IDEAS", "WHAT YOU'LL LEARN", "CHAPTERS", "LINKS",
    "CAPTION", "CLIP CANDIDATES",
])
def test_no_header_is_printed_with_nothing_under_it(header):
    text = render_youtube_package(
        empty_record(), Brief(), duration=None, source_name=SOURCE_NAME
    )

    assert header not in text


def test_an_empty_brief_drops_only_the_brief_blocks():
    record = full_record()

    text = render(record, Brief())

    assert "Recorded at" not in text and "Speaker:" not in text
    assert "Subscribe for more." not in text
    assert "#captions #Whisper" in text  # the record's own hashtags survive
    assert "Repo: https://github.com/capforge/capforge" in text
    assert "CapForge: https://capforge.app" not in text  # the brief's link row


def test_a_description_with_no_body_still_prints_its_chapters():
    record = full_record().model_copy(update={"description": ""})

    text = render(record, full_brief())

    assert "\nDESCRIPTION\n" in text and "\nCHAPTERS\n" in text
    assert "Description: 0 characters, 0 bytes" in text


def test_shorts_without_a_caption_or_clips_drops_the_whole_section():
    record = full_record().model_copy(update={"shorts": Shorts()})

    text = render(record, full_brief())

    assert "\nSHORTS\n" not in text
    assert "Full video:" not in text


def test_a_thumbnail_idea_without_a_visual_suggestion_is_just_its_headline():
    record = full_record().model_copy(update={"thumbnail": Thumbnail(ideas=[
        ThumbnailIdea(label="Plain", type="text", headline="No render farm"),
    ])})

    text = render(record, full_brief())

    assert "\nNo render farm\n" in text
    assert "No render farm —" not in text


# --- placeholders ------------------------------------------------------------

def unnamed_speaker_record() -> VideoRecord:
    return full_record().model_copy(update={
        "speakers": {"SPEAKER_00": Speaker(name="")},
        "publish": Publish(),
    })


def test_an_unnamed_speaker_prints_the_placeholder_and_lists_it_in_notes():
    text = render(unnamed_speaker_record(), full_brief())

    assert "Speaker: [SPEAKER NAME] ()" in text
    assert "Placeholders still open:" in text
    assert "- [SPEAKER NAME] for SPEAKER_00" in text


def test_a_missing_published_url_prints_the_placeholder_and_lists_it():
    text = render(unnamed_speaker_record(), full_brief())

    assert "Full video: [FULL VIDEO URL]" in text
    assert "- [FULL VIDEO URL]" in text


def test_a_complete_record_lists_no_open_placeholders():
    assert "Placeholders still open" not in render(full_record(), full_brief())


def test_without_a_speaker_block_there_is_no_speaker_placeholder():
    """No template means no speaker section, so nothing is left open there."""
    brief = full_brief().model_copy(update={"speaker_block": ""})

    text = render(unnamed_speaker_record(), brief)

    assert "[SPEAKER NAME]" not in text
    assert "- [FULL VIDEO URL]" in text  # the other placeholder is untouched


def test_a_single_chapter_reports_no_minimum_gap():
    record = full_record().model_copy(update={
        "chapters": [Chapter(start_s=0, title="All of it")]
    })

    text = render(record, full_brief())

    assert "Chapters: 1, first 00:00\n" in text
    assert "minimum gap" not in text


# --- unnamed diarized speakers -------------------------------------------------

def test_a_transcript_speaker_the_record_has_not_named_becomes_a_placeholder():
    """The skill's unknown-speaker rule: never drop a diarized speaker silently."""
    from backend.library.brief import Brief
    from backend.library.package import SPEAKER_NAME_PLACEHOLDER, render_youtube_package
    from backend.library.schemas import Speaker, VideoRecord

    record = VideoRecord(
        id="a" * 32, rev=1, fingerprint="f", sourceTag="t", sourcePath="/x/talk.mp4",
        createdAt="2026-01-01T00:00:00Z", updatedAt="2026-01-01T00:00:00Z",
        speakers={"SPEAKER_00": Speaker(name="Filip")},
    )
    text = render_youtube_package(
        record, Brief(speaker_block="Speaker: {{name}}"), duration=300.0,
        source_name="talk.mp4", diarized_ids=["SPEAKER_00", "SPEAKER_01"],
    )
    assert "Speaker: Filip" in text
    assert f"Speaker: {SPEAKER_NAME_PLACEHOLDER}" in text
    assert f"{SPEAKER_NAME_PLACEHOLDER} for SPEAKER_01" in text
    # Order: the record's named speaker first, then the unnamed transcript one.
    assert text.index("Speaker: Filip") < text.index(f"Speaker: {SPEAKER_NAME_PLACEHOLDER}")


# --- the cover file (publish-editors Part A, decision 5) ----------------------

COVER_NAME = "c" * 32 + ".jpg"


def with_cover(record: VideoRecord, *, ideas: bool = True) -> VideoRecord:
    thumbnail = record.thumbnail.model_copy(update={
        "candidates": ["d" * 32 + ".jpg", COVER_NAME],
        "cover": COVER_NAME,
        **({} if ideas else {"ideas": []}),
    })
    return record.model_copy(update={"thumbnail": thumbnail})


def thumbnail_section(text: str) -> str:
    return text.split("THUMBNAIL IDEAS", 1)[1].split("NOTES", 1)[0]


def test_a_cover_prints_its_absolute_file_under_thumbnail_ideas(tmp_path):
    folder = tmp_path / "library" / ("a" * 32)

    text = render_youtube_package(
        with_cover(full_record()), full_brief(), duration=DURATION_S,
        source_name=SOURCE_NAME, record_folder=folder,
    )

    section = thumbnail_section(text)
    assert f"Cover file: {folder / 'thumbnails' / COVER_NAME}" in section
    assert section.index("No render farm") < section.index("Cover file:")


def test_a_cover_with_no_ideas_still_prints_the_section(tmp_path):
    text = render_youtube_package(
        with_cover(full_record(), ideas=False), full_brief(), duration=DURATION_S,
        source_name=SOURCE_NAME, record_folder=tmp_path,
    )

    assert f"Cover file: {tmp_path / 'thumbnails' / COVER_NAME}" in thumbnail_section(text)


def test_with_no_cover_the_package_is_byte_identical_given_a_folder(tmp_path):
    record = full_record().model_copy(update={"thumbnail": full_record().thumbnail.model_copy(
        update={"candidates": [COVER_NAME]}
    )})

    with_folder = render_youtube_package(
        record, full_brief(), duration=DURATION_S, source_name=SOURCE_NAME,
        record_folder=tmp_path,
    )

    assert with_folder == render(full_record(), full_brief())
    assert with_folder == GOLDEN.read_text(encoding="utf-8")


def test_a_cover_without_a_folder_prints_no_line():
    assert "Cover file:" not in render(with_cover(full_record()), full_brief())
