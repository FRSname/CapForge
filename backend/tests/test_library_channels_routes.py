"""The channel and platform routes, and the brief as a view of the primary channel.

Contract: docs/plans/multi-channel-pr1-contract.md (Routes).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.library import posters
from backend.library.brief import BRIEF_FILE
from backend.library.channel_store import CHANNELS_FILE

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

BASE = "/api/library/channels"
BRIEF = "/api/library/brief"
PLACEHOLDER = "youtube-channel"


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def agent(**kw) -> dict:
    return {AGENT_HEADER: AGENT_TOKEN, **kw}


def user(**kw) -> dict:
    return {LOCAL_HEADER: LOCAL_TOKEN, **kw}


def library(home: Path) -> Path:
    path = home / "library"
    path.mkdir(parents=True, exist_ok=True)
    return path


def create(client, **body) -> dict:
    r = client.post(BASE, json=body, headers=agent())
    assert r.status_code == 201, r.text
    return r.json()


# --- the guard and the route order ---------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", "/api/library/platforms"), ("get", BASE), ("post", BASE),
    ("get", f"{BASE}/a"), ("patch", f"{BASE}/a"), ("delete", f"{BASE}/a"),
    ("post", f"{BASE}/a/primary"),
])
def test_every_channel_route_needs_a_token(client, method, path):
    kwargs = {"json": {}} if method in ("post", "patch") else {}

    assert getattr(client, method)(path, **kwargs).status_code == 401


def test_platforms_is_served(client):
    r = client.get("/api/library/platforms", headers=user())

    assert r.status_code == 200
    body = r.json()
    assert [p["id"] for p in body["platforms"]] == ["youtube", "tiktok", "instagram", "linkedin", "x"]
    x = body["platforms"][-1]
    assert x["limits"] == [{"field": "text", "max": 280, "unit": "weighted", "severity": "hard"}]


# --- list / create -------------------------------------------------------------

def test_the_list_bootstraps_one_primary_channel(client, home):
    r = client.get(BASE, headers=user())

    assert r.status_code == 200
    body = r.json()
    assert body["primary_id"] == PLACEHOLDER
    [channel] = body["channels"]
    assert channel["id"] == PLACEHOLDER and channel["primary"] is True
    assert channel["platform"] == "youtube" and channel["name"] == "YouTube channel"
    assert set(channel["context"]) >= {"about", "example_titles", "notes"}
    assert set(channel["profile"]) >= {"footer", "house_rules", "slots"}
    assert (home / "library" / CHANNELS_FILE).is_file()


def test_create_answers_201_with_primary_false(client):
    body = create(client, platform="instagram", name="Filip IG", handle="@filip",
                  context={"about": "Behind the scenes"})

    assert body["id"] == "filip-ig" and body["primary"] is False
    assert body["handle"] == "@filip" and body["context"]["about"] == "Behind the scenes"
    assert body["context"]["voice"] == ""
    assert body["createdAt"] and body["updatedAt"]
    listed = client.get(BASE, headers=agent()).json()["channels"]
    assert [c["id"] for c in listed] == [PLACEHOLDER, "filip-ig"]


def test_create_with_a_taken_id_is_409_channel_exists(client):
    create(client, id="ig", platform="instagram", name="IG")

    r = client.post(BASE, json={"id": "ig", "platform": "x", "name": "X"}, headers=agent())

    assert r.status_code == 409
    assert r.json()["reason"] == "channel_exists" and "ig" in r.json()["detail"]


@pytest.mark.parametrize("body", [
    {"name": "No platform"},
    {"platform": "youtube"},
    {"platform": "myspace", "name": "M"},
    {"platform": "x", "name": "X", "nope": 1},
    {"platform": "youtube", "name": "Y", "profile": {"slots": {"footer": "x"}}},
])
def test_an_invalid_create_is_422(client, body):
    assert client.post(BASE, json=body, headers=agent()).status_code == 422


# --- one channel -----------------------------------------------------------------

def test_get_one_and_404(client):
    assert client.get(f"{BASE}/{PLACEHOLDER}", headers=agent()).json()["primary"] is True
    assert client.get(f"{BASE}/nope", headers=agent()).status_code == 404


def test_patch_merges_context_and_profile_per_field(client):
    client.patch(f"{BASE}/{PLACEHOLDER}", json={"profile": {"footer": "F", "slots": {"a": "1"}}},
                 headers=agent())

    r = client.patch(f"{BASE}/{PLACEHOLDER}",
                     json={"name": "Update Conf", "context": {"keywords": ["dev"]},
                           "profile": {"default_hashtags": ["#u"]}},
                     headers=agent())

    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Update Conf" and body["primary"] is True
    assert body["id"] == PLACEHOLDER  # a rename keeps the id
    assert body["context"]["keywords"] == ["dev"]
    assert body["profile"] == {**body["profile"], "footer": "F", "slots": {"a": "1"},
                               "default_hashtags": ["#u"]}


def test_a_no_op_patch_keeps_updated_at(client):
    before = client.get(f"{BASE}/{PLACEHOLDER}", headers=agent()).json()

    after = client.patch(f"{BASE}/{PLACEHOLDER}", json={"name": before["name"]},
                         headers=agent()).json()

    assert after["updatedAt"] == before["updatedAt"]


@pytest.mark.parametrize("body", [
    {"platform": "instagram"},
    {"name": None},
    {"context": None},
    {"profile": {"slots": {"Bad": "x"}}},
    {"context": {"nope": 1}},
])
def test_an_invalid_patch_is_422(client, body):
    r = client.patch(f"{BASE}/{PLACEHOLDER}", json=body, headers=agent())

    assert r.status_code == 422


def test_patch_unknown_is_404(client):
    assert client.patch(f"{BASE}/nope", json={"handle": "@x"}, headers=agent()).status_code == 404


# --- delete / primary --------------------------------------------------------------

def test_delete_a_channel_is_204(client):
    create(client, id="ig", platform="instagram", name="IG")

    r = client.delete(f"{BASE}/ig", headers=agent())

    assert r.status_code == 204
    assert client.get(f"{BASE}/ig", headers=agent()).status_code == 404
    assert client.delete(f"{BASE}/ig", headers=agent()).status_code == 404


def test_deleting_the_primary_is_409_channel_is_primary(client):
    r = client.delete(f"{BASE}/{PLACEHOLDER}", headers=agent())

    assert r.status_code == 409
    assert r.json()["reason"] == "channel_is_primary" and r.json()["detail"]


def test_set_primary_answers_the_list(client):
    create(client, id="second", platform="youtube", name="Second")

    r = client.post(f"{BASE}/second/primary", headers=agent())

    assert r.status_code == 200
    body = r.json()
    assert body["primary_id"] == "second"
    assert {c["id"]: c["primary"] for c in body["channels"]} == {PLACEHOLDER: False, "second": True}
    assert client.delete(f"{BASE}/{PLACEHOLDER}", headers=agent()).status_code == 204


def test_a_non_youtube_primary_is_422_primary_not_youtube(client):
    create(client, id="ig", platform="instagram", name="IG")

    r = client.post(f"{BASE}/ig/primary", headers=agent())

    assert r.status_code == 422
    assert r.json()["reason"] == "primary_not_youtube" and r.json()["detail"]


def test_set_primary_unknown_is_404(client):
    assert client.post(f"{BASE}/nope/primary", headers=agent()).status_code == 404


# --- corrupt files ---------------------------------------------------------------

def test_a_corrupt_channels_file_is_500_on_every_route(client, home):
    (library(home) / CHANNELS_FILE).write_text("{nope", encoding="utf-8")

    for method, path in [("get", BASE), ("get", f"{BASE}/a"), ("get", BRIEF)]:
        r = getattr(client, method)(path, headers=agent())
        assert r.status_code == 500, path
        assert CHANNELS_FILE in r.json()["detail"]
    r = client.patch(BRIEF, json={"voice": "v"}, headers=agent())
    assert r.status_code == 500 and CHANNELS_FILE in r.json()["detail"]


def test_a_corrupt_brief_during_bootstrap_is_500(client, home):
    (library(home) / BRIEF_FILE).write_text("{nope", encoding="utf-8")

    for method, path in [("get", BASE), ("get", BRIEF), ("post", BASE)]:
        kwargs = {"json": {"platform": "x", "name": "X"}} if method == "post" else {}
        r = getattr(client, method)(path, headers=agent(), **kwargs)
        assert r.status_code == 500, path
        assert BRIEF_FILE in r.json()["detail"]
    assert not (home / "library" / CHANNELS_FILE).exists()


# --- the brief is a view of the primary channel ----------------------------------

def test_get_brief_reads_the_primary_channel(client):
    client.patch(f"{BASE}/{PLACEHOLDER}", json={
        "name": "Update", "language": "cs",
        "context": {"audience": "devs", "voice": "dry", "about": "not in the brief"},
        "profile": {"footer": "Thanks"},
    }, headers=agent())

    brief = client.get(BRIEF, headers=agent()).json()

    assert brief["channel"] == "Update" and brief["language"] == "cs"
    assert brief["audience"] == "devs" and brief["voice"] == "dry"
    assert brief["footer"] == "Thanks"
    assert "about" not in brief


def test_patch_brief_writes_through_to_the_primary_channel(client, home):
    r = client.patch(BRIEF, json={"channel": "Update", "voice": "dry",
                                  "default_hashtags": ["#u"]}, headers=agent())

    assert r.status_code == 200
    assert r.json()["channel"] == "Update" and r.json()["default_hashtags"] == ["#u"]
    channel = client.get(f"{BASE}/{PLACEHOLDER}", headers=agent()).json()
    assert channel["name"] == "Update" and channel["context"]["voice"] == "dry"
    assert channel["profile"]["default_hashtags"] == ["#u"]
    assert not (home / "library" / BRIEF_FILE).exists()  # the brief file is never written


def test_patch_brief_follows_the_primary(client):
    create(client, id="second", platform="youtube", name="Second")
    client.post(f"{BASE}/second/primary", headers=agent())

    client.patch(BRIEF, json={"footer": "Second's footer"}, headers=agent())

    assert client.get(f"{BASE}/second", headers=agent()).json()["profile"]["footer"] == "Second's footer"
    assert client.get(f"{BASE}/{PLACEHOLDER}", headers=agent()).json()["profile"]["footer"] == ""
    assert client.get(BRIEF, headers=agent()).json()["channel"] == "Second"


def test_patch_brief_with_a_null_field_is_422(client):
    assert client.patch(BRIEF, json={"footer": None}, headers=agent()).status_code == 422


def test_the_bootstrap_leaves_brief_json_on_disk(client, home):
    brief = {"channel": "Update", "footer": "F"}
    path = library(home) / BRIEF_FILE
    path.write_text(json.dumps(brief), encoding="utf-8")

    client.patch(BRIEF, json={"footer": "G"}, headers=agent())

    assert json.loads(path.read_text(encoding="utf-8")) == brief
    assert client.get(BASE, headers=agent()).json()["primary_id"] == "update"
