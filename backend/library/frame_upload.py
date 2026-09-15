"""Upload your own image as a thumbnail frame — and make it the cover.

A sibling of ``frames.py`` (kept apart for its size): a grabbed frame comes out
of the video through ffmpeg, an uploaded one out of the request body through
Pillow, and both end the same way — a ``thumbnails/<32-hex>.jpg`` file on the
asset allowlist, appended to ``thumbnail.candidates`` by ``store_frames``. An
upload also becomes the cover in that same locked write: choosing an image is
choosing the cover.

The body is external data, so it is checked in order of cost: its size before
anything is decoded, the record's room before the image is decoded, and then
Pillow may only open JPEG, PNG or WEBP. A decompression bomb is refused, never
decoded. The image is normalised to what a grabbed frame is — upright, RGB,
inside the frame box, never upscaled, under YouTube's 2 MB — so nothing
downstream (the package, the save-out, the library card) can tell the two
apart. Re-encoding also drops the upload's metadata (EXIF, GPS).

Media need not exist: a record whose file moved can still get a cover.
Decoding and the file write run **outside** the store's write lock, like a
grab; a failed append removes the file it wrote.

Pillow is imported lazily, like ``frame_grab`` finds ffmpeg, so the library
package stays import-light.
"""

from __future__ import annotations

import io
import logging
import uuid
import warnings
from pathlib import Path
from typing import Any

from backend.library import frame_grab, frames, fs
from backend.library.errors import FramesRefused
from backend.library.paths import THUMBNAILS_DIR, record_dir
from backend.library.schemas import VideoRecord

__all__ = [
    "ACCEPTED_FORMATS",
    "FLATTEN_BACKGROUND",
    "UPLOAD_JPEG_QUALITIES",
    "UPLOAD_MAX_BYTES",
    "check_upload_size",
    "encode_jpeg",
    "normalise_image",
    "upload_frame",
    "write_frame_file",
]

logger = logging.getLogger(__name__)

#: The largest body accepted, checked before a byte is decoded. A phone photo
#: or a designed thumbnail fits; the result is still held to 2 MB.
UPLOAD_MAX_BYTES = 20 * 1024 * 1024
#: Pillow format names an upload may be.
ACCEPTED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
#: What transparent pixels are flattened onto — a JPEG has no alpha.
FLATTEN_BACKGROUND = (255, 255, 255)
#: Pillow JPEG ``quality`` (1–95), tried in order until the frame fits.
UPLOAD_JPEG_QUALITIES = (92, 85, 75, 60)

EMPTY_REASON = "The upload is empty; choose an image file."
TOO_LARGE_REASON = "The image is {size} bytes; uploads are limited to {limit} bytes."
NOT_AN_IMAGE_REASON = "The upload is not a JPEG, PNG or WEBP image that can be read."
UNSUPPORTED_FORMAT_REASON = (
    "{format} images cannot be used as a thumbnail; upload a JPEG, PNG or WEBP."
)
BOMB_REASON = "The image has too many pixels to decode safely."
UNCONVERTIBLE_REASON = "The image could not be converted to a JPEG ({mode} images are not supported)."
OVERSIZE_REASON = (
    "The image is still {size} bytes as a JPEG at the lowest quality; "
    "YouTube allows {limit} bytes."
)


# --- the image --------------------------------------------------------------------

def check_upload_size(size: int) -> None:
    """Refuse a body over ``UPLOAD_MAX_BYTES`` — before it is decoded."""
    if size > UPLOAD_MAX_BYTES:
        raise FramesRefused(TOO_LARGE_REASON.format(size=size, limit=UPLOAD_MAX_BYTES))


def _decode(data: bytes) -> Any:
    """Open and fully load an accepted image, or ``FramesRefused``.

    The bomb warning is made an error, and the pixel count is checked again
    explicitly, because ``warnings.catch_warnings`` is process-global and a
    concurrent thread could reset the filter.
    """
    from PIL import Image

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(data))
            fmt = image.format
            too_many = image.width * image.height > (Image.MAX_IMAGE_PIXELS or float("inf"))
            if fmt in ACCEPTED_FORMATS and not too_many:
                image.load()
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise FramesRefused(BOMB_REASON) from exc
        except (OSError, SyntaxError, ValueError, EOFError) as exc:
            raise FramesRefused(NOT_AN_IMAGE_REASON) from exc
    if fmt not in ACCEPTED_FORMATS or too_many:
        image.close()
        reason = BOMB_REASON if fmt in ACCEPTED_FORMATS else UNSUPPORTED_FORMAT_REASON
        raise FramesRefused(reason.format(format=fmt or "These"))
    return image


