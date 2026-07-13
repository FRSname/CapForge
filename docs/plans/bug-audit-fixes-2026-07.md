# Bug Audit & Fixes — July 2026

Phased repair plan produced from a three-agent scout sweep (backend, renderer, Electron)
on 2026-07-13. Each phase is self-contained: it names the files, the exact patterns to
copy, and a verification checklist, so it can be executed in a fresh context by the
**implementer** agent. Use the **scout** agent inside a phase only if a cited line has
drifted and needs re-locating.

Execution order = severity order. Phases 1–2 should not be reordered. Phases 3–5 are
independent of each other.

---

## Phase 0 — Consolidated findings (research complete, no action)

### Confirmed bugs / gaps

| # | Finding | Where | Severity |
|---|---------|-------|----------|
| 1 | `POST /api/export`, `POST /api/render-video`, `POST /api/export-hyperframes` have **no token gating** and write to a client-supplied `output_dir` raw (`os.makedirs`) | `backend/main.py:755,788,873`; `backend/main.py:1528`; `backend/exporters/video_render.py:1170` | CRITICAL |
| 2 | Transcription errors swallowed — user sees spinner, no toast | `src/renderer/src/components/screens/ProgressScreen.tsx:47-49` | HIGH |
| 3 | `shell:showInFolder` IPC accepts an arbitrary renderer path with zero validation | `electron/main.js:408-410` | HIGH (low blast radius) |
| 4 | `studio:open` IPC only type-checks its path before using it as spawn `cwd` | `electron/main.js:424-436`, `electron/hyperframes-studio.js:101-111` | MEDIUM |
| 5 | Electron core has near-zero test coverage (`main.js`, `python-manager.js`, `preset-io.js` untested; only `claude-connect` + `node-archive` have tests) | `electron/` | MEDIUM (quality) |
| 6 | `text-[var(--color-…)]` Tailwind-ambiguous classes still present (subset of 208 `-[var(` matches; CLAUDE.md says use inline `style` for text color) | 40+ renderer files, e.g. `App.tsx:332,344`, `StudioPanel.tsx`, `GroupEditor.tsx` | MEDIUM |
| 7 | GroupEditor word `key` uses array index (`${group.id}-${wi}`) | `src/renderer/src/components/editor/GroupEditor.tsx:447` | MEDIUM (latent) |
| 8 | WS broadcast + discovery-file failures logged too quietly / swallowed | `backend/main.py:232,250,276` | MEDIUM/LOW |
| 9 | Async handlers mutate globals (`current_result`, `current_effects`, `ws_clients`) without locks | `backend/main.py` various | assessed LOW for a single-user loopback app — document, don't over-engineer |

### Verified clean (do NOT "fix")

- Dual preloads (`electron/preload.js` ↔ `src/preload/index.ts`) are **in sync** (34 methods).
- `preset-io.js` trust boundary implements every CLAUDE.md claim (type tag, version gate,
  proto-pollution strip, 10MB cap, extension allowlist, basename-only writes).
- StudioSettings → `buildRenderBody()` bridge has **no drift** (all 47 fields mapped;
  `safeZone` is deliberately preview-only).
- No bare `except:` in backend; tokens never logged; `workspace_fs.py` sandbox is solid.

### Allowed APIs / patterns to copy (Phase 0 discovery)

- **Token gating**: `dependencies=[Depends(require_local_token)]` — copy from
  `PUT /api/result` at `backend/main.py:552`. The dependency itself is
  `backend/main.py:293-307`.
- **Auth trap**: `require_local_token` accepts the agent token *value* but only reads
  `?token=` / `X-CapForge-Local-Token`. The MCP client (`mcp_server/client.py:39-40`)
  sends `X-CapForge-Agent-Token` on every call, including `/api/export`
  (`client.py:91-92`) and `/api/export-hyperframes` (`client.py:120`). Gating those
  routes therefore REQUIRES extending `require_local_token` with a third param:
  `x_capforge_agent_token: Optional[str] = Header(None)` folded into the same
  constant-time check.
- **Renderer token header**: `private put()` in `src/renderer/src/lib/api.ts:272-285`
  shows the pattern (build headers dict, add `X-CapForge-Local-Token` when
  `this.localToken` is set). `private post()` at `api.ts:262-270` lacks it — copy the
  header logic across. Harmless on ungated POSTs.
- **Output-dir safety**: `resolve_output_dir()` (`backend/exporters/hyperframes_project.py:315`)
  is the existing safe-default pattern (falls back next to the source file). Reuse it —
  do not invent a new sandbox.
