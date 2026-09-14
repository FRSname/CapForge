# v3.0 #6 — Posters at import

**Status:** implemented 2026-09-14 on `feat/v3-posters`. Plan row: creator-hub-vision §7 #6 ("core — every card has a poster"); layout §2.2 (`poster.jpg` in the record folder), CSP rule §1/§9.4.

## Why

The library cards shipped in #3 with a gradient placeholder where the picture belongs. A card without a frame reads as a row; the Continue hero in particular is 260 px of nothing. The record folder already has the slot (`poster.jpg` is on the asset allowlist and served by the fixed-name route since #1) — what was missing is the grab and the fetch.

## What

- **`backend/library/posters.py`** — one ffmpeg call per record: a frame a tenth of the way in (clamped to 0.5–30 s; 1 s when the duration is not known yet), scaled to 640 wide, `-q:v 4`, written to a dot-prefixed temp file in the record folder (never a servable name) and `os.replace`d into `poster.jpg`. `ensure_poster` is idempotent, retries at 0 s when the first frame fails (a clip shorter than the minimum, a stream that decodes from its first keyframe only), and never raises: no media, no ffmpeg, an audio-only source all mean "placeholder", not "failed import". ffmpeg is found through `video_render._find_ffmpeg` lazily (the library package stays import-light) and the finder is injectable, so the tests replace the subprocess call and never run a binary.
- **Where it runs** — `POST /api/library` and `POST /api/library/import-project` schedule `ensure_poster_for` as a FastAPI `BackgroundTasks` step when the record has no poster (after the response, in the threadpool); startup runs `backfill_posters` in one bounded daemon thread (200 records, skipping missing media) so libraries from before #6, and records whose grab failed, catch up without anyone asking. `migrate-studio` records are covered by the backfill on the next launch.
- **The flag** — `poster: bool` on the list summary and the record view, derived at read time from the file like `status` and `hasProject`; nothing is stored on the record. `test_library_record_contract.py`'s partition is untouched because it is not a record field.
- **Renderer** — `LibraryVideo.poster` (boundary guard defaults it to `false`), `api.getLibraryPoster(id)` fetches `asset/poster.jpg` with the local token and returns a `Blob` (or `null` on 404), `hooks/usePosterUrl.ts` turns it into a `blob:` object URL (the CSP is `img-src 'self' data: blob:`, so `127.0.0.1` can never be an `<img src>`), revoked on unmount. `Poster` takes `posterUrl` and draws the `<img>` under the duration badge and the missing-media chip; `LibraryPoster` binds the hook and is what the card and the Continue hero mount. A failed fetch logs and keeps the placeholder.

## Verification

- `backend/tests/test_library_posters.py`: `poster_time` clamps; the grab's argv, atomicity (no temp file survives, the temp name is not an asset name) and failure path (nothing left behind, a missing binary is survived); `ensure_poster` retries at 0 s, is idempotent, never raises; the store's `poster` flag and the backfill (count, limit, missing media skipped); the create route grabs in the background and a fingerprint hit does not grab again; the asset route serves the result.
- `LibraryCard.test.tsx` renders `Poster` with and without a URL (static markup; the hook cannot run in the node environment).
- Real ffmpeg: `ensure_poster` against the "capforge reel" record's media produced a 640×1138 JPEG (44 KB) at 2.9 s, no leftovers, and the frame is the speaker, not a title card.

## Deliberately not here

- Replacing the poster from the player (vision §2.2 "replaceable from the player") and the thumbnail strip / `grab_frames` are 4s.
- No poster for audio-only media: the grab fails cleanly and the placeholder stays.
- `peaks.bin` is 6s.