def _flatten(image: Any) -> Any:
    """An RGB copy; any transparency is composited onto ``FLATTEN_BACKGROUND``."""
    from PIL import Image

    if image.mode == "P" and "transparency" in image.info:
        image = image.convert("RGBA")
    if {"A", "a"} & set(image.getbands()):
        rgba = image.convert("RGBA")
        flat = Image.new("RGB", rgba.size, FLATTEN_BACKGROUND)
        flat.paste(rgba, mask=rgba.getchannel("A"))
        return flat
    return image.convert("RGB")


def encode_jpeg(image: Any, quality: int) -> bytes:
    """``image`` as JPEG bytes at Pillow ``quality``; no metadata is carried."""
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def _fit_jpeg(image: Any) -> bytes:
    """The best quality in ``UPLOAD_JPEG_QUALITIES`` that is within the limit."""
    size = 0
    for quality in UPLOAD_JPEG_QUALITIES:
        jpeg = encode_jpeg(image, quality)
        size = len(jpeg)
        if size <= frames.THUMBNAIL_MAX_BYTES:
            return jpeg
        logger.info("Uploaded frame is %d bytes at quality %d", size, quality)
    raise FramesRefused(OVERSIZE_REASON.format(size=size, limit=frames.THUMBNAIL_MAX_BYTES))


def normalise_image(data: bytes) -> bytes:
    """The upload as a frame's JPEG bytes: upright, RGB, fitted, within 2 MB.

    ``FramesRefused`` (one sentence) for an empty or oversize body, a format
    other than JPEG/PNG/WEBP, undecodable data, a decompression bomb, or an
    image that is over the limit even at the lowest quality.
    """
    from PIL import Image, ImageOps

    check_upload_size(len(data))
    if not data:
        raise FramesRefused(EMPTY_REASON)
    with _decode(data) as image:
        try:
            fitted = _flatten(ImageOps.exif_transpose(image))
            fitted.thumbnail(
                (frames.FRAME_MAX_WIDTH, frames.FRAME_MAX_HEIGHT), Image.Resampling.LANCZOS
            )
        except (OSError, SyntaxError, ValueError) as exc:
            raise FramesRefused(UNCONVERTIBLE_REASON.format(mode=image.mode)) from exc
    return _fit_jpeg(fitted)


# --- the file and the record ------------------------------------------------------

def write_frame_file(folder: Path, jpeg: bytes) -> str:
    """Write ``jpeg`` into ``folder`` under a fresh frame name, atomically.

    The bytes wait under a ``frames.STAGING_PREFIX`` name (never servable) and
    are moved into place with the Windows-safe replace. Answers the name.
    """
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{frames.FRAME_SUFFIX}"
    staging = folder / f"{frames.STAGING_PREFIX}{name}"
    try:
        staging.write_bytes(jpeg)
        fs.replace_with_retry(staging, folder / name)
    except OSError:
        frame_grab.discard(staging)
        raise
    return name


def upload_frame(store: Any, video_id: str, data: bytes, *, by: str) -> VideoRecord:
    """Decode ``data``, store it as a new candidate, and make it the cover.

    Raises ``RecordNotFound``, ``ScratchReadOnly`` and ``FramesRefused`` (no
    room) before the image is decoded, then ``FramesRefused`` for an unusable
    image. The append re-checks the limit under the lock; if it fails, the
    written file is removed.
    """
    record = store.get(video_id)
    frames.require_editable(record)
    frames.check_room(len(record.thumbnail.candidates), 1)
    jpeg = normalise_image(data)
    folder = record_dir(record.id, scratch=record.scratch, root=store.root) / THUMBNAILS_DIR
    name = write_frame_file(folder, jpeg)
    try:
        return store.add_thumbnail_candidates(video_id, [name], by=by, cover=name)
    except Exception:
        frame_grab.discard(folder / name)  # never leave a file no record points at
        raise
