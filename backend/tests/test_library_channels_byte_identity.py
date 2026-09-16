"""The PR 1 exit gate: a library that only has a ``brief.json`` renders byte-identically.

docs/plans/multi-channel-pr1-contract.md → Exit. Each route is answered twice
for the same record: once with ``read_brief`` swapped back to the pre-channels
implementation (straight from ``load_brief(root)``, touching no channels file),
and once as shipped, which bootstraps ``channels.json`` from that brief and reads
the brief back as a view of the primary channel. The two answers must be equal.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.library import posters, router_publish
from backend.library.brief import BRIEF_FILE, load_brief
from backend.library.channel_store import CHANNELS_FILE

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    LEGAL_CHAPTERS,
    agent,
    client,
    home,
    main_module,
    media,
    project,
    transcribed_record,
)

URL = "https://youtu.be/abc123"
FILLED_BRIEF = {
    "channel": "Update Conference",
    "audience": "Developers",
    "voice": "plain",
    "language": "en",
    "footer": "Subscribe for more.\nMade with CapForge — thanks!",
    "recorded_at_line": "Recorded at Update 2026, Prague.",
    "speaker_block": "Speaker: {{name}} ({{handle}})",
    "default_hashtags": ["#update", "captions"],
    "link_rows": [{"label": "Site", "url": "https://update.cz"}],
    "house_rules": {"no_em_dashes": True, "description_chars": [10, 20],
                    "keywords_terms": [1, 2], "hook_first_150": True},
    "description_template": "",
    "slots": {"sponsor": "Acme"},
}
TEMPLATED_BRIEF = {
    **FILLED_BRIEF,
    "description_template": "{{description}}\n\n{{channel}} / {{sponsor}}\n\n{{footer}}",
}
ROUTES = ("youtube", "linkedin", "x", "instagram", "validate", "validate-draft", "brief")


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def _pre_channels_read_brief(store):
    """``read_brief`` as it was before channels existed."""
    return load_brief(store.root)


def filled_record(client, media) -> str:
    video_id = transcribed_record(client, media)
    rev = client.get(f"/api/library/{video_id}", headers=agent()).json()["rev"]
    r = client.patch(f"/api/library/{video_id}", json={
        "title": "Captions without a render farm",
        "short_description": "How CapForge renders captions locally — fast.",
        "description": "The render farm was the bottleneck.\n\nHere is what we run instead.",
        "chapters": LEGAL_CHAPTERS,
        "tags": ["captions", "whisper"],
        "hashtags": ["captions", "ffmpeg"],
        "keywords": ["captions", "local rendering", "whisper"],
        "publish": {"youtube": {"url": URL}},
    }, headers=agent(**{"If-Match": str(rev)}))
    assert r.status_code == 200, r.text
    return video_id


def answer(client, route: str, video_id: str):
    if route == "brief":
        return client.get("/api/library/brief", headers=agent())
    if route == "validate":
        return client.post("/api/library/validate", json={"video_id": video_id}, headers=agent())
    if route == "validate-draft":
        return client.post("/api/library/validate",
                           json={"fields": {"title": "A — B", "description": "x" * 30}},
                           headers=agent())
    return client.get(f"/api/library/{video_id}/package", params={"platform": route},
                      headers=agent())


def both_answers(client, home: Path, media, brief: dict, monkeypatch) -> tuple[dict, dict]:
    library = home / "library"
    library.mkdir(parents=True, exist_ok=True)
    (library / BRIEF_FILE).write_text(json.dumps(brief), encoding="utf-8")
    video_id = filled_record(client, media)

    with monkeypatch.context() as patch:
        patch.setattr(router_publish, "read_brief", _pre_channels_read_brief)
        before = {route: answer(client, route, video_id) for route in ROUTES}
    assert not (library / CHANNELS_FILE).exists(), "the old path must not bootstrap"

    after = {route: answer(client, route, video_id) for route in ROUTES}
    assert (library / CHANNELS_FILE).is_file(), "the shipped path reads the primary channel"
    for route in ROUTES:
        assert before[route].status_code == after[route].status_code == 200, route
    return ({r: before[r].content for r in ROUTES}, {r: after[r].content for r in ROUTES})


def test_a_brief_only_library_renders_byte_identically(client, home, media, monkeypatch):
    before, after = both_answers(client, home, media, FILLED_BRIEF, monkeypatch)

    for route in ROUTES:
        assert after[route] == before[route], route
    # The fixture is not vacuous: the brief reached the text and the findings.
    youtube = json.loads(after["youtube"])
    assert "Made with CapForge" in youtube["text"] and "#update" in youtube["text"]
    assert any(v["rule"] == "no_em_dashes" for v in json.loads(after["validate"])["violations"])


def test_a_custom_template_naming_the_channel_is_byte_identical(client, home, media, monkeypatch):
    before, after = both_answers(client, home, media, TEMPLATED_BRIEF, monkeypatch)

    for route in ROUTES:
        assert after[route] == before[route], route
    assert "Update Conference / Acme" in json.loads(after["youtube"])["description"]


def test_a_library_with_no_brief_file_keeps_every_default_package(client, home, media, monkeypatch):
    """No brief at all: the placeholder name reaches only ``/brief`` and ``{{channel}}``."""
    library = home / "library"
    library.mkdir(parents=True, exist_ok=True)
    video_id = filled_record(client, media)

    with monkeypatch.context() as patch:
        patch.setattr(router_publish, "read_brief", _pre_channels_read_brief)
        before = {route: answer(client, route, video_id).content for route in ROUTES}
    after = {route: answer(client, route, video_id).content for route in ROUTES}

    for route in ROUTES:
        if route != "brief":
            assert after[route] == before[route], route
    assert json.loads(after["brief"])["channel"] == "YouTube channel"  # the accepted delta
