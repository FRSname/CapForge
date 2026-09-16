"""The PR 2 exit gate: every schema-1 record answers byte-identically after the upgrade.

docs/plans/multi-channel-pr2-contract.md → Exit. Each synthetic v1 fixture
(``library_v1_fixtures.py``) is written to disk as a pre-posts build left it.
Every route is answered three times:

1. **before**: the store reads the file as the code did before posts
   (``VideoRecord.model_validate`` of the raw dict, the legacy status ladder);
2. **after**: as shipped, which upgrades the file in memory and projects the
   primary channel's post back onto the root;
3. **after a write**: once the upgrade is persisted as schema 2 (with
   ``record.v1.json`` kept beside it).

The YouTube package (and its ``lang`` view when the fixture has one), the
LinkedIn / X / Instagram packages and ``POST /validate {video_id}`` must be
byte-identical; ``GET /{id}`` must be identical minus ``posts`` and ``schema``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.library import fs, posters
from backend.library import router as library_router
from backend.library.brief import BRIEF_FILE
from backend.library.paths import RECORD_FILE, RECORD_V1_FILE, THUMBNAILS_DIR, TRANSCRIPT_FILE
from backend.library.schemas import VideoRecord, derive_status
from backend.library.store import LibraryStore
from backend.library.transcript import derive_transcript
from backend.tests.library_v1_fixtures import COVER, FIXTURES, fixture

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    agent,
    client,
    home,
    main_module,
    project,
)

BASE = "/api/library"
LONG_VIDEO_S = 600.0
BRIEF = {
    "channel": "Harbour Office",
    "audience": "Sailors",
    "voice": "plain",
    "language": "en",
    "footer": "Fair winds.",
    "recorded_at_line": "Recorded on the pier.",
    "speaker_block": "Speaker: {{name}} ({{handle}})",
    "default_hashtags": ["#harbour", "tides"],
    "link_rows": [{"label": "Office", "url": "https://harbour.example"}],
    "house_rules": {"no_em_dashes": True, "description_chars": [10, 40],
                    "keywords_terms": [1, 2], "hook_first_150": True},
    "description_template": "",
    "slots": {},
}
VIEW_KEYS_A_READ_ADDS = ("posts", "schema")
VIEW_KEYS_A_WRITE_CHANGES = ("updatedAt", "rev")


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def _pre_posts_get(self: LibraryStore, video_id: str) -> VideoRecord:
    """``LibraryStore.get`` as it was before posts."""
    record = VideoRecord.model_validate(fs.read_json(self._locate(video_id) / RECORD_FILE))
    return record.model_copy(update={"missing_media": not Path(record.sourcePath).exists()})


def _pre_posts_status(self: LibraryStore, record: VideoRecord):
    """``status_of`` before posts: the root fields only (the record has no posts)."""
    assert record.posts == {}
    return derive_status(record, has_segments=self._has_segments(record))


def seed(home: Path, tmp_path: Path, name: str) -> tuple[str, Path]:
    library = home / "library"
    library.mkdir(parents=True, exist_ok=True)
    (library / BRIEF_FILE).write_text(json.dumps(BRIEF), encoding="utf-8")
    video_id = f"{sorted(FIXTURES).index(name) + 1:x}" * 32
    source = tmp_path / f"{name}.mp4"
    source.write_bytes(name.encode() * 64)
    folder = library / video_id
    (folder / THUMBNAILS_DIR).mkdir(parents=True)
    (folder / THUMBNAILS_DIR / COVER).write_bytes(b"jpeg")
    (folder / TRANSCRIPT_FILE).write_text(
        json.dumps(derive_transcript(project(duration=LONG_VIDEO_S))), encoding="utf-8")
    record_path = folder / RECORD_FILE
    record_path.write_text(json.dumps(fixture(name, video_id, str(source)), indent=2), encoding="utf-8")
    return video_id, record_path


def routes(video_id: str, raw: dict) -> dict[str, tuple[str, str, dict]]:
    package = f"{BASE}/{video_id}/package"
    found = {
        "youtube": ("get", package, {}),
        "linkedin": ("get", package, {"platform": "linkedin"}),
        "x": ("get", package, {"platform": "x"}),
        "instagram": ("get", package, {"platform": "instagram"}),
        "validate": ("post", f"{BASE}/validate", {"video_id": video_id}),
    }
    for lang in raw.get("localized", {}):
        found[f"youtube-{lang}"] = ("get", package, {"lang": lang})
    return found


def answers(client, video_id: str, raw: dict) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for label, (method, path, params) in routes(video_id, raw).items():
        if method == "get":
            r = client.get(path, params=params, headers=agent())
        else:
            r = client.post(path, json=params, headers=agent())
        assert r.status_code == 200, (label, r.text)
        out[label] = r.content
    return out


def view(client, video_id: str, *drop: str) -> str:
    body = client.get(f"{BASE}/{video_id}", headers=agent()).json()
    return json.dumps({k: v for k, v in body.items() if k not in drop}, ensure_ascii=False)


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_a_v1_record_answers_byte_identically_before_and_after_the_upgrade(
    client, home, tmp_path, monkeypatch, name
):
    video_id, record_path = seed(home, tmp_path, name)
    original = record_path.read_bytes()
    raw = json.loads(original)

    with monkeypatch.context() as legacy:
        legacy.setattr(LibraryStore, "get", _pre_posts_get)
        legacy.setattr(LibraryStore, "status_of", _pre_posts_status)
        before = answers(client, video_id, raw)
        before_view = view(client, video_id, *VIEW_KEYS_A_READ_ADDS)

    after = answers(client, video_id, raw)
    assert record_path.read_bytes() == original, "a read never writes the record"
    for label in before:
        assert after[label] == before[label], label
    assert view(client, video_id, *VIEW_KEYS_A_READ_ADDS) == before_view

    store = library_router.get_store()
    with store.write_lock:
        store._persist(store.get(video_id))
    stored = json.loads(record_path.read_text(encoding="utf-8"))
    assert stored["schema"] == 2
    assert record_path.with_name(RECORD_V1_FILE).read_bytes() == original

    written = answers(client, video_id, raw)
    for label in before:
        assert written[label] == before[label], f"{label} after the write"
    drop = (*VIEW_KEYS_A_READ_ADDS, *VIEW_KEYS_A_WRITE_CHANGES)
    assert view(client, video_id, *drop) == json.dumps(
        {k: v for k, v in json.loads(before_view).items() if k not in drop}, ensure_ascii=False)


def test_the_fixtures_are_not_vacuous(client, home, tmp_path):
    """The full fixture reaches the text, the findings, the cover and the translation."""
    video_id, _ = seed(home, tmp_path, "full")

    youtube = client.get(f"{BASE}/{video_id}/package", headers=agent()).json()
    polish = client.get(f"{BASE}/{video_id}/package", params={"lang": "pl"}, headers=agent()).json()
    record = client.get(f"{BASE}/{video_id}", headers=agent()).json()
    linkedin = client.get(f"{BASE}/{video_id}/package", params={"platform": "linkedin"},
                          headers=agent()).json()

    assert "Fair winds." in youtube["text"] and "Cover file: " in youtube["text"]
    assert any(v["rule"] == "no_em_dashes" for v in youtube["violations"])
    assert "Marynowanie" in polish["text"]
    assert "https://youtu.be/tideVid0001" in linkedin["text"]
    assert record["status"] == "published" and record["cover"] == COVER
    assert record["languages"] == ["en", "pl"]
