# v3.0 3s — Folder import, "Locate…" relink, import-only watch folder

**Status:** planned 2026-09-14 on `feat/v3-folder-import`. Plan row: creator-hub-vision §7 **3s** ("stretch, cut #5 — drop a folder of recordings, see cards"). Builds on #1 (store, fingerprint identity), #3 (library screen, Remove/Delete), #6 (posters via the store's `on_created` hook — every record minted here gets a poster for free).

## Why

A creator's recordings live in folders, not one file at a time. Today the library takes a single dropped file, and a record whose media moved (an external drive renamed, a folder reorganised) is a dead card with a "missing media" chip and no way back. And a recording session that drops files into one export folder has to be imported by hand, every time.

## Decisions (made here, not open)

1. **Folder import is explicit and imports everything it finds** (bounded). Dedupe is the existing fingerprint; nothing is transcribed.
2. **A fingerprint hit on a record whose media is missing is a relink**, not a skip: importing the folder a drive was moved to heals every card in it. A hit whose media still exists at another path is reported as `existing` (a duplicate file), never repointed.
3. **Relink is its own route**, not `PATCH`: `sourcePath` stays a `SYSTEM_FIELDS` member (`test_library_record_contract.py` unchanged). Same media (fingerprint equal) relinks silently; different media needs `force` — the UI confirms inline, like Delete. A file another record already owns is refused.
4. **Relink rewrites the stored snapshot's media paths.** `projectRestore.ts` restores from the snapshot's `transcriptionResult.audioPath` (and `meta.selectedFilePath`), not from the record, so repointing only `sourcePath` would still open the missing file. Every string in `project.capforge` and `transcript.json` **exactly equal** to the old `sourcePath` becomes the new path (atomic writes). `sourceTag` is recomputed from the new path (it is the studio-workspace join key; a co-author workspace for the old path is simply not reused).
5. **The watch folder lives in the backend**, polls, and only runs while CapForge runs (decision D9: quit means quit). Electron main never calls REST and has no watcher; `fs.watch` recursion is unreliable on macOS and chokidar is not a dependency. Polling one folder every 10 s with `os.scandir` is cheap.
6. **The watcher remembers every path it has seen** (`seen` in `watch.json`) and never re-imports a seen path. Without that, Remove/Delete would be undone on the next tick — fingerprint lookup deliberately ignores `.removed/` and `.trash/`. Choosing a folder imports what is already in it (then remembers it); changing the folder resets `seen`.
7. **A file is imported only once its size+mtime are unchanged across two polls** — a render or copy still being written is never fingerprinted half-done (the fingerprint includes size and mtime, so an early import would mint a record the finished file no longer matches).
8. **New event `library_changed`** (`{type, created: [ids], relinked: [ids]}`), not `record_updated`: the publish panel's soft lock reads `record_updated.by`, and a watcher is not an actor. The list hook refetches on it.
9. **One media-extension list, three copies, one fixture** (the timestamp precedent): `backend/library/media_scan.py` `MEDIA_EXTENSIONS`, `lib/libraryView.ts` `MEDIA_EXTENSIONS`, and the list behind Electron's `firstMediaArg` (`electron/single-instance.js`), all asserted against `backend/tests/fixtures/media_extensions.json` (pytest, vitest, `node --test`).
11. **History for a relink** is one `HistoryEntry` (`{field: "sourcePath", prev: <old path>, by, at}`); the watcher and folder import stamp nothing (minting a record stamps nothing today either).
10. **Not in this change:** an MCP `import_folder` tool (tool-count churn; the agent already has `load_video`), auto-transcribe of watched files (v3.x job queue), multiple watch folders, a "Locate folder…" for many cards at once beyond what decision 2 already gives.

## Backend

### `backend/library/media_scan.py` (new, pure)
- `MEDIA_EXTENSIONS: frozenset[str]` — lower-case, no dots, equal to the fixture.
- `SCAN_MAX_FILES = 500`, `SCAN_MAX_DEPTH = 4` (named constants).
- `scan_media(folder: Path, *, recursive: bool = True, max_files=SCAN_MAX_FILES, max_depth=SCAN_MAX_DEPTH) -> ScanResult` (`@dataclass(frozen=True)`: `paths: tuple[Path, ...]`, `truncated: bool`). Deterministic order (sorted per directory). Skips dot-files and dot-directories, never follows symlinked directories, only regular files whose suffix (case-insensitive) is in the set. Raises `NotADirectoryError` for a non-directory.

