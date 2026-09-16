"""Nested collections over the token-gated routes: ``parent_id``, ``path`` and
``total_members`` on every collection answer, the nesting refusals, and the
resolved chain reaching the package, ``/validate`` and the collection detail.

Plan: docs/plans/library-finder.md §2.2–§2.4.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.tests.test_library_collections_routes import (
    BASE,
    agent,
    clip,
    create_collection,
    create_record,
    set_collection,
)

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import client, home, main_module  # noqa: F401

PRIMARY = "youtube-channel"
EM_DASH_DESCRIPTION = "Plain words — with a dash"


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    from backend.library import posters

    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def patch_collection(client, cid: str, body: dict):
    return client.patch(f"{BASE}/{cid}", json=body, headers=agent())


def events_tree(client) -> None:
    """Events › UCK 2026 › Day 1, plus a top-level Solo."""
    create_collection(client, id="events", name="Events", slots={"series": "Talks"},
                      overrides={"footer": "Recorded at {{event}} ({{series}})"})
    create_collection(client, id="uck26", name="UCK 2026", parent_id="events",
                      slots={"event": "UCK 2026"})
    create_collection(client, id="day-1", name="Day 1", parent_id="uck26",
                      overrides={"house_rules": {"no_em_dashes": True}})
    create_collection(client, id="solo", name="Solo")


def member_of(client, tmp_path: Path, name: str, cid: str) -> dict:
    record = create_record(client, clip(tmp_path / "m", name))
    r = set_collection(client, record, cid)
    assert r.status_code == 200, r.text
    return r.json()


# --- the answers' shape -----------------------------------------------------------

def test_list_rows_carry_parent_path_and_total_members(client, tmp_path):
    events_tree(client)
    member_of(client, tmp_path, "a.mp4", "events")
    member_of(client, tmp_path, "b.mp4", "uck26")
    member_of(client, tmp_path, "c.mp4", "day-1")
    member_of(client, tmp_path, "d.mp4", "day-1")

    rows = {c["id"]: c for c in client.get(BASE, headers=agent()).json()["collections"]}

    assert [(rows[c]["parent_id"], rows[c]["members"], rows[c]["total_members"])
            for c in ("events", "uck26", "day-1", "solo")] == [
        (None, 1, 4), ("events", 1, 3), ("uck26", 2, 2), (None, 0, 0),
    ]
    assert rows["day-1"]["path"] == ["Events", "UCK 2026", "Day 1"]
    assert rows["solo"]["path"] == ["Solo"]


def test_create_get_and_patch_answer_the_same_fields(client):
    events_tree(client)

    created = client.post(BASE, json={"name": "Day 2", "parent_id": "uck26"}, headers=agent())
    got = client.get(f"{BASE}/day-1", headers=agent()).json()
    patched = patch_collection(client, "day-1", {"name": "Day One"}).json()

    assert created.status_code == 201
    assert created.json()["parent_id"] == "uck26"
    assert created.json()["path"] == ["Events", "UCK 2026", "Day 2"]
    assert created.json()["total_members"] == 0
    for body in (got, patched):
        assert body["parent_id"] == "uck26" and body["total_members"] == 0
        assert "effective_brief" in body
    assert patched["path"] == ["Events", "UCK 2026", "Day One"]


def test_the_detail_keeps_its_own_slots_and_resolves_the_effective_brief(client):
    events_tree(client)

    body = client.get(f"{BASE}/day-1", headers=agent()).json()

    assert body["slots"] == {}
    assert body["overrides"]["footer"] is None
    assert body["effective_brief"]["footer"] == "Recorded at {{event}} ({{series}})"
    assert body["effective_brief"]["slots"]["event"] == "UCK 2026"
    assert body["effective_brief"]["slots"]["series"] == "Talks"
    assert body["effective_brief"]["house_rules"]["no_em_dashes"] is True


def test_the_library_filter_stays_direct_members_only(client, tmp_path):
    events_tree(client)
    member_of(client, tmp_path, "a.mp4", "day-1")

    listed = client.get("/api/library", params={"collection": "events"}, headers=agent())

    assert listed.status_code == 200
    assert listed.json()["videos"] == []


# --- moves and refusals ------------------------------------------------------------

def test_a_patch_moves_under_a_folder_and_null_moves_to_the_root(client):
    events_tree(client)

    moved = patch_collection(client, "solo", {"parent_id": "events"})
    back = patch_collection(client, "solo", {"parent_id": None})
    kept = patch_collection(client, "day-1", {"name": "Day 1"})

    assert moved.status_code == 200 and moved.json()["path"] == ["Events", "Solo"]
    assert back.status_code == 200 and back.json()["parent_id"] is None
    assert kept.json()["parent_id"] == "uck26"


@pytest.mark.parametrize("method,cid,body,reason", [
    ("post", None, {"name": "X", "parent_id": "nope"}, "unknown_parent"),
    ("patch", "solo", {"parent_id": "nope"}, "unknown_parent"),
    ("patch", "events", {"parent_id": "events"}, "collection_cycle"),
    ("patch", "events", {"parent_id": "day-1"}, "collection_cycle"),
], ids=["create-unknown", "move-unknown", "self", "descendant"])
def test_nesting_refusals_are_422_with_a_reason(client, method, cid, body, reason):
    events_tree(client)
    before = client.get(BASE, headers=agent()).json()

    if method == "post":
        r = client.post(BASE, json=body, headers=agent())
    else:
        r = patch_collection(client, cid, body)

    assert r.status_code == 422
    assert r.json()["reason"] == reason and r.json()["detail"]
    assert client.get(BASE, headers=agent()).json() == before


def test_too_deep_is_422_with_the_limit(client):
    parent = None
    for level in range(1, 9):
        create_collection(client, id=f"level-{level}", name=f"Level {level}", parent_id=parent)
        parent = f"level-{level}"

    r = client.post(BASE, json={"name": "Nine", "parent_id": "level-8"}, headers=agent())

    assert r.status_code == 422
    assert r.json()["reason"] == "collection_too_deep" and r.json()["max_depth"] == 8


def test_delete_with_subfolders_is_409_with_the_count(client):
    events_tree(client)
    create_collection(client, id="meetups", name="Meetups", parent_id="events")

    r = client.delete(f"{BASE}/events", headers=agent())

    assert r.status_code == 409
    assert r.json()["reason"] == "collection_has_children" and r.json()["children"] == 2
    assert client.get(f"{BASE}/events", headers=agent()).status_code == 200


def test_delete_with_members_and_subfolders_answers_in_use_first(client, tmp_path):
    events_tree(client)
    member_of(client, tmp_path, "a.mp4", "events")

    r = client.delete(f"{BASE}/events", headers=agent())

    assert r.status_code == 409 and r.json()["reason"] == "collection_in_use"


def test_a_pydantic_422_keeps_fastapis_shape(client):
    events_tree(client)

    r = patch_collection(client, "solo", {"parent_id": "Not An Id"})

    assert r.status_code == 422 and "reason" not in r.json()


# --- the resolved chain reaches every brief reader --------------------------------

def package(client, video_id: str, **params) -> dict:
    r = client.get(f"/api/library/{video_id}/package", params=params, headers=agent())
    assert r.status_code == 200, r.text
    return r.json()


def test_a_nested_members_package_inherits_from_every_ancestor(client, tmp_path):
    events_tree(client)
    record = member_of(client, tmp_path, "a.mp4", "day-1")
    # A root description lands in the primary channel's post, so ?channel= has one.
    written = client.patch(f"/api/library/{record['id']}", json={"description": "Body"},
                           headers=agent(**{"If-Match": str(record["rev"])}))
    assert written.status_code == 200, written.text

    primary = package(client, record["id"])
    by_channel = package(client, record["id"], channel=PRIMARY)

    assert "Recorded at UCK 2026 (Talks)" in primary["description"]
    assert "Recorded at UCK 2026 (Talks)" in by_channel["text"]


def test_moving_a_folder_changes_its_members_package_with_no_record_write(client, tmp_path):
    events_tree(client)
    record = member_of(client, tmp_path, "a.mp4", "solo")
    assert "Recorded at" not in package(client, record["id"])["description"]

    patch_collection(client, "solo", {"parent_id": "uck26"})

    assert "Recorded at UCK 2026 (Talks)" in package(client, record["id"])["description"]
    assert client.get(f"/api/library/{record['id']}", headers=agent()).json()["rev"] == record["rev"]


def test_validate_uses_the_resolved_chain(client, tmp_path):
    events_tree(client)
    create_collection(client, id="day-2", name="Day 2", parent_id="day-1")
    fields = {"description": EM_DASH_DESCRIPTION}

    explicit = client.post("/api/library/validate", json={"fields": fields, "collection_id": "day-2"},
                           headers=agent()).json()["violations"]

    assert [v["rule"] for v in explicit] == ["no_em_dashes"]


def test_the_injected_reader_resolves_the_chain(client):
    from backend.library import post_drafts, router as library_router, router_publish

    events_tree(client)

    resolved = router_publish.read_collection(library_router.get_store(), "day-1")

    assert resolved.id == "day-1" and resolved.slots["series"] == "Talks"
    assert "read_collection" in post_drafts.register_draft_route.__code__.co_varnames
