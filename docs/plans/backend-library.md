# v3.0 deliverable #1 — `backend/library/`

**Status:** IMPLEMENTED 2026-09-14 on branch `feat/v3-library` (exit test run live with curl, see §Verification). Parent plan: [creator-hub-vision.md](creator-hub-vision.md) §2, §3.1, §7 row 1, §9.

## Goal

The video record exists on disk and is readable/writable over the token-gated HTTP boundary **with no window open**. Exit test (from §7): `curl` with the agent token lists, reads and writes a record while the app sits on the drop screen (`current_result is None`).

Nothing in this deliverable touches the renderer, `VideoRenderConfig`, the three caption renderers, or the mirror. The MCP tool group (`mcp_server/library.py`) is deliverable #2 and is **not** in scope here, except the two S-effort inputs the doc files under #1 (`duration` in `get_transcript(segments_only)`, the `pause` moment kind).

## Layout on disk (from §2.2, unchanged)

```
$CAPFORGE_HOME (default ~/.capforge)
  backend.json, agent-token            ← discovery now honours CAPFORGE_HOME too
  library/
    library.db                         disposable SQLite index (WAL); rebuilt when missing or schema_version differs
    .scratch/<id>/record.json …        scratch records, hidden, pruned after SCRATCH_LIFESPAN_DAYS
    <id>/
      record.json                      dossier (system + authored fields, rev, history)
      project.capforge                 v2 session snapshot, PUT by the renderer (deliverable #3) or a test
      transcript.json                  DERIVED from that PUT by the backend, same rev
      poster.jpg | peaks.bin | thumbnails/<hex>.jpg   served by the asset route, fixed-name allowlist
```

Every write is tmp + `os.replace` (precedent: `write_coauthor_marker`). Human-readable files are the truth; the DB is a cache.

## Modules (`backend/library/`, each < 400 lines)

| File | Owns |
|---|---|
| `paths.py` | `capforge_home()` (the ONE reader of `CAPFORGE_HOME`), `library_root()`, `record_dir(id, scratch)`, `ASSET_NAME_RE`, `resolve_asset(record_dir, name)` (realpath, must stay under the record dir) |
| `fs.py` | `write_json_atomic`, `read_json`, `fingerprint(path)` (size + mtime + sha1 of first/last `FINGERPRINT_EDGE_BYTES`), `source_tag(path)` (= the `hyperframes_workspace` hash; pinned by a test) |
| `schemas.py` | Pydantic dossier: `Chapter{start_s,title}`, `Highlight`, `Quote`, `Link`, `Shorts{caption, clip_suggestions[]}`, `Thumbnail{ideas[], candidates[], cover}`, `Speaker`, `LocalizedFields`, `Publish{youtube{videoId,url,publishedAt}, pushes[]}`, `ExternalRef`, `RenderEntry`, `HistoryEntry{field,prev,by,at}`; `AuthoredFields`, `SystemFields`, `VideoRecord(SystemFields, AuthoredFields)`, `RecordPatch` (authored, all optional, `extra="forbid"`), `AUTHORED_FIELDS` / `SYSTEM_FIELDS` sets, `derive_status()`, `HISTORY_CAP`, `HISTORY_PREV_MAX_CHARS` |
| `transcript.py` | `derive_transcript(project_dict) -> dict` (validated through `TranscriptionResult`, renderer-only keys such as `wid`/`overrides` dropped), `segments_only(transcript)`, `plain_text(transcript)` for the index |
| `index.py` | `LibraryIndex(db_path)`: `SCHEMA_VERSION`, `has_fts5()`, FTS5 table or a `LIKE` table when FTS5 is absent, `upsert`, `delete`, `search(q) -> ids`, `rebuild(records)`; `NullIndex` (pure-Python substring scan) when `sqlite3` itself cannot be imported. Errors propagate. |
| `store.py` | `LibraryStore(root)`: `create(source_path, scratch)` (dedupes by fingerprint; a scratch open of a known real record returns the real one), `get`, `find_by_path`, `list(status, collection, q, include_scratch)`, `patch(id, patch, rev, by)` (→ `StaleRevision(current)` on rev mismatch, `ScratchReadOnly` unless the patch is the promotion `{scratch: false}`), `promote`, `put_project(id, project)` (writes `project.capforge` + derived `transcript.json`, bumps rev, refreshes `duration`/`language`), `get_transcript(id, segments_only)`, `add_render`, `prune_scratch()`, `ensure_index()` |
| `router.py` | `build_router(actor_dep) -> APIRouter`. The guard is **injected** — `main.py` is past the size ceiling and importing it from here would be circular. |

### Routes (all under the injected guard; agent token or local token)

| Route | Notes |
|---|---|
| `GET /api/library?status=&collection=&q=&include_scratch=` | `{videos: [summary…]}`; `q` goes through the index |
| `POST /api/library` `{source_path, scratch?}` | create-or-return; used by create-on-drop / `load_video` later |
| `GET /api/library/{id}` | dossier with derived `status` and `missing_media`, no transcript |
| `PATCH /api/library/{id}` + `If-Match: <rev>` | body = `RecordPatch`; `428` without `If-Match`; `409 {detail, current}` when stale; `422` on unknown / system fields; `by` = `agent` or `user` from which token matched |
| `PUT /api/library/{id}/project` | v2 project JSON → `project.capforge` + `transcript.json`; returns `{rev}` |
| `GET /api/library/{id}/transcript?segments_only=true` | `{rev, source: "record", transcript}`. The `source: "session"` proxy for the *active* record lands with deliverable #3 (it needs `activeVideoId`). |
| `GET /api/library/{id}/asset/{name:path}` | `name` must match `ASSET_NAME_RE`; `404` otherwise (never reveals why) |
| `POST /api/library/{id}/renders` | append a `RenderEntry` (what "captioned" is derived from) |
| `POST /api/library/rebuild-index` | drop and rebuild from folders |

