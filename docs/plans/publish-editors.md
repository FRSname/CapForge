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

## Part B — Localized editor + per-language packages

**Status:** building on `feat/v3-localized` (stacked on Part A).

### Why
`localized: {lang: LocalizedFields}` has existed since #1. Its fields are title, description, short_description, tags, hashtags, `chapter_titles` and `shorts_caption`, and a translated caption track already exists per language. But nothing edits the field, nothing validates it (an agent can store a 9000-byte Polish description today), the package ignores it, and **a `PATCH` of `localized` replaces the whole dict**. So an agent writing `pl` silently erases `de`, and so would a renderer draft taken before the agent's write.

### Decisions
1. **`localized` merges per language on `PATCH`.**
   - Languages the patch omits are inherited.
   - A language set to `null` is removed.
   - A language sent as an object replaces that language's fields.

   `RecordPatch.localized` becomes `Optional[dict[str, Optional[LocalizedFields]]]`, and the stored model stays `dict[str, LocalizedFields]`. The merge happens under `write_lock` against the fresh read, like the thumbnail inheritance. The `history` entry names `localized`. The record contract partition is unchanged (no new field).
2. **Language keys** match `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$` (the codes `create_track` and `lib/languages.ts` use: `pl`, `de`, `pt-BR`). A bad key is a hard `localized_lang_code` violation. A key equal to the record's source `language` is refused (`localized_is_source`), because the root fields already are that language.
3. **Per-language rules** reuse the root rules, under field names `localized.<lang>.<field>`:
   - **Hard:** title ≤ 100 chars, description ≤ 5000 bytes, tags line ≤ 500 chars, and no angle brackets in any of them.
   - **Style:** more `chapter_titles` than root `chapters` (`localized_chapter_count`), and the brief's style rules applied to the localized title and description.
4. **`GET /{id}/package?lang=xx`** renders the package from a *localized view of the record*: a pure `localize_record(record, lang) -> VideoRecord`.
   - **Substituted:** title, description, short_description, tags and hashtags (a non-empty localized list replaces), `chapters[i].title` from `chapter_titles[i]` (non-empty entries only, by index; extras ignored), and `shorts.caption`.
   - **Dropped:** `title_options` and `highlights` (the "WHAT YOU'LL LEARN" block), which are source-language prose with no localized counterpart. A localized package that silently mixes languages is worse than a shorter one.
   - **NOTES** gains `Not translated (source text used): …` listing every substituted field that fell back to the root, and `Omitted (source language only): title options, highlights`.
   - **Brief and collection boilerplate** (footer, recorded-at, speaker block, slots) stays as written: there is no per-language brief in v3.0, and the NOTES line says so when a footer exists.
   - **Errors:** an unknown `lang` (not a key of `localized`) is a 404 `{detail}`; `lang` equal to the source language, or omitted, is today's package. With no `lang`, the output is **byte-identical**.
   - `violations` are the localized view's findings. `description` is the localized assembled body.
5. **`POST /validate`** accepts `lang` and validates the localized view the same way, merging draft `fields.localized` per language before substituting.
6. **Derived `languages` on the single-record view** (`GET /{id}`, not the list summary, which must stay cheap):
   - The source `language` comes first.
   - Then every `tracks[].lang` in the stored `project.capforge`, read only when the file exists; a corrupt file is logged and skipped.
   - Then every `localized` key.
   - Deduplicated in that order, and never stored.
7. **MCP:** `lang` on `get_upload_package(video_id, platform, lang=None)` and `validate_video(video_id, lang=None)`. The `set_video_meta` docstring gains the per-language merge (send only the languages you change, `null` removes). There is a new guide topic `localized`: read the tracks with `get_ui_state` / `get_track` for their `lang`, translate from the source fields, write `localized[lang]` one language per call, validate with `lang`, then read the package with `lang`. The tool count is unchanged (57).
8. **Renderer:** a **Localized card**, plus a language choice on "Copy upload package". The whole-field draft must not re-send stale languages, so `composeLocalizedPatch(draft, latest)` sends **only the languages whose draft differs from the latest record**, plus `null` for languages the user removed. It is applied at send time in the writer, beside `withManagedCandidates`.

