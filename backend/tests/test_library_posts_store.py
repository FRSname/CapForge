"""Posts in the store: upgrade on read, schema 2 on write, the per-channel merge
and everything derived from posts (docs/plans/multi-channel-pr2-contract.md)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.library.channel_store import CHANNELS_FILE
from backend.library.channels import ChannelCreate
from backend.library.errors import ChannelInUse, ChannelIsPrimary, UnknownChannel
from backend.library.paths import RECORD_FILE, RECORD_V1_FILE, SCRATCH_DIR_NAME
from backend.library.schemas import RecordPatch, RenderEntry
from backend.library.store import LibraryStore
from backend.library.store_posts import RECENT_POST_TEXT_MAX_CHARS
from backend.tests.library_v1_fixtures import COVER, fixture

PRIMARY = "youtube-channel"  # the bootstrap id with no brief.json
FRAME = "a" * 32 + ".jpg"


@pytest.fixture
def store(tmp_path: Path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


def media(tmp_path: Path, name: str = "talk.mp4", data: bytes = b"talk") -> Path:
    path = tmp_path / "media" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data * 50)
    return path


def write_v1(store: LibraryStore, tmp_path: Path, name: str, video_id: str = "d" * 32) -> Path:
    body = fixture(name, video_id, str(media(tmp_path, f"{video_id}.mp4", video_id.encode())))
    path = store.root / video_id / RECORD_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2), encoding="utf-8")
    return path


def tiktok(store: LibraryStore, name: str = "Clips") -> str:
    return store.create_channel(ChannelCreate(platform="tiktok", name=name)).id


def patch(store: LibraryStore, video_id: str, body: dict, by: str = "agent"):
    current = store.get(video_id)
    return store.patch(video_id, RecordPatch.model_validate(body), rev=current.rev, by=by)


# --- upgrade and storage ---------------------------------------------------------------

def test_a_v1_file_reads_as_before_and_a_read_writes_nothing(store, tmp_path):
    path = write_v1(store, tmp_path, "full")
    before = path.read_bytes()

    record = store.get("d" * 32)
    store.list()

    assert record.description.startswith("A harbour clerk") and record.thumbnail.cover == COVER
    assert record.publish.youtube.videoId == "tideVid0001"
    assert record.posts[PRIMARY].description == record.description
    assert path.read_bytes() == before
    assert not path.with_name(RECORD_V1_FILE).exists()
    assert not (store.root / CHANNELS_FILE).exists(), "a record read never bootstraps channels"


def test_the_first_write_keeps_the_v1_file_once_and_stores_schema_2(store, tmp_path):
    path = write_v1(store, tmp_path, "full")
    original = path.read_bytes()

    store.add_render("d" * 32, RenderEntry(path="/o.mp4", kind="video", at="2026-09-01T00:00:00Z"))
    store.add_render("d" * 32, RenderEntry(path="/p.mp4", kind="video", at="2026-09-02T00:00:00Z"))

    assert path.with_name(RECORD_V1_FILE).read_bytes() == original
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["schema"] == 2 and "description" not in stored
    assert stored["posts"][PRIMARY]["published"]["id"] == "tideVid0001"
    assert store.get("d" * 32).description.startswith("A harbour clerk")


def test_a_new_record_is_never_backed_up(store, tmp_path):
    record = store.create(str(media(tmp_path)))
    patch(store, record.id, {"description": "x"})

    assert not (store.root / record.id / RECORD_V1_FILE).exists()


# --- the posts merge -------------------------------------------------------------------

def test_a_posts_write_merges_per_channel_with_one_history_entry_per_channel(store, tmp_path):
    tt = tiktok(store)
    record = store.create(str(media(tmp_path)))
    patch(store, record.id, {"description": "main text"})

    out = patch(store, record.id, {"posts": {tt: {"caption": "clip", "hashtags": ["a"]}}})

    assert out.rev == 3 and out.posts[tt].caption == "clip"
    assert out.description == "main text" and out.posts[PRIMARY].description == "main text"
    assert [h.field for h in out.history] == ["description", f"posts.{tt}"]
    assert out.history[-1].prev is None

    again = patch(store, record.id, {"posts": {tt: {"caption": "clip"}}})
    assert again.rev == 3, "a no-op posts write bumps nothing"

    kept = patch(store, record.id, {"posts": {tt: {"caption": "new"}}})
    assert kept.posts[tt].hashtags == ["a"] and kept.history[-1].prev["caption"] == "clip"

    removed = patch(store, record.id, {"posts": {tt: None}})
    assert tt not in removed.posts and removed.history[-1].field == f"posts.{tt}"


def test_a_direct_primary_post_write_is_the_root_on_read(store, tmp_path):
    record = store.create(str(media(tmp_path)))

    patch(store, record.id, {"posts": {PRIMARY: {"description": "direct", "tags": ["t"]}}})

    fresh = store.get(record.id)
    assert fresh.description == "direct" and fresh.tags == ["t"]


def test_a_youtube_url_gets_its_id_and_published_at_is_the_earliest(store, tmp_path):
    tt = tiktok(store)
    record = store.create(str(media(tmp_path)))

    patch(store, record.id, {"posts": {
        PRIMARY: {"published": {"url": "https://youtu.be/vid42", "at": "2026-06-02T00:00:00Z"}},
        tt: {"published": {"url": "https://tiktok.example/v/1", "at": "2026-06-01T00:00:00Z"}},
    }})

    fresh = store.get(record.id)
    assert fresh.publish.youtube.videoId == "vid42"
    assert fresh.posts[tt].published.id is None
    assert fresh.publishedAt == "2026-06-01T00:00:00Z"


# --- derived state ----------------------------------------------------------------------

def test_status_and_published_on_skip_hidden_posts(store, tmp_path):
    tt = tiktok(store)
    record = store.create(str(media(tmp_path)))
    patch(store, record.id, {"posts": {PRIMARY: {"description": "hidden text", "hidden": True}}})
    assert store.status_of(store.get(record.id)) == "imported"

    patch(store, record.id, {"posts": {tt: {"caption": "visible"}}})
    assert store.status_of(store.get(record.id)) == "drafted"

    patch(store, record.id, {"posts": {tt: {"published": {"url": "https://tiktok.example/1"}},
                                       PRIMARY: {"published": {"id": "hiddenVid"}}}})
    (summary,) = store.list()
    assert summary["status"] == "published" and summary["publishedOn"] == [tt]


def test_a_root_write_unhides_the_primary_post(store, tmp_path):
    record = store.create(str(media(tmp_path)))
    patch(store, record.id, {"posts": {PRIMARY: {"description": "x", "hidden": True}}})

    out = patch(store, record.id, {"short_description": "shown again"})

    assert out.posts[PRIMARY].hidden is False


def test_search_reads_every_visible_post(store, tmp_path):
    tt = tiktok(store)
    record = store.create(str(media(tmp_path)))
    patch(store, record.id, {"posts": {tt: {"caption": "marmalade", "hashtags": ["quince"]},
                                       PRIMARY: {"description": "sardines", "hidden": True}}})

    assert [v["id"] for v in store.list(q="marmalade")] == [record.id]
    assert [v["id"] for v in store.list(q="quince")] == [record.id]
    assert store.list(q="sardines") == []


def test_deleting_a_frame_clears_it_from_every_post(store, tmp_path):
    tt = tiktok(store)
    record = store.create(str(media(tmp_path)))
    store.add_thumbnail_candidates(record.id, [FRAME], by="user", cover=FRAME)
    patch(store, record.id, {"posts": {tt: {"cover": FRAME}, PRIMARY: {"hidden": True}}})

    out = store.remove_thumbnail_candidate(record.id, FRAME, by="user")

    assert out.thumbnail.cover is None and out.posts[tt].cover is None
    assert out.posts[PRIMARY].cover is None and out.posts[PRIMARY].hidden is True
    assert out.history[-1].field == "thumbnail" and out.history[-1].prev["cover"] == FRAME


# --- channels -----------------------------------------------------------------------------

def test_a_channel_with_posts_cannot_be_deleted_scratch_included(store, tmp_path):
    tt = tiktok(store)
    real = store.create(str(media(tmp_path, "a.mp4", b"a")), channels=[tt])
    store.create(str(media(tmp_path, "b.mp4", b"b")), scratch=True, channels=[tt])

    with pytest.raises(ChannelInUse) as refused:
        store.delete_channel(tt)
    assert refused.value.posts == 2
    with pytest.raises(ChannelIsPrimary):
        store.delete_channel(PRIMARY)

    patch(store, real.id, {"posts": {tt: None}})
    scratch_folder = next((store.root / SCRATCH_DIR_NAME).iterdir())
    raw = json.loads((scratch_folder / RECORD_FILE).read_text(encoding="utf-8"))
    (scratch_folder / RECORD_FILE).write_text(json.dumps({**raw, "posts": {}}), encoding="utf-8")
    store.delete_channel(tt)


def test_recent_posts_newest_first_visible_published_only(store, tmp_path):
    tt = tiktok(store)
    ids = [store.create(str(media(tmp_path, f"{n}.mp4", n.encode()))).id for n in "abcd"]
    long_caption = "x" * (RECENT_POST_TEXT_MAX_CHARS + 20)
    posts = [
        {"caption": "older", "published": {"url": "https://t.example/a", "at": "2026-01-01T00:00:00Z"}},
        {"caption": long_caption, "published": {"url": "https://t.example/b", "at": "2026-02-01T00:00:00Z"}},
        {"caption": "hidden", "hidden": True, "published": {"url": "https://t.example/c"}},
        {"caption": "never published"},
    ]
    for video_id, post in zip(ids, posts):
        patch(store, video_id, {"title": f"Video {video_id[:4]}", "posts": {tt: post}})

    recent = store.recent_posts(tt, limit=10)

    assert [r["video_id"] for r in recent] == [ids[1], ids[0]]
    assert recent[0]["text"] == "x" * RECENT_POST_TEXT_MAX_CHARS
    assert recent[0] == {**recent[0], "url": "https://t.example/b", "at": "2026-02-01T00:00:00Z",
                         "title": f"Video {ids[1][:4]}", "hashtags": []}
    assert len(store.recent_posts(tt, limit=1)) == 1


# --- import with channels -----------------------------------------------------------------

def test_a_new_record_gets_an_empty_post_per_channel_and_an_existing_one_is_left_alone(store, tmp_path):
    tt = tiktok(store)
    path = media(tmp_path)

    created, minted = store.create_or_get(str(path), channels=[tt, PRIMARY, tt])
    again, minted_again = store.create_or_get(str(path), channels=[tt])
    other = store.create(str(media(tmp_path, "b.mp4", b"b")))
    same, _ = store.create_or_get(str(media(tmp_path, "b.mp4", b"b")), channels=[tt])

    assert minted and list(created.posts) == [tt, PRIMARY]
    assert not minted_again and again.rev == created.rev
    assert same.posts == other.posts == {}


def test_an_unknown_channel_creates_nothing(store, tmp_path):
    with pytest.raises(UnknownChannel):
        store.create_or_get(str(media(tmp_path)), channels=["nope"])

    assert store.list() == []
