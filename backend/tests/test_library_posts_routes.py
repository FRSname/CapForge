"""Posts over HTTP: the PATCH merge and refusals, the channel package and validate,
channel delete, recent posts and import (docs/plans/multi-channel-pr2-contract.md)."""

from __future__ import annotations

import pytest

from backend.library import posters
from backend.library.platforms import TIKTOK_MAX_CAPTION_UTF16
from backend.library.validate import TITLE_MAX_CHARS

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    agent,
    capforge_file,
    client,
    home,
    main_module,
    media,
    project,
)

BASE = "/api/library"
PRIMARY = "youtube-channel"
EMOJI = "\N{GRINNING FACE}"  # 2 UTF-16 units
FRAME = "a" * 32 + ".jpg"


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def new_channel(client, platform: str, name: str) -> str:
    r = client.post(f"{BASE}/channels", json={"platform": platform, "name": name}, headers=agent())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_record(client, path, **body) -> dict:
    r = client.post(BASE, json={"source_path": str(path), **body}, headers=agent())
    assert r.status_code in (200, 201), r.text
    return r.json()


def patch(client, video_id: str, body: dict):
    rev = client.get(f"{BASE}/{video_id}", headers=agent()).json()["rev"]
    return client.patch(f"{BASE}/{video_id}", json=body, headers=agent(**{"If-Match": str(rev)}))


def rules(response) -> list[tuple[str, str]]:
    return [(v["field"], v["rule"]) for v in response.json()["violations"]]


# --- the exit test ----------------------------------------------------------------------

