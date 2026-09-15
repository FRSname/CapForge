"""The package with collections and template slots (collections plan, decisions 3–5).

``test_library_package.py`` is the byte-identity proof on its golden and stays
untouched; this file adds the edge cases that golden cannot show (blank-line runs
inside a block, a speaker block ending in a newline, braces that are not slots),
pinned from the output the package printed *before* templates existed.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.library.brief import Brief
from backend.library.collection_store import (
    BriefOverrides,
    CollectionCreate,
    CollectionPatch,
)
from backend.library.package import render_youtube_package
from backend.library.schemas import Link, RecordPatch, Speaker, VideoRecord
from backend.library.store import LibraryStore
from backend.library.template import DEFAULT_DESCRIPTION_TEMPLATE
from backend.library.validate import (
    DESCRIPTION_MAX_BYTES,
    package_violations,
    validate_record,
)
from backend.tests.test_library_package import GOLDEN, full_brief, full_record

SOURCE_NAME = "talk.mp4"
RULE = "=" * 69
EXIT_TEST_MEMBERS = 3

#: Captured from the pre-template ``_description_section`` on 2026-09-15.
LEGACY_BLANK_RUNS = (
    f"{RULE}\nDESCRIPTION\n{RULE}\n\nOne\n\n\nTwo\n\nSpeaker: Ada\n\n\n"
    f"{RULE}\nNOTES\n{RULE}\nSource: CapForge transcript, talk.mp4\n"
    "Description: 9 characters, 9 bytes\nShorts caption: 0 characters\nChapters: none\n"
)
LEGACY_LITERAL_BRACES = (
    f"{RULE}\nDESCRIPTION\n{RULE}\n\nRecorded\n\nThanks\n\n\n\nBye {{{{ not a slot }}}} {{{{}}}}"
    f"\n\n#x\n\n{RULE}\nNOTES\n{RULE}\nSource: CapForge transcript, talk.mp4, 00:12\n"
    "Description: 0 characters, 0 bytes\nShorts caption: 0 characters\nChapters: none\n"
)


def render(record: VideoRecord, brief: Brief, **kw) -> str:
    return render_youtube_package(record, brief, duration=None, source_name=SOURCE_NAME, **kw)


def rules(found) -> list[tuple[str, str, str]]:
    return [(v.field, v.rule, v.severity) for v in found]


# --- byte identity -----------------------------------------------------------

def test_the_explicit_default_template_renders_the_golden():
    brief = full_brief().model_copy(update={"description_template": DEFAULT_DESCRIPTION_TEMPLATE})

    text = render_youtube_package(full_record(), brief, duration=3724.0, source_name=SOURCE_NAME)

    assert text == GOLDEN.read_text(encoding="utf-8")


def test_a_whitespace_only_template_is_the_default_layout():
    brief = full_brief().model_copy(update={"description_template": "  \n "})

    text = render_youtube_package(full_record(), brief, duration=3724.0, source_name=SOURCE_NAME)

    assert text == GOLDEN.read_text(encoding="utf-8")


def test_blank_line_runs_inside_a_block_are_byte_identical_to_before():
    record = VideoRecord(id="c" * 32, sourcePath="/v/talk.mp4", description="One\n\n\nTwo",
                         speakers={"SPEAKER_00": Speaker(name="Ada")})

    assert render(record, Brief(speaker_block="Speaker: {{name}}\n")) == LEGACY_BLANK_RUNS


def test_braces_that_are_not_slots_are_byte_identical_to_before():
    record = VideoRecord(id="d" * 32, sourcePath="/v/talk.mp4", hashtags=["x"])
    brief = Brief(footer="  Thanks\n\n\n\nBye {{ not a slot }} {{}}  ", recorded_at_line=" Recorded\n")

    text = render_youtube_package(record, brief, duration=12.0, source_name=SOURCE_NAME)

    assert text == LEGACY_LITERAL_BRACES


def test_the_golden_has_no_package_violations():
    assert package_violations(full_record(), full_brief()) == []


# --- templates and slots -----------------------------------------------------

def test_a_custom_template_reorders_the_description():
    brief = full_brief().model_copy(update={
        "description_template": "{{hashtags}}\n\n{{title}}\n\n{{description}}",
    })

    text = render(full_record(), brief)

    assert f"{RULE}\n\n#CapForge #captions #Whisper\n\nCaptions without a render farm\n\n" \
           "The render farm was the bottleneck." in text
    assert "WHAT YOU'LL LEARN" not in text  # a block the template leaves out is out


def test_channel_and_collection_are_built_in_slots(tmp_path):
    store = LibraryStore(tmp_path / "library")
    try:
        col = store.create_collection(CollectionCreate(id="uck26", name="UCK 2026"))
    finally:
        store.close()
    brief = Brief(channel="CapForge", description_template="{{channel}} at {{collection}}")
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4")

    assert "\nCapForge at UCK 2026\n" in render(record, brief, collection=col)
    assert "\nCapForge at\n" in render(record, brief)  # no collection → empty


def test_slots_expand_inside_the_footer_and_the_recorded_at_line(tmp_path):
    store = LibraryStore(tmp_path / "library")
    try:
        col = store.create_collection(CollectionCreate(
            id="uck26", name="UCK 2026", slots={"event": "UCK 2026"},
            overrides=BriefOverrides(footer="Thanks to {{sponsor}} ({{channel}})"),
        ))
    finally:
        store.close()
    brief = Brief(channel="CapForge", recorded_at_line="Recorded at {{event}}, {{city}}",
                  slots={"event": "Channel event", "city": "Brno", "sponsor": "Acme"})
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4", description="Body")

    text = render(record, brief, collection=col)

    assert "Body\n\nRecorded at UCK 2026, Brno\n\nThanks to Acme (CapForge)\n\n" in text


def test_an_empty_slot_line_in_the_footer_collapses():
    brief = Brief(footer="Thanks\n\n{{sponsor_line}}\n\nBye", slots={"sponsor_line": ""})
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4")

    assert f"{RULE}\n\nThanks\n\nBye\n\n{RULE}" in render(record, brief)


def test_the_speaker_block_keeps_its_own_placeholders_and_expands_nothing_else():
    brief = Brief(speaker_block="{{name}} at {{event}}", slots={"event": "UCK"})
    record = full_record()

    text = render(record, brief)

    assert "Ada Lovelace at {{event}}" in text
    assert package_violations(record, brief) == []  # a speaker block is not a template


def test_a_record_description_is_a_value_and_never_expanded():
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4", description="Use {{event}} here")
    brief = Brief(slots={"event": "UCK"})

    assert "Use {{event}} here" in render(record, brief)
    assert package_violations(record, brief) == []


# --- unknown slots -----------------------------------------------------------

def test_an_unknown_slot_is_printed_listed_in_notes_and_reported():
    brief = Brief(footer="Thanks to {{typo}}", description_template="{{description}}\n\n{{nope}}\n\n{{footer}}")
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4", description="Body")

    text = render(record, brief)

    assert "Body\n\n{{nope}}\n\nThanks to {{typo}}" in text
    notes = text[text.index("\nNOTES\n"):]
    assert "Unknown template slots, printed as written:\n- {{typo}}\n- {{nope}}\n" in notes
    assert rules(package_violations(record, brief)) == [
        ("package.description", "unknown_slot", "hard"),
        ("package.description", "unknown_slot", "hard"),
    ]
    assert "{{typo}}" in package_violations(record, brief)[0].message


def test_a_self_reference_in_the_footer_is_unknown_not_recursive():
    brief = Brief(footer="A {{footer}} B")
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4")

    assert "A {{footer}} B" in render(record, brief)
    assert rules(package_violations(record, brief)) == [("package.description", "unknown_slot", "hard")]


# --- the assembled description ------------------------------------------------

def test_an_assembled_description_over_the_limit_is_reported_on_the_package():
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4", description="d" * 4000)
    brief = Brief(footer="f" * 1500)

    assert validate_record(record, duration=None, brief=brief) == []
    found = package_violations(record, brief)

    assert rules(found) == [("package.description", "description_max_bytes", "hard")]
    assert str(DESCRIPTION_MAX_BYTES) in found[0].message


def test_angle_brackets_the_brief_adds_are_reported_on_the_package():
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4", description="Clean")
    brief = Brief(link_rows=[Link(label="<b>Site</b>", url="https://x.example")])

    assert rules(package_violations(record, brief)) == [
        ("package.description", "no_angle_brackets", "hard"),
    ]


def test_a_collection_footer_is_measured_with_its_overrides(tmp_path):
    store = LibraryStore(tmp_path / "library")
    try:
        col = store.create_collection(CollectionCreate(
            id="uck26", name="UCK", overrides=BriefOverrides(footer="f" * (DESCRIPTION_MAX_BYTES + 1)),
        ))
    finally:
        store.close()
    record = VideoRecord(id="e" * 32, sourcePath="/v/talk.mp4")

    assert package_violations(record, Brief()) == []
    assert rules(package_violations(record, Brief(), collection=col)) == [
        ("package.description", "description_max_bytes", "hard"),
    ]


# --- the exit test: regenerate every member's footer in one pass -----------------

def clip(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(f"media:{name}".encode() * 64)
    return p


@pytest.fixture
def store(tmp_path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def test_changing_the_collection_changes_every_members_package_with_no_record_write(store, tmp_path):
    store.create_collection(CollectionCreate(
        id="uck26", name="UCK 2026", slots={"event": "UCK 2026", "sponsor": "Acme"},
        overrides=BriefOverrides(footer="Recorded at {{event}} — thanks to {{sponsor}}"),
    ))
    members = []
    for index in range(EXIT_TEST_MEMBERS):
        record = store.create(clip(tmp_path / "media", f"talk{index}.mp4"))
        members.append(store.patch(record.id, RecordPatch(collection_id="uck26"),
                                   rev=record.rev, by="user"))

    def packages() -> list[str]:
        col = store.get_collection("uck26")
        return [render(store.get(m.id), Brief(), collection=col) for m in members]

    assert all("Recorded at UCK 2026 — thanks to Acme" in text for text in packages())

    store.patch_collection("uck26", CollectionPatch(slots={"event": "UCK 2026", "sponsor": "Globex"}))

    assert all("Recorded at UCK 2026 — thanks to Globex" in text for text in packages())
    assert [store.get(m.id).rev for m in members] == [m.rev for m in members]
