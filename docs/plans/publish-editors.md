# v3.0 4s (parts 2–4): Publish editors, frames, per-language packages, formatters, Transcript tab

**Status:** planned 2026-09-15.
- **Part A** is detailed below and is being built on `feat/v3-shorts-thumbnails`.
- **Parts B and C** are outlined only; each gets its own detailed section and PR when started.

Plan row: creator-hub-vision §7 **4s** (the rest after collections), §2.4 (the `shorts` / `thumbnail` / `localized` dossier fields, which already exist and are authored since #1), §3.1 (`grab_frames`, `get_upload_package(…, lang?)`, `validate_video(…, lang?)`), §4 (Publish workspace: Shorts caption + clip suggestions "timestamps only", thumbnail strip, "Copy for platform ▾", Transcript tab), §6 (platform matrix).

The plan's 4s cut order is: collections (done), then **these editors, `grab_frames`, the strip and per-language packages**, then the formatters, then the Transcript tab. Parts A, B and C follow it.

## Part A — Shorts editor, Thumbnail editor, `grab_frames`, thumbnail strip

### Why
The agent already writes `shorts` (caption + clip suggestions) and `thumbnail.ideas` through `set_video_meta`, and the package prints them. But nobody can see or edit them in the app, and nothing produces a thumbnail image. The vision is explicit that v3.0 ships **frame grabs + text briefs, not typography boards** (§4 "Deferred"). Burning the caption style into a thumbnail is a parity trap, so it stays out.

### Decisions
1. **`POST /api/library/{id}/frames` is the only writer that adds candidates**, and `DELETE /api/library/{id}/frames/{name}` the only one that removes them.
   - Both run under the store's `write_lock`, re-read the record, bump `rev`, stamp `history` (`field: "thumbnail"`), and await `on_record_changed`, so the Publish soft lock and any stale `If-Match` writer see the change.
   - A `PATCH` may still set `thumbnail.cover` and `thumbnail.ideas`. A `PATCH` whose `thumbnail.candidates` differs from the stored list is **refused** with `422 {violations: [{field: "thumbnail.candidates", rule: "candidates_managed"}]}`. Candidates are files; only the routes that create and delete the files may change the list. So an agent or a stale renderer draft can never drop a frame by writing an old list.
   - The renderer and MCP therefore always send the current candidates back unchanged. The renderer composes them from the latest record at send time, never from the draft.
2. **Frames are app-generated sidecars** in the record folder (`thumbnails/<32-hex>.jpg`, already on the asset allowlist), never user media. Deleting one is allowed; the "backend never deletes user files" rule is about media and record folders.
3. **Frame format:** ffmpeg (the poster grab generalised to `grab_frame(source, dest, at_s, *, ffmpeg, max_width, quality)`; posters keep 640/q4).
   - Frames are `FRAME_MAX_WIDTH = 1280`, never upscaled, at `FRAME_JPEG_QUALITY = 3`.
   - The aspect ratio is the video's: a 9:16 source yields a vertical frame.
   - A frame over YouTube's `THUMBNAIL_MAX_BYTES = 2 MB` is re-encoded once at a lower quality, then reported as a `failed` frame if still over.
   - At most `FRAMES_PER_REQUEST = 8` times per call and `MAX_CANDIDATES = 24` per record. Beyond that, 422 with a sentence.
   - Times must be finite and ≥ 0, and ≤ `duration` when it is known (now probed at import).
   - ffmpeg runs in the threadpool, sequentially, **outside** `write_lock`; only the candidate append is locked.
4. **Validation.** Hard rules block a `PATCH`; style rules are advisory.

   | Rule | Severity | What it checks |
   |---|---|---|
   | `thumbnail.cover` | hard | `null` or one of `candidates` |
   | `shorts.clip_suggestions[i]` | hard | `0 ≤ start_s < end_s`, and `end_s ≤ duration` when known |
   | `shorts_clip_length` | style | a clip longer than `SHORTS_MAX_S = 60` (the guide's rule; YouTube itself allows longer, hence style) |
   | `thumbnail_recommended` | style | exactly one idea `recommended: true` when there are ideas |
   | `candidates_managed` | hard | as in decision 1 |

5. **The package** prints a `Cover file: <absolute path>` line in THUMBNAIL IDEAS when `cover` is set. With no cover the output is byte-identical to today, and the existing package tests prove it.
6. **Saving a frame out:** Electron `library:save-frame(videoId, name)` resolves the path itself: `<libraryRoot>/<id>/thumbnails/<name>`, with `id` matching `^[0-9a-f]{32}$`, `name` matching `^[0-9a-f]{32}\.jpg$`, realpath strictly under the library root (reuse the `library-fs.js` guard). It opens a save dialog (default name `<video title>-thumbnail.jpg`) and copies the file. The renderer never passes a path.
7. **MCP:** `grab_frames(video_id, times)` goes in the publish tool group (56 → **57**). It returns the frame names, the failures and the new `rev`. Its docstring says to pick times from `find_video_moments`, then set `thumbnail.cover` with `set_video_meta`, sending `candidates` back unchanged. The `thumbnails` guide topic and the `shorts` topic are updated.

### Backend
- `backend/library/frames.py` (new): `grab_frames(store, video_id, times, *, by, find_ffmpeg=None) -> FramesResult` (frozen dataclass: `frames: tuple[(time_s, name)]`, `failed: tuple[(time_s, reason)]`, `record`) and `delete_frame(store, video_id, name, *, by)`. The ffmpeg grab is shared with `posters.py` (move the grab into a small `frame_grab.py`, so neither module grows past its ceiling).
- Store methods (`@writes`, in a mixin, not `store.py` at 466 lines): `add_thumbnail_candidates(id, names, *, by)` and `remove_thumbnail_candidate(id, name, *, by)`. Removing a name also clears `cover` if it was the cover.
- Routes in a new `router_frames.py`, registered by `build_router`, behind the router's actor guard:
  - `POST /{id}/frames {times: [float]}` → `200 {frames: [{time_s, name}], failed: [{time_s, reason}], rev}`; 404, 422.
  - `DELETE /{id}/frames/{name}` → `200 {rev}`; 404 (unknown record or name).
- The `candidates_managed` check lives in the `PATCH` path under the lock. The hard and style rules go in `validate.py`, and `validate.py` stays under 400 lines; split a `validate_media.py` if needed.
- Tests first: the grab (argv via fake `_run`, width/quality/no-upscale, oversize re-encode, failure leaves nothing), limits, time validation, the append and remove locking (forced interleaving against a `PATCH`), `candidates_managed`, the four rules, cover-clearing on remove, the package cover line and byte-identity, the routes' status codes, plus **one real-ffmpeg test** in `test_library_posters_ffmpeg.py` (a 1920×1080 source → a 1280-wide frame; a 1080×1920 source → a 720-wide vertical frame).

### Electron
- `library:save-frame` in `electron/library-dialogs.js` (injected `dialog`, `copyFile`, the guard), with a node test. `saveLibraryFrame(videoId, name)` goes in **both** preloads.

### Renderer
- `lib/publishTypes.ts`: `Shorts`, `ClipSuggestion`, `Thumbnail`, `ThumbnailIdea` + guards; `PublishAuthored` gains `shorts` and `thumbnail`.
- `lib/publishFields.ts`: cards `'shorts'` and `'thumbnail'`.
- `lib/publishClips.ts` (pure):
  - add a clip at the playhead (start snapped with `snapToWordStart`; end = start + `DEFAULT_CLIP_S = 30`, clamped to the duration)
  - set start or end from the playhead (keeping start < end)
  - sort by start
  - a length readout
- `lib/publishThumbnail.ts` (pure):
  - set cover
  - toggle recommended (exactly one)
  - add or remove an idea
  - **`composeThumbnailPatch(draft, latestRecord)`**, which always takes `candidates` from the latest record
- `ShortsCard.tsx`: the caption textarea; clip rows with start/end (click → `seek`, "⇤ playhead" / "playhead ⇥"), the length, `why`, remove; "Add clip at playhead"; `FieldViolations` for `shorts.*`.
- `ThumbnailCard.tsx`:
  - idea rows: label, type select (`face | text | diagram | screen | object`), headline, subtext, visual suggestion, recommended radio
  - the **strip**: candidates as images loaded through a generalised `hooks/useLibraryAssetUrl.ts` (fetch + `blob:`, as `usePosterUrl` does, which then uses it). Click sets the cover (ring); × deletes via `DELETE` with an inline confirm.
  - "Grab frame at playhead": **flush the pending `thumbnail` draft first**, then `POST frames`, then adopt the returned `rev` through the existing `record_updated` path
  - "Save cover…" (Electron)
  - the empty state explains frames
- Cards go in `PublishPanel` after Chapters. Every file stays ≤ 400 lines; `usePublishRecord.ts` (396) must not grow past its ceiling, so the thumbnail send composition goes in the writer or a helper.
- Tests (node env, static markup): the guards, the pure helpers (especially `composeThumbnailPatch` against a record whose candidates changed), and the card markup (empty, populated, cover ring, violations).

### Verification
- The backend library tests plus the full suite (the 15 known golden-frame failures), the MCP tests, `npm run typecheck`/`test`/`lint`, and the Electron node tests.
- **Live** on a temp `CAPFORGE_HOME` with real ffmpeg:
  - grab 3 frames from a 16:9 clip and 2 from a 9:16 clip; check the dimensions and ≤ 2 MB
  - `PATCH` cover → package cover line
  - a stale `PATCH` with an old candidates list → 422 `candidates_managed`
  - `DELETE` the cover frame → cover cleared, file gone
  - a clip with `end_s > duration` → 422
  - over the frame limits → 422

### As built (Part A)
- **Modules:**
  - Backend: `frame_grab.py` (the grab shared with posters), `frames.py`, `store_frames.py` (store mixin), `router_frames.py`, `validate_media.py`, and `violation.py` (`Violation` moved out of `validate.py`, which re-exports it).
  - Renderer: `lib/publishMediaTypes.ts`, `lib/publishThumbnail.ts`, `lib/publishClips.ts`, `lib/publishViolations.ts`, `lib/framesApi.ts`, `hooks/useThumbnailFrames.ts`, `hooks/useLibraryAssetUrl.ts` (`usePosterUrl` is now built on it), and `ShortsCard` / `ThumbnailCard` / `ThumbnailIdeas`.
- **Frames fit a 1280 *box*** (`FRAME_MAX_HEIGHT = FRAME_MAX_WIDTH`), so a 1080×1920 source yields 720×1280.
- **Scratch and failure cases:** scratch records answer 409 on the frames routes. Missing media or no ffmpeg answers 200 with every time under `failed` and `rev` unchanged. `clip_order` also covers `start_s < 0`.
- **`candidates_managed` is checked twice:** before the rev check (so a stale rev carrying an old list is a 422, not a 409) and again under the lock.
- **An omitted key means unchanged:** a `thumbnail` patch object that leaves out `candidates` or `cover` inherits the stored value, and `cover_not_a_candidate` is judged against the merged object. Only an explicit, different candidates list is refused. So an agent's ideas-only `set_video_meta` works on a record with frames.
- **The renderer composes at send time** (`withManagedCandidates` in `usePublishWriter`, for both the debounced flush and `patchNow`/Revert). A draft cover that is no longer a candidate is sent as `null`, so one stale cover can't 422 the other drafts in the same patch. `mergeDrafts`, `mergeAgentUpdate` and `survivingDrafts` all take candidates from the record. Grab and delete first await `flushDrafts()`.
- **Finding routing:** `violationsForField` also matches dotted sub-fields (`thumbnail.cover`), and `partitionViolations` puts each finding under exactly one control.
- **Removed:** `api.ts` lost the unused `getLibraryPoster` (1016 → 1002 lines).

**Verification (Part A):**
- **Backend:** 1952 passed (only the 15 known golden-frame failures). The real-ffmpeg frame-dimension tests run on the caption-parity CI line.
- **MCP:** 257 passed.
- **Renderer:** vitest 2035, typecheck clean, lint 0 errors. Electron: 44/44, preload parity 3/3.
- **Live, temp `CAPFORGE_HOME`:**
  - 16:9 frames came out 1280×720 (~30 KB); 9:16 frames 720×1280.
  - The cover line prints in the package.
  - An old candidates list → 422 `candidates_managed`.
  - Deleting the cover frame → cover cleared and the file gone.
  - `clip_past_end` → 422.
  - 9 times or a 25th frame → 422 with a sentence.
  - A 90 s clip → `shorts_clip_length` style finding.

## Part B — Localized editor + per-language packages (outline)

- **Languages:** read from the stored `project.capforge` `tracks[].lang` (the record autosave already PUTs it), plus the source `language`. Exposed as a derived `languages: []` on the record view.
- **Routes:** `GET /{id}/package?lang=xx` and `POST /validate` with `lang` substitute `localized[lang]`: title, description, short_description, tags, hashtags, `chapter_titles` by index, and `shorts_caption`. A root field fills in wherever a localized one is empty. Validators run over the substituted fields, including 5000 bytes per language.
- **MCP:** `lang?` on `get_upload_package` and `validate_video`.
- **Renderer:** a Localized card (a language picker of the track languages, the fields per language, chapter titles aligned to the root chapters), plus a per-language "Copy upload package" in the footer.

## Part C — Copy for platform + Transcript tab (outline)

- **Formatters:** backend `platform=linkedin|x|instagram` renderers over the same record plus effective brief, clipboard text only (§6): LinkedIn ≤ 3000 chars, 3–5 hashtags, the link on its own line; X ≤ 280 with URLs counted as 23; Instagram ≤ 2200, ≤ 30 hashtags, "link in bio". Each has its own violations. The footer gets a "Copy for platform ▾" menu, and MCP `get_upload_package(platform=…)` accepts the new values.
- **Transcript tab:** a read-mostly third tab beside Text/Groups, extracted as its own component (`ResultsScreen.tsx` is 763 lines). Segments with timestamps, a chapter gutter placing each chapter at its segment (seconds → the first segment that starts at or after it), click to seek, and "insert chapter here".