def test_exit_a_tiktok_caption_over_2200_utf16_units_is_refused_under_its_post(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]
    at_limit = EMOJI * (TIKTOK_MAX_CAPTION_UTF16 // 2)

    refused = patch(client, video_id, {"posts": {tt: {"caption": at_limit + "a"}}})

    assert refused.status_code == 422
    assert rules(refused) == [(f"posts.{tt}.caption", "tiktok_max_chars")]
    assert client.get(f"{BASE}/{video_id}", headers=agent()).json()["posts"] == {}

    landed = patch(client, video_id, {"posts": {tt: {"caption": at_limit}}})
    assert landed.status_code == 200 and landed.json()["posts"][tt]["caption"] == at_limit


# --- PATCH ------------------------------------------------------------------------------

def test_a_posts_write_lands_and_the_root_is_the_primary_post(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]

    r = patch(client, video_id, {"description": "Root text",
                                 "posts": {tt: {"caption": "Clip", "hashtags": ["a"]}}})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["schema"] == 2 and body["description"] == "Root text"
    assert body["posts"][PRIMARY]["description"] == "Root text"
    assert body["posts"][tt]["caption"] == "Clip"
    assert [h["field"] for h in body["history"]] == ["description", f"posts.{tt}"]


def test_an_unknown_channel_is_refused(client, media):
    video_id = new_record(client, media)["id"]

    r = patch(client, video_id, {"posts": {"nowhere": {"caption": "x"}}})

    assert r.status_code == 422 and rules(r) == [("posts.nowhere", "unknown_channel")]


def test_a_field_sent_at_the_root_and_under_the_primary_post_is_ambiguous(client, media):
    video_id = new_record(client, media)["id"]

    r = patch(client, video_id, {"description": "a", "posts": {PRIMARY: {"description": "b"}}})

    assert r.status_code == 422
    assert rules(r) == [(f"posts.{PRIMARY}.description", "ambiguous_post_field")]


def test_a_second_youtube_channel_is_judged_by_youtubes_rules(client, media):
    second = new_channel(client, "youtube", "Second")
    video_id = new_record(client, media)["id"]

    r = patch(client, video_id, {"posts": {second: {"title": "T" * (TITLE_MAX_CHARS + 1),
                                                    "caption": "not here"}}})

    assert r.status_code == 422
    assert set(rules(r)) == {(f"posts.{second}.title", "title_max_chars"),
                             (f"posts.{second}.caption", "field_not_on_platform")}


def test_a_post_cover_must_be_a_candidate(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]

    r = patch(client, video_id, {"posts": {tt: {"cover": FRAME}}})

    assert r.status_code == 422 and rules(r) == [(f"posts.{tt}.cover", "cover_not_a_candidate")]


def test_a_style_finding_never_refuses_a_post(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]

    assert patch(client, video_id, {"posts": {tt: {"caption": "x", "hashtags": list("abcdefg")}}}).status_code == 200


def test_mark_published_through_posts_derives_the_youtube_id(client, media):
    video_id = new_record(client, media)["id"]

    r = patch(client, video_id, {"posts": {PRIMARY: {"published": {
        "url": "https://youtu.be/pub42", "at": "2026-09-01T10:00:00Z"}}}})

    body = r.json()
    assert body["publish"]["youtube"] == {"videoId": "pub42", "url": "https://youtu.be/pub42",
                                          "publishedAt": "2026-09-01T10:00:00Z"}
    assert body["publishedAt"] == "2026-09-01T10:00:00Z" and body["status"] == "published"
    (summary,) = client.get(BASE, headers=agent()).json()["videos"]
    assert summary["publishedOn"] == [PRIMARY]


# --- package ----------------------------------------------------------------------------

def package(client, video_id: str, **params):
    return client.get(f"{BASE}/{video_id}/package", params=params, headers=agent())


def test_the_package_refuses_an_unknown_channel_or_a_missing_post(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]

    assert package(client, video_id, channel="nowhere").status_code == 404
    missing = package(client, video_id, channel=tt)
    assert missing.status_code == 404 and missing.json()["reason"] == "no_post"


def test_a_tiktok_channel_package_is_the_pasted_post(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]
    patch(client, video_id, {"posts": {tt: {"caption": "Watch this", "hashtags": list("abcdef")}}})

    body = package(client, video_id, channel=tt).json()

    assert body == {
        "channel": tt, "platform": "tiktok", "text": "Watch this\n\n#a #b #c #d #e #f",
        "violations": [{"field": f"posts.{tt}.hashtags", "rule": "tiktok_hashtags",
                        "message": body["violations"][0]["message"], "severity": "style"}],
        "description": None,
    }


def test_a_youtube_channel_package_uses_its_post_and_its_own_profile(client, media):
    second = new_channel(client, "youtube", "Second")
    client.patch(f"{BASE}/channels/{second}", json={"profile": {"footer": "Second footer"}},
                 headers=agent())
    video_id = new_record(client, media)["id"]
    patch(client, video_id, {"title": "Library name", "description": "Primary text",
                             "posts": {second: {"title": "Second title", "description": "Second text"}}})

    body = package(client, video_id, channel=second).json()
    primary = package(client, video_id).json()

    assert body["channel"] == second and body["platform"] == "youtube"
    assert "Second title" in body["text"] and "Second footer" in body["text"]
    assert "Second text" in body["description"] and "Primary text" not in body["text"]
    assert "channel" not in primary and "Primary text" in primary["text"]


# --- validate ---------------------------------------------------------------------------

def validate(client, **body):
    return client.post(f"{BASE}/validate", json=body, headers=agent())


def test_validate_with_a_channel_judges_that_posts_draft(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]

    r = validate(client, video_id=video_id, channel=tt,
                 fields={"caption": "a" * (TIKTOK_MAX_CAPTION_UTF16 + 1)})

    assert r.status_code == 200 and rules(r) == [(f"posts.{tt}.caption", "tiktok_max_chars")]
    assert validate(client, channel=tt, fields={}).status_code == 422
    assert validate(client, video_id=video_id, channel="nowhere").status_code == 404
    assert validate(client, video_id=video_id, channel=tt, fields={"nope": 1}).status_code == 422


def test_the_record_wide_validate_adds_visible_posts_only(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]
    patch(client, video_id, {"posts": {tt: {"caption": "x", "hashtags": list("abcdef")}}})

    assert rules(validate(client, video_id=video_id)) == [(f"posts.{tt}.hashtags", "tiktok_hashtags")]
    patch(client, video_id, {"posts": {tt: {"hidden": True}}})
    assert rules(validate(client, video_id=video_id)) == []


# --- channels ---------------------------------------------------------------------------

def test_deleting_a_channel_with_posts_is_409_channel_in_use(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media, channels=[tt])["id"]

    r = client.delete(f"{BASE}/channels/{tt}", headers=agent())

    assert r.status_code == 409
    assert r.json()["reason"] == "channel_in_use" and r.json()["posts"] == 1
    patch(client, video_id, {"posts": {tt: None}})
    assert client.delete(f"{BASE}/channels/{tt}", headers=agent()).status_code == 204


def test_recent_posts_are_opt_in_and_bounded(client, media):
    tt = new_channel(client, "tiktok", "Clips")
    video_id = new_record(client, media)["id"]
    patch(client, video_id, {"title": "A video", "posts": {tt: {
        "caption": "Posted", "published": {"url": "https://t.example/1", "at": "2026-09-01T00:00:00Z"}}}})

    plain = client.get(f"{BASE}/channels/{tt}", headers=agent()).json()
    recent = client.get(f"{BASE}/channels/{tt}", params={"include_recent_posts": "true", "limit": 1},
                        headers=agent()).json()

    assert "recent_posts" not in plain
    assert recent["recent_posts"] == [{"video_id": video_id, "title": "A video", "text": "Posted",
                                       "hashtags": [], "url": "https://t.example/1",
                                       "at": "2026-09-01T00:00:00Z"}]
    for bad in (0, 51):
        r = client.get(f"{BASE}/channels/{tt}", params={"include_recent_posts": "true", "limit": bad},
                       headers=agent())
        assert r.status_code == 422


# --- import -----------------------------------------------------------------------------

def test_create_with_channels_gives_a_new_record_empty_posts(client, media):
    tt = new_channel(client, "tiktok", "Clips")

    created = client.post(BASE, json={"source_path": str(media), "channels": [tt]}, headers=agent())
    again = client.post(BASE, json={"source_path": str(media), "channels": [PRIMARY]}, headers=agent())

    assert created.status_code == 201 and list(created.json()["posts"]) == [tt]
    assert again.status_code == 200 and list(again.json()["posts"]) == [tt]


def test_an_unknown_import_channel_is_refused_before_anything_is_imported(client, media, tmp_path):
    folder = tmp_path / "inbox"
    folder.mkdir()
    (folder / "clip.mp4").write_bytes(b"clip" * 64)

    for path, body in (
        (BASE, {"source_path": str(media), "channels": ["nowhere"]}),
        (f"{BASE}/import-paths", {"paths": [str(media)], "channels": ["nowhere"]}),
        (f"{BASE}/import-folder", {"path": str(folder), "channels": ["nowhere"]}),
    ):
        r = client.post(path, json=body, headers=agent())
        assert r.status_code == 422 and r.json()["reason"] == "unknown_channel", path

    assert client.get(BASE, headers=agent()).json()["videos"] == []


def test_import_project_passes_channels_and_refuses_an_unknown_one(client, media, tmp_path):
    """The one create route PR 4 had to close (contract Part C → Backend gap)."""
    tt = new_channel(client, "tiktok", "Clips")
    path = capforge_file(tmp_path, media)

    refused = client.post(f"{BASE}/import-project",
                          json={"path": str(path), "channels": ["nowhere"]}, headers=agent())
    created = client.post(f"{BASE}/import-project", json={"path": str(path), "channels": [tt]},
                          headers=agent())

    assert refused.status_code == 422 and refused.json()["reason"] == "unknown_channel"
    assert created.status_code == 201 and list(created.json()["posts"]) == [tt]
    assert client.get(BASE, headers=agent()).json()["videos"] != []


def test_import_project_without_channels_is_unchanged(client, media, tmp_path):
    path = capforge_file(tmp_path, media)

    created = client.post(f"{BASE}/import-project", json={"path": str(path)}, headers=agent())

    assert created.status_code == 201 and created.json()["posts"] == {}


def test_import_paths_and_folder_pass_channels_to_created_records(client, media, tmp_path):
    tt = new_channel(client, "tiktok", "Clips")
    folder = tmp_path / "inbox"
    folder.mkdir()
    (folder / "clip.mp4").write_bytes(b"clip" * 64)

    dropped = client.post(f"{BASE}/import-paths", json={"paths": [str(media)], "channels": [tt]},
                          headers=agent()).json()
    scanned = client.post(f"{BASE}/import-folder", json={"path": str(folder), "channels": [tt]},
                          headers=agent()).json()

    for video_id in (*dropped["created"], *scanned["created"]):
        assert list(client.get(f"{BASE}/{video_id}", headers=agent()).json()["posts"]) == [tt]
    assert len(dropped["created"]) == len(scanned["created"]) == 1
