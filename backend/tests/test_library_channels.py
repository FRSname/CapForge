"""Channels: models, the brief view, the bootstrap and the store's CRUD.

Contract: docs/plans/multi-channel-pr1-contract.md. The store tests go through
``LibraryStore`` because every channel write holds the store's ``write_lock``.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.library.brief import BRIEF_FILE, Brief, BriefPatch, HouseRules
from backend.library.channel_store import CHANNELS_FILE
from backend.library.channels import (
    PLACEHOLDER_NAME,
    PROFILE_FIELDS,
    Channel,
    ChannelContext,
    ChannelCreate,
    ChannelPatch,
    ChannelProfile,
    bootstrap_channel,
    brief_from_channel,
    channel_patch_from_brief,
    patched_channel,
)
from backend.library.errors import (
    ChannelExists,
    ChannelIsPrimary,
    ChannelNotFound,
    ChannelsUnreadable,
    PrimaryNotYoutube,
)
from backend.library.schemas import Link
from backend.library.store import LibraryStore

NAME_MAX_CHARS = 120
STAMP = "2026-09-15T10:00:00Z"


@pytest.fixture
def root(tmp_path: Path) -> Path:
    path = tmp_path / "library"
    path.mkdir()
    return path


@pytest.fixture
def store(root: Path):
    s = LibraryStore(root)
    yield s
    s.close()


def full_brief(**over) -> Brief:
    base = dict(
        channel="Update Conference",
        audience="Czech developers",
        voice="plain, no hype",
        language="cs",
        footer="Subscribe.\nMade with CapForge.",
        recorded_at_line="Recorded at Update 2026.",
        speaker_block="Speaker: {{name}}",
        default_hashtags=["#update", "#conf"],
        link_rows=[Link(label="Site", url="https://update.cz")],
        house_rules=HouseRules(no_em_dashes=True, description_chars=(1800, 2200),
                               keywords_terms=(12, 20), hook_first_150=False),
        description_template="{{description}}\n\n{{footer}}",
        slots={"sponsor": "Acme"},
    )
    return Brief(**{**base, **over})


def write_brief(root: Path, brief: Brief) -> None:
    (root / BRIEF_FILE).write_text(json.dumps(brief.model_dump(mode="json")), encoding="utf-8")


def channels_json(root: Path) -> dict:
    return json.loads((root / CHANNELS_FILE).read_text(encoding="utf-8"))


def stored_channel(**over) -> dict:
    base = {
        "id": "update-conference", "platform": "youtube", "name": "Update Conference",
        "handle": "", "url": "", "language": "", "context": {}, "profile": {},
        "createdAt": STAMP, "updatedAt": STAMP,
    }
    return {**base, **over}


def write_channels(root: Path, body) -> None:
    text = body if isinstance(body, str) else json.dumps(body)
    (root / CHANNELS_FILE).write_text(text, encoding="utf-8")


# --- models --------------------------------------------------------------------

@pytest.mark.parametrize("model", [
    ChannelContext, ChannelProfile, Channel, ChannelCreate, ChannelPatch,
])
def test_every_channel_model_forbids_unknown_keys(model):
    assert model.model_config.get("extra") == "forbid"


def test_the_context_fields_and_defaults():
    assert ChannelContext().model_dump() == {
        "about": "", "audience": "", "voice": "", "title_style": "", "example_titles": [],
        "naming": "", "example_slugs": [], "keywords": [], "notes": "",
    }


def test_the_profile_is_exactly_the_briefs_boilerplate_with_its_defaults():
    assert tuple(ChannelProfile.model_fields) == PROFILE_FIELDS
    assert PROFILE_FIELDS == (
        "footer", "recorded_at_line", "speaker_block", "default_hashtags", "link_rows",
        "house_rules", "description_template", "slots",
    )
    brief_defaults = Brief().model_dump()
    assert ChannelProfile().model_dump() == {name: brief_defaults[name] for name in PROFILE_FIELDS}


@pytest.mark.parametrize("model", [ChannelProfile, lambda **kw: ChannelPatch(profile=kw)])
@pytest.mark.parametrize("slots", [{"footer": "x"}, {"Bad": "x"}])
def test_profile_slot_names_are_validated(model, slots):
    with pytest.raises(ValidationError):
        model(slots=slots)


@pytest.mark.parametrize("bad", ["Update", "-u", "u_x", "", "a" * 65])
def test_a_malformed_channel_id_is_refused(bad):
    with pytest.raises(ValidationError):
        ChannelCreate(id=bad, platform="youtube", name="U")


@pytest.mark.parametrize("name", ["", "   ", "x" * (NAME_MAX_CHARS + 1)])
def test_a_channel_name_must_be_1_to_120_characters(name):
    with pytest.raises(ValidationError):
        ChannelCreate(platform="youtube", name=name)


def test_the_name_is_stripped():
    assert ChannelCreate(platform="x", name="  Filip  ").name == "Filip"


def test_an_unknown_platform_is_refused():
    with pytest.raises(ValidationError):
        ChannelCreate(platform="myspace", name="M")


@pytest.mark.parametrize("missing", ["platform", "name"])
def test_create_needs_platform_and_name(missing):
    body = {"platform": "youtube", "name": "U"}
    body.pop(missing)
    with pytest.raises(ValidationError):
        ChannelCreate.model_validate(body)


def test_platform_is_not_patchable():
    with pytest.raises(ValidationError):
        ChannelPatch.model_validate({"platform": "x"})


@pytest.mark.parametrize("field", ["name", "handle", "url", "language", "context", "profile"])
def test_a_patch_may_not_null_a_top_level_field(field):
    with pytest.raises(ValidationError):
        ChannelPatch.model_validate({field: None})


# --- the brief view --------------------------------------------------------------

def test_bootstrap_maps_every_brief_field():
    brief = full_brief()

    channel = bootstrap_channel(brief)

    assert channel.id == "update-conference" and channel.name == "Update Conference"
    assert channel.platform == "youtube" and channel.language == "cs"
    assert channel.context.audience == brief.audience and channel.context.voice == brief.voice
    for name in PROFILE_FIELDS:
        assert getattr(channel.profile, name) == getattr(brief, name), name
    assert channel.handle == "" and channel.url == ""
    assert channel.createdAt == channel.updatedAt


def test_an_empty_brief_bootstraps_the_placeholder():
    channel = bootstrap_channel(Brief(channel="   "))

    assert PLACEHOLDER_NAME == "YouTube channel"
    assert channel.name == PLACEHOLDER_NAME and channel.id == "youtube-channel"


def test_the_brief_view_round_trips_a_filled_brief():
    brief = full_brief()

    assert brief_from_channel(bootstrap_channel(brief)) == brief
    assert brief_from_channel(bootstrap_channel(brief)).model_dump() == brief.model_dump()


def test_the_brief_view_never_aliases_the_channels_lists():
    channel = bootstrap_channel(full_brief())

    view = brief_from_channel(channel)
    view.default_hashtags.append("#leak")
    view.slots["leak"] = "x"

    assert channel.profile.default_hashtags == ["#update", "#conf"]
    assert "leak" not in channel.profile.slots


def test_a_brief_patch_maps_only_the_fields_it_sets():
    patch = channel_patch_from_brief(BriefPatch(channel="Renamed", voice="dry", footer="F"))

    assert patch.model_fields_set == {"name", "context", "profile"}
    assert patch.name == "Renamed"
    assert patch.context.model_fields_set == {"voice"} and patch.context.voice == "dry"
    assert patch.profile.model_fields_set == {"footer"} and patch.profile.footer == "F"


def test_a_brief_patch_of_language_and_house_rules():
    rules = HouseRules(no_em_dashes=True)
    patch = channel_patch_from_brief(BriefPatch(language="en", house_rules=rules))

    assert patch.model_fields_set == {"language", "profile"}
    assert patch.language == "en" and patch.profile.house_rules == rules


def test_an_empty_brief_patch_is_an_empty_channel_patch():
    assert channel_patch_from_brief(BriefPatch()).model_fields_set == set()


def test_clearing_the_briefs_channel_names_the_placeholder():
    """The brief allowed an empty channel; a channel name may not be empty."""
    assert channel_patch_from_brief(BriefPatch(channel="  ")).name == PLACEHOLDER_NAME


def test_a_null_brief_field_is_refused():
    with pytest.raises(ValueError):
        channel_patch_from_brief(BriefPatch.model_validate({"footer": None}))


# --- patched_channel -------------------------------------------------------------

def test_context_and_profile_merge_per_field():
    current = bootstrap_channel(full_brief())
    patch = ChannelPatch.model_validate(
        {"context": {"about": "A conference"}, "profile": {"footer": "New footer"}}
    )

    updated = patched_channel(current, patch)

    assert updated.context.about == "A conference"
    assert updated.context.audience == "Czech developers"  # kept
    assert updated.profile.footer == "New footer"
    assert updated.profile.default_hashtags == ["#update", "#conf"]  # kept
    assert current.profile.footer == "Subscribe.\nMade with CapForge."  # not mutated


def test_a_no_op_patch_returns_the_same_channel():
    current = bootstrap_channel(full_brief())

    same = patched_channel(current, ChannelPatch.model_validate(
        {"name": current.name, "profile": {"footer": current.profile.footer}}
    ))

    assert same is current


def test_a_real_patch_bumps_updated_at(monkeypatch):
    from backend.library import channels as channels_module

    current = bootstrap_channel(full_brief()).model_copy(update={"updatedAt": STAMP})
    monkeypatch.setattr(channels_module, "now_iso", lambda: "2026-09-16T00:00:00Z")

    updated = patched_channel(current, ChannelPatch(handle="@updateconf"))

    assert updated.handle == "@updateconf" and updated.updatedAt == "2026-09-16T00:00:00Z"
    assert updated.createdAt == current.createdAt


# --- the bootstrap on disk -------------------------------------------------------

def test_a_missing_channels_file_bootstraps_from_the_brief(store, root):
    write_brief(root, full_brief())
    brief_bytes = (root / BRIEF_FILE).read_bytes()

    book = store.list_channels()

    assert book.primary_id == "update-conference"
    assert [c.id for c in book.channels] == ["update-conference"]
    assert channels_json(root)["version"] == 1
    assert channels_json(root)["primary_id"] == "update-conference"
    assert (root / BRIEF_FILE).read_bytes() == brief_bytes  # untouched


def test_no_brief_file_bootstraps_the_placeholder(store, root):
    primary = store.primary_channel()

    assert primary.id == "youtube-channel" and primary.name == PLACEHOLDER_NAME
    assert not (root / BRIEF_FILE).exists()


def test_the_bootstrap_writes_once_and_never_overwrites(store, root):
    write_brief(root, full_brief())
    store.list_channels()
    store.patch_channel("update-conference", ChannelPatch(handle="@update"))

    write_brief(root, full_brief(channel="Something else"))
    book = store.list_channels()

    assert [c.id for c in book.channels] == ["update-conference"]
    assert book.channels[0].handle == "@update"


def test_concurrent_first_reads_bootstrap_one_file(store, root, monkeypatch):
    from backend.library import channel_store

    write_brief(root, full_brief())
    writes: list[str] = []
    real_save = channel_store.save_channels

    def counting_save(path, book):
        writes.append(threading.current_thread().name)
        real_save(path, book)

    monkeypatch.setattr(channel_store, "save_channels", counting_save)
    threads = [threading.Thread(target=store.list_channels, name=f"r{i}") for i in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(writes) == 1


def test_a_corrupt_brief_during_bootstrap_raises_and_writes_nothing(store, root):
    (root / BRIEF_FILE).write_text("{nope", encoding="utf-8")

    with pytest.raises(ValueError) as excinfo:
        store.list_channels()

    assert BRIEF_FILE in str(excinfo.value)
    assert not (root / CHANNELS_FILE).exists()


@pytest.mark.parametrize("body", [
    "{not json",
    {"version": 1, "primary_id": "a", "channels": [stored_channel(id="a"), stored_channel(id="a")]},
    {"version": 1, "primary_id": "a", "channels": [stored_channel(id="a")], "extra": 1},
    {"version": 1, "primary_id": "a", "channels": [stored_channel(id="a", nope=1)]},
    {"version": 1, "primary_id": "ghost", "channels": [stored_channel(id="a")]},
    {"version": 1, "primary_id": "ig", "channels": [stored_channel(id="ig", platform="instagram")]},
    {"version": 1, "primary_id": "a", "channels": []},
], ids=["json", "duplicate-id", "unknown-key", "unknown-channel-key", "ghost-primary",
        "non-youtube-primary", "no-channels"])
def test_an_unreadable_channels_file_raises_and_is_left_alone(store, root, body):
    write_channels(root, body)
    before = (root / CHANNELS_FILE).read_bytes()

    with pytest.raises(ChannelsUnreadable) as excinfo:
        store.list_channels()

    assert CHANNELS_FILE in str(excinfo.value)
    assert isinstance(excinfo.value, ValueError)
    assert (root / CHANNELS_FILE).read_bytes() == before


# --- CRUD ------------------------------------------------------------------------

def test_create_slugs_and_dedupes_the_id(store):
    store.primary_channel()  # "youtube-channel"

    first = store.create_channel(ChannelCreate(platform="youtube", name="YouTube Channel"))
    ig = store.create_channel(ChannelCreate(platform="instagram", name="Filip IG",
                                            context=ChannelContext(about="Me")))

    assert first.id == "youtube-channel-2"
    assert ig.id == "filip-ig" and ig.context.about == "Me"
    assert [c.id for c in store.list_channels().channels] == [
        "youtube-channel", "youtube-channel-2", "filip-ig",
    ]


def test_create_with_a_taken_explicit_id_raises(store):
    store.create_channel(ChannelCreate(id="ig", platform="instagram", name="IG"))

    with pytest.raises(ChannelExists):
        store.create_channel(ChannelCreate(id="ig", platform="x", name="Other"))


def test_get_and_patch_an_unknown_channel_raise(store):
    with pytest.raises(ChannelNotFound):
        store.get_channel("nope")
    with pytest.raises(ChannelNotFound):
        store.patch_channel("nope", ChannelPatch(handle="@x"))
    with pytest.raises(ChannelNotFound):
        store.delete_channel("nope")
    with pytest.raises(ChannelNotFound):
        store.set_primary_channel("nope")


def test_a_no_op_patch_writes_nothing(store, root):
    primary = store.primary_channel()
    before = (root / CHANNELS_FILE).read_bytes()

    same = store.patch_channel(primary.id, ChannelPatch(name=primary.name))

    assert same.updatedAt == primary.updatedAt
    assert (root / CHANNELS_FILE).read_bytes() == before


def test_patch_persists(store):
    primary = store.primary_channel()

    store.patch_channel(primary.id, ChannelPatch.model_validate(
        {"context": {"keywords": ["captions"]}, "url": "https://youtube.com/@x"}
    ))

    stored = store.get_channel(primary.id)
    assert stored.context.keywords == ["captions"] and stored.url == "https://youtube.com/@x"


def test_the_primary_cannot_be_deleted(store):
    primary = store.primary_channel()

    with pytest.raises(ChannelIsPrimary):
        store.delete_channel(primary.id)


def test_a_non_primary_channel_can_be_deleted(store):
    store.primary_channel()
    ig = store.create_channel(ChannelCreate(platform="instagram", name="IG"))

    store.delete_channel(ig.id)

    assert [c.id for c in store.list_channels().channels] == ["youtube-channel"]


def test_the_primary_moves_to_another_youtube_channel(store):
    old = store.primary_channel()
    second = store.create_channel(ChannelCreate(platform="youtube", name="Second"))

    book = store.set_primary_channel(second.id)

    assert book.primary_id == "second" and store.primary_channel().id == "second"
    store.delete_channel(old.id)
    assert [c.id for c in store.list_channels().channels] == ["second"]


def test_a_non_youtube_channel_cannot_be_primary(store):
    primary = store.primary_channel()
    ig = store.create_channel(ChannelCreate(platform="instagram", name="IG"))

    with pytest.raises(PrimaryNotYoutube):
        store.set_primary_channel(ig.id)

    assert store.primary_channel().id == primary.id


def test_patch_primary_channel_writes_through_to_the_primary(store):
    store.primary_channel()

    updated = store.patch_primary_channel(ChannelPatch(language="en"))

    assert updated.id == "youtube-channel"
    assert store.primary_channel().language == "en"


def test_a_name_with_no_ascii_letters_slugs_to_channel_not_collection(tmp_path):
    """The slug helper is shared with collections; a channel keeps its own fallback."""
    store = LibraryStore(tmp_path / "library")

    created = store.create_channel(ChannelCreate(platform="instagram", name="日本"))

    assert created.id == "channel"


def test_a_brief_named_with_no_ascii_letters_bootstraps_the_channel_id():
    assert bootstrap_channel(Brief(channel="日本")).id == "channel"
