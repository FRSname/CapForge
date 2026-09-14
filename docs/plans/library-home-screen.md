# v3.0 deliverable #3 — the library home screen

**Status:** IMPLEMENTED 2026-09-14 on branch `feat/v3-library-ui` (see §Verification for what was and was not exercised live). Parent: [creator-hub-vision.md](creator-hub-vision.md) §2.3, §4 "Library home", §7 row 3, §9.1. Builds on #1 ([backend-library.md](backend-library.md)) and #2 ([mcp-library-tools.md](mcp-library-tools.md)).

## Goal (exit test from §7)

Open CapForge → your videos. Open a card → the editor. Every session is a record: dropping a video creates one, editing autosaves into it, and `autosave.json` is only the backend-down fallback.

## Scope

| In #3 | Deferred |
|---|---|
| `'library'` home screen (initial), cards with status pips, "Continue" hero, drop anywhere, Add video, Import project files… (multi-select), card menu Remove / Delete | posters (#6 — cards show a placeholder block), Needs-attention column (needs #4's description/publish data), collections (4s), ⌘K, the demo-caption empty state (chrome week) |
| create-on-drop (`ensureRecordFor(path)` at Start and at the agent's `load_video`), `activeVideoId` cleared on New | `source: "session"` transcript proxy — its `activeVideoId` input now exists; wire it in #4 with the publish panel |
| record autosave (`PUT /api/library/{id}/project` on the existing 2 s debounce), `autosave.json` demoted to the fallback (written only when the PUT fails, stamped with `recordId` + `rev`) | a per-card "Restore local copy" affordance — the existing launch banner already restores a fallback copy through the same path (deviation, see below) |
| first-launch migration: studio workspaces with a live co-author marker → `imported` records; `lastProjectPath` → imported project | watch folder, folder import (3s) |
| single-instance lock; `outputDir` lifted out of StudioPanel; Settings → General "Library folder" row with Reveal | |

## Contracts (so the three halves can be built in parallel)

### Backend (`backend/library/`)

- `store.remove(id) -> VideoRecord` — moves the record folder to `<root>/.removed/<id>/` (keeps every file, hidden from `list`/`get`; `RecordNotFound` afterwards), deletes it from the index. `store.detach(id) -> Path` — deletes from the index and moves the folder to `<root>/.trash/<id>/`, returning that path; **the backend never deletes files** — Electron trashes the returned folder (`shell.trashItem`). `store.import_project_file(path) -> VideoRecord` — reads a `.capforge` file (absolute path, `.capforge` suffix, size ≤ `PROJECT_IMPORT_MAX_BYTES` = 64 MB, must parse as an object with `transcriptionResult` and a string `selectedFilePath`), `create_or_get(selectedFilePath)` (a missing media file → `MediaNotFound`), then `put_project`. `store.migrate_studio_workspaces() -> dict` — for every `capforge_home()/studio/*/` whose `read_coauthor_marker()` names a `source` that still exists, `create_or_get(source)`; returns `{"imported": [ids], "skipped": [{"folder", "reason"}]}`; idempotent.
- Record view + list summary gain a derived `hasProject: bool` (like `status`, never stored) and the summary gains `title` fallback **no** — the renderer derives the display title from `sourcePath` when `title` is empty.
- Router: `DELETE /api/library/{id}?mode=remove|detach` → `{"status": "ok", "mode": …, "folder": <path when detach>}`; `POST /api/library/import-project` `{path}` → the record view (`201`/`200` like create; `404` `MediaNotFound`; `422` on a bad file with the reason); `POST /api/library/migrate-studio` → the migration dict. All under the existing injected guard.
- `mcp_server/tracks.py` `confirm_hint`: `screen == 'library'` → "The app is on the library screen — call open_video (a stored record) or load_video (a file) first." Test in `mcp_server/tests`.

### Electron (`electron/`, dual preload)

- `app.requestSingleInstanceLock()` in `main.js`: a second launch quits itself; the first focuses its window and, when the second instance was launched with a media path argument, forwards it to the renderer over the existing file channel (mac: the `open-file` event). Pure helper `firstMediaArg(argv) -> string|null` in a new `electron/single-instance.js` with a `node:test` test (extensions from DropZoneScreen's list).
- IPC `library:trash-folder` (`window.subforge.trashLibraryFolder(path)`): resolves the path, refuses anything not strictly under `<CAPFORGE_HOME>/library/` (guard in `electron/library-fs.js`, pure, tested with `node:test`: traversal, symlink, the library root itself), then `shell.trashItem`. IPC `library:reveal` (`window.subforge.revealLibraryFolder()`): `shell.openPath(<CAPFORGE_HOME>/library)`, creating it if missing. IPC `dialog:open-projects` (`window.subforge.openProjectFiles(): Promise<string[]>`): multi-select `.capforge` dialog defaulting to `lastProjectPath`'s folder, returns paths only. `CAPFORGE_HOME` resolved the way `skills-store.js` does (one shared helper, not a fourth copy).
- Three names added to **both** `electron/preload.js` and `src/preload/index.ts`; `src/preload/parity.test.ts` must pass.
- `app-state` keys used by the renderer through the existing generic `getState`/`setState`: `lastOutputDir` (string), `library_migrated_v3` (boolean). No new IPC for them.

### Renderer (`src/renderer/src/`)

- `types/app.ts`: `Screen = 'library' | 'file' | 'progress' | 'results'`; App starts on `'library'`.
- `lib/api.ts`: `listLibrary(): Promise<{videos: LibraryVideo[]}>`, `createLibraryRecord(path): Promise<LibraryRecord>`, `putLibraryProject(id, project): Promise<{rev: number}>`, `deleteLibraryRecord(id, mode: 'remove' | 'detach'): Promise<{folder?: string}>`, `importLibraryProject(path)`, `migrateStudioWorkspaces()` — all with the local token. Types in `lib/libraryTypes.ts` (`LibraryVideo` = the list summary + `hasProject`; `LibraryStatus` union).
- `lib/libraryView.ts` (pure, tested): `displayTitle(video)` (title or file stem), `formatDuration(seconds)` (`m:ss` / `h:mm:ss`), `statusPips(status)` → four booleans (transcribed / captioned / drafted / published), `sortByUpdated(videos)`, `continueCandidate(videos)` (newest with a project), `isMediaPath(name)` (the DropZone extension list, exported from one place).
- `hooks/useLibraryList.ts`: `{videos, loading, error, refresh}`; fetches on mount and whenever `screen === 'library'` becomes true; `error` is surfaced (toast), never swallowed.
- `hooks/useLibrarySession.ts` — **owns the record side of a session**, absorbing `useLibraryOpen`: `activeVideoId`, `ensureRecordFor(path): Promise<string|null>` (`createLibraryRecord` → sets `activeVideoId`; a failure toasts and returns null — the session still runs, autosave falls back), `clearActive()`, `applyEchoedCommand` (as today), `openRecord(id)` (a record with `hasProject` → `openVideoFromLibrary`; without one → `onChooseFile(sourcePath)` so the user transcribes it), `outputDir` / `setOutputDir` (seeded from `lastOutputDir`, persisted on change), and `writeSnapshot(snapshot)` — the autosave writer: with an `activeVideoId` it PUTs the project and remembers `rev`; when the PUT fails it writes `autosaveWrite({...snapshot, recordId, rev})` and toasts once per session ("Library unreachable — keeping a local copy"); without an id it writes `autosave.json` as before.
- `hooks/useAutosave.ts`: takes the writer (`write: (snapshot: unknown) => Promise<void>`) instead of calling `autosaveWrite` itself; same debounce, same dedupe. A failing writer still rejects into `.catch` — the writer is where the fallback lives.
- `hooks/useLibraryMigration.ts`: on first launch (`library_migrated_v3` unset) calls `migrateStudioWorkspaces()`, imports `lastProjectPath` when set and existing, sets the flag, refreshes the list; runs once, errors toast.
- `components/library/LibraryScreen.tsx` (+ `LibraryCard.tsx`, `LibraryEmptyState.tsx`; each < 250 lines): hero "Continue" card for `continueCandidate`, a grid of cards (placeholder poster block with the mono duration, display title, language chip in TrackTabs' chip style, the four-pip status rail, `updatedAt`), toolbar with **Add video** and **Import project files…**, a card `…` menu with Remove from library / Delete record (Delete confirms with a `window.confirm`-free inline "Delete? / Cancel" toggle — no native dialogs in tests), drop-anywhere via `getPathForFile`. Render-to-string tests cover: empty state, cards with pips, the continue hero, a missing-media chip. Theme tokens only, no hardcoded colours.
- `components/screens/RecoveryBanner.tsx`: the launch banner JSX extracted verbatim from App.tsx (that is what pays for the new screen block).
- `App.tsx`: `useLibrarySession` replaces `useLibraryOpen`; `useAutosave(projectFile, deps, session.writeSnapshot)`; `handleStart` → `await ensureRecordFor(filePath)` then `'progress'`; `handleLoadVideo` → `ensureRecordFor(path)`; `handleNew` → `clearActive()` and `'library'`; `restoreFromProjectFile` → `ensureRecordFor(plan.file.selectedFilePath)` when the file names one; StudioPanel gets `outputDir`/`onOutputDirChange`; the `'library'` block renders `LibraryScreen`. **App.tsx must end ≤ 649 lines; AgentLiveSync.tsx unchanged (372).**
- `components/studio/StudioPanel.tsx`: `outputDir` becomes props (state deleted).
- `components/settings/GeneralSettings.tsx`: a "Library folder" row showing `~/.capforge/library` (the path text from `capforge_home()` is not available in the renderer — show the literal default and note `CAPFORGE_HOME` overrides it) with **Reveal**.
- `CLAUDE.md`: Renderer Structure gains `components/library/`; the Screen union; the autosave rule ("the record is primary; `autosave.json` is the backend-down fallback").

## Rules the reviewer enforces

§9.1 two owners of durable state (record primary, `autosave.json` fallback only, toast on fallback); §9.3 size ceilings (App ≤ 649, AgentLiveSync 372, new modules only); §9.4 CSP (no `127.0.0.1` images — nothing in #3 loads one); no native modules; every Electron IPC is a three-file edit guarded by the parity test; the backend never deletes user files (folders go to Trash through Electron); the trash guard refuses anything outside `<home>/library/`.

## Not in this deliverable

Posters (#6), brief/validators/publish panel (#4), the `source: "session"` proxy (#4), folder import / watch folder / Locate… (3s), collections (4s), Export/Import record zip (v3.x).

## Verification (2026-09-14)

Backend 1343 passed / 35 skipped; MCP 144 passed; Electron `node --test electron/*.test.js` 166 passed (+28: the single-instance argv parser and the trash guard); vitest 1528 passed across 66 files (+75); typecheck clean incl. the preload parity test; lint 0 errors. Sizes: App.tsx 649 → **634**, AgentLiveSync.tsx 372 unchanged, `backend/main.py` unchanged, every new module under 400 lines.

Live: the dev instance that was already running picked the renderer up over HMR — the library home rendered (`Library · 0 videos`, Import project files…, Add video, the empty state with the drop zone, StudioPanel hidden, the pre-existing recovery banner still offered). Its **backend predates the library routes** (`GET /api/library` → 404 there), so the list failure surfaced as a toast and the page stayed usable; the happy path (create-on-drop → record autosave → card → editor, migration, Remove/Delete, single-instance lock) needs the app **restarted from this branch** — manual QA, not done here because relaunching the user's instance is theirs to do.

## Deviations from the plan above (all deliberate)

- `components/library/LibraryHome.tsx` is the container owning `useLibraryList` + `useLibraryMigration` + `useLibraryActions`; App's `'library'` block is seven lines.
- Two further verbatim extractions from App paid for the new block: `hooks/useGlobalShortcuts.ts` and `hooks/useSourceVideoInfo.ts`.
- StudioPanel is **hidden**, not unmounted, on the library screen (vision §4).
- `useLibraryList` has no `error` field; failures go to the toast relay.
- `openRecord` takes the `LibraryVideo` (it needs `hasProject` + `sourcePath`); a record without a stored session hands its file to the drop screen.
- `writeSnapshot` resolves after a successful fallback write, so the titlebar still shows "Saved" for a locally kept session; it rejects only when the local write also fails.
- `--shadow-2` / `--shadow-3` tokens added to `globals.css` (both themes) instead of inline black shadows.
- Electron: a fourth preload name, `onOpenPath`, carries a media path from a second launch / macOS `open-file` to the renderer (buffered until `did-finish-load`); nothing consumes it yet. A cold launch with a file argument on Windows/Linux is still not handled (pre-existing).
- Backend: `remove`/`detach`/`import_project_file`/`migrate_studio_workspaces` live in a `StoreAdminMixin` (`store_admin.py`) and `router_admin.py`; `read_coauthor_marker` is imported lazily so the library never drags Pillow/FFmpeg in; the name-clash stamp strips colons for Windows; `import_project_file` returns `(record, created)` for 201/200.
- The per-card "Restore local copy" affordance is the existing launch banner: a fallback copy restores through `restoreFromProjectFile`, which adopts the record and autosaves into it.
