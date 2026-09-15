"""Collections: brief overrides + slots, stored in ``<library_root>/collections.json``.

Plan: docs/plans/library-collections.md (Backend → collections.py). The store
tests go through ``LibraryStore`` because membership is ``record.collection_id``
and every write must hold the store's ``write_lock``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.library import collection_store as collections_module
from backend.library.brief import Brief, BriefPatch, HouseRules
from backend.library.collection_store import (
    BUILTIN_SLOTS,
    COLLECTION_ID_RE,
    COLLECTIONS_FILE,
    BriefOverrides,
    Collection,
    CollectionCreate,
    CollectionPatch,
    effective_brief,
    slugify,
)
from backend.library.errors import CollectionExists, CollectionInUse, CollectionNotFound
from backend.library.schemas import Link, RecordPatch
from backend.library.store import LibraryStore
from backend.tests.test_library_store_lock import race

FIXTURES = Path(__file__).parent / "fixtures"
NAME_MAX_CHARS = 120
ID_MAX_CHARS = 64


@pytest.fixture
def store(tmp_path: Path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def clip(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(f"media:{folder.name}/{name}".encode() * 64)
    return p


def member(store: LibraryStore, tmp_path: Path, name: str, collection_id: str | None):
    record = store.create(clip(tmp_path / "media", name))
    if collection_id is None:
        return record
    return store.patch(record.id, RecordPatch(collection_id=collection_id), rev=record.rev, by="user")


# --- models ------------------------------------------------------------------

def test_builtin_slots_are_re_exported_and_equal_the_fixture():
    fixture = json.loads((FIXTURES / "builtin_slots.json").read_text(encoding="utf-8"))

    assert BUILTIN_SLOTS == frozenset(fixture["slots"])


def test_every_brief_field_but_slots_can_be_overridden():
    """A new Brief field that is not overridable fails here, not in a QA pass."""
    assert set(BriefOverrides.model_fields) == set(Brief.model_fields) - {"slots"}
    assert all(value is None for value in BriefOverrides().model_dump().values())


@pytest.mark.parametrize("model", [BriefOverrides, Collection, CollectionCreate, CollectionPatch])
def test_every_collection_model_forbids_unknown_keys(model):
    assert model.model_config.get("extra") == "forbid"


def test_the_collection_id_pattern_is_the_plans():
    assert COLLECTION_ID_RE.pattern == r"^[a-z0-9][a-z0-9-]{0,63}$"


@pytest.mark.parametrize("bad", ["UCK26", "-uck", "uck_26", "", "a" * (ID_MAX_CHARS + 1), "uck 26"])
def test_a_malformed_collection_id_is_refused(bad):
    with pytest.raises(ValidationError):
        CollectionCreate(id=bad, name="UCK")


@pytest.mark.parametrize("name", ["", "   ", "x" * (NAME_MAX_CHARS + 1)])
def test_a_collection_name_must_be_1_to_120_characters(name):
    with pytest.raises(ValidationError):
        CollectionCreate(name=name)


@pytest.mark.parametrize("model", [CollectionCreate, CollectionPatch])
@pytest.mark.parametrize("slots", [{"footer": "x"}, {"Event": "x"}])
def test_collection_slot_names_are_validated(model, slots):
    with pytest.raises(ValidationError):
        model(name="UCK", slots=slots)


@pytest.mark.parametrize("field", ["name", "slots", "overrides"])
def test_a_patch_may_not_null_a_top_level_field(field):
    with pytest.raises(ValidationError):
        CollectionPatch.model_validate({field: None})


def test_the_brief_gains_a_template_and_slots():
    brief = Brief()

    assert brief.description_template == "" and brief.slots == {}
    assert "description_template" in BriefPatch.model_fields and "slots" in BriefPatch.model_fields


@pytest.mark.parametrize("model", [Brief, BriefPatch])
@pytest.mark.parametrize("slots", [{"footer": "x"}, {"Bad": "x"}])
def test_brief_slot_names_are_validated(model, slots):
    with pytest.raises(ValidationError):
        model(slots=slots)


# --- slugs -------------------------------------------------------------------

@pytest.mark.parametrize("name,slug", [
    ("UCK 2026: Brno!", "uck-2026-brno"),
    ("  Škoda Café  ", "skoda-cafe"),
    ("already-a-slug", "already-a-slug"),
    ("!!!", "collection"),
    ("日本", "collection"),
])
def test_slugify(name, slug):
    assert slugify(name) == slug


def test_a_long_name_slugs_to_a_legal_id():
    slug = slugify("word " * 40)

    assert COLLECTION_ID_RE.match(slug) and len(slug) <= ID_MAX_CHARS
    assert not slug.endswith("-")


# --- effective_brief ---------------------------------------------------------

def channel() -> Brief:
    return Brief(
        channel="CapForge",
        footer="Channel footer",
        default_hashtags=["#capforge", "#captions"],
        link_rows=[Link(label="Site", url="https://capforge.app")],
        house_rules=HouseRules(no_em_dashes=True, description_chars=(10, 20)),
        slots={"event": "Channel event", "city": "Prague"},
    )


def collection(**kw) -> Collection:
    return Collection(id="uck26", name="UCK 2026", createdAt="t", updatedAt="t", **kw)


def test_no_collection_is_the_channel_brief():
    assert effective_brief(channel(), None) == channel()


def test_an_override_replaces_and_null_inherits():
    col = collection(overrides=BriefOverrides(footer="Event footer", voice=None))

    brief = effective_brief(channel(), col)

    assert brief.footer == "Event footer"
    assert brief.channel == "CapForge"


def test_a_list_override_replaces_the_channels_list():
    col = collection(overrides=BriefOverrides(default_hashtags=["#uck"], link_rows=[]))

    brief = effective_brief(channel(), col)

    assert brief.default_hashtags == ["#uck"]
    assert brief.link_rows == []  # an empty override is still an override


def test_a_house_rules_override_replaces_the_whole_block():
    col = collection(overrides=BriefOverrides(house_rules=HouseRules(hook_first_150=False)))

    rules = effective_brief(channel(), col).house_rules

    assert rules == HouseRules(hook_first_150=False)
    assert rules.no_em_dashes is False and rules.description_chars is None


def test_slots_merge_key_wise_over_the_channels():
    col = collection(slots={"event": "UCK 2026", "sponsor": "Acme"})

    assert effective_brief(channel(), col).slots == {
        "event": "UCK 2026", "city": "Prague", "sponsor": "Acme",
    }


def test_effective_brief_is_idempotent_and_mutates_nothing():
    brief, col = channel(), collection(slots={"x": "1"}, overrides=BriefOverrides(footer="F"))

    once = effective_brief(brief, col)

    assert effective_brief(once, col) == once
    assert brief == channel()
    assert col == collection(slots={"x": "1"}, overrides=BriefOverrides(footer="F"))


# --- storage: CRUD -----------------------------------------------------------

def test_a_missing_file_is_no_collections(store):
    assert store.list_collections() == []
    assert store.orphan_collection_ids() == []
    assert not (store.root / COLLECTIONS_FILE).exists()  # reading never writes


def test_create_with_an_explicit_id_round_trips(store):
    created = store.create_collection(
        CollectionCreate(id="uck26", name="UCK 2026", slots={"event": "UCK"},
                         overrides=BriefOverrides(footer="Thanks"))
    )

    assert created.id == "uck26" and created.name == "UCK 2026"
    assert created.createdAt and created.createdAt == created.updatedAt
    assert store.get_collection("uck26") == created
    assert [c.id for c in store.list_collections()] == ["uck26"]
    stored = json.loads((store.root / COLLECTIONS_FILE).read_text(encoding="utf-8"))
    assert [c["id"] for c in stored["collections"]] == ["uck26"]


def test_an_omitted_id_is_slugged_from_the_name_with_a_clash_suffix(store):
    ids = [store.create_collection(CollectionCreate(name="UCK 2026")).id for _ in range(3)]

    assert ids == ["uck-2026", "uck-2026-2", "uck-2026-3"]


def test_the_clash_suffix_keeps_a_maximal_slug_legal(store):
    name = "x" * ID_MAX_CHARS
    store.create_collection(CollectionCreate(name=name))

    second = store.create_collection(CollectionCreate(name=name)).id

    assert second.endswith("-2") and len(second) <= ID_MAX_CHARS
    assert COLLECTION_ID_RE.match(second)


def test_an_explicit_id_that_is_taken_is_refused(store):
    store.create_collection(CollectionCreate(id="uck26", name="UCK"))

    with pytest.raises(CollectionExists):
        store.create_collection(CollectionCreate(id="uck26", name="Other"))
    assert store.get_collection("uck26").name == "UCK"


def test_get_patch_and_delete_of_an_unknown_id_are_not_found(store):
    for call in (
        lambda: store.get_collection("nope"),
        lambda: store.patch_collection("nope", CollectionPatch(name="x")),
        lambda: store.delete_collection("nope"),
    ):
        with pytest.raises(CollectionNotFound):
            call()


def test_patch_merges_top_level_fields_and_replaces_slots(store):
    store.create_collection(CollectionCreate(id="uck26", name="UCK", slots={"a": "1", "b": "2"}))

    patched = store.patch_collection("uck26", CollectionPatch(slots={"c": "3"}))

    assert patched.name == "UCK"
    assert patched.slots == {"c": "3"}


def test_patch_merges_overrides_per_field_and_null_clears(store):
    store.create_collection(CollectionCreate(
        id="uck26", name="UCK",
        overrides=BriefOverrides(footer="F", default_hashtags=["#uck"]),
    ))

    store.patch_collection("uck26", CollectionPatch(overrides=BriefOverrides(voice="plain")))
    patched = store.patch_collection(
        "uck26", CollectionPatch.model_validate({"overrides": {"footer": None}})
    )

    assert patched.overrides.footer is None
    assert patched.overrides.default_hashtags == ["#uck"]
    assert patched.overrides.voice == "plain"


def test_a_patch_that_changes_nothing_writes_nothing(store):
    created = store.create_collection(CollectionCreate(id="uck26", name="UCK"))
    before = (store.root / COLLECTIONS_FILE).stat().st_mtime_ns

    same = store.patch_collection("uck26", CollectionPatch(name="UCK"))

    assert same == created
    assert (store.root / COLLECTIONS_FILE).stat().st_mtime_ns == before


def test_a_changing_patch_bumps_updated_at_only(store, monkeypatch):
    monkeypatch.setattr(collections_module, "now_iso", lambda: "2026-01-01T00:00:00Z")
    store.create_collection(CollectionCreate(id="uck26", name="UCK"))
    monkeypatch.setattr(collections_module, "now_iso", lambda: "2026-02-02T00:00:00Z")

    patched = store.patch_collection("uck26", CollectionPatch(name="UCK 2026"))

    assert patched.createdAt == "2026-01-01T00:00:00Z"
    assert patched.updatedAt == "2026-02-02T00:00:00Z"


def test_delete_removes_an_empty_collection(store):
    store.create_collection(CollectionCreate(id="uck26", name="UCK"))

    store.delete_collection("uck26")

    assert store.list_collections() == []


# --- storage: corrupt file ----------------------------------------------------

@pytest.mark.parametrize("content", [
    "{not json",
    json.dumps({"collections": [{"id": "uck26"}]}),
    json.dumps({"collections": [], "nope": 1}),
    json.dumps({"collections": [
        {"id": "a", "name": "A", "createdAt": "t", "updatedAt": "t"},
        {"id": "a", "name": "B", "createdAt": "t", "updatedAt": "t"},
    ]}),
])
def test_a_corrupt_file_raises_and_is_never_reset(store, content):
    path = store.root / COLLECTIONS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

    with pytest.raises(ValueError, match=COLLECTIONS_FILE):
        store.list_collections()
    with pytest.raises(ValueError, match=COLLECTIONS_FILE):
        store.create_collection(CollectionCreate(name="New"))
    assert path.read_text(encoding="utf-8") == content


# --- membership --------------------------------------------------------------

def test_members_and_orphans_are_counted_from_the_records(store, tmp_path):
    store.create_collection(CollectionCreate(id="known", name="Known"))
    member(store, tmp_path, "a.mp4", "known")
    member(store, tmp_path, "b.mp4", "uck26")
    member(store, tmp_path, "c.mp4", "uck26")
    member(store, tmp_path, "d.mp4", None)

    assert store.members_of("known") == 1
    assert store.members_of("uck26") == 2
    assert store.members_of("nobody") == 0
    assert store.orphan_collection_ids() == [{"id": "uck26", "members": 2}]


def test_adopting_an_orphan_id_clears_it_from_orphans(store, tmp_path):
    member(store, tmp_path, "a.mp4", "uck26")

    store.create_collection(CollectionCreate(id="uck26", name="UCK 2026"))

    assert store.orphan_collection_ids() == []
    assert store.members_of("uck26") == 1


def test_a_slugged_id_never_silently_adopts_an_orphans_videos(store, tmp_path):
    member(store, tmp_path, "a.mp4", "uck-2026")

    created = store.create_collection(CollectionCreate(name="UCK 2026"))

    assert created.id == "uck-2026-2"
    assert store.orphan_collection_ids() == [{"id": "uck-2026", "members": 1}]


def test_scratch_records_are_not_members(store, tmp_path):
    record = store.create(clip(tmp_path / "media", "qa.mp4"), scratch=True)
    path = store.root / ".scratch" / record.id / "record.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    path.write_text(json.dumps({**stored, "collection_id": "uck26"}), encoding="utf-8")

    assert store.members_of("uck26") == 0
    assert store.orphan_collection_ids() == []


def test_delete_refuses_a_collection_with_members(store, tmp_path):
    store.create_collection(CollectionCreate(id="uck26", name="UCK"))
    member(store, tmp_path, "a.mp4", "uck26")
    member(store, tmp_path, "b.mp4", "uck26")

    with pytest.raises(CollectionInUse) as refused:
        store.delete_collection("uck26")

    assert refused.value.members == 2
    assert store.get_collection("uck26").name == "UCK"


# --- the lock ----------------------------------------------------------------

def test_a_create_racing_a_patch_keeps_both(store, monkeypatch):
    store.create_collection(CollectionCreate(id="uck26", name="UCK"))

    race(
        monkeypatch,
        slow=lambda: store.patch_collection("uck26", CollectionPatch(name="Slow")),
        fast=lambda: store.create_collection(CollectionCreate(id="fast", name="Fast")),
        gate=(collections_module.fs, "write_json_atomic"),
    )

    assert {c.id: c.name for c in store.list_collections()} == {"uck26": "Slow", "fast": "Fast"}


def test_a_delete_racing_a_create_keeps_the_create(store, monkeypatch):
    store.create_collection(CollectionCreate(id="gone", name="Gone"))

    race(
        monkeypatch,
        slow=lambda: store.delete_collection("gone"),
        fast=lambda: store.create_collection(CollectionCreate(id="fast", name="Fast")),
        gate=(collections_module.fs, "write_json_atomic"),
    )

    assert [c.id for c in store.list_collections()] == ["fast"]
