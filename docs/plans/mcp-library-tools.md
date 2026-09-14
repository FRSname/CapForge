# v3.0 deliverable #2 — `mcp_server/library.py` (the library tool group)

**Status:** IMPLEMENTED 2026-09-14 on branch `feat/v3-library-mcp` (every tool exercised live, see §Verification). Parent: [creator-hub-vision.md](creator-hub-vision.md) §3.1, §3.5, §7 row 2. Builds on [backend-library.md](backend-library.md) (#1, merged as PR #29).

## Goal (exit test from §7)

An agent lists videos, reads a stored transcript and writes a description **with the app on the drop screen**; `open_video` and a project-file open produce identical track stores (a pure `projectRestore` test). Error copy distinguishes *app closed* from *no window open*.

## Scope

| In #2 | Deferred (why) |
|---|---|
| `list_videos`, `search_library`, `get_video`, `get_video_transcript`, `set_video_meta` (incl. the `{scratch: false}` promotion), `mark_published`, `find_video_moments`, `open_video` | `get_brief`/`set_brief`, `validate_video`, `check_chapters`, `get_upload_package` — they need the brief + validators (#4) |
| `load_video` returns `video_id` (the backend creates the record); `transcribe` creates the record after success | `grab_frames`, `lang?` params (4s stretch) |
| `activeVideoId` in the UI-state mirror; `open_video` restores through `lib/projectRestore.ts` | create-on-drop, record autosave, the card (#3) — so in #2 a record only has a `project.capforge` after a `PUT …/project`; `open_video` on a record without one answers a clear `409` |

Rules carried over: one video per tool call; no library tool reaches `_await_render_approval` (`render`/`render_hyperframes` stay its only occupants); transcript *edits* stay session-only (`update_words` needs `open_video` first — the docstrings say so); read budget: dossier + stored transcript from the record routes, `get_video_transcript` defaults to `segments_only`.

## Backend (small)

- `backend/library/router.py`:
  - `GET /api/library/{id}/project` → the stored v2 project JSON, `404` when none. (The renderer's `open_video` path reads it.)
  - `GET /api/library/{id}/moments?query=…` **or** `?kind=…` → `find_transcript_moments` / `find_semantic_moments` over `TranscriptionResult.model_validate(transcript.json)`; `400` when neither or both are given, `404` without a transcript, `400` for an unknown kind (the `ValueError` message).
- `backend/main.py` (keep to ~25 lines): `"open_video"` joins `AGENT_COMMAND_OPS`. In `agent_command`: `record_id` must be a non-empty string (`400`); `RecordNotFound` → `404`; no stored project → `409 "Record <id> has no session snapshot yet — open it in CapForge once (autosave lands with the library screen)"`; no `ws_clients` → `409 "CapForge is running but no window is open — click the Dock icon, then retry open_video"`. `load_video`: after the existing validation, `library_store().create_or_get(path)` and return `{"status": "ok", "video_id": …}`; a library failure there is logged at error level and the response simply lacks `video_id` (loading the video is the primary action and must not be blocked by the index).

## Renderer (App.tsx and AgentLiveSync.tsx must not grow; new logic goes in new modules)

- `lib/uiStateMirror.ts`: `activeVideoId: string | null` on `UiStateCore` and `UiStateCoreInput`; `hooks/useUiStateMirror.ts` input gains it.
- `lib/trackCommands.ts`: `ECHOED_COMMAND_OPS = [...TRACK_COMMAND_OPS, 'open_video']`, `isEchoedCommand(op)`. `isTrackCommand` stays.
- `lib/api.ts`: `getLibraryProject(id): Promise<unknown>` → `GET /api/library/{id}/project` through `getWithLocalToken` (the library routes accept the local token).
- `lib/libraryOpen.ts` (pure, tested): `openVideoFromLibrary({ videoId, screen, getProject, restore }) → Promise<string>` — refuses (throws) while `screen === 'progress'`, fetches the project, calls `restore(raw)` (which resolves `true` when the store was replaced, `false` when the plan was rejected — throw then), returns the toast copy `Agent opened "<title|id>" from the library`.
- `hooks/useLibraryOpen.ts`: wraps that with `useState<string | null>` for `activeVideoId` and returns `{ activeVideoId, applyEchoedCommand }` where `applyEchoedCommand(cmd)` dispatches `isTrackCommand(cmd.op)` → the existing `applyTrackCommand` (sync string) and `'open_video'` → `openVideoFromLibrary` (async). Takes `{ screen, restoreFromProjectFile, applyTrackCommand }`.
- `components/AgentLiveSync.tsx`: prop `applyTrackCommand` becomes `applyEchoedCommand: (cmd) => string | Promise<string>`; `handleTrackCommand` becomes `handleEchoedCommand` (awaits the applier; every exit still echoes `{lastCommandId, lastCommandStatus, lastCommandError}`); `isTrackCommand` → `isEchoedCommand` at the dispatch site. Line count must not increase.
- `App.tsx`: `restoreFromProjectFile` returns `Promise<boolean>`; `useLibraryOpen(...)` replaces the direct `applyTrackCommand` prop wiring; `activeVideoId` is passed to the mirror. Net change ≤ +5 lines — report the exact before/after count.
- vitest (node env, pure): `lib/libraryOpen.test.ts` (refusal on progress, project fetched, restore rejected → throws, toast copy); `lib/projectRestore.test.ts` gains: `planProjectRestore(JSON.parse(JSON.stringify(file)))` deep-equals `planProjectRestore(file)` — the stored project is byte-for-byte what was PUT, so this is the "open_video and the card install the same store" pin; `lib/uiStateMirror.test.ts` asserts `activeVideoId` rides the core.

## MCP

- `mcp_server/client.py`: `_request` gains `headers: Optional[dict] = None`; a new `_request_status(...) -> tuple[int, Any]` variant that returns `(status_code, body)` for statuses in an `accept` tuple instead of raising; methods `library_list(params: dict)`, `library_get(video_id)`, `library_find_by_path(path)` (= list + client-side match on `sourcePath`, or a `?path=` param if you add one to the list route — pick one and test it), `library_create(path, scratch=False)`, `library_transcript(video_id, segments_only=True)`, `library_patch(video_id, patch, rev)` (sends `If-Match`; on `409` raises `StaleRecord(detail, current)` — a new exception class in `client.py`), `library_promote(video_id)`, `library_moments(video_id, query=None, kind=None)`.
- `mcp_server/library.py` — same shape as `tracks.py`: `TOOLS`, `register(mcp, get_client)`, `_get_client` resolved per call, **never imports `server`**. Every tool returns a dict; failures are `{"status": "error", ...}` dicts, never raised, via one `_library_call(fn)` helper that maps: `BackendNotFound` → `"CapForge is not running — launch it (the window can stay closed) and retry."`; `httpx.HTTPStatusError` → the backend `detail` (404/409/422 text); `StaleRecord` → `{"status": "error", "reason": "stale_rev", "current": …}`.
  - `list_videos(status=None, collection=None, q=None, include_scratch=False)`, `search_library(q)` (a thin alias over the list route's `q`), `get_video(video_id=None, path=None)` (exactly one), `get_video_transcript(video_id, segments_only=True)` (passes the `{rev, source, transcript}` envelope through; docstring explains `source`), `set_video_meta(video_id, patch: dict, rev: int)` (a patch that is exactly `{"scratch": False}` promotes instead), `mark_published(video_id, url, youtube_video_id=None, published_at=None)` (reads the record, merges over `publish.youtube`, patches with the read `rev`; tier 1, no approval), `find_video_moments(video_id, query=None, kind=None)`, `open_video(video_id)` (mints `command_id`, sends the `open_video` command, then polls the mirror with `tracks.poll_mirror` until the echo carries this id **and** `activeVideoId == video_id`; the `409` texts from the backend are returned verbatim; `confirm_hint` on timeout).
- `mcp_server/server.py`: `load_video` returns the command response's `video_id`; `transcribe` calls `library_create(path)` after success and adds `video_id`; `update_words` / `remove_filler_words` docstrings gain one line: "edits the *open* session — call `open_video` first for a library record". `library.register(mcp, lambda: _client)` next to `tracks.register`.
- Tests `mcp_server/tests/test_library_tools.py` with a `StubClient` (the `test_tracks_tools.py` pattern): every tool's happy path; `get_video` with both/neither args; stale rev surfaces `current`; the promotion special case; `mark_published` merges without clobbering an existing `publishedAt`; `open_video` confirms on echo + `activeVideoId`, and returns the backend's 409 text; `BackendNotFound` copy; a test that `TOOLS` names are all registered on `server.mcp` and that the CLAUDE.md count is updated (`grep -c` the two files). `backend/tests/test_agent_open_video.py`: op allowed; 400/404/409 (no project)/409 (no window) in that order; broadcast payload carries `record_id` + `command_id`; `load_video` response carries `video_id` and the record exists on disk.
- Docs: `mcp_server/README.md` gains a "Library (the video record)" section after "Caption tracks"; CLAUDE.md's MCP bullet count 38 → 46 and the mirror bullet mentions `activeVideoId`.

## Not in this deliverable

Record autosave / create-on-drop / the library screen (#3); brief, validators, upload package, per-track SRT pairing (#4); `@mcp.prompt()` publish prompts (#5); posters (#6).

## Verification (2026-09-14)

Backend 1301 passed / 35 skipped; MCP 140 passed; vitest 1453 passed; typecheck clean; lint 0 errors (34 warnings, one new: the ref-write pattern AgentLiveSync already uses). The Windows CI file set plus `test_agent_open_video.py` also passes with `huggingface_hub` blocked. Live: a stubbed-ML uvicorn under a temporary `CAPFORGE_HOME`, the **real** `CapForgeClient` and the tool functions themselves — `list_videos`, `get_video` by id and by path (and refused with both/neither), `set_video_meta` (rev bump, history `by: agent`, stale rev → `stale_rev` + `current`, a system field → the 422 summary naming `rev`), `get_video_transcript` before/after a `PUT …/project` (words stripped by default), `find_video_moments` (`kind=pause`, `query=`, both → refused), `mark_published` (status flips to `published`), `search_library`, `open_video` (unknown id → the 404 text; no snapshot → the 409 text verbatim), and the not-running copy after the backend quit. The renderer half (`open_video` restoring in the window, `activeVideoId` in the mirror) is covered by the pure vitest layer only — it needs a live window and lands in manual QA with #3.

## Deviations from the plan above (all deliberate)

- `require_openable_record` / `record_id_for_media` live in `backend/library/router.py`, not `main.py` (+28 lines there instead of +58).
- `mark_published` reads the YouTube id from the URL (`youtu.be/<id>`, `watch?v=`, `/shorts/`, `/live/`) when `youtube_video_id` is omitted and **refuses** a URL it cannot read, because `published` status keys on `videoId`, not on the URL — the first live run showed a URL-only call left the record `drafted`.
- FastAPI's list-shaped 422 `detail` is summarised as `CapForge refused the write — <field>: <msg>`; the first live run handed the agent a bare "422 Unprocessable Content".
- `get_video(path=…)` returns the list summary (11 keys), `get_video(video_id=…)` the full dossier; both under a `video` key.
- `set_video_meta` refuses `scratch` locally unless the patch is exactly `{"scratch": false}`; blank moment params count as absent.
- `open_video` stops polling on an `error` echo instead of waiting out the timeout.
- `activeVideoId` is set only by a successful `open_video`; clearing it on New / drop / `load_video` belongs with create-on-drop (#3).
- `useCrashRecovery` accepts a `Promise<unknown>`-returning restore (it ignores the boolean).
- No CLAUDE.md-count test; the registration pin is `test_every_library_tool_is_registered_on_the_server` (46 tools).
- `test_agent_load_video.py` gained a `CAPFORGE_HOME` fixture — without it the `video_id` change wrote a record into the real `~/.capforge/library` on the first run (cleaned up).