### `backend/library/folder_import.py` (new)
- `import_folder(store, folder, *, recursive=True) -> FolderImport` (frozen dataclass: `created`, `existing`, `relinked` — tuples of ids; `failed: tuple[tuple[str, str], ...]` path+reason; `truncated: bool`).
- Per path: `store.create_or_get(path)`. Minted → `created`. Hit with `missing_media` → `store.relink(id, path, by=actor)` → `relinked`. Hit otherwise → `existing`. `MediaNotFound`/`OSError` → `failed` (never aborts the pass). A scratch hit is promoted by `create_or_get` already.
- `import_paths(store, paths, *, by)` — the same per-path step for an explicit list (used by the watcher and by a multi-file drop).

### Relink — `LibraryStore.relink(video_id, path, *, by, force=False) -> VideoRecord`
Lives in `store_admin.py` (the mixin; `store.py` is at 434 lines). Rules:
- `path` not a regular file → `MediaNotFound`.
- Fingerprint equal to the record's → relink. Another record (library or scratch) holds the new fingerprint → new `MediaInUse(other_id)`. Different and not `force` → new `MediaMismatch`. `force` → relink and adopt the new fingerprint.
- Updates `sourcePath` (resolved), `sourceTag`, `fingerprint` (when forced), `rev + 1`, `updatedAt`, and stamps `history[]` the same way `patch` does, naming `sourcePath`.
- Rewrites exact-equal strings in `project.capforge` and `transcript.json` (deep, dicts and lists; atomic). Reindexes.
- Relinking to the path it already has is a no-op (no rev bump), like a no-op patch.

### Watch — `backend/library/watch.py` (new)
- `watch.json` at the library root: `WatchConfig` pydantic `extra="forbid"`: `folder: Optional[str]`, `seen: dict[str, str]` (absolute path → `"{size}-{mtime_ns}"`). Written with `write_json_atomic`; a missing or invalid file reads as "not watching" (logged).
- `WATCH_INTERVAL_S = 10.0`, `WATCH_STABLE_POLLS = 2`.
- `FolderWatcher(store, notify, *, interval_s=WATCH_INTERVAL_S)`:
  - `tick() -> WatchTick` — synchronous, the unit the tests drive (no sleeps in tests): scan the folder (`scan_media`, recursive), skip paths in `seen`, track `(size, mtime_ns)` for the rest in memory, and once a path's stat is unchanged for `WATCH_STABLE_POLLS` consecutive ticks import it through `import_paths(by="user")`, add it to `seen` (also when its import *failed* for a reason other than a vanished file — a corrupt file is not retried every 10 s), persist `seen`, and call `notify(created, relinked)` when either is non-empty. A folder that no longer exists is a quiet no-op tick (drive unplugged) with `status().available == False`.
  - `set_folder(folder: Optional[str]) -> WatchStatus` — validates: absolute, an existing directory, not inside the library root (`capforge_home()`), else `ValueError` with a user-facing message. A changed folder resets `seen` and pending state; `None` stops watching. Wakes the loop.
  - `status() -> WatchStatus` (`folder`, `available`, `lastScanAt`, `importedCount` for this process).
  - `start()` / `stop()` — a daemon thread with a `threading.Event`, one tick per interval; any exception inside a tick is logged with `exc_info` and the loop continues.
- Thread safety: the watcher thread writes through the same `LibraryStore` as request threads (and the poster pool reads through it). `index.py:67` opens **one** connection with `check_same_thread=False` and **no lock** — concurrent use of a shared `sqlite3.Connection` can raise ("recursive use of cursors") or interleave a transaction. Add a `threading.RLock` owned by the index that every method holding the connection takes (not a lock in the watcher), with a test that hammers `upsert`/`search` from several threads. `NullIndex` needs none.
- `main.py` startup (it is at 2001 lines — add only the call): build the store's watcher via a factory in `watch.py` (`get_watcher(store, notify)` cached per root, like `router.get_store`), `start()` it, and pass a `notify` that does `asyncio.run_coroutine_threadsafe(broadcast_event({"type": "library_changed", "created": [...], "relinked": [...]}), loop)`. Stop it on shutdown.

