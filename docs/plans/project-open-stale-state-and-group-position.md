# Plan: Stale editor state on project open + per-group caption position override

Two workstreams, independently executable. Each phase is self-contained with its own
documentation references so it can run in a fresh chat context.

- **Workstream A (bug)** — opening a saved project while the results screen is already
  showing another video leaves the timeline + text editor holding the *previous* video's
  captions. Phase 1.
- **Workstream B (feature)** — right-click a caption group to set a position override
  (e.g. move that group to the top of the frame for a section where the bottom is
  occupied). Phases 2–5.

Branch suggestion: `fix/project-open-stale-state` for Phase 1 (small, shippable alone),
then `feat/group-position-override` for Phases 2–5.

---

## Phase 0 — Documentation discovery (consolidated findings)

All findings below were verified against source on 2026-07-13. Line numbers are anchors,
not gospel — re-read the cited spans before editing.

### A. The stale-state bug: exact mechanism

Open-project flow (`src/renderer/src/App.tsx:195-259`):

1. `restoreFromProjectFile()` (App.tsx:195) pushes the new transcript to the backend via
   `api.updateResult(...)`, then calls `setFilePath`, `setResult`, `setSettings`,
   `setEffects`, `setScreen('results')`, and stashes the file in `pendingRestore.current`.
2. A no-deps effect (App.tsx:254-259) flushes `projectIORef.current.restore(file)` once
   the ResultsScreen handle exists.

The asymmetry:

| Path | What happens |
|---|---|
| Fresh app → open project | `ResultsScreen` **mounts** → `useState(result.segments)` (ResultsScreen.tsx:55) and `useState(() => buildStudioGroups(result.segments, ...))` (ResultsScreen.tsx:63-65) initialize from the NEW result → correct. |
| Results screen showing video A → open project B | `ResultsScreen` is rendered with **no `key`** (App.tsx:366) → it stays mounted → `useState` initializers never re-run → `segments`/`groups` still hold video A. The groups-derivation effect (ResultsScreen.tsx:99-175) depends only on `[segments, settings.wordsPerGroup]` — neither changes — so nothing re-derives. `projectIORef.restore()` (ResultsScreen.tsx ~296-301) only calls `setGroups(file.studioGroups)` when `customGroupsEdited` is true and **never calls `setSegments`**. Result: stale captions in SubtitleEditor, GroupEditor, and the AudioPlayer timeline. |

Additional stale state that survives in the same scenario: undo/redo stack
(`useUndoRedo`, ResultsScreen.tsx:84-91), `groupsEdited`, `segmentsEdited`,
`currentTime`/`seekTarget`, `focusSegmentId`, `realigningSegId`.

The backend IS correctly updated (App.tsx:199-206), so renders/exports after an open
would use the *new* transcript while the UI shows the *old* one — worse than just a
display bug.

### B. Per-group position: current position pipeline

Global position today:

| Layer | Fields | Location |
|---|---|---|
| StudioSettings | `posX` (0–100, default 50), `posY` (10–95, default 82) | `src/renderer/src/components/studio/StudioPanel.tsx:31-105` |
| Bridge | `position_x: settings.posX / 100`, `position_y: settings.posY / 100` | `src/renderer/src/lib/render.ts:103-104` |
| Backend config | `position_x`/`position_y` floats 0–1 | `backend/models/schemas.py:162-163` (`VideoRenderConfig`) |

Position math in the three lockstep renderers (see CLAUDE.md → Preview ↔ Render Parity):

1. **Canvas**: `src/renderer/src/hooks/useSubtitleOverlay.ts:234-255` —
   `cx = resW * (posX / 100)`, `cy = resH * (posY / 100) + slideOffset`, then alignment
   shifts + text offsets.
2. **Pillow**: `backend/exporters/video_render.py:734, 777-791` —
   `center_x = config.resolution_w * position_x`,
   `center_y = config.resolution_h * config.position_y + slide_offset`.
3. **HTML/GSAP runtime**: `backend/exporters/hyperframes_caption_html.py:50-102` — config
   dict carries `"posX": config.position_x`, `"posY": config.position_y` (fractions); the
   embedded JS runtime mirrors the Canvas math.

Groups:

- Group = a `Segment` produced by `buildStudioGroups(segments, wordsPerGroup)`
  (`src/renderer/src/lib/groups.ts:21-59`). Group IDs are `${seg.id}:${offset}`.
