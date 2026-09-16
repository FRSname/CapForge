"""The channel brief: one small JSON file under the library root (#4).

The brief is the only *global* authored state the library owns. It is read on
every package render and every style validation, so the rules pinned here are
"defaults when absent" and "never silently reset a user's brief".
"""

from __future__ import annotations

import json
import sys
import types

import pytest
from fastapi.testclient import TestClient

from backend.library.brief import (
    BRIEF_FILE,
    Brief,
    BriefPatch,
    HouseRules,
    load_brief,
    save_brief,
)

AGENT_HEADER = "X-CapForge-Agent-Token"
LOCAL_HEADER = "X-CapForge-Local-Token"
AGENT_TOKEN = "test-agent-token-xyz"
LOCAL_TOKEN = "test-local-token-abc"

DESCRIPTION_WINDOW = (1800, 2200)
KEYWORD_WINDOW = (12, 20)


# --- the pure module ---------------------------------------------------------

def test_load_brief_returns_defaults_when_the_file_is_missing(tmp_path):
    brief = load_brief(tmp_path)

    assert brief == Brief()
    assert brief.channel == "" and brief.default_hashtags == []
    assert brief.house_rules == HouseRules()
    # The one house rule that is on out of the box.
    assert brief.house_rules.hook_first_150 is True
    assert brief.house_rules.no_em_dashes is False
    assert brief.house_rules.description_chars is None
    assert not (tmp_path / BRIEF_FILE).exists()  # reading never writes


def test_save_brief_writes_the_file_and_returns_the_merged_brief(tmp_path):
    saved = save_brief(tmp_path, BriefPatch(channel="CapForge", footer="Thanks!"))

    assert saved.channel == "CapForge" and saved.footer == "Thanks!"
    assert (tmp_path / BRIEF_FILE).is_file()
    assert load_brief(tmp_path) == saved


def test_save_brief_merges_top_level_fields_and_leaves_the_rest(tmp_path):
    save_brief(tmp_path, BriefPatch(channel="CapForge", default_hashtags=["#ai"]))

    merged = save_brief(tmp_path, BriefPatch(audience="Developers"))

    assert merged.channel == "CapForge"  # untouched by the second patch
    assert merged.default_hashtags == ["#ai"]
    assert merged.audience == "Developers"


def test_save_brief_replaces_a_list_rather_than_appending(tmp_path):
    save_brief(tmp_path, BriefPatch(default_hashtags=["#a", "#b"]))

    merged = save_brief(tmp_path, BriefPatch(default_hashtags=["#c"]))

    assert merged.default_hashtags == ["#c"]


def test_save_brief_replaces_house_rules_as_a_whole(tmp_path):
    """``house_rules`` is one top-level field, so a patch carries the whole block."""
    save_brief(tmp_path, BriefPatch(house_rules=HouseRules(no_em_dashes=True)))

    stored = load_brief(tmp_path)

    assert stored.house_rules.no_em_dashes is True
    assert stored.house_rules.hook_first_150 is True  # the sub-model's own default


def test_house_rule_windows_round_trip_through_the_file(tmp_path):
    save_brief(tmp_path, BriefPatch(house_rules=HouseRules(
        description_chars=DESCRIPTION_WINDOW, keywords_terms=KEYWORD_WINDOW
    )))

    stored = load_brief(tmp_path)

    assert stored.house_rules.description_chars == DESCRIPTION_WINDOW
    assert stored.house_rules.keywords_terms == KEYWORD_WINDOW


def test_save_brief_does_not_mutate_the_brief_it_read(tmp_path):
    first = save_brief(tmp_path, BriefPatch(channel="One"))

    save_brief(tmp_path, BriefPatch(channel="Two"))

    assert first.channel == "One"


def test_corrupt_brief_json_raises_rather_than_resetting_the_users_brief(tmp_path):
    (tmp_path / BRIEF_FILE).write_text("{not json", encoding="utf-8")

    with pytest.raises(ValueError) as excinfo:
        load_brief(tmp_path)

    assert BRIEF_FILE in str(excinfo.value)
    # The bad file is still there: nothing was overwritten.
    assert (tmp_path / BRIEF_FILE).read_text(encoding="utf-8") == "{not json"


def test_a_brief_file_with_an_unknown_field_raises(tmp_path):
    (tmp_path / BRIEF_FILE).write_text(json.dumps({"nope": 1}), encoding="utf-8")

    with pytest.raises(ValueError):
        load_brief(tmp_path)


