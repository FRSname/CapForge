"""The root ↔ primary post projection (docs/plans/multi-channel-pr2-contract.md).

``project`` fills the root from a post, ``unproject`` moves the root back into
the primary post and strips it for storage; ``with_post`` re-projects so a
direct post write is never overwritten by a stale root.
"""

from __future__ import annotations

from backend.library.record_projection import (
    PROJECTED_FIELDS,
    bridge_title,
    loaded_record,
    project,
    record_for_channel,
    stored_dict,
    unproject,
    with_post,
)
from backend.library.schemas import (
    LocalizedFields,
    Post,
    PostPublished,
    Publish,
    Thumbnail,
    VideoRecord,
    YouTubePublish,
)
from backend.tests.library_v1_fixtures import COVER, OTHER_FRAME, fixture

PRIMARY = "main"
SECOND = "second"
VIDEO_ID = "b" * 32


def record_with_posts(**posts: Post) -> VideoRecord:
    base = VideoRecord(id=VIDEO_ID, title="Library name",
                       thumbnail=Thumbnail(candidates=[COVER, OTHER_FRAME]))
    return base.model_copy(update={"posts": posts})


def test_the_pinned_projection_table():
    assert PROJECTED_FIELDS == frozenset({
        "description", "short_description", "tags", "hashtags", "localized",
        "thumbnail.cover", "publish.youtube",
    })


def test_project_fills_the_root_from_the_named_post():
    post = Post(description="d", short_description="s", tags=["t"], hashtags=["h"],
                cover=COVER, localized={"de": LocalizedFields(title="T")},
                published=PostPublished(url="https://youtu.be/v1", id="v1", at="2026-01-01T00:00:00Z"))
    record = record_with_posts(main=post)

    view = project(record, PRIMARY)

    assert (view.description, view.short_description, view.tags, view.hashtags) == ("d", "s", ["t"], ["h"])
    assert view.thumbnail.cover == COVER and view.thumbnail.candidates == [COVER, OTHER_FRAME]
    assert view.localized["de"].title == "T"
    assert view.publish.youtube == YouTubePublish(videoId="v1", url="https://youtu.be/v1",
                                                  publishedAt="2026-01-01T00:00:00Z")
    assert view.title == "Library name", "project never touches the root title"


def test_project_without_the_post_gives_defaults():
    record = record_with_posts().model_copy(update={"description": "stale", "tags": ["x"]})

    view = project(record, PRIMARY)

    assert view.description == "" and view.tags == [] and view.thumbnail.cover is None
    assert view.publish.youtube == YouTubePublish()


def test_unproject_moves_the_root_into_the_primary_post_and_strips_it():
    record = VideoRecord(id=VIDEO_ID, description="written", hashtags=["a"],
                         publish=Publish(youtube=YouTubePublish(url="https://youtu.be/q")))

    stored = unproject(record, PRIMARY)

    assert stored.description == "" and stored.hashtags == []
    assert stored.publish.youtube == YouTubePublish()
    assert stored.posts[PRIMARY].description == "written"
    assert stored.posts[PRIMARY].published.url == "https://youtu.be/q"


def test_unproject_creates_no_post_when_every_projected_value_is_default():
    assert unproject(VideoRecord(id=VIDEO_ID, title="named"), PRIMARY).posts == {}


def test_unproject_keeps_an_existing_post_even_when_the_root_is_default():
    record = project(record_with_posts(main=Post(caption="")), PRIMARY)

    assert PRIMARY in unproject(record, PRIMARY).posts


def test_unproject_keeps_the_post_fields_the_root_does_not_carry():
    record = project(record_with_posts(main=Post(title="Post title", language="en")), PRIMARY)

    post = unproject(record.model_copy(update={"description": "new"}), PRIMARY).posts[PRIMARY]

    assert (post.title, post.language, post.description) == ("Post title", "en", "new")


def test_a_root_write_unhides_the_hidden_primary_post():
    record = project(record_with_posts(main=Post(description="old", hidden=True)), PRIMARY)

    assert unproject(record, PRIMARY).posts[PRIMARY].hidden is True, "a read keeps it hidden"
    written = unproject(record.model_copy(update={"description": "new"}), PRIMARY)
    assert written.posts[PRIMARY].hidden is False


def test_project_then_unproject_is_the_identity_on_posts():
    record = record_with_posts(main=Post(description="a", cover=COVER), second=Post(caption="c"))

    assert unproject(project(record, PRIMARY), PRIMARY).posts == record.posts


def test_with_post_reprojects_so_a_direct_write_survives_storage():
    record = project(record_with_posts(main=Post(description="old")), PRIMARY)

    written = with_post(record, PRIMARY, Post(description="direct"), PRIMARY)

    assert written.description == "direct"
    assert unproject(written, PRIMARY).posts[PRIMARY].description == "direct"


def test_with_post_keeps_a_root_write_not_yet_stored():
    record = project(record_with_posts(main=Post(description="old")), PRIMARY)
    root_written = record.model_copy(update={"tags": ["fresh"]})

    written = with_post(root_written, SECOND, Post(caption="hi"), PRIMARY)

    assert written.tags == ["fresh"] and written.posts[PRIMARY].tags == ["fresh"]
    assert written.posts[SECOND].caption == "hi"


def test_with_post_none_removes_the_post():
    record = project(record_with_posts(main=Post(description="gone")), PRIMARY)

    removed = with_post(record, PRIMARY, None, PRIMARY)

    assert PRIMARY not in removed.posts and removed.description == ""


def test_record_for_channel_takes_the_post_title_and_falls_back_to_the_root():
    record = record_with_posts(main=Post(title="Main title"), second=Post(description="two"))

    assert record_for_channel(record, PRIMARY).title == "Main title"
    view = record_for_channel(record, SECOND)
    assert view.title == "Library name" and view.description == "two"


def test_bridge_title_sets_the_primary_post_title_and_creates_the_post():
    record = VideoRecord(id=VIDEO_ID, title="Renamed")

    bridged = bridge_title(record, PRIMARY)

    assert bridged.posts[PRIMARY].title == "Renamed" and bridged.title == "Renamed"


def test_bridge_title_with_an_empty_title_and_no_post_creates_nothing():
    assert bridge_title(VideoRecord(id=VIDEO_ID), PRIMARY).posts == {}


def test_stored_dict_has_no_projected_field_at_the_root():
    record = project(record_with_posts(main=Post(description="x", cover=COVER)), PRIMARY)

    data = stored_dict(record, PRIMARY)

    assert data["schema"] == 2
    for name in ("description", "short_description", "tags", "hashtags", "localized"):
        assert name not in data
    assert "cover" not in data["thumbnail"] and "youtube" not in data["publish"]
    assert data["posts"][PRIMARY]["description"] == "x"


def test_a_v1_file_loads_to_the_same_root_it_had():
    raw = fixture("full", VIDEO_ID, "/media/a.mp4")

    record = loaded_record(raw, PRIMARY)

    legacy = VideoRecord.model_validate(fixture("full", VIDEO_ID, "/media/a.mp4"))
    skip = {"posts", "schema"}
    assert record.model_dump(exclude=skip) == legacy.model_dump(exclude=skip)


def test_a_stored_record_loads_back_equal():
    record = loaded_record(fixture("full", VIDEO_ID, "/media/a.mp4"), PRIMARY)

    assert loaded_record(stored_dict(record, PRIMARY), PRIMARY) == record