- Render body sends `custom_groups` **only when `groupsEdited` is true**
  (`src/renderer/src/lib/render.ts:150-159`); backend shape is `CustomGroup`
  (`backend/models/schemas.py:200-205`: `text`, `start`, `end`, `words: list[dict]`).
- Project files persist `studioGroups` **only when `customGroupsEdited`**
  (`src/renderer/src/lib/project.ts:16-34`).
- The ResultsScreen groups-sync effect (ResultsScreen.tsx:99-175) has three branches
  (word-sync / rebuild-with-ID-restore / rebuild-from-scratch) and already carries
  per-word `overrides` forward — per-group data must ride the same three branches.

Per-word override precedent (the pattern to copy):

- Type: `WordOverrides` in `src/renderer/src/types/app.ts:8-31` — snake_case,
  backend-shaped keys, sparse objects.
- UI: right-click a word chip → `onContextMenu` handler
  (`src/renderer/src/components/editor/GroupEditor.tsx:424-427`) → `WordStylePopup`
  (`GroupEditor.tsx:464-473`); popup builds a sparse override object
  (`WordStylePopup.tsx:204-241` `buildOverrides()`), applies live via `onApply`.
- Backend allowlist: `_WORD_OVERRIDE_KEYS` in
  `backend/exporters/hyperframes_caption_html.py:128-134`; Pillow reads
  `w.get("overrides")` in `_draw_word_list()`; Canvas reads `w.overrides?.…`
  (useSubtitleOverlay.ts:347-348).

Tests:

- Golden frames: `backend/tests/test_render_golden.py`; regenerate with
  `.venv-dev/bin/python -m backend.tests.gen_golden` and review PNGs visually.
- Parity: `backend/tests/test_caption_parity.py` (`_config(**over)` fixture ~line 98,
  tolerances `MEAN_MAX=8.0`, `NOTABLE_FRAC_MAX=5.0`, `EXTENT_TOL_PX=3`); opt-in
  `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py`
  (needs Node 22 + ffmpeg).

### Allowed APIs (do not invent alternatives)