- **Toasts**: `useToast()` context hook (`src/renderer/src/hooks/useToast` — grep for
  provider) — `toast(message, 'error')`.
- **Electron path validation**: `fonts:read` / `fonts:delete` handlers at
  `electron/main.js:575-589` show the existing containment-check style.
- **Test runners**: renderer/electron-pure = `vitest run` (`npm test`); electron
  node-runner style = `node --test electron/*.test.js` (see header of
  `electron/claude-connect.test.js`). Backend = `.venv-dev/bin/python -m pytest backend/tests`.

### Anti-pattern guards (all phases)

- Do NOT invent new auth headers, token stores, or middleware — extend `require_local_token` only.
- Do NOT touch the three-renderer parity code paths (`useSubtitleOverlay.ts`,
  `_render_frame()`, `hyperframes_caption_html.py`) — nothing in this audit requires it.
- Do NOT "fix" the accepted deltas or the verified-clean list above.
- Do NOT convert `bg-[var(…)]`/`border-[var(…)]` classes in Phase 4 — only `text-[var(…)]`
  is ambiguous to Tailwind v4 (per CLAUDE.md).

---

## Phase 1 — CRITICAL: token-gate + sandbox the export/render endpoints

**Agent**: implementer. **Branch**: `fix/export-endpoint-auth`.

### What to implement

1. `backend/main.py` — extend `require_local_token` (line 293) with
   `x_capforge_agent_token: Optional[str] = Header(None)`; include it in the
   `provided = token or x_capforge_local_token or x_capforge_agent_token` resolution.
   Keep `token_matches` constant-time compares exactly as-is.
2. Add `dependencies=[Depends(require_local_token)]` to the three route decorators,
   copying the form used at `main.py:552`:
   - `POST /api/export` (main.py:755)
   - `POST /api/render-video` (main.py:788)
   - `POST /api/export-hyperframes` (main.py:873)
3. Sandbox `output_dir` in `/api/export` and `/api/render-video`: route the
   client-supplied value through the `resolve_output_dir()` pattern
   (`hyperframes_project.py:315`) — non-absolute or unusable dirs fall back next to the
   source media (`current_result.audio_path`). `/api/export-hyperframes` already uses it;
   verify rather than re-implement.
4. `src/renderer/src/lib/api.ts` — copy the token-header block from `put()` (272-285)
   into `post()` (262-270) so the gated endpoints keep working from the UI.
5. Update the CLAUDE.md "Local media token" bullet: the gated set now includes the three
   export/render routes, and the agent header is accepted.

### Verification checklist

- [ ] New backend tests (follow style in `backend/tests/`): 401 with no token on all three
      routes; 200-path with `X-CapForge-Local-Token`; 200-path with `X-CapForge-Agent-Token`
      (pins the MCP regression); `output_dir: "../../../tmp/evil"` lands in the fallback
      dir, not the traversal target.
- [ ] Full `pytest backend/tests` green (355+ baseline).
- [ ] `npm run typecheck` + `npm test` green.
- [ ] Grep guard: `grep -n "api/export\|api/render-video" backend/main.py` — every route
      decorator shows the dependency.
- [ ] mcp_server tests still green (`pytest mcp_server/tests`).

### Anti-pattern guards

- Do not gate `GET /api/result` or other read routes not in scope — the MCP contract
  (`response_model=None` behavior) must not change.
- Do not add the token as a query param on POSTs (headers only; query-param tokens are
  for media `<src>` loads exclusively).

---

## Phase 2 — HIGH: surface transcription errors to the user

**Agent**: implementer. Can ride the Phase 1 branch or its own `fix/progress-error-toast`.

### What to implement

`src/renderer/src/components/screens/ProgressScreen.tsx:47-49`: the `.catch` currently
`console.log`s non-"Cancelled" errors. Replace with the app's toast pattern
(`toast(message, 'error')` via `useToast`) plus whatever screen transition returns the
user to the drop zone / file screen — check how App.tsx handles the `error` progress
status from the WebSocket (`ProgressUpdate` events) and route through the same path so
the spinner never strands. Keep the "Cancelled" short-circuit.

### Verification checklist

- [ ] Vitest: a test that rejects the transcribe promise and asserts toast fired + screen
      state reset (mock the api client; follow existing component-test patterns).
- [ ] `npm run typecheck` + `npm test` green.
- [ ] Manual: kill the backend mid-transcription → toast appears, UI returns to file screen.

### Anti-pattern guard

- Don't introduce a new error UI — the toast system is the repo's error surface (CLAUDE.md).

---

## Phase 3 — Electron IPC hardening + first tests for the handlers

