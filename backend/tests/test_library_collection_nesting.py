"""Nested collections (folders): ``parent_id``, the tree's integrity rules and the
resolved chain every brief reader goes through.

Plan: docs/plans/library-finder.md §2. The store tests go through ``LibraryStore``
because a delete counts members from the records and every write must hold the
store's ``write_lock``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.library.brief import Brief, HouseRules
from backend.library.collection_store import (
    COLLECTIONS_FILE,
    MAX_COLLECTION_DEPTH,
    BriefOverrides,
    Collection,
    CollectionCreate,
    CollectionPatch,
    effective_brief,
    resolved_collection,
)
from backend.library.collection_tree import (
    collection_path,
    depth_of,
    descendant_ids,
    subtree_height,
    total_members,
)
from backend.library.errors import (
    CollectionCycle,
    CollectionHasChildren,
    CollectionInUse,
    CollectionTooDeep,
    UnknownParent,
)
from backend.library.schemas import Link, RecordPatch
from backend.library.store import LibraryStore


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


def member(store: LibraryStore, tmp_path: Path, name: str, collection_id: str):
    record = store.create(clip(tmp_path / "media", name))
    return store.patch(record.id, RecordPatch(collection_id=collection_id), rev=record.rev, by="user")


def folder(store: LibraryStore, cid: str, parent_id: str | None = None, **kw) -> Collection:
    return store.create_collection(
        CollectionCreate(id=cid, name=cid.title(), parent_id=parent_id, **kw)
    )


def chain(store: LibraryStore, *ids: str) -> None:
    """``ids[0]`` at the top, each next one inside the previous."""
    parent = None
    for cid in ids:
        folder(store, cid, parent)
        parent = cid


def col(cid: str, parent_id: str | None = None, **kw) -> Collection:
    return Collection(id=cid, name=cid.title(), parent_id=parent_id,
                      createdAt="t", updatedAt="t", **kw)


# --- the stored shape ----------------------------------------------------------

def test_parent_id_is_optional_on_every_model_and_defaults_to_the_root():
    assert col("a").parent_id is None
    assert CollectionCreate(name="A").parent_id is None
    assert "parent_id" not in CollectionPatch().model_fields_set


def test_a_file_with_no_nesting_keeps_the_pre_nesting_shape(store):
    """An older build forbids unknown keys, so a top-level row carries no parent_id."""
    chain(store, "events", "uck26")
    store.patch_collection("uck26", CollectionPatch.model_validate({"parent_id": None}))

    stored = json.loads((store.root / COLLECTIONS_FILE).read_text(encoding="utf-8"))

    assert stored["version"] == 1
    assert all("parent_id" not in row for row in stored["collections"])


def test_a_nested_row_stores_its_parent(store):
    chain(store, "events", "uck26")

    stored = json.loads((store.root / COLLECTIONS_FILE).read_text(encoding="utf-8"))

    assert [row.get("parent_id") for row in stored["collections"]] == [None, "events"]
    assert "parent_id" not in stored["collections"][0]


def test_a_file_written_before_nesting_reads_as_top_level(store):
    path = store.root / COLLECTIONS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "collections": [
        {"id": "a", "name": "A", "createdAt": "t", "updatedAt": "t"},
    ]}), encoding="utf-8")

    assert [c.parent_id for c in store.list_collections()] == [None]


def test_the_depth_limit_is_eight():
    assert MAX_COLLECTION_DEPTH == 8


# --- create --------------------------------------------------------------------

def test_create_inside_a_folder(store):
    folder(store, "events")

    created = folder(store, "uck26", "events")

    assert created.parent_id == "events"
    assert store.get_collection("uck26").parent_id == "events"


def test_create_under_an_unknown_parent_is_refused_and_writes_nothing(store):
    with pytest.raises(UnknownParent) as refused:
        folder(store, "uck26", "nope")

    assert refused.value.parent_id == "nope"
    assert store.list_collections() == []


def test_create_at_the_depth_limit_is_allowed_and_one_deeper_is_refused(store):
    ids = [f"level-{n}" for n in range(1, MAX_COLLECTION_DEPTH + 1)]
    chain(store, *ids)

    with pytest.raises(CollectionTooDeep) as refused:
        folder(store, "too-deep", ids[-1])

    assert refused.value.max_depth == MAX_COLLECTION_DEPTH
    assert "too-deep" not in {c.id for c in store.list_collections()}


# --- move ----------------------------------------------------------------------

def test_moving_a_folder_carries_its_subtree(store):
    folder(store, "events")
    chain(store, "uck26", "day-1")

    moved = store.patch_collection("uck26", CollectionPatch(parent_id="events"))

    assert moved.parent_id == "events"
    assert store.get_collection("day-1").parent_id == "uck26"
    assert collection_path(store.list_collections(), "day-1") == ["Events", "Uck26", "Day-1"]


def test_null_moves_to_the_root_and_omitted_leaves_it_put(store):
    chain(store, "events", "uck26")

    renamed = store.patch_collection("uck26", CollectionPatch(name="UCK"))
    assert renamed.parent_id == "events"

    moved = store.patch_collection("uck26", CollectionPatch.model_validate({"parent_id": None}))
    assert moved.parent_id is None


def test_re_sending_the_current_parent_writes_nothing(store):
    chain(store, "events", "uck26")
    before = (store.root / COLLECTIONS_FILE).stat().st_mtime_ns

    same = store.patch_collection("uck26", CollectionPatch(parent_id="events"))

    assert same.parent_id == "events"
    assert (store.root / COLLECTIONS_FILE).stat().st_mtime_ns == before


def test_a_move_under_an_unknown_parent_is_refused(store):
    folder(store, "uck26")

    with pytest.raises(UnknownParent):
        store.patch_collection("uck26", CollectionPatch(parent_id="nope"))

    assert store.get_collection("uck26").parent_id is None


def test_a_folder_cannot_be_its_own_parent(store):
    folder(store, "uck26")

    with pytest.raises(CollectionCycle):
        store.patch_collection("uck26", CollectionPatch(parent_id="uck26"))


def test_a_folder_cannot_move_under_its_own_descendant(store):
    chain(store, "events", "uck26", "day-1")

    with pytest.raises(CollectionCycle):
        store.patch_collection("events", CollectionPatch(parent_id="day-1"))

    assert store.get_collection("events").parent_id is None


def test_a_move_counts_the_whole_subtrees_depth(store):
    """A three-level subtree fits under depth 5 (5 + 3 = 8), not under depth 6."""
    chain(store, *[f"deep-{n}" for n in range(1, 7)])
    chain(store, "top", "middle", "bottom")

    store.patch_collection("top", CollectionPatch(parent_id="deep-5"))
    assert depth_of(store.list_collections(), "bottom") == MAX_COLLECTION_DEPTH

    with pytest.raises(CollectionTooDeep):
        store.patch_collection("top", CollectionPatch(parent_id="deep-6"))
    assert store.get_collection("top").parent_id == "deep-5"


def test_a_refused_move_that_also_renames_changes_nothing(store):
    folder(store, "uck26")

    with pytest.raises(UnknownParent):
        store.patch_collection("uck26", CollectionPatch(name="Renamed", parent_id="nope"))

    assert store.get_collection("uck26").name == "Uck26"


# --- delete --------------------------------------------------------------------

def test_delete_refuses_a_folder_with_subfolders(store):
    chain(store, "events", "uck26")
    folder(store, "meetups", "events")

    with pytest.raises(CollectionHasChildren) as refused:
        store.delete_collection("events")

    assert refused.value.children == 2
    assert {c.id for c in store.list_collections()} == {"events", "uck26", "meetups"}


def test_children_count_direct_subfolders_only(store):
    chain(store, "events", "uck26", "day-1")

    with pytest.raises(CollectionHasChildren) as refused:
        store.delete_collection("events")

    assert refused.value.children == 1


def test_members_are_refused_before_subfolders(store, tmp_path):
    """Documented order: a folder with both answers ``collection_in_use`` first."""
    chain(store, "events", "uck26")
    member(store, tmp_path, "a.mp4", "events")

    with pytest.raises(CollectionInUse):
        store.delete_collection("events")


def test_a_leaf_folder_deletes_and_leaves_its_parent(store):
    chain(store, "events", "uck26")

    store.delete_collection("uck26")
    store.delete_collection("events")

    assert store.list_collections() == []


# --- the file ------------------------------------------------------------------

def _write(store: LibraryStore, rows: list[dict]) -> str:
    path = store.root / COLLECTIONS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps({"version": 1, "collections": rows})
    path.write_text(content, encoding="utf-8")
    return content


def _row(cid: str, parent_id: str | None) -> dict:
    return {"id": cid, "name": cid, "parent_id": parent_id, "createdAt": "t", "updatedAt": "t"}


@pytest.mark.parametrize("rows", [
    [_row("a", "ghost")],
    [_row("a", "a")],
    [_row("a", "b"), _row("b", "a")],
    [_row("root", None), _row("a", "c"), _row("b", "a"), _row("c", "b")],
], ids=["dangling", "self", "two-cycle", "three-cycle"])
def test_a_hand_edited_tree_is_unreadable_and_never_reset(store, rows):
    content = _write(store, rows)

    with pytest.raises(ValueError, match=COLLECTIONS_FILE):
        store.list_collections()
    with pytest.raises(ValueError, match=COLLECTIONS_FILE):
        store.create_collection(CollectionCreate(name="New"))
    assert (store.root / COLLECTIONS_FILE).read_text(encoding="utf-8") == content


# --- the pure tree helpers -----------------------------------------------------

TREE = (
    col("events"), col("uck26", "events"), col("day-1", "uck26"),
    col("day-2", "uck26"), col("meetups", "events"), col("solo"),
)


def test_descendants_depth_height_and_path():
    assert descendant_ids(TREE, "events") == frozenset({"uck26", "day-1", "day-2", "meetups"})
    assert descendant_ids(TREE, "day-1") == frozenset()
    assert descendant_ids(TREE, "unknown") == frozenset()
    assert [depth_of(TREE, cid) for cid in ("events", "uck26", "day-1")] == [1, 2, 3]
    assert [subtree_height(TREE, cid) for cid in ("events", "uck26", "day-1")] == [3, 2, 1]
    assert collection_path(TREE, "day-2") == ["Events", "Uck26", "Day-2"]
    assert collection_path(TREE, "unknown") == []


def test_total_members_is_the_folder_and_every_descendant():
    counts = {"events": 1, "uck26": 2, "day-1": 3, "solo": 7, "orphan": 9}

    assert total_members(TREE, counts, "events") == 6
    assert total_members(TREE, counts, "uck26") == 5
    assert total_members(TREE, counts, "day-2") == 0
    assert total_members(TREE, counts, "solo") == 7


# --- resolved_collection -------------------------------------------------------

def channel() -> Brief:
    return Brief(
        channel="CapForge",
        footer="Channel footer",
        voice="Channel voice",
        default_hashtags=["#capforge"],
        link_rows=[Link(label="Site", url="https://capforge.app")],
        slots={"event": "Channel event", "city": "Prague"},
    )


def three_levels() -> tuple[Collection, ...]:
    return (
        col("events", slots={"event": "Events", "series": "Talks"},
            overrides=BriefOverrides(footer="Events footer", voice="Events voice",
                                     default_hashtags=["#events", "#talks"],
                                     house_rules=HouseRules(no_em_dashes=True))),
        col("uck26", "events", slots={"event": "UCK 2026"},
            overrides=BriefOverrides(link_rows=[Link(label="UCK", url="https://uck.cz")])),
        col("day-1", "uck26", slots={"day": "Day 1"},
            overrides=BriefOverrides(default_hashtags=[], footer=None)),
    )


def test_none_and_unknown_ids_resolve_to_nothing():
    assert resolved_collection(three_levels(), None) is None
    assert resolved_collection(three_levels(), "orphan") is None


def test_a_top_level_collection_resolves_to_itself():
    tree = three_levels()

    assert resolved_collection(tree, "events") is tree[0]


def test_a_three_level_chain_folds_root_first():
    resolved = resolved_collection(three_levels(), "day-1")

    # Identity is the leaf's own.
    assert (resolved.id, resolved.name, resolved.parent_id) == ("day-1", "Day-1", "uck26")
    # Slots merge key-wise, the deeper value winning.
    assert resolved.slots == {"event": "UCK 2026", "series": "Talks", "day": "Day 1"}
    # null inherits through two levels.
    assert resolved.overrides.footer == "Events footer"
    assert resolved.overrides.voice == "Events voice"
    assert resolved.overrides.house_rules == HouseRules(no_em_dashes=True)
    # A list set deeper replaces, even when empty.
    assert resolved.overrides.default_hashtags == []
    assert resolved.overrides.link_rows == [Link(label="UCK", url="https://uck.cz")]


def test_the_effective_brief_of_a_chain_is_the_brief_under_the_resolved_leaf():
    brief = effective_brief(channel(), resolved_collection(three_levels(), "day-1"))

    assert brief.footer == "Events footer"
    assert brief.default_hashtags == []
    assert brief.link_rows == [Link(label="UCK", url="https://uck.cz")]
    assert brief.channel == "CapForge"
    assert brief.slots == {
        "event": "UCK 2026", "city": "Prague", "series": "Talks", "day": "Day 1",
    }


def test_resolving_mutates_nothing():
    tree = three_levels()

    resolved = resolved_collection(tree, "day-1")
    resolved.slots["extra"] = "x"

    assert tree == three_levels()


def test_the_store_resolves_through_the_stored_tree(store):
    folder(store, "events", slots={"event": "Events"})
    folder(store, "uck26", "events", overrides=BriefOverrides(footer="UCK footer"))

    resolved = store.resolve_collection("uck26")

    assert resolved.slots == {"event": "Events"}
    assert resolved.overrides.footer == "UCK footer"
    assert store.resolve_collection(None) is None
    assert store.resolve_collection("orphan") is None