### Backend
- **`backend/library/localized.py` (new, pure):** `LANG_CODE_RE`, `localize_record`, `untranslated_fields`, and `merge_localized(stored, patch_value) -> dict` (returns a new dict, never mutates).
- **The `PATCH` path:** it applies `merge_localized` under the lock (in `locked_refusal`'s completed patch, like the thumbnail). Pre-lock hard rules judge the merged value. This lives in `router_publish.py` / `validate_media.py` or a new `validate_localized.py`, keeping every file ≤ 400 lines; `router.py` (422) must not grow.
- **Routes:**
  - The package route takes `lang: Optional[str] = None`.
  - `ValidateRequest` gains `lang: Optional[str]`.
  - `languages` on the record view goes wherever `status`/`hasProject`/`poster` are derived.
- **Tests first:**
  - the merge (inherit, remove with `null`, replace one language), non-mutation, and lock interleaving against a concurrent `PATCH` of another language
  - key and source-language refusals, and every per-language rule
  - `localize_record` substitution and fallbacks (chapter titles by index, shorter or longer lists)
  - the NOTES lines, the dropped sections, byte-identity without `lang`, and 404 for an unknown `lang`
  - validate with `lang`; `languages` derivation (no project, a project with tracks, a corrupt project, localized-only languages)
  - the MCP `lang` parameters

### Renderer
- **`lib/publishTypes.ts`:** add `LocalizedFields` + a guard (or put them in `publishMediaTypes.ts` if `publishTypes.ts` would pass 400 lines); `PublishAuthored.localized`; `languages: string[]` on the record (guard defaults to `[]`).
- **`lib/publishLocalized.ts` (pure):**
  - `editableLanguages(record)`: record `languages` + `localized` keys, minus the source language
  - `setLocalizedField` / `removeLanguage` / `addLanguage` (all immutable)
  - `alignedChapterTitles(chapters, chapterTitles)`: rows of `{start_s, sourceTitle, title}`
  - `composeLocalizedPatch(draft, latest)`
- **`LocalizedCard.tsx`:**
  - language chips: the editable languages, a chip showing a translated track without localized fields as "not started", and "Add language" from `lib/languages.ts`
  - for the selected language: title (100-char meter), description (5000-byte meter, reusing `FieldMeter`), short description, tags line, hashtags, chapter titles aligned to the root chapters (timestamp + the source title as placeholder), shorts caption
  - findings for `localized.<lang>.*` via `violationsForField`
  - "Remove language" with an inline confirm
  - The card goes after Description in `PublishPanel`. Keep `usePublishRecord.ts` (399) from growing: new logic goes in helpers or the writer.
- **`PublishFooter`:** "Copy upload package" becomes a split control with the source language first, then each localized language (`getUploadPackage(id, 'youtube', lang)`); the plain transcript and SRT/VTT are unchanged.
- **Tests (node env):** the guard, every pure helper (especially `composeLocalizedPatch` against a record where an agent added another language meanwhile), and the card markup (empty, one language, a not-started track language, findings).

### Verification
- Backend library tests + the full suite, MCP tests, renderer gates, and the Electron and preload tests (unchanged).
- **Live, on a temp `CAPFORGE_HOME`:**
  - `PATCH localized {pl: {...}}`, then `PATCH localized {de: {...}}`: both stored.
  - `{pl: null}` removes `pl`.
  - A 6000-byte `pl` description → 422 `localized.pl.description`.
  - A key equal to the source language → 422.
  - `GET package?lang=de`: localized title and chapters, source title options and highlights absent, the NOTES lines present.
  - `?lang=xx` → 404. No `lang` → byte-identical to before.
  - `languages` on a record whose stored project has a `pl` track.

### As built (Part B)
- **Modules:**
  - Backend: `localized.py` (pure merge, localized view, NOTES lines, `derive_languages`), `validate_localized.py`, and `store_localized.py` (`languages_of`: a missing project contributes nothing, a corrupt one is logged and skipped).
  - Renderer: `lib/publishLocalized.ts`, plus `LocalizedCard.tsx` and `LocalizedLanguageForm.tsx`.
- **Findings with `lang`:** the package and `/validate` name a translated field's finding `localized.<lang>.<field>`; a field that fell back keeps its root name, because the fix belongs there. Without `lang`, `/validate` and the package also report every language's `localized.*` findings.
- **Extra refusals and notes:** `/validate` with `lang` needs a `video_id` (422). "footer" joins the *Not translated* NOTES line when the effective brief has one, and the *Omitted* line always prints in a localized package.
- **`languages` placement:** it rides every single-record response (GET, PATCH, the 409 `current`, create, promote), never the list summary.
- **Stored bad translations block saves:** because a PATCH is judged on the *merged* record, a translation stored before this change that breaks a hard limit blocks every PATCH until it is fixed. The root fields already behave this way.
- **The renderer draft is a delta** of changed languages, with `null` for removed ones. `localizedDraft(record.localized, onScreen)` diffs at edit time; `withLocalizedDraft` recomposes against the latest record at send time; `withLocalizedRestore` turns a Revert's whole-dict `prev` into a delta. `survivingDrafts` judges `localized` per language, so an agent rewriting or removing the drafted language drops only that language from the draft.
- **Known gap:** validation still sends the merged `localized`, so a language removed but not yet saved can show findings until the save lands.

**Verification (Part B):**
- **Backend:** 2037 passed (only the 15 known golden-frame failures). MCP: 265 passed.
- **Renderer:** vitest 2077, typecheck clean, lint 0 errors.
- **Live, temp `CAPFORGE_HOME`:**
  - `pl` then `de` written separately: both kept.
  - A 6000-byte `pl` description → 422 `localized.pl.description`.
  - `?lang=pl` package uses the Polish title, drops the source description, and prints the NOTES lines.
  - `?lang=xx` → 404.
  - `{pl: null}` removes only `pl`.

## Part C — Copy for platform + Transcript tab (outline)

- **Formatters:** backend `platform=linkedin|x|instagram` renderers over the same record plus effective brief, clipboard text only (§6): LinkedIn ≤ 3000 chars, 3–5 hashtags, the link on its own line; X ≤ 280 with URLs counted as 23; Instagram ≤ 2200, ≤ 30 hashtags, "link in bio". Each has its own violations. The footer gets a "Copy for platform ▾" menu, and MCP `get_upload_package(platform=…)` accepts the new values.
- **Transcript tab:** a read-mostly third tab beside Text/Groups, extracted as its own component (`ResultsScreen.tsx` is 763 lines). Segments with timestamps, a chapter gutter placing each chapter at its segment (seconds → the first segment that starts at or after it), click to seek, and "insert chapter here".