Status is derived at read time, never stored: `imported → transcribed (segments>0) → captioned (renders non-empty) → drafted (description non-empty) → published (publish.youtube.videoId set)`, plus `captions_newer_than_published`.

### `main.py` (small, deliberate growth)

`require_library_actor` (returns `"agent"` / `"user"` by which token matched, else `401`), `app.include_router(build_router(require_library_actor))`, and `ensure_index()` + `prune_scratch()` at startup. `agent_bridge.discovery_path()` reads `capforge_home()`.

## Side items filed under #1

- `CAPFORGE_HOME` honoured **everywhere**: `agent_bridge.py`, `mcp_server/discovery.py` (separate package — same two-line env read, cannot import `backend`), `workspace_fs._sensitive_roots`, `hyperframes_workspace()` → all read `capforge_home()`.
- `pause` kind in `find_semantic_moments`: a gap ≥ `PAUSE_MIN_S` (1.0 s) between consecutive words; each match is `{text: <first word after the pause>, start: prev.end, end: next.start, word_id: next, gap}`. Docstrings in `moments.py` and the MCP tool updated.
- `duration` in the MCP `get_transcript(segments_only=True)` shape (the backend route already carries it; the tool dropped it).
- CI: a `backend-windows` job on `windows-latest` that prints the SQLite version + FTS5 availability and runs `backend/tests/test_library_*.py` + `test_moments.py`. This checks setup-python's runtime, not the embeddable one CapForge bundles — the `LIKE` fallback is what makes that acceptable.

## Tests (TDD, `backend/tests/`)

- `test_library_paths.py` — env override; allowlist rejects `../poster.jpg`, `thumbnails/../record.json`, absolute paths, a symlink out of the record dir; `source_tag` equals the `hyperframes_workspace` folder name.
- `test_library_record_contract.py` — every `VideoRecord.model_fields` key sits in exactly one of `AUTHORED_FIELDS` / `SYSTEM_FIELDS`; `RecordPatch.model_fields` == `AUTHORED_FIELDS`; a patch carrying a system field is refused; **chapters are seconds** (§9.2): store a chapter, then PUT a project whose transcript lost a word before it — the chapter time is unchanged.
- `test_library_store.py` — create + dedupe by fingerprint; patch bumps rev, stamps capped history with `by`; stale rev raises with the current record; scratch hidden / read-only / promoted; `put_project` derives `transcript.json` and refreshes `duration`/`language`; status ladder; `missing_media`; a failed write leaves the previous file intact and no `.tmp`; `prune_scratch`.
- `test_library_index.py` — FTS5 path; forced `LIKE` fallback; rebuild on `SCHEMA_VERSION` mismatch; `NullIndex`.
- `test_library_routes.py` — the exit test as a `TestClient` flow with `current_result is None`: no token `401`; agent token and local token both pass; create → list → patch (`428` without `If-Match`, `409` carries `current`) → put project → transcript envelope → asset `404`/`200`; `by` is `agent` vs `user`.
- `test_moments.py` — `pause`.
- `mcp_server/tests/` — `duration` present in the segments-only shape.

## Not in this deliverable

`mcp_server/library.py` + `client.py` methods (#2); create-on-drop, record autosave, the home screen (#3); validators, brief, upload package (#4); `record_id` on the render request models (#3/#4 — the store's `add_render` is ready for it); `open_video`; the `source: "session"` transcript proxy; Remove / Delete; posters at import (#6).

## Verification (2026-09-14)

Backend suite 1269 passed / 35 skipped (including the 40 golden-frame cases, which passed on this Mac this time), MCP suite 83 passed. The exit test was also run for real: a stubbed-ML `uvicorn` under a temporary `CAPFORGE_HOME` with `current_result is None`; `backend.json` landed under that home; `curl` with the agent token created a record (201, then 200 on the fingerprint hit), listed it, got `428` without `If-Match`, `409` + `current` on a stale rev, patched as `agent` and as `user` (local `?token=`), had a system field refused with `422`, PUT a v2 project (the derived transcript carried no `wid`/`overrides`), read the `{rev, source: "record", transcript}` envelope, found the record by FTS (`q=edge`), got a uniform `404` for `../record.json`, `record.json` and a missing poster and `200` once `poster.jpg` existed, and left no `.tmp` file behind.

## Deviations from the plan above (all deliberate)

- `create_or_get()` returns `(record, created)` beside `create()` so the route can answer 201 vs 200 honestly.
- `promote()` bumps `rev` (it changes a durable field) and is idempotent on a non-scratch record.
- A no-op patch returns the record unchanged: no rev bump, no history entry.
- Exceptions live in `backend/library/errors.py`, re-exported from `store.py`.
- `router.reset_store_cache()` exists for tests that relocate `CAPFORGE_HOME` (closes cached SQLite connections).
- `LibraryStore._has_segments` caches the "transcript has segments" answer by `(mtime_ns, size)` so `list()` does not re-parse every 3 MB transcript per request.
- FTS5 queries are tokenised and re-quoted (a search-box `kubernetes AND (` cannot raise `OperationalError`); the `LIKE` branch escapes `%`/`_`.
- `VIDEO_ID_RE` (`uuid4().hex`) is checked before any filesystem lookup, so an id can never double as a path segment.
- `store.py` sits at ~390 lines; the next growth (deliverable #2/#3) should split the project/transcript half out first.