- React remount-to-reset: `key` prop on `ResultsScreen` (React docs: "Resetting state
  with a key"). Do NOT add a `useEffect` that mirrors `result.segments` into state —
  that's the documented anti-pattern and leaves undo/edited-flags stale.
- Bridge convention: snake_case mapping happens ONLY in `render.ts` `buildRenderBody()`
  (CLAUDE.md → Key Conventions).
- New render config fields go through the triple: StudioSettings-adjacent frontend type →
  `render.ts` → Pydantic model in `schemas.py`.
- Per-word overrides travel to the HTML runtime via the compact per-word `"o"` object —
  per-group overrides should use an analogous per-group key.

### Known anti-patterns (grep-able)

- `useEffect(() => { setSegments(result.segments) …, [result])` — state-mirroring effect.
- Sending `custom_groups` without also updating the persistence condition in
  `project.ts` (they must stay in lockstep or overrides render but don't save).
- Changing position math in ONE renderer only — all three must change in lockstep, plus
  parity/golden tests.
- GSAP ease "upgrades" (`power1` → `power2`) — forbidden per CLAUDE.md.

---

## Phase 1 — Fix: remount ResultsScreen on project identity change

### What to implement

1. In `src/renderer/src/App.tsx`:
   - Add a monotonically increasing state counter, e.g.
     `const [resultsSessionId, setResultsSessionId] = useState(0)`.
   - Increment it (`setResultsSessionId((n) => n + 1)`) in exactly two places:
     (a) inside `restoreFromProjectFile()` (App.tsx:195-216), next to `setResult(...)`;
     (b) wherever a *new transcription result* is committed (find the `setResult(`
     call site on the transcription-complete path — search `setResult(` in App.tsx).
   - Pass `key={resultsSessionId}` to `<ResultsScreen …>` at App.tsx:366.
2. That's the whole fix: the remount re-runs the `useState` initializers
   (ResultsScreen.tsx:55, 63-65) from the fresh `result` prop and resets undo stack,
   `groupsEdited`, `segmentsEdited`, playback state — making the open-from-results path
   byte-identical in behavior to the fresh-app path (which already works).
3. Verify (read, don't assume) that the `pendingRestore` flush effect (App.tsx:254-259)
   still fires after remount: child (`ResultsScreen`) effects register the
   `projectIORef` handle before the parent's effects run, which is the same ordering the
   working fresh-app path relies on. Confirm the handle registration site in
   ResultsScreen (~lines 280-330) executes on mount.
4. Optional hardening (only if trivial): in `projectIORef.restore()`
   (ResultsScreen.tsx:296-301) add a comment stating restore assumes a freshly-mounted
   instance (segments already correct from `result`), so nobody "fixes" it later by
   adding a `setSegments` mirror.

### Documentation references

- Remount pattern: React docs "Preserving and Resetting State" — key change = new
  instance. Same technique CLAUDE.md implicitly relies on for screen transitions.
- Flow to preserve: App.tsx:195-259 (restore + flush), ResultsScreen.tsx:47-95 (state
  init + handle).

### Verification checklist

- [ ] `npm run typecheck` clean.
- [ ] Existing vitest suite green (`npx vitest run` or the project's test script).
- [ ] Grep guard: `grep -n "key={resultsSessionId}" src/renderer/src/App.tsx` → 1 hit.
- [ ] Grep guard: no new `useEffect` in ResultsScreen referencing `result.segments`
      (anti-pattern): `grep -n "result.segments" src/renderer/src/components/screens/ResultsScreen.tsx`
      should show only the two `useState` initializers (lines ~55, ~63-65) and any
      pre-existing hits.
- [ ] Manual QA (the exact repro): launch app → transcribe video A → wait for results →
      File-open saved project B → timeline, text editor, AND groups view all show B's
      captions; play the video and confirm overlay shows B. Then Cmd+Z — undo stack must
      be empty (no cross-project undo).
- [ ] Manual QA regression: fresh app → open project B directly (the previously-working
      path) still works; crash-recovery restore (`handleRecover`, App.tsx:242-246) still
      works — it shares `restoreFromProjectFile`.
- [ ] Manual QA regression: transcribe A → transcribe another file C (results→dropzone→
      results path) still shows C correctly.

### Anti-pattern guards

- Do NOT sync state with a `result`-dependent effect instead of the key.
- Do NOT key on the `result` object identity or `audioPath` (two projects can point at
  the same media file; object identity is fragile under future `setResult` calls). Use
  the explicit counter.
- Do NOT touch the groups-derivation effect (ResultsScreen.tsx:99-175) in this phase.

---

## Phase 2 — Feature data model: per-group position override plumbing

### What to implement

1. **Type** (`src/renderer/src/types/app.ts`, next to `WordOverrides`):

   ```typescript
   /** Per-group caption position override — fractions of output resolution (0–1),
    *  same units as VideoRenderConfig.position_x/position_y. Sparse: absent = use
    *  the global StudioSettings position. */
   export interface GroupPositionOverride {
     position_x?: number
     position_y?: number
   }
   ```

   Add `positionOverride?: GroupPositionOverride` to the `Segment` interface (it is the
   group type; source segments simply never set it — mirror how `Word.overrides` is
   group-only per ResultsScreen.tsx:129-132 comment).

2. **Carry-forward in the groups-sync effect** (ResultsScreen.tsx:99-175): in all three
   branches, preserve `positionOverride` exactly the way per-word `overrides` are
   preserved today — branch 1 spreads `...g` (already keeps it — verify), branch 2
   restores from `oldById.get(g.id)` (add `positionOverride: saved.positionOverride`),
   branch 3 rebuilds from scratch (override intentionally lost only when wpg changes —
   acceptable, same as manual group edits today).

3. **Send condition** (`src/renderer/src/lib/render.ts:150-159`): compute
   `const hasGroupOverrides = groups.some((g) => g.positionOverride)` and send
   `custom_groups` when `groupsEdited || hasGroupOverrides` (keep the existing
   condition's other terms intact — read the actual condition first). Map per group:

   ```typescript
   position_x: g.positionOverride?.position_x,   // already 0–1 fractions
   position_y: g.positionOverride?.position_y,
   ```

4. **Backend schema** (`backend/models/schemas.py:200-205` `CustomGroup`):

   ```python
   position_x: float | None = Field(None, ge=0.0, le=1.0)
   position_y: float | None = Field(None, ge=0.0, le=1.0)
   ```

5. **Persistence** (`src/renderer/src/lib/project.ts` + the ResultsScreen
   `gather()`/`restore()` handle, ResultsScreen.tsx ~280-330): `studioGroups` must be
   saved and restored when `customGroupsEdited || groups.some((g) => g.positionOverride)`.
   Since `studioGroups` already serializes whole `Segment[]`, the new field rides along
   for free — only the *conditions* need widening (gather-side flag and restore-side
   `if`). Keep `ProjectFile` back-compat: old projects simply lack the field.

### Documentation references

- Sparse-override precedent: `types/app.ts:8-31`, `WordStylePopup.tsx:204-241`.
- Bridge convention: CLAUDE.md → Key Conventions (snake_case bridge lives in render.ts).
- Groups-sync branches: ResultsScreen.tsx:99-175 (read the whole effect before editing).

### Verification checklist

- [ ] `npm run typecheck` clean.
- [ ] Backend: `.venv-dev/bin/python -m pytest backend/tests -x -q` green (schema change
      must not break existing `CustomGroup` consumers — `words: list[dict]` callers).
- [ ] Unit test (vitest): `buildRenderBody()` includes `custom_groups` with
      `position_x/position_y` when a group has `positionOverride` and `groupsEdited` is
      false; omits the fields when no override.
- [ ] Unit test (vitest): project gather→restore round-trip preserves
      `positionOverride` (extend whatever project.ts tests exist; if none, add one for
      the round-trip helpers).
- [ ] Grep guard: `grep -rn "positionOverride" src/renderer/src/lib/project.ts src/renderer/src/lib/render.ts` — both plumbed.

### Anti-pattern guards

- Do NOT store the override in percent or px — fractions 0–1 only (matches
  `VideoRenderConfig`), converting once at the UI edge (Phase 4).
- Do NOT add the fields to `VideoRenderConfig` — they are per-group, they belong on
  `CustomGroup`.
- Do NOT introduce a second snake_case mapping site — only `render.ts`.

---

## Phase 3 — Renderer parity: honor per-group position in all three renderers

Per CLAUDE.md this is a lockstep change: Canvas, Pillow, and the HTML runtime in ONE
phase, then parity tests in Phase 5. Read CLAUDE.md → "Preview ↔ Render Parity" in full
before starting.

### What to implement

1. **Canvas** (`src/renderer/src/hooks/useSubtitleOverlay.ts:234-255`): where
   `cx`/`cy` are computed from `posX`/`posY` (percent), use the active group's override
   first:

   ```typescript
   const gpo = group.positionOverride
   const effPosX = gpo?.position_x != null ? gpo.position_x * 100 : posX
   const effPosY = gpo?.position_y != null ? gpo.position_y * 100 : posY
   ```

   Everything downstream (alignment shifts, text offsets, slide/enter animations that
   add `slideOffset` to `cy`) stays untouched — only the base center moves.

2. **Pillow** (`backend/exporters/video_render.py:734, 777-791`): in `_render_frame()`
   the active group is known when position is computed; prefer
   `group.get("position_x")` / `group.get("position_y")` (from `CustomGroup`) over
   `config.position_x` / `config.position_y`. Find the exact variable carrying the
   current group dict in `_render_frame()` — read the function top-to-bottom first; do
   not guess its name.

3. **HTML runtime** (`backend/exporters/hyperframes_caption_html.py`): the per-group
   payload entries gain an optional compact key (e.g. `"pos": [x, y]`, only when set —
   mirror how the per-word `"o"` object is emitted sparsely at lines ~137-144). In the
   embedded JS runtime, use the group's `pos` (fractions) instead of the global
   `posX`/`posY` when present, at the same point the Canvas uses it. Remember the
   CLAUDE.md contract: the runtime is a port of the Canvas math — keep the code shape
   parallel so future diffs stay reviewable.

4. **Scaffold cache**: bump `SCAFFOLD_VERSION` in
   `backend/exporters/hyperframes_project.py` — the caption runtime changed shape
   (CLAUDE.md → HyperFrames Integration: stale-shape preview otherwise).

5. **Highlight-slide note**: slide is row-local and group-local; two adjacent groups
   with different positions never lerp between positions (slide only animates within a
   group). Verify by reading the slide implementation in all three renderers — if any
   slide/crossfade path references the *previous group's* rect, it must use that group's
   own effective position.

### Documentation references

- CLAUDE.md → Preview ↔ Render Parity (the whole section is the contract).
- Position math anchors: useSubtitleOverlay.ts:234-255, video_render.py:777-791,
  hyperframes_caption_html.py:50-102 (config) + ~137-144 (sparse per-word emission
  pattern to copy for the group key).

### Verification checklist

- [ ] `npm run typecheck` clean.
- [ ] `.venv-dev/bin/python -m pytest backend/tests -x -q` green (goldens must NOT
      change — no override set means identical output; if goldens diff, the fallback
      path is broken).
- [ ] Grep guard: `grep -n "SCAFFOLD_VERSION" backend/exporters/hyperframes_project.py`
      — version bumped in this diff.
- [ ] Grep guard: all three renderers reference the override —
      `grep -ln "positionOverride" src/renderer/src/hooks/useSubtitleOverlay.ts` and
      `grep -ln "position_x" backend/exporters/video_render.py backend/exporters/hyperframes_caption_html.py`.
- [ ] Manual spot check: in-app, hand-edit a group's `positionOverride` via devtools (or
      wait for Phase 4 UI) and confirm the Canvas preview moves that group only.

### Anti-pattern guards

- Do NOT change any easing, row-gap, or box-sizing formula while in these files.
- Do NOT "fix" the documented accepted deltas (stroke joins, shadow kernel, mid-entry
  translucency) — CLAUDE.md lists them as intentional.
- Do NOT forget the `SCAFFOLD_VERSION` bump — byte-identical inputs would serve a
  stale runtime.

---

## Phase 4 — UI: right-click a group → position popup

### What to implement

1. **New component** `src/renderer/src/components/editor/GroupPositionPopup.tsx` —
   copy the structure of `WordStylePopup.tsx` (anchor rect, outside-click close, live
   `onApply`, `onReset`, sparse build). Controls, kept deliberately minimal (KISS):
   - "Custom position" toggle (off = follows global StudioPanel position),
   - X and Y sliders/number inputs shown in **percent** (UI edge converts to/from the
     stored 0–1 fractions), defaulting to the current global `posX`/`posY` when first
     enabled so enabling it doesn't jump the captions,
   - Reset button (clears `positionOverride`, group follows global again).
2. **Trigger** in `GroupEditor.tsx`: `onContextMenu` on the group container/header row
   (NOT on word chips — those already open `WordStylePopup`, GroupEditor.tsx:424-427).
   Call `e.preventDefault(); e.stopPropagation()` and open the popup anchored to the
   group row. Copy the popup-state pattern from GroupEditor.tsx:464-473.
3. **Apply handler** in GroupEditor/ResultsScreen: `pushUndo()` (the existing
   `useUndoRedo` snapshot covers `groups` state — verify it snapshots groups, then apply
   immutably: `setGroups(prev => prev.map((g, i) => i === gi ? { ...g, positionOverride } : g))`).
   Live preview comes free — Canvas reads groups state.
4. **Affordance**: add a small indicator on groups that carry an override (e.g. a
   position glyph in the group header) so users can find/reset them. Follow existing
   GroupEditor visual language; use `var(--color-*)` tokens, never hardcoded colors
   (CLAUDE.md → Theming).
5. **Discoverability for SubtitleEditor/timeline (optional, only if trivial)**: skip
   for now — Groups view is where group-level editing lives. Note as follow-up.

### Documentation references

- Popup to copy: `WordStylePopup.tsx` (whole file; esp. 81-113 local state, 178-202
  live apply, 204-241 sparse build).
- Trigger + instantiation pattern: `GroupEditor.tsx:424-427, 464-473`.
- Undo integration: ResultsScreen.tsx:84-91 (`useUndoRedo` signature) — group edits
  elsewhere in GroupEditor show the `pushUndo` call pattern; find one and copy it.
- Theming rules: CLAUDE.md → Theming (CSS vars, Tailwind `text-[var(--…)]` trap).

### Verification checklist

- [ ] `npm run typecheck` clean.
- [ ] Vitest: component test for `GroupPositionPopup` sparse-build logic (enable →
      returns fractions; disable/reset → returns undefined) — mirror however
      WordStylePopup is tested; if it isn't, test the pure build helper only.
- [ ] Manual QA: right-click group → popup opens; drag Y slider → that group's preview
      caption moves live, others don't; Cmd+Z reverts; save project, reopen (fresh app)
      → override persists; render a short clip → exported video places that group at the
      override position (exercises Pillow); co-author/HyperFrames preview honors it if
      easily testable.
- [ ] Manual QA: right-click a *word chip* still opens WordStylePopup (no regression —
      the group handler must not swallow the word handler).
- [ ] Both themes: popup readable in dark AND light (`:root.light`).

### Anti-pattern guards

- No `console.log` left behind; errors surface via `useToast`.
- No hardcoded colors (`text-white`, `#fff`) — CSS custom properties only.
- Do NOT set `groupsEdited = true` when only a position override changes — that flag
  changes group-boundary semantics in the sync effect (ResultsScreen.tsx:113-146); the
  send/persist conditions were already widened in Phase 2 instead.

---

## Phase 5 — Verification: tests, parity, and final sweep

### What to implement

1. **Golden frame**: add a case to `backend/tests/test_render_golden.py` with
   `custom_groups` where the active group carries `position_y=0.15` (top of frame).
   Regenerate goldens with `.venv-dev/bin/python -m backend.tests.gen_golden`, visually
   review the new PNG (caption at top), commit it. Existing goldens must be
   byte-identical (no-override fallback unchanged).
2. **Parity case**: add a `test_caption_parity.py` case with a per-group
   position override (copy an existing per-word-override case's shape; use `_config()`
   + a custom_groups payload with `position_x=0.5, position_y=0.15`). It must pass the
   3px extent assertion — a position bug shows up as a large extent delta immediately.
3. **Full suite + typecheck**:
   - `npm run typecheck`
   - `npx vitest run` (or project test script)
   - `.venv-dev/bin/python -m pytest backend/tests -q`
   - `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q`
     (Node 22 + ffmpeg required)
4. **Anti-pattern grep sweep**:
   - `grep -rn "useEffect" src/renderer/src/components/screens/ResultsScreen.tsx | grep -i result` — no state-mirroring effect added.
   - `grep -rn "power2" backend/exporters/hyperframes_caption_html.py` — no ease drift
     (compare against `git main` baseline; pre-existing hits are fine).
   - `grep -rn "console.log" src/renderer/src/components/editor/GroupPositionPopup.tsx` — none.
   - `git diff main --stat` — confirm no accidental edits to animation/easing formulas.
5. **Docs**: add a short bullet to CLAUDE.md → Preview ↔ Render Parity noting per-group
   `position_x/position_y` on `CustomGroup` is part of the three-renderer contract, and
   to Key Conventions if `ProjectFile` semantics changed (studioGroups persisted when
   overrides exist, not only when `customGroupsEdited`).
6. **Manual end-to-end QA** (both workstreams together): transcribe A → set a group
   position override → open saved project B → B loads clean (no stale captions, no
   leaked overrides from A) → set an override in B, save, restart app, open B → override
   intact → export video → verify placement.

### Verification checklist

- [ ] All commands in step 3 green.
- [ ] New golden PNG visually correct and reviewed before commit.
- [ ] Parity case passes including extent assertion.
- [ ] Grep sweep clean.
- [ ] CLAUDE.md updated.
- [ ] Manual E2E pass recorded in this plan file (check the boxes, note date).

---

## Design decisions log

- **Remount via `key`, not sync-effects** — resets ALL per-project editor state (undo,
  flags, playback) in one move and makes both open paths share the already-working mount
  code path. Chosen over lifting segments/groups state to App (larger refactor, no extra
  benefit here).
- **Override unit = 0–1 fractions, snake_case keys** — matches `VideoRenderConfig` and
  the per-word override precedent; converts to percent only at the popup UI edge.
- **Override lives on the group (`CustomGroup`), not per-word `pos_offset_*`** — word
  offsets are additive px nudges inside the row layout; group position replaces the
  block's base center. Different semantics, different mechanism.
- **`groupsEdited` untouched by position overrides** — the flag governs group-boundary
  preservation semantics; send/persist conditions widened independently instead.
- **Scope cut (YAGNI)**: per-group alignment/textOffset overrides, drag-to-position on
  the preview, and per-time-range (rather than per-group) positioning are explicitly out
  of scope; revisit if requested.
