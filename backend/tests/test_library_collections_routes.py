"""The collection routes, and what collections change in the record/package/validate
routes, over the token-gated boundary. Plan: docs/plans/library-collections.md."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    AGENT_HEADER,
    AGENT_TOKEN,
    LOCAL_HEADER,
    LOCAL_TOKEN,
    client,
    home,
    main_module,
)

BASE = "/api/library/collections"
EM_DASH_DESCRIPTION = "Plain words — with a dash"
FOOTER = "Recorded at {{event}} — thanks to {{sponsor}}"


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    """Nothing here is about posters; keep ffmpeg grabs off the shared pool."""
    from backend.library import posters

    monkeypatch.setattr(posters, "start_grab", lambda store, record: None)


def agent(**kw) -> dict:
    return {AGENT_HEADER: AGENT_TOKEN, **kw}


def user(**kw) -> dict:
    return {LOCAL_HEADER: LOCAL_TOKEN, **kw}


def clip(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(f"media:{folder.name}/{name}".encode() * 64)
    return p


def create_record(client, media: Path) -> dict:
    r = client.post("/api/library", json={"source_path": str(media)}, headers=agent())
    assert r.status_code in (200, 201), r.text
    return r.json()


def set_collection(client, record: dict, collection_id):
    return client.patch(
        f"/api/library/{record['id']}", json={"collection_id": collection_id},
        headers=agent(**{"If-Match": str(record["rev"])}),
    )


def create_collection(client, **body) -> dict:
    r = client.post(BASE, json=body, headers=agent())
    assert r.status_code == 201, r.text
    return r.json()


def write_dangling_id(home: Path, record: dict, collection_id: str) -> None:
    """A record an older build (or a deleted collection) left with a dangling id."""
    path = home / "library" / record["id"] / "record.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    path.write_text(json.dumps({**stored, "collection_id": collection_id}), encoding="utf-8")


# --- the guard and the route order ---------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", BASE), ("post", BASE), ("get", f"{BASE}/uck26"),
    ("patch", f"{BASE}/uck26"), ("delete", f"{BASE}/uck26"),
])
def test_every_collection_route_needs_a_token(client, method, path):
    kwargs = {"json": {}} if method in ("post", "patch") else {}

    assert getattr(client, method)(path, **kwargs).status_code == 401


def test_collections_is_not_mistaken_for_a_record_id(client):
    r = client.get(BASE, headers=user())

    assert r.status_code == 200
    assert r.json() == {"collections": [], "orphans": []}


# --- create ------------------------------------------------------------------

def test_create_answers_201_with_members(client):
    r = client.post(BASE, json={"name": "UCK 2026", "slots": {"event": "UCK"},
                                "overrides": {"footer": FOOTER}}, headers=user())

    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "uck-2026" and body["name"] == "UCK 2026"
    assert body["members"] == 0
    assert body["slots"] == {"event": "UCK"}
    assert body["overrides"]["footer"] == FOOTER
    assert body["overrides"]["voice"] is None  # every override key, null = inherit
    assert body["createdAt"] and body["updatedAt"]


def test_create_with_a_taken_id_is_409_collection_exists(client):
    create_collection(client, id="uck26", name="UCK")

    r = client.post(BASE, json={"id": "uck26", "name": "Other"}, headers=agent())

    assert r.status_code == 409
    assert r.json()["reason"] == "collection_exists"


@pytest.mark.parametrize("body", [
    {"id": "Bad Id", "name": "UCK"},
    {"name": ""},
    {"name": "UCK", "slots": {"Bad": "x"}},
    {"name": "UCK", "slots": {"footer": "x"}},
    {"name": "UCK", "nope": 1},
    {"name": "UCK", "overrides": {"nope": 1}},
    {"name": "UCK", "overrides": {"slots": {"a": "b"}}},
])
def test_create_refuses_a_bad_body_with_422(client, body):
    assert client.post(BASE, json=body, headers=agent()).status_code == 422


# --- list / get ----------------------------------------------------------------

def test_list_counts_members_and_lists_orphans(client, home, tmp_path):
    create_collection(client, id="uck26", name="UCK")
    a = create_record(client, clip(tmp_path / "m", "a.mp4"))
    b = create_record(client, clip(tmp_path / "m", "b.mp4"))
    assert set_collection(client, a, "uck26").status_code == 200
    write_dangling_id(home, b, "old-event")

    body = client.get(BASE, headers=agent()).json()

    assert [(c["id"], c["members"]) for c in body["collections"]] == [("uck26", 1)]
    assert body["orphans"] == [{"id": "old-event", "members": 1}]


def test_get_answers_members_and_the_effective_brief(client):
    client.patch("/api/library/brief", json={"channel": "CapForge", "footer": "Channel",
                                             "slots": {"city": "Brno"}}, headers=agent())
    create_collection(client, id="uck26", name="UCK", slots={"event": "UCK"},
                      overrides={"footer": FOOTER})

    r = client.get(f"{BASE}/uck26", headers=agent())

    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "uck26" and body["members"] == 0
    effective = body["effective_brief"]
    assert effective["channel"] == "CapForge"
    assert effective["footer"] == FOOTER
    assert effective["slots"] == {"city": "Brno", "event": "UCK"}


def test_get_unknown_is_404(client):
    assert client.get(f"{BASE}/nope", headers=agent()).status_code == 404
    assert client.get(f"{BASE}/Not A Legal Id", headers=agent()).status_code == 404


# --- patch -------------------------------------------------------------------

def test_patch_answers_the_get_shape_and_merges_overrides_per_field(client):
    create_collection(client, id="uck26", name="UCK", overrides={"footer": "F", "voice": "plain"})

    r = client.patch(f"{BASE}/uck26", json={"name": "UCK 2026", "overrides": {"footer": None}},
                     headers=agent())

    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "UCK 2026"
    assert body["overrides"]["footer"] is None and body["overrides"]["voice"] == "plain"
    assert "effective_brief" in body and body["members"] == 0


def test_patch_unknown_is_404(client):
    assert client.patch(f"{BASE}/nope", json={"name": "x"}, headers=agent()).status_code == 404


@pytest.mark.parametrize("body", [
    {"slots": {"title": "x"}}, {"nope": 1}, {"name": None}, {"id": "other"},
])
def test_patch_refuses_a_bad_body_with_422(client, body):
    create_collection(client, id="uck26", name="UCK")

    assert client.patch(f"{BASE}/uck26", json=body, headers=agent()).status_code == 422


# --- delete ------------------------------------------------------------------

def test_delete_an_empty_collection_is_204(client):
    create_collection(client, id="uck26", name="UCK")

    r = client.delete(f"{BASE}/uck26", headers=agent())

    assert r.status_code == 204 and r.content == b""
    assert client.get(f"{BASE}/uck26", headers=agent()).status_code == 404


def test_delete_with_members_is_409_collection_in_use(client, tmp_path):
    create_collection(client, id="uck26", name="UCK")
    for name in ("a.mp4", "b.mp4"):
        set_collection(client, create_record(client, clip(tmp_path / "m", name)), "uck26")

    r = client.delete(f"{BASE}/uck26", headers=agent())

    assert r.status_code == 409
    assert r.json()["reason"] == "collection_in_use" and r.json()["members"] == 2
    assert client.get(f"{BASE}/uck26", headers=agent()).status_code == 200


def test_delete_unknown_is_404(client):
    assert client.delete(f"{BASE}/nope", headers=agent()).status_code == 404


def test_a_corrupt_collections_file_is_a_500_and_is_left_alone(client, home):
    path = home / "library" / "collections.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{broken", encoding="utf-8")

    r = client.get(BASE, headers=agent())

    assert r.status_code == 500 and "collections.json" in r.json()["detail"]
    assert path.read_text(encoding="utf-8") == "{broken"


# --- record PATCH: membership ------------------------------------------------------

def test_patching_an_unknown_collection_id_is_422_and_writes_nothing(client, tmp_path):
    record = create_record(client, clip(tmp_path / "m", "a.mp4"))

    r = set_collection(client, record, "nope")

    assert r.status_code == 422
    (violation,) = r.json()["violations"]
    assert violation["field"] == "collection_id"
    assert violation["rule"] == "unknown_collection"
    assert violation["severity"] == "hard"
    assert client.get(f"/api/library/{record['id']}", headers=agent()).json()["rev"] == 1


def test_patching_a_known_or_null_collection_id_is_allowed(client, tmp_path):
    create_collection(client, id="uck26", name="UCK")
    record = create_record(client, clip(tmp_path / "m", "a.mp4"))

    joined = set_collection(client, record, "uck26")
    left = set_collection(client, joined.json(), None)

    assert joined.status_code == 200 and joined.json()["collection_id"] == "uck26"
    assert left.status_code == 200 and left.json()["collection_id"] is None


def test_a_dangling_id_stays_readable_and_patchable_elsewhere(client, home, tmp_path):
    record = create_record(client, clip(tmp_path / "m", "a.mp4"))
    write_dangling_id(home, record, "old-event")

    r = client.patch(f"/api/library/{record['id']}", json={"title": "Still editable"},
                     headers=agent(**{"If-Match": "1"}))

    assert r.status_code == 200 and r.json()["collection_id"] == "old-event"


def test_orphan_adoption_by_creating_a_collection_with_its_id(client, home, tmp_path):
    record = create_record(client, clip(tmp_path / "m", "a.mp4"))
    write_dangling_id(home, record, "uck26")

    adopted = create_collection(client, id="uck26", name="UCK 2026")

    assert adopted["members"] == 1
    assert client.get(BASE, headers=agent()).json()["orphans"] == []


# --- package ---------------------------------------------------------------------

def package(client, video_id: str) -> dict:
    r = client.get(f"/api/library/{video_id}/package", headers=agent())
    assert r.status_code == 200, r.text
    return r.json()


def test_changing_the_collection_regenerates_every_members_package(client, tmp_path):
    create_collection(client, id="uck26", name="UCK 2026",
                      slots={"event": "UCK 2026", "sponsor": "Acme"}, overrides={"footer": FOOTER})
    members = []
    for name in ("a.mp4", "b.mp4", "c.mp4"):
        record = create_record(client, clip(tmp_path / "m", name))
        members.append(set_collection(client, record, "uck26").json())

    assert all("thanks to Acme" in package(client, m["id"])["text"] for m in members)
    client.patch(f"{BASE}/uck26", json={"slots": {"event": "UCK 2026", "sponsor": "Globex"}},
                 headers=agent())

    for m in members:
        assert "Recorded at UCK 2026 — thanks to Globex" in package(client, m["id"])["text"]
        assert client.get(f"/api/library/{m['id']}", headers=agent()).json()["rev"] == m["rev"]


def test_the_package_reports_unknown_slots_and_the_assembled_size(client, tmp_path):
    create_collection(client, id="uck26", name="UCK",
                      overrides={"footer": "Thanks {{typo}} " + "f" * 5000})
    record = set_collection(client, create_record(client, clip(tmp_path / "m", "a.mp4")), "uck26").json()

    body = package(client, record["id"])

    assert "- {{typo}}" in body["text"]
    assert sorted(v["rule"] for v in body["violations"] if v["field"] == "package.description") == [
        "description_max_bytes", "unknown_slot",
    ]


def test_the_package_returns_the_description_body_it_validates(client, tmp_path):
    """``description`` is the pasteable DESCRIPTION body alone — no header, no rules —
    and it is exactly the text the ``package.description`` rules measured."""
    from backend.library import router as library_router
    from backend.library.brief import load_brief
    from backend.library.package import assemble_description

    create_collection(client, id="uck26", name="UCK", slots={"event": "UCK 2026"},
                      overrides={"footer": "Thanks <b>{{event}}</b>"})
    record = set_collection(client, create_record(client, clip(tmp_path / "m", "a.mp4")), "uck26").json()
    client.patch(f"/api/library/{record['id']}", json={"description": "Body"},
                 headers=agent(**{"If-Match": str(record["rev"])}))

    body = package(client, record["id"])

    assert set(body) == {"platform", "text", "violations", "description"}
    assert body["description"] == "Body\n\nThanks <b>UCK 2026</b>"
    assert body["description"] in body["text"]
    assert "=" * 69 not in body["description"] and "DESCRIPTION" not in body["description"]
    store = library_router.get_store()
    assembled = assemble_description(
        store.get(record["id"]), load_brief(store.root), collection=store.get_collection("uck26")
    )
    assert body["description"] == assembled.body
    assert [(v["field"], v["rule"]) for v in body["violations"]] == [
        ("package.description", "no_angle_brackets"),
    ]


def test_an_empty_record_has_an_empty_description_body(client, tmp_path):
    body = package(client, create_record(client, clip(tmp_path / "m", "a.mp4"))["id"])

    assert body["description"] == ""


def test_an_orphan_collection_id_renders_with_the_channel_brief(client, home, tmp_path):
    client.patch("/api/library/brief", json={"footer": "Channel footer"}, headers=agent())
    record = create_record(client, clip(tmp_path / "m", "a.mp4"))
    write_dangling_id(home, record, "old-event")

    body = package(client, record["id"])

    assert "Channel footer" in body["text"] and body["violations"] == []


# --- validate ----------------------------------------------------------------------

def validate(client, **body):
    return client.post("/api/library/validate", json=body, headers=agent())


def test_validate_with_a_collection_id_uses_the_effective_brief(client):
    create_collection(client, id="uck26", name="UCK", overrides={"house_rules": {"no_em_dashes": True}})
    fields = {"description": EM_DASH_DESCRIPTION}

    channel = validate(client, fields=fields).json()["violations"]
    event = validate(client, fields=fields, collection_id="uck26").json()["violations"]

    assert channel == []
    assert [v["rule"] for v in event] == ["no_em_dashes"]


def test_validate_with_a_video_id_uses_the_records_collection(client, tmp_path):
    create_collection(client, id="uck26", name="UCK", overrides={"house_rules": {"no_em_dashes": True}})
    record = create_record(client, clip(tmp_path / "m", "a.mp4"))
    record = set_collection(client, record, "uck26").json()
    client.patch(f"/api/library/{record['id']}", json={"description": EM_DASH_DESCRIPTION},
                 headers=agent(**{"If-Match": str(record["rev"])}))

    stored = validate(client, video_id=record["id"]).json()["violations"]
    draft_without = validate(client, video_id=record["id"], collection_id=None).json()["violations"]

    assert [v["rule"] for v in stored] == ["no_em_dashes"]
    assert draft_without == []  # the panel's unsaved "None" wins over the stored id


def test_validate_with_an_unknown_collection_id_is_404(client):
    assert validate(client, fields={}, collection_id="nope").status_code == 404


# --- the brief ---------------------------------------------------------------------

def test_the_brief_round_trips_a_template_and_slots(client):
    patch = {"description_template": "{{description}}\n\n{{footer}}", "slots": {"event": "UCK"}}

    body = client.patch("/api/library/brief", json=patch, headers=agent()).json()

    assert body["description_template"] == patch["description_template"]
    assert body["slots"] == {"event": "UCK"}


@pytest.mark.parametrize("slots", [{"footer": "x"}, {"Bad": "x"}])
def test_the_brief_refuses_a_bad_slot_name(client, slots):
    assert client.patch("/api/library/brief", json={"slots": slots}, headers=agent()).status_code == 422
