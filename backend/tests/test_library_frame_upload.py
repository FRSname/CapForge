"""Uploading an image as a thumbnail frame (and the cover), module and routes.

Every image is generated in memory with Pillow. Poster grabs are disabled like
``test_library_frames_routes.py`` does; no ffmpeg is involved at all — an
upload is decoded by Pillow, so it works for a record whose media is missing.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from backend.library import frame_upload, frames, posters
from backend.library import router as library_router
from backend.library.errors import FramesRefused, RecordNotFound, ScratchReadOnly
from backend.library.paths import record_dir
from backend.library.store import LibraryStore
from backend.tests.test_library_store_lock import clip

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    LOCAL_HEADER,
    LOCAL_TOKEN,
    agent,
    client,
    create,
    home,
    main_module,
    media,
)

#: EXIF tag 0x0112; 6 means "rotate 90° clockwise to display".
EXIF_ORIENTATION = 0x0112
ROTATE_CW = 6


def encoded(image: Image.Image, fmt: str, **save: object) -> bytes:
    buf = io.BytesIO()
    image.save(buf, fmt, **save)
    return buf.getvalue()


def solid(size: tuple[int, int], mode: str = "RGB", color: object = (200, 40, 40)) -> Image.Image:
    return Image.new(mode, size, color)


def decoded(path: Path) -> Image.Image:
    """The stored frame, asserted to be a JPEG."""
    with Image.open(path) as image:
        assert image.format == "JPEG"
        image.load()
        return image.copy()


@pytest.fixture
def store(tmp_path: Path):
    s = LibraryStore(tmp_path / "library")
    yield s
    s.close()


@pytest.fixture
def record(store, tmp_path):
    return store.create(clip(tmp_path / "media", "talk.mp4"))


def thumbs(store: LibraryStore, video_id: str) -> Path:
    return record_dir(video_id, root=store.root) / frames.THUMBNAILS_DIR


def upload(store: LibraryStore, video_id: str, data: bytes):
    return frame_upload.upload_frame(store, video_id, data, by="user")


def stored_frame(store: LibraryStore, record) -> Path:
    return thumbs(store, record.id) / record.thumbnail.cover


# --- the image --------------------------------------------------------------------

def test_a_png_with_alpha_becomes_an_rgb_jpeg_candidate_and_the_cover(store, record) -> None:
    png = encoded(solid((64, 48), "RGBA", (0, 0, 255, 0)), "PNG")

    updated = upload(store, record.id, png)

    assert updated.thumbnail.candidates == [updated.thumbnail.cover]
    assert frames.FRAME_NAME_RE.match(updated.thumbnail.cover)
    image = decoded(stored_frame(store, updated))
    assert image.mode == "RGB"
    assert image.size == (64, 48)
    # Fully transparent pixels flatten onto the background, not onto black.
    assert image.getpixel((32, 24)) == pytest.approx(frame_upload.FLATTEN_BACKGROUND, abs=2)


def test_a_large_image_fits_the_frame_box(store, record) -> None:
    updated = upload(store, record.id, encoded(solid((4000, 3000)), "JPEG"))

    assert decoded(stored_frame(store, updated)).size == (frames.FRAME_MAX_WIDTH, 960)


def test_a_small_image_is_not_upscaled(store, record) -> None:
    updated = upload(store, record.id, encoded(solid((320, 180)), "WEBP"))

    assert decoded(stored_frame(store, updated)).size == (320, 180)


def test_an_exif_rotated_jpeg_is_transposed(store, record) -> None:
    exif = Image.Exif()
    exif[EXIF_ORIENTATION] = ROTATE_CW
    jpeg = encoded(solid((400, 100)), "JPEG", exif=exif)

    updated = upload(store, record.id, jpeg)

    assert decoded(stored_frame(store, updated)).size == (100, 400)


@pytest.mark.parametrize("data,reason", [
    (encoded(solid((10, 10)), "GIF"), "GIF"),
    (b"definitely not an image", "image"),
    (b"", "empty"),
])
def test_unusable_data_is_refused_and_writes_nothing(store, record, data, reason) -> None:
    with pytest.raises(FramesRefused, match=reason):
        upload(store, record.id, data)

    assert store.get(record.id).rev == record.rev
    assert not thumbs(store, record.id).exists() or list(thumbs(store, record.id).iterdir()) == []


def test_a_truncated_image_is_refused(store, record) -> None:
    png = encoded(solid((200, 200)), "PNG")
    with pytest.raises(FramesRefused):
        upload(store, record.id, png[: len(png) // 2])


@pytest.mark.parametrize("pixels_over", [1.5, 3])
def test_a_decompression_bomb_is_refused(store, record, monkeypatch, pixels_over) -> None:
    # Pillow warns past MAX_IMAGE_PIXELS and raises past twice it; both refuse.
    side = 100
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", int(side * side / pixels_over))

    with pytest.raises(FramesRefused, match="pixels"):
        upload(store, record.id, encoded(solid((side, side)), "PNG"))


def test_the_input_cap_is_checked_before_decoding() -> None:
    with pytest.raises(FramesRefused, match=str(frame_upload.UPLOAD_MAX_BYTES)):
        frame_upload.check_upload_size(frame_upload.UPLOAD_MAX_BYTES + 1)
    frame_upload.check_upload_size(frame_upload.UPLOAD_MAX_BYTES)


def test_an_image_over_the_limit_at_every_quality_is_refused(store, record, monkeypatch) -> None:
    monkeypatch.setattr(frames, "THUMBNAIL_MAX_BYTES", 10)

    with pytest.raises(FramesRefused, match="bytes"):
        upload(store, record.id, encoded(solid((64, 64)), "PNG"))
    assert store.get(record.id).thumbnail.candidates == []


def test_an_image_over_the_limit_is_re_encoded_at_the_next_quality(store, record, monkeypatch) -> None:
    noise = Image.effect_noise((256, 256), 64).convert("RGB")
    first, second = frame_upload.UPLOAD_JPEG_QUALITIES[:2]
    at_first = len(frame_upload.encode_jpeg(noise, first))
    at_second = len(frame_upload.encode_jpeg(noise, second))
    assert at_second < at_first
    monkeypatch.setattr(frames, "THUMBNAIL_MAX_BYTES", at_first - 1)

    updated = upload(store, record.id, encoded(noise, "PNG"))

    assert stored_frame(store, updated).stat().st_size == at_second


def test_no_staging_file_is_left_behind(store, record) -> None:
    updated = upload(store, record.id, encoded(solid((64, 64)), "PNG"))

    assert [p.name for p in thumbs(store, record.id).iterdir()] == [updated.thumbnail.cover]


# --- the record -----------------------------------------------------------------

def test_an_upload_appends_after_the_frames_already_there(store, record) -> None:
    grabbed = f"{1:032x}.jpg"
    store.add_thumbnail_candidates(record.id, [grabbed], by="agent")

    updated = upload(store, record.id, encoded(solid((64, 64)), "PNG"))

    assert updated.thumbnail.candidates == [grabbed, updated.thumbnail.cover]
    assert updated.rev == record.rev + 2
    assert updated.history[-1].field == "thumbnail"
    assert updated.history[-1].by == "user"


def test_a_record_whose_media_is_missing_still_takes_an_upload(store, record) -> None:
    Path(record.sourcePath).unlink()

    updated = upload(store, record.id, encoded(solid((64, 64)), "PNG"))

    assert updated.thumbnail.cover is not None


def test_an_unknown_record_is_not_found(store) -> None:
    with pytest.raises(RecordNotFound):
        upload(store, "f" * 32, encoded(solid((8, 8)), "PNG"))


def test_a_scratch_record_is_read_only(store, tmp_path) -> None:
    scratch = store.create(clip(tmp_path / "media", "scratch.mp4"), scratch=True)
    with pytest.raises(ScratchReadOnly):
        upload(store, scratch.id, encoded(solid((8, 8)), "PNG"))


def test_a_full_record_is_refused_before_decoding(store, record, monkeypatch) -> None:
    full = [f"{i:032x}.jpg" for i in range(frames.MAX_CANDIDATES)]
    store.add_thumbnail_candidates(record.id, full, by="agent")
    monkeypatch.setattr(frame_upload, "normalise_image", lambda data: pytest.fail("decoded"))

    with pytest.raises(FramesRefused, match=str(frames.MAX_CANDIDATES)):
        upload(store, record.id, b"never decoded")


def test_a_failed_append_removes_the_written_file(store, record, monkeypatch) -> None:
    def refuse(*args, **kwargs):
        raise FramesRefused("another upload filled the record")

    monkeypatch.setattr(store, "add_thumbnail_candidates", refuse)

    with pytest.raises(FramesRefused):
        upload(store, record.id, encoded(solid((64, 64)), "PNG"))
    assert list(thumbs(store, record.id).iterdir()) == []


# --- POST /{id}/frames/upload -------------------------------------------------------

@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


@pytest.fixture
def announced(main_module, monkeypatch) -> list[dict]:
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(main_module, "broadcast_event", capture)
    return sent


PNG_TYPE = {"Content-Type": "image/png"}


def post_upload(client, video_id: str, data: bytes, headers: dict):
    return client.post(
        f"/api/library/{video_id}/frames/upload", content=data, headers={**PNG_TYPE, **headers}
    )


def png_bytes() -> bytes:
    return encoded(solid((64, 36)), "PNG")


@pytest.mark.parametrize("headers", [agent(), {LOCAL_HEADER: LOCAL_TOKEN}])
def test_uploading_sets_the_candidates_and_the_cover_and_announces(
    client, media, announced, headers
) -> None:
    rec = create(client, media)

    r = post_upload(client, rec["id"], png_bytes(), headers)

    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"frame", "rev"}
    name = body["frame"]["name"]
    assert frames.FRAME_NAME_RE.match(name)
    assert body["rev"] == rec["rev"] + 1
    stored = client.get(f"/api/library/{rec['id']}", headers=agent()).json()
    assert stored["thumbnail"]["candidates"] == [name]
    assert stored["thumbnail"]["cover"] == name
    asset = client.get(f"/api/library/{rec['id']}/asset/thumbnails/{name}", headers=agent())
    assert asset.status_code == 200
    by = "agent" if headers == agent() else "user"
    assert announced == [
        {"type": "record_updated", "video_id": rec["id"], "rev": body["rev"], "by": by}
    ]


def test_uploading_needs_a_token(client, media) -> None:
    rec = create(client, media)
    assert post_upload(client, rec["id"], png_bytes(), {}).status_code == 401


@pytest.mark.parametrize("video_id", ["f" * 32, "not-a-record"])
def test_uploading_to_an_unknown_record_is_404(client, video_id) -> None:
    assert post_upload(client, video_id, png_bytes(), agent()).status_code == 404


def test_uploading_to_a_scratch_record_is_409(client, media) -> None:
    rec = create(client, media, scratch=True)
    assert post_upload(client, rec["id"], png_bytes(), agent()).status_code == 409


def test_uploading_to_a_full_record_is_422_in_a_sentence(client, media, announced) -> None:
    rec = create(client, media)
    library_router.get_store().add_thumbnail_candidates(
        rec["id"], [f"{i:032x}.jpg" for i in range(frames.MAX_CANDIDATES)], by="user"
    )

    r = post_upload(client, rec["id"], png_bytes(), agent())

    assert r.status_code == 422
    assert str(frames.MAX_CANDIDATES) in r.json()["detail"]
    assert announced == []


def test_an_oversize_body_is_422_before_decoding(client, media, monkeypatch) -> None:
    rec = create(client, media)
    monkeypatch.setattr(frame_upload, "UPLOAD_MAX_BYTES", 1024)
    monkeypatch.setattr(frame_upload, "normalise_image", lambda data: pytest.fail("decoded"))

    r = post_upload(client, rec["id"], b"\0" * 2048, agent())

    assert r.status_code == 422
    assert "1024" in r.json()["detail"]


def test_a_chunked_body_with_no_length_is_refused_once_past_the_cap(
    client, media, monkeypatch
) -> None:
    rec = create(client, media)
    monkeypatch.setattr(frame_upload, "UPLOAD_MAX_BYTES", 1024)
    monkeypatch.setattr(frame_upload, "normalise_image", lambda data: pytest.fail("decoded"))

    def chunks():
        for _ in range(64):
            yield b"\0" * 512

    r = client.post(
        f"/api/library/{rec['id']}/frames/upload",
        content=chunks(),
        headers={**PNG_TYPE, **agent()},
    )

    assert r.status_code == 422
    assert "1024" in r.json()["detail"]


def test_a_non_image_body_is_422(client, media) -> None:
    rec = create(client, media)

    r = post_upload(client, rec["id"], b"<html>nope</html>", agent())

    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)