def test_brief_forbids_an_unknown_field():
    with pytest.raises(ValueError):
        Brief(nope=1)
    with pytest.raises(ValueError):
        BriefPatch(nope=1)
    with pytest.raises(ValueError):
        HouseRules(nope=1)


# --- over HTTP ---------------------------------------------------------------

@pytest.fixture
def main_module():
    """Import backend.main with the heavy ML deps stubbed (see test_library_routes)."""
    inserted = []
    for name in ("whisperx", "torch", "torchaudio", "huggingface_hub"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
            inserted.append(name)
    hub = sys.modules["huggingface_hub"]
    if not hasattr(hub, "snapshot_download"):
        hub.snapshot_download = lambda *a, **k: None  # type: ignore[attr-defined]
    if "huggingface_hub.errors" not in sys.modules:
        errors = types.ModuleType("huggingface_hub.errors")
        errors.LocalEntryNotFoundError = type(  # type: ignore[attr-defined]
            "LocalEntryNotFoundError", (Exception,), {}
        )
        sys.modules["huggingface_hub.errors"] = errors
        inserted.append("huggingface_hub.errors")
    import backend.main as m

    yield m

    for name in inserted:
        sys.modules.pop(name, None)


@pytest.fixture
def home(tmp_path, monkeypatch):
    path = tmp_path / "home"
    monkeypatch.setenv("CAPFORGE_HOME", str(path))
    return path


@pytest.fixture
def client(main_module, monkeypatch, home):
    from backend.library import router as library_router

    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "LOCAL_TOKEN", LOCAL_TOKEN, raising=False)
    prev_result = m.current_result
    m.current_result = None
    try:
        yield TestClient(m.app)
    finally:
        m.current_result = prev_result
        library_router.reset_store_cache()


def agent(**kw):
    return {AGENT_HEADER: AGENT_TOKEN, **kw}


def test_get_brief_answers_defaults_before_anything_is_saved(client):
    """The brief is the primary channel's view (multi-channel PR 1): an empty
    library bootstraps a channel named "YouTube channel", the accepted delta."""
    r = client.get("/api/library/brief", headers=agent())

    assert r.status_code == 200
    assert r.json() == Brief(channel="YouTube channel").model_dump(mode="json")


def test_patch_brief_round_trips(client, home):
    patch = {
        "channel": "CapForge",
        "default_hashtags": ["#captions", "#ai"],
        "link_rows": [{"label": "Site", "url": "https://capforge.app"}],
        "house_rules": {"no_em_dashes": True, "description_chars": [1800, 2200]},
    }

    r = client.patch("/api/library/brief", json=patch, headers=agent())

    assert r.status_code == 200
    body = r.json()
    assert body["channel"] == "CapForge"
    assert body["house_rules"]["no_em_dashes"] is True
    assert body["house_rules"]["description_chars"] == [1800, 2200]
    assert body["link_rows"] == [{"label": "Site", "url": "https://capforge.app"}]
    assert client.get("/api/library/brief", headers=agent()).json() == body
    # PATCH /brief writes the primary channel (multi-channel PR 1), never brief.json.
    assert (home / "library" / "channels.json").is_file()
    assert not (home / "library" / BRIEF_FILE).exists()


def test_patch_brief_merges_with_what_is_already_stored(client):
    client.patch("/api/library/brief", json={"channel": "CapForge"}, headers=agent())

    body = client.patch("/api/library/brief", json={"voice": "plain"}, headers=agent()).json()

    assert body["channel"] == "CapForge" and body["voice"] == "plain"


def test_patch_brief_refuses_an_unknown_field(client):
    r = client.patch("/api/library/brief", json={"nope": 1}, headers=agent())

    assert r.status_code == 422


def test_patch_brief_refuses_an_unknown_house_rule(client):
    r = client.patch("/api/library/brief", json={"house_rules": {"nope": 1}}, headers=agent())

    assert r.status_code == 422


def test_brief_routes_need_a_token(client):
    assert client.get("/api/library/brief").status_code == 401
    assert client.patch("/api/library/brief", json={}).status_code == 401


def test_brief_is_not_mistaken_for_a_record_id(client):
    """``/brief`` is registered before ``/{video_id}`` — never a 404 record lookup."""
    assert client.get("/api/library/brief", headers=agent()).status_code == 200
    assert client.get("/api/library/nope", headers=agent()).status_code == 404