### Routes — `backend/library/router_import.py` (new, registered by `build_router` like `router_admin`)
All gated by the injected actor dependency; blocking work through `run_in_threadpool`.
- `POST /api/library/import-folder` `{path: str, recursive: bool = true}` → `200 {created, existing, relinked, failed: [{path, reason}], truncated}`; `422` when not an existing directory. Awaits `on_record_changed(id, rev, actor)` for each relinked record.
- `POST /api/library/{id}/relink` `{path: str, force: bool = false}` → `200` record view; `404` unknown record; `422 {reason: "media_not_found"}`; `409 {reason: "different_media"}`; `409 {reason: "media_in_use", video_id}`. Awaits `on_record_changed`.
- `GET /api/library/watch` → `{folder, available, lastScanAt, importedCount}`.
- `PUT /api/library/watch` `{folder: str | null}` → the same shape; `422 {detail}` with the validation message.
Request models `extra="forbid"`.

### Tests (write first)
- `test_library_media_scan.py`: extension set equals the fixture; hidden files/dirs skipped; symlinked dir not followed; depth and file caps set `truncated`; case-insensitive suffix; non-directory raises.
- `test_library_folder_import.py`: created/existing/relinked/failed partition on real temp files (distinct bytes per file — records key by content); a moved file relinks the missing record and its snapshot paths; an unreadable file lands in `failed` and the pass continues; `on_created` fires once per minted record.
- `test_library_relink.py`: same-media relink; mismatch without/with force; media in use; no-op; history stamped + rev bumped; exact-equal deep rewrite only (a different string containing the old path as a substring is untouched); `sourcePath` still refused by `PATCH` (422).
- `test_library_watch.py`: stability (a file whose size changes between ticks waits), `seen` survives a new watcher instance, a Removed record's file is not re-imported, a changed folder resets `seen`, a vanished folder is a quiet tick, the folder inside the library root is refused, `notify` called with ids only when something happened, a raising tick does not kill the loop (call the loop body directly).
- Route tests for the four routes including every status code above, using the existing `test_library_routes.py` fixtures.

## Electron
- `electron/library-dialogs.js` (new; `main.js` is already 1023 lines — register from there with one call): `registerLibraryDialogs({ ipcMain, dialog, getWindow, appState })` → `library:pick-folder` (`openDirectory`, `createDirectory`, `defaultPath` from `appState.get('lastImportFolder')`, persists the choice) returning a path or `null`. `electron/library-dialogs.test.js` with fakes (`node --test`).
- Both preloads: `pickLibraryFolder: () => Promise<string | null>` → `library:pick-folder` (the parity test enforces the pair).
- "Locate…" reuses the existing `pickAudioFile()`.