**Agent**: implementer. **Branch**: `fix/electron-ipc-validation`.

### What to implement

1. `electron/main.js:408-410` (`shell:showInFolder`): validate before calling
   `shell.showItemInFolder` — require a string, `path.resolve` it, and require
   `fs.existsSync` on the resolved path; return an error object (like the other
   handlers) otherwise. Style-match `fonts:read`/`fonts:delete` (main.js:575-589).
2. `electron/main.js:424-436` + `electron/hyperframes-studio.js:101-111` (`studio:open`):
   `path.resolve` the projectDir and verify it exists and is a directory before spawn.
3. Extract the two validation helpers into a small import-safe module (or an existing
   one) so they can be unit-tested without Electron, mirroring how
   `electron/claude-connect.test.js` tests pure helpers (`node --test`).

### Verification checklist

- [ ] `node --test electron/*.test.js` green, including new tests: rejects non-string,
      rejects missing path, accepts a real temp file/dir.
- [ ] Manual smoke: Export → "Reveal in Finder" still opens the folder
      (callers: `ExportFooter.tsx:82`, `HyperFramesPanel.tsx:292`).

### Anti-pattern guard

- Do not add an allowlist that breaks legitimate reveals of user-chosen output dirs —
  existence + resolution is the bar here, not containment.

---

## Phase 4 — Renderer hygiene sweep

**Agent**: implementer. **Branch**: `chore/renderer-hygiene`.

### What to implement

1. **`text-[var(…)]` sweep**: for every match of `text-\[var\(` in
   `src/renderer/src/`, replace the class with inline
   `style={{ color: 'var(--color-…)' }}` (merging into any existing `style` prop),
   exactly as CLAUDE.md's theming section prescribes. Leave `bg-[…]`, `border-[…]`,
   `ring-[…]` variants alone. Hotspots: `StudioPanel.tsx` (60+), `SettingsPanel.tsx`,
   `GroupEditor.tsx`, `App.tsx:332,344`.
2. **GroupEditor word keys** (`GroupEditor.tsx:447`): replace the index-based key with a
   stable one. Words carry `start`/`end` timings — `${group.id}-${w.start}` is stable and
   unique within a group; verify against the actual word shape before choosing.
3. Optional (LOW, only if trivial): one-line justification comments on the four
   `eslint-disable react-hooks/exhaustive-deps` suppressions
   (`AudioPlayer.tsx:165,225,231`, `useWaveSurfer.ts:112`).

### Verification checklist

- [ ] Grep guard: `grep -rn "text-\[var(" src/renderer/src/` returns 0 matches.
- [ ] `npm run typecheck` + `npm test` green.
- [ ] Visual spot-check in both themes (dark + `:root.light`) on StudioPanel, Groups
      editor, Settings — colors unchanged.

### Anti-pattern guards

- Mechanical color-value changes are forbidden — this sweep changes *how* the variable is
  applied, never *which* variable.
- Don't refactor components while passing through; sweep only.

---

## Phase 5 — Backend robustness (optional, LOW/MEDIUM)

**Agent**: implementer. Only after 1–4 land.

1. `backend/main.py:232,250`: log swallowed WS send failures at `logger.warning`
   (message + client repr), keep the disconnect handling.
2. `backend/main.py:276`: on discovery-file write failure, also push a visible signal —
   at minimum raise the log to `logger.error` with the resolved path so "MCP can't
   connect" is diagnosable from `backend.log`.
3. Global-state races (`current_result` et al.): **decision, not code** — add a short
   comment at the globals' definition documenting the single-user/loopback assumption,
   or introduce one `asyncio.Lock` around `current_result` writes if the implementer
   finds a concrete interleaving that corrupts state. Do not add per-global locks
   speculatively (YAGNI).

Verification: full pytest green; no new locks without a failing test demonstrating the race.

---

## Phase 6 — Final verification

1. `.venv-dev/bin/python -m pytest backend/tests` (all), `pytest mcp_server/tests`.
2. `npm run typecheck` && `npm test`.
3. `node --test electron/*.test.js`.
4. Golden frames untouched: `pytest backend/tests/test_render_golden.py` (no formula
   changes were in scope — a diff here means a phase overstepped).
5. Grep guards from each phase re-run.
6. Optional (env-gated): `CAPFORGE_PARITY=1 pytest backend/tests/test_caption_parity.py`.
7. Anti-pattern audit: `grep -rn "text-\[var(" src/renderer/src/`;
   `grep -n "output_dir" backend/main.py` (every use flows through the resolver);
   confirm no new auth mechanism was invented (only `require_local_token` extended).
