# Project Improvement Plan — July 2026

Status: PLAN (locked 2026-07-18). Execute phases consecutively; each phase is self-contained and can run in a fresh context.

**Agent routing (mandatory):**
- **scout** (read-only, sonnet) — every phase's pre-flight fact gathering; never used for git writes.
- **implementer** (opus) — all code edits, test writing, and test runs.
- **git-ops** — every git mutation (branch/commit/merge/push/PR); conventional commits; never commits directly to main.
- Orchestrator keeps synthesis, phase gating, and decisions.

---

## Phase 0 — Documentation Discovery (COMPLETE)

Three parallel scouts surveyed the repo on 2026-07-18. Consolidated findings:

**Sources consulted:** `backend/main.py`, `electron/python-manager.js`, `backend/exporters/hyperframes_project.py`, `mcp_server/client.py`, all 26 docs in `docs/plans/`, `package.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `.github/workflows/ci.yml` + `parity-nightly.yml`, `git branch -vv` / `git worktree list`, `wc -l` sweeps, `npm run typecheck` (live run).

**Verified CLOSED (do not re-plan):**
- Route auth: all 6 media/export routes gated by `require_local_token` (`backend/main.py:431,447,567,770,803,888`); all 16 `/api/agent/*` routes gated by `require_agent_token`; constant-time compares.
- `output_dir` sandboxing via `resolve_output_dir` on all 3 output routes (`main.py:777,951,1207`).
- `_is_servable_path` allowlist (`main.py:335–361`) guards serve-audio/video-info; realpath + containment.
- `--no-access-log` present (`electron/python-manager.js:242`).
- `npm run typecheck` passes clean; ESLint/Prettier/vitest/CI all configured.
- Agent pins: scout=sonnet, implementer=opus, git-ops=sonnet (`~/.claude/agents/*.md:5`).

**Allowed commands (cite these exactly, do not invent scripts):**
`npm run typecheck` · `npm run test` (vitest) · `npm run lint` · `npm run build:react` · `.venv-dev/bin/python -m pytest backend/tests` · `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py` · `.venv-dev/bin/python -m backend.tests.gen_golden` · `npm run dist:mac` / `npm run release:mac`.

**Anti-patterns (global):**
- Never touch one caption renderer without the other two (`useSubtitleOverlay.ts` / `video_render.py` / `hyperframes_caption_html.py`).
- Never add a `window.subforge.*` API in only one preload (both `electron/preload.js` AND `src/preload/index.ts`).
- Never "fix" the accepted parity deltas documented in CLAUDE.md.
- Never log/persist `CAPFORGE_LOCAL_TOKEN`.
- Never use scout for git writes.

---

## Phase 1 — Repo hygiene: land finished work, prune branches

**Why first:** several implemented+tested changes exist only on local branches; everything later should build on a consolidated main.

**Pre-flight (scout):** for each branch below, confirm merge state vs main (`git log main..<branch> --oneline`) and whether a PR exists (`gh pr list --state all`). Known state (2026-07-18): main clean, 0 ahead/behind origin.

**Work (git-ops):**
1. `feat/mcp-transcript-editing-ux` — 4 phases shipped on-branch (f4bd17c…66a1461, 355 tests green). Open PR → merge to main.
2. `fix/preset-style-only` — implemented (24c10c6, 118/118 green). Merge to main.
3. `fix/project-open-stale-state` — plan doc says implemented (both workstreams incl. group `positionOverride`). Verify branch content vs main first — CLAUDE.md already documents group position overrides, so it may be merged under another name; if fully contained in main, just delete the branch.
4. PR #8 (`shareable-presets`) — CLAUDE.md documents `.cfpreset` as a shipped convention, but the plan doc says PR open. Resolve the contradiction: if merged, close/delete; if genuinely open, rebase + merge.
5. Delete fully-merged local branches (`fix/bt709-color-tagging`, `feat/fill-group-gaps`, `feat/highlight-pill-offset`, `feat/word-transition-none`, `feat/hyperframes-hardening`, `fix/overlay-premultiplied-alpha`, older feat/* once confirmed merged).

**Verification:** `git branch --no-merged main` lists only `capforge-enhanced` (active worktree fork — keep) and any branch intentionally deferred. Full backend pytest + `npm run test` + typecheck green on main after merges.

**Anti-patterns:** no squash-merging a branch without running its test suite on the merge result; do not delete `capforge-enhanced` or its worktree; confirm with the user before any push.

---

## Phase 2 — Quick wins (small, ready, low-risk)

**Work (implementer):**
1. **Diarization kwarg fix** — copy the exact change from `docs/plans/diarization-use-auth-token-fix.md` (discovery already done against installed WhisperX 3.8.6): rename `use_auth_token=` → `token=` in `backend/engine/transcriber.py`.
2. **`text-[var(` sweep** — convert all 22 remaining occurrences to inline `style={{ color: 'var(--…)' }}` per CLAUDE.md Theming rules. Exact sites: `GroupEditor.tsx:351,419,452,512,524,542,597` · `SubtitleEditor.tsx:221,235,413,547,586,596,625` · `ResultsScreen.tsx:600,701` · `SettingsPanel.tsx:303` · `GroupPositionPopup.tsx:138` · `ExportFooter.tsx:85` · `StudioPanel.tsx:332` · `ColorSwatch.tsx:92` · `StudioRow.tsx:79`.

**Verification:** `grep -rn 'text-\[var(' src/renderer/src/` returns 0 hits; `npm run typecheck && npm run lint && npm run test` green; visual spot-check both themes on the touched screens.

**Anti-patterns:** don't "modernize" surrounding styling while sweeping; don't guess other WhisperX kwargs — only the documented rename.

---

## Phase 3 — Fill-gaps bake + editable per-group end (locked plan, not started)

**Work (implementer, tdd-guide workflow):** execute `docs/plans/fill-gaps-bake-and-editable-end.md` as written — replace the `fill_gaps` toggle with a bake button + editable per-group end times. The backend already honors per-group `end`; the plan is locked, follow it rather than redesigning.

**Verification:** the plan doc's own checklist; parity suite (`CAPFORGE_PARITY=1 …`) stays green; golden frames unchanged unless the plan says otherwise; `groupsEdited` semantics preserved (bake is a boundary edit, position overrides are not).

**Anti-patterns:** don't leave both the toggle and the bake button; don't touch renderer formulas — this is data-flow/UX, not geometry.

---

## Phase 4 — Renderer test coverage (weakest area: ~23%)

Backend is strong (27 test files + parity + golden). Renderer has 30 untested components and 10 untested hooks. Target the highest-leverage pure logic first — not brittle markup tests.

**Work (implementer, tests-first):** in priority order —
1. `lib/api.ts` (521L) — request/token/URL-building logic with mocked fetch.
2. `lib/presets.ts` (444L) — serialize/deserialize round-trips (only partially covered).
3. `hooks/useSettingsUndo` + `hooks/useUndoRedo` — debounce, 50-cap, redo-stack invalidation.
4. `hooks/useSubtitleOverlay.ts` (570L) — extract pure geometry/layout helpers into a testable module and pin them (this also protects the parity contract from the TS side).
5. `hooks/useTimeline.ts` (779L) — extract pure zoom/snap/hit-test math and test it.

**Verification:** `npm run test` green; new tests follow AAA pattern; coverage on the touched `lib/` + extracted helper modules ≥80%. Do NOT chase 80% across visual components — golden/parity suites carry that signal (per web testing rules).

**Anti-patterns:** no snapshot tests of JSX trees; no fake-timer flakiness; extraction refactors must be behavior-preserving (typecheck + existing tests before/after).

---

## Phase 5 — Size hotspot refactors (guarded)

Two files exceed the 800-line ceiling meaningfully: `backend/exporters/video_render.py` (1626L) and `src/renderer/src/components/studio/StudioPanel.tsx` (1042L).

**Work (implementer):**
1. `StudioPanel.tsx` — split into section components (typography / colors / animation / layout rows) keeping `StudioSettings` flat and passed as props (convention: never fragment the settings object).
2. `video_render.py` — extract non-`_render_frame` concerns (ffmpeg mux/encode arg-building, BT.709 tag helpers, overlay branches) into sibling modules. **`_render_frame()` moves untouched or not at all** — it's the parity source of truth.

**Verification:** golden-frame suite byte-identical (no regeneration allowed in this phase); parity suite green; `test_overlay_alpha.py` green; typecheck + vitest green.

**Anti-patterns:** no formula "cleanups" during extraction; no renaming render-config keys (snake_case bridge in `lib/render.ts` must not change); if a golden diff appears, the refactor is wrong — revert, don't regenerate.

---

## Phase 6 — Release + manual QA batch

**Work (orchestrator + user):**
1. Rebuild + notarize the Mac DMG (`npm run release:mac`, Apple creds in `.env.local`) so shipped fixes since the last DMG (BT.709 tagging, premultiplied alpha, word-timing UX, etc.) reach users.
2. One consolidated manual in-app QA pass covering the accumulated pending items: fill-gaps stretch, word-transition "none", highlight pill offset, group position overrides, builtin presets visual check, error-toast paths, co-author approval gate, Mac HyperFrames flow, and (after Phase 3) the bake button.
3. Record outcomes back into the respective plan docs / memory so the "open: manual QA" tail is finally cleared.

**Verification:** QA checklist doc committed with pass/fail per item; any failure becomes a scoped follow-up plan, not an inline fix.

---

## Phase 7 — Final verification

1. `npm run typecheck && npm run lint && npm run test` — green.
2. `.venv-dev/bin/python -m pytest backend/tests` — green (~355+ tests).
3. `CAPFORGE_PARITY=1` parity suite — green at pinned CLI 0.7.21.
4. Anti-pattern greps: `grep -rn 'text-\[var(' src/renderer/src/` → 0; `grep -rn 'use_auth_token' backend/` → 0; no new file >800 lines (`wc -l` sweep).
5. `git branch --no-merged main` → only intentional branches remain.
6. CI green on main; parity-nightly still advisory (never required).

---

## Deferred (needs a user decision, not scheduled)

- **Node 22 bundling** (`docs/plans/node-bundling.md`) — R1 blocker for fully in-app HyperFrames rendering; large, packaging-heavy. Decide whether it precedes the next release.
- **E2E framework** — no Playwright wired; per web testing rules an E2E layer is expected eventually. Decide scope (smoke-only vs flows) before adding the dependency.
- **`capforge-enhanced` worktree** — active throwaway-friendly fork; explicitly out of scope for this plan.
- **`src/main/index.ts` TODO** (TS port of `electron/main.js`) — cosmetic; fold into a future Electron-TS migration if ever.