## Renderer
- `lib/libraryView.ts`: `MEDIA_EXTENSIONS` unchanged; `libraryView.test.ts` asserts it equals `backend/tests/fixtures/media_extensions.json`.
- `lib/libraryTypes.ts`: `FolderImportResult`, `WatchStatus`, and their boundary guards (`parseFolderImportResult`, `parseWatchStatus`) in the existing hand-written style.
- `lib/libraryImport.ts` (new, pure): `folderImportSummary(result, folderName)` toast copy ("Imported 12 videos · 3 already in the library · 1 relinked · 1 could not be read", "No media found in X", a truncated note naming the cap); `relinkRefusal(status, body)` → `{kind: 'different_media'} | {kind: 'media_in_use', videoId} | {kind: 'media_not_found'} | null`; `droppedImport(items)` → the plan for a drop: `{kind: 'folder', path} | {kind: 'files', paths} | {kind: 'open', path} | {kind: 'rejected'}` (one media file keeps today's "open in the editor"; several media files import without opening; a directory imports the folder).
- `lib/api.ts` is **979 lines (over the ceiling)**: new REST calls go in a new `lib/libraryApi.ts` built on `api.ts`'s existing request helpers (export what is needed rather than duplicating token/bridge plumbing — `ensureBridge` must still gate every call). Only the WS branch for `library_changed` plus `onLibraryChanged(cb)` subscription goes in `api.ts`.
- `hooks/useLibraryList.ts`: subscribe to `onLibraryChanged` → refresh while active; when inactive, the existing activation edge refetches anyway.
- `hooks/useLibraryActions.ts`: `importFolder(path?)` (picker when no path; toast the summary; refresh), `importFiles(paths)`, `locate(video)` → picks a file, relinks, returns `{kind: 'done'} | {kind: 'confirm', path}` for a different-media refusal, toasts the other refusals; `forceLocate(video, path)`.
- `components/library/LibraryScreen.tsx`: an "Import folder…" button beside "Import project files…" (reachable from the empty state too); drop handling through `droppedImport` using `DataTransferItem.webkitGetAsEntry()?.isDirectory` + `getPathForFile`.
- `components/library/LibraryCard.tsx`: when `missing_media`, a "Locate…" menu item; a different-media answer shows an inline "Different file — link anyway?" [Link] [Cancel], same pattern as Delete.
- `components/settings/GeneralSettings.tsx` + `hooks/useLibraryWatch.ts`: a "Watch folder" row — the path (or "Not watching"), "Choose…" (`pickLibraryFolder` → `PUT`), "Stop"; copy: "New recordings saved here become library videos while CapForge is open. Nothing is transcribed automatically." A drive that is unplugged shows "Folder not available".
- Tests (node env, static markup): `libraryImport.test.ts` (summary copy, refusal mapping, drop plan), guards in `libraryTypes.test.ts`, `LibraryCard.test.tsx` (Locate item only with missing media; the confirm markup), `LibraryScreen.test.tsx` (Import folder button present in both states), `GeneralSettings` markup for watching / not watching / unavailable.

## As built — deviations and additions

- **`POST /api/library/import-paths`** `{paths: [str]}` (1–500, `extra="forbid"`) was added for a multi-file drop, since per-file `POST /api/library` could neither relink nor say created vs existing. The body has the import-folder shape. Refused paths come first in `failed` with the codes `media_not_found` / `not_media`. A failure *during* import carries a sentence, so `failed[].reason` is a code only for those two pre-checks.
- **Relink refusal bodies** put `reason` at the top level beside `detail` (`JSONResponse`, not `HTTPException`); `media_in_use` adds `video_id`. The renderer accepts `reason` either top-level or under `detail`.
- **Relative paths are refused** everywhere: import-folder answers 422, relink answers `media_not_found`. Otherwise a relative path would resolve against the backend's working directory.
- **"Another record owns it"** matches by path as well as by fingerprint, and is checked before the different-media check, so `force` cannot override it.
- **The snapshot rewrite** also replaces an absolute string that *resolves* to the old path (`/var` vs `/private/var`, a symlinked folder), not only exact-equal strings. A string that merely contains the old path is still left alone.
- **The scanner** skips symlinked files as well as symlinked directories. A directory deeper than the depth cap sets `truncated` even when it holds no media.
- **The watcher** forgets a `seen` path that has left the folder (unless the scan was truncated), so a new file saved later under the same name is imported. Setting the same folder again keeps `seen`; `null` clears it. Files already in a newly chosen folder go through the same two-poll wait (about 10 s). `importedCount` counts created and relinked records.
- **Review additions:**
  - `LibraryStore` owns a re-entrant write lock around every read-modify-write. The watcher thread made a relink racing a `PATCH` a lost-update risk; the race predated this change through FastAPI's threadpool, but nothing made it likely.
  - The watcher runs its scan and import **outside** its state lock, so `GET`/`PUT /watch` stay responsive during a large first import.
  - Import summaries toast with a success/info tone (`LibraryHome`'s `notify` relays through `ToastRelay`, which defaults to `'error'`).
  - The renderer carries no copy of the scan caps.
  - The Locate picker's filter follows the extension fixture, plus an "All Files" entry.

## Verification (to fill in)
- backend pytest (library tests + full suite; the 15 golden-frame failures on this Mac are the known environmental delta), `npm run typecheck`, `npm test`, `npm run lint`, `node --test electron/library-dialogs.test.js`.
- Live, against a temp `CAPFORGE_HOME` uvicorn: import a folder of real clips (cards + posters), move one file and import the new folder (relinked, opens), relink a card to a different file (409 → force), watch a folder and copy a file in (appears after two ticks, a `library_changed` frame on `/ws/...`), Remove it (not re-imported).
