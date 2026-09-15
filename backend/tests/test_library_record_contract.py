"""Dossier contract: the field partition, the patch surface, chapters-in-seconds.

Same spirit as ``test_caption_cfg_contract.py`` — a new dossier field must be
filed as authored or system, or this test fails. Vision §2.3 ("contract test")
and §9.2 ("chapters are seconds").
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.library import fs, paths
from backend.library.schemas import (
    AUTHORED_FIELDS,
    HISTORY_CAP,
    HISTORY_PREV_MAX_CHARS,
    SYSTEM_FIELDS,
    AuthoredFields,
    Chapter,
    Publish,
    RecordPatch,
    RenderEntry,
    SystemFields,
    VideoRecord,
    YouTubePublish,
    captions_newer_than_published,
    derive_status,
)
from backend.library.record_projection import PROJECTED_FIELDS
from backend.library.store import LibraryStore

CHAPTER_START_S = 61.25


def _media(tmp_path, name: str = "talk.mp4"):
    p = tmp_path / name
    p.write_bytes(b"media-bytes" * 10)
    return p


def _project(words: list[str]) -> dict:
    """A v2 project whose single segment holds ``words`` at 1 s each."""
    return {
        "version": 2,
        "transcriptionResult": {
            "segments": [
                {
                    "start": 0.0,
                    "end": float(len(words)),
                    "text": " ".join(words),
                    "words": [
                        {"word": w, "start": float(i), "end": float(i + 1), "wid": f"w{i}"}
                        for i, w in enumerate(words)
                    ],
                }
            ],
            "language": "en",
            "audio_path": "/tmp/a.wav",
            "duration": float(len(words)),
        },
    }


def test_every_record_field_is_filed_exactly_once():
    for name in VideoRecord.model_fields:
        filed = [name in AUTHORED_FIELDS, name in SYSTEM_FIELDS]
        assert sum(filed) == 1, f"{name!r} must be in exactly one of AUTHORED/SYSTEM"
    assert AUTHORED_FIELDS | SYSTEM_FIELDS == set(VideoRecord.model_fields)
    assert not (AUTHORED_FIELDS & SYSTEM_FIELDS)


def test_field_sets_match_their_base_classes():
    assert AUTHORED_FIELDS == set(AuthoredFields.model_fields)
    assert SYSTEM_FIELDS == set(SystemFields.model_fields)


def test_posts_are_authored_and_the_schema_is_a_system_field():
    assert "posts" in AUTHORED_FIELDS
    assert "schema" in SYSTEM_FIELDS


def test_the_projected_fields_are_pinned():
    """The root fields that are the primary channel's post (PR 2 contract)."""
    assert PROJECTED_FIELDS == frozenset({
        "description", "short_description", "tags", "hashtags", "localized",
        "thumbnail.cover", "publish.youtube",
    })


def test_patch_surface_is_exactly_the_authored_fields():
    assert set(RecordPatch.model_fields) == AUTHORED_FIELDS


def test_patch_defaults_are_all_none_so_unset_means_untouched():
    patch = RecordPatch()
    assert patch.model_fields_set == set()
    assert all(getattr(patch, name) is None for name in RecordPatch.model_fields)


@pytest.mark.parametrize("payload", [
    {"rev": 4},                 # system field
    {"id": "abc"},              # system field
    {"history": []},            # system field
    {"not_a_field": 1},         # unknown
])
def test_patch_refuses_system_and_unknown_fields(payload):
    with pytest.raises(ValidationError):
        RecordPatch(**payload)


def test_record_defaults_are_empty_not_none():
    rec = VideoRecord(id="x")
    assert rec.title == "" and rec.description == ""
    assert rec.chapters == [] and rec.tags == [] and rec.renders == []
    assert rec.shorts.clip_suggestions == [] and rec.thumbnail.ideas == []
    assert rec.publish.youtube.videoId is None
    assert rec.scratch is False and rec.missing_media is False


def test_status_ladder():
    rec = VideoRecord(id="x")
    assert derive_status(rec, has_segments=False) == "imported"
    assert derive_status(rec, has_segments=True) == "transcribed"
    with_render = rec.model_copy(update={"renders": [RenderEntry(path="/o.mp4", kind="video", at="t")]})
    assert derive_status(with_render, has_segments=True) == "captioned"
    drafted = with_render.model_copy(update={"description": "hello"})
    assert derive_status(drafted, has_segments=True) == "drafted"
    published = drafted.model_copy(update={"publish": Publish(youtube=YouTubePublish(videoId="abc"))})
    assert derive_status(published, has_segments=True) == "published"


def test_captions_newer_than_published():
    rec = VideoRecord(id="x", publishedAt="2026-09-01T10:00:00Z")
    assert captions_newer_than_published(rec, "2026-09-02T09:00:00Z") is True
    assert captions_newer_than_published(rec, "2026-08-30T09:00:00Z") is False
    assert captions_newer_than_published(rec, None) is False
    assert captions_newer_than_published(VideoRecord(id="x"), "2026-09-02T09:00:00Z") is False


def test_history_constants_are_named():
    assert HISTORY_CAP == 200
    assert HISTORY_PREV_MAX_CHARS == 500


def test_chapters_are_seconds_and_survive_a_transcript_word_deletion(tmp_path):
    """§9.2: a word deleted *before* a chapter must not move the chapter."""
    store = LibraryStore(tmp_path / "library")
    rec = store.create(str(_media(tmp_path)))
    store.put_project(rec.id, _project(["one", "two", "three", "four"]))

    patched = store.patch(
        rec.id,
        RecordPatch(chapters=[Chapter(start_s=CHAPTER_START_S, title="Deep dive")]),
        rev=store.get(rec.id).rev,
        by="agent",
    )
    before = patched.model_dump()["chapters"]

    # The transcript loses its first word — the chapter is not re-anchored.
    store.put_project(rec.id, _project(["two", "three", "four"]))
    after = store.get(rec.id).model_dump()["chapters"]

    assert after == before
    assert after[0]["start_s"] == CHAPTER_START_S
    store.close()


def test_record_json_on_disk_round_trips_through_the_model(tmp_path):
    store = LibraryStore(tmp_path / "library")
    rec = store.create(str(_media(tmp_path)))
    raw = fs.read_json(paths.record_dir(rec.id, root=tmp_path / "library") / paths.RECORD_FILE)
    assert VideoRecord.model_validate(raw).id == rec.id
    top_level_projected = {name for name in PROJECTED_FIELDS if "." not in name}
    assert set(raw) == set(VideoRecord.model_fields) - top_level_projected
    assert raw["schema"] == 2
    store.close()


def test_no_projected_field_is_ever_at_the_root_of_a_persisted_record(tmp_path):
    """Every projected field written through the root lands in ``posts`` on disk."""
    store = LibraryStore(tmp_path / "library")
    rec = store.create(str(_media(tmp_path)))
    store.patch(rec.id, RecordPatch.model_validate({
        "description": "written", "short_description": "short", "tags": ["a"],
        "hashtags": ["b"], "localized": {"pl": {"title": "Tytuł"}},
        "publish": {"youtube": {"url": "https://youtu.be/abc", "videoId": "abc"}},
    }), rev=rec.rev, by="agent")

    raw = fs.read_json(paths.record_dir(rec.id, root=tmp_path / "library") / paths.RECORD_FILE)

    for name in PROJECTED_FIELDS:
        head, _, tail = name.partition(".")
        if tail:
            assert tail not in raw[head], name
        else:
            assert head not in raw, name
    (post,) = raw["posts"].values()
    assert post["description"] == "written" and post["published"]["id"] == "abc"
    store.close()
