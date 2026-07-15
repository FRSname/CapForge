# Plan: "Fill gaps" bake button + editable per-group end time

## Goal (user's words)

> "I imagined a button which will actually set the groups to be that long to fill
> those gaps … so if that button makes those groups specifically long (stretch till
> next group), then I can manually pick places where I want to hide them (e.g. a long
> stretch of video with no voice-over where I want subtitles to disappear)."

Replace the current live **"Fill gaps" toggle** (preview-only, all-or-nothing) with:

1. A **"Fill gaps" button** that *bakes* the stretch into the real, editable group
   data (`group.end` → next group's `start`) in one shot.
2. **Editable per-group end times** so the user can then pull specific groups back
   to create deliberate caption gaps (silence with no subtitle).

### Decisions locked in (from the user)

- **Replace the toggle**, don't keep it. "Fill gaps" becomes a one-shot button, not a
  live preview flag.
- **Editable end time** (numeric inline edit) is the per-group hide mechanism. Timeline
  drag is a *stretch goal* (Phase 4), deferred — the numeric field fully satisfies the need.

### Why this is low-risk

The backend **already honors per-group `end` verbatim** whenever `custom_groups` is
sent (`render.ts:158`, gated by `groupsEdited`), and all three parity-locked renderers
read group `start`/`end`. So "baking" and "editable end" need **zero new data model** —
they are just writes to `group.end` on the existing editing state, with `groupsEdited=true`.

---

## Phase 0 — Documentation Discovery (consolidated findings)

All facts below were verified by reading the files. Treat this as the "Allowed APIs" list.

### The pure stretch function (REUSE — do not rewrite)

`src/renderer/src/lib/groups.ts:77-87`

```ts
export function fillGroupGaps(groups: Segment[]): Segment[] {
  if (groups.length === 0) return []
  return groups.map((group, i) => {
    const next = groups[i + 1]
    if (next && next.start > group.end) {
      return { ...group, end: next.start }   // stretch end to next group's start
    }
    return { ...group }
  })
}
```

Immutable, idempotent, last group unchanged. **Keep this function and its tests
(`groups.test.ts`)** — the bake button reuses it.

### Group data model

`src/renderer/src/types/app.ts:66-76` — a group is a `Segment`:

```ts
export interface Segment {
  id: string
  start: number      // = first word.start
  end: number        // = last word.end (DERIVED), but can be overwritten
  text: string
  words: Word[]
  speaker?: string
  positionOverride?: GroupPositionOverride
}
```

**Natural end** of a group = its last word's `end`. **Held end** = next group's `start`.
The editable range for group `i` is therefore `[naturalEnd, nextStart]`:
pull to `naturalEnd` → maximal gap; push to `nextStart` → fully held (no gap).

### Editing state ownership (CRITICAL for wiring)

There are **two** `groups` states:

- `ResultsScreen` owns the **editing** copy + all edit handlers. This is where GroupEditor
  edits flow and where re-grouping preserves boundaries by group ID.
  - `handleGroupsChange` (`ResultsScreen.tsx:208-211`): `setGroups(next); setGroupsEdited(true)` — the boundary-edit path.
  - `handleGroupsPositionChange` (`:217-219`): sets groups **without** flipping `groupsEdited` (position-only).
  - `pushUndo` — the `onBeforeEdit` snapshot callback passed to GroupEditor (`:627`).
- `App.tsx:30-31` owns a **published** copy (`groups`/`groupsEdited`) forwarded to
  StudioPanel for render/export and mirrored to the backend. ResultsScreen publishes to it
  via `onGroupsUpdate` (`ResultsScreen.tsx:202-204`).

> **Anti-pattern guard:** The bake button and the end-edit MUST go through
> `handleGroupsChange` (flips `groupsEdited=true`) — NOT `handleGroupsPositionChange`,
> and NOT StudioPanel's read-only forwarded `groups`. Routing through the position path
> would fail to persist the ends in `custom_groups` and they'd be silently lost on re-group.

### Current toggle call-sites to remove/repoint (frontend)

| File:line | What it is | Action |
|---|---|---|
| `components/studio/StudioPanel.tsx:62` | `fillGaps: boolean` in StudioSettings | remove |
| `components/studio/StudioPanel.tsx:155` | `fillGaps: false` in DEFAULTS | remove |
| `components/studio/StudioPanel.tsx:528-546` | "Fill gaps" toggle Row | remove |
| `lib/render.ts:100` | `fill_gaps: settings.fillGaps ?? false` | remove (also drop `fill_gaps` from `RenderBody` if present) |
| `lib/render.test.ts:42` | `fill_gaps: false` in default-config expectation | remove that key |
| `lib/presets.ts:88` | `fillGaps?: boolean` in preset DTO | remove |
| `lib/presets.ts:177` | preset import of `fillGaps` | remove |
| `lib/presets.ts:251` | preset export of `fillGaps` | remove |
| `lib/presets.test.ts:65` | `'fillGaps'` in ROUND_TRIP_KEYS | remove |
| `lib/presets.test.ts:133` | `fillGaps: true` fixture | remove |
| `lib/settingsSearch.ts:49` | `'fillGaps'` in `layout` list | remove |
| `components/screens/ResultsScreen.tsx:70-71` | `displayGroups` memo applying `fillGroupGaps` when toggle on | replace: pass raw `groups` (see Phase 1) |

Keep the `fillGroupGaps` import at `ResultsScreen.tsx:16` — the bake handler uses it.

### Groups-view toolbar (button home)

`ResultsScreen.tsx:576-602` — a `role="tablist"` bar with Text/Groups tabs and an
`ml-auto` group-count span (`:597-601`). The "Fill gaps" button goes here, shown only
when `view === 'groups'`.

### GroupEditor structure (for editable end)

`components/editor/GroupEditor.tsx`:
- Props: `groups`, `onChange`, `onPositionChange`, `onBeforeEdit`, `currentTime`, `onSeek`, `defaults`, `positionDefaults` (`:22-38`).
- Existing **inline-edit precedent** to copy: speaker editing (`editingSpeakerIdx`/`speakerDraft` state at `:68-70`; the `<input>` with commit-on-blur/Enter/Escape at `:402-422`; `commitSpeakerEdit` at `:135-143`). The end-time editor mirrors this exactly.
- The time display to modify: `:371-381` — a single seek button rendering
  `{formatTime(group.start)}→{formatTime(group.end)}`. Split into: start seeks (unchanged),
  end becomes click-to-edit.
- `formatTime` helper: `:557-561` (`m:ss.s`). Need an inverse `parseTime`.

### Backend fill_gaps (dead after toggle removal) — Phase 3

| File:line | What |
|---|---|
| `backend/models/schemas.py:157` | `fill_gaps: bool = Field(False, …)` |
| `backend/exporters/video_render.py:298-318` | `fill_group_gaps()` Python fn |
| `backend/exporters/video_render.py:1241-1242` | applies it when `config.fill_gaps` |
| `backend/exporters/frame_qa.py:22, 51-52` | import + apply |
| `backend/exporters/hyperframes_project.py:35, 736-737, 776-777, 859-860` | import + 3 apply sites |
| `backend/tests/test_fill_group_gaps.py` | unit tests for the Python fn |
| `backend/tests/test_caption_parity.py:361-388` | `test_fill_gaps_parity` (renders with `fill_gaps` flag) |
| `backend/tests/test_caption_cfg_contract.py:118-119` | `fill_gaps` doc entry |

> Note: the backend Python `fill_group_gaps` is only reached via the config flag. Baking
> happens client-side, so once the frontend stops sending `fill_gaps=true`, this is dead code.

---

## Phase 1 — Replace the toggle with a "Fill gaps" bake button

**What to implement (frontend only):**

1. **Bake handler in ResultsScreen.** Add next to `handleGroupsChange`:

   ```ts
   // Bake the gap-fill stretch into the editable groups: each group's end is
   // extended to the next group's start (fillGroupGaps). One-shot + undoable.
   const handleFillGaps = useCallback(() => {
     pushUndo()
     handleGroupsChange(fillGroupGaps(groups))
   }, [groups, handleGroupsChange, pushUndo])
   ```

   `handleGroupsChange` already flips `groupsEdited=true`; `pushUndo` gives Cmd+Z.

2. **Button in the Groups-view toolbar** (`ResultsScreen.tsx:576-602`), before or after
   the `ml-auto` count span, rendered only when `view === 'groups'`. Match the existing
   `text-2xs` button styling used elsewhere in GroupEditor (e.g. the merge button
   `GroupEditor.tsx:305-312`). Give it a `title` explaining it stretches every caption to
   the next group's start, and that you can then shorten individual groups to create gaps.
   Disable it when `groups.length < 2` (nothing to fill).

3. **Remove the preview memo.** `ResultsScreen.tsx:70-71`: delete the `displayGroups`
   `useMemo` (and its `settings.fillGaps` dependency). Pass `groups` directly to
   `AudioPlayer`'s `overlaySegments` (`:646`). Baked/edited ends now show in the preview
   automatically because they live in `groups`.

4. **Strip the toggle machinery** — apply every "remove" row in the Phase 0 table
   (StudioPanel field/default/Row, render.ts bridge + `RenderBody` key, presets ×3,
   presets.test ×2, render.test ×1, settingsSearch ×1).

**Documentation references:** bake handler mirrors the `handleGroupsChange` pattern
(`ResultsScreen.tsx:208-211`); button styling copies `GroupEditor.tsx:305-312`; toolbar
insertion point `ResultsScreen.tsx:597-601`.

**Verification checklist:**
- [ ] `npm run typecheck` clean.
- [ ] `grep -rn "fillGaps" src/renderer/src` returns **zero** hits (fully removed).
- [ ] `grep -rn "fillGroupGaps" src/renderer/src` shows it imported/used only by the bake handler + still exported from `groups.ts` + `groups.test.ts`.
- [ ] Frontend tests: `render.test.ts` and `presets.test.ts` pass with the removed keys.
- [ ] Manual: click "Fill gaps" in Groups view → every group's `end` in the row list jumps to the next group's start; Cmd+Z reverts.

**Anti-pattern guards:**
- Do NOT leave `fill_gaps` in the render body "just in case" — remove it; the test at `render.test.ts:42` will otherwise fail or drift.
- Do NOT put the button in StudioPanel (it only has the read-only forwarded `groups`).
- Do NOT delete `fillGroupGaps` from `groups.ts` — the button depends on it.

---

## Phase 2 — Editable per-group end time in GroupEditor

**What to implement (copy the speaker-inline-edit pattern):**

1. **Local edit state** (mirror `editingSpeakerIdx`/`speakerDraft` at `GroupEditor.tsx:68-70`):
   ```ts
   const [editingEndIdx, setEditingEndIdx] = useState<number | null>(null)
   const [endDraft, setEndDraft] = useState('')
   ```

2. **Helpers** (module scope, next to `formatTime` at `:557`):
   ```ts
   // Inverse of formatTime — "m:ss.s" → seconds. Returns null if unparseable.
   function parseTime(s: string): number | null {
     const m = s.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/)
     if (!m) return null
     const mins = m[1] ? parseInt(m[1], 10) : 0
     return mins * 60 + parseFloat(m[2])
   }
   ```
   And in-component, a natural-end helper:
   ```ts
   const naturalEnd = (g: Segment) =>
     g.words.length ? Math.max(...g.words.map((w) => w.end)) : g.end
   ```

3. **Clamp range.** For group index `gi`:
   - `min = naturalEnd(groups[gi])`
   - `max = groups[gi + 1] ? groups[gi + 1].start : (mediaDuration ?? groups[gi].end)`
   - If `max <= min` (overlapping/degenerate) → the end is not editable; render it read-only.
   - Commit: `const clamped = Math.min(max, Math.max(min, parsed))`.

4. **Commit handler** (route through `onChange` so `groupsEdited` flips — this is the
   whole point):
   ```ts
   const commitEndEdit = useCallback((gi: number) => {
     const parsed = parseTime(endDraft)
     setEditingEndIdx(null)
     if (parsed == null) return
     const g = groups[gi]
     const min = naturalEnd(g)
     const max = groups[gi + 1] ? groups[gi + 1].start : (mediaDuration ?? g.end)
     if (max <= min) return
     const end = Math.min(max, Math.max(min, parsed))
     if (end === g.end) return
     onBeforeEdit?.()
     onChange(groups.map((x, i) => (i === gi ? { ...x, end } : x)))
   }, [groups, endDraft, onChange, onBeforeEdit, mediaDuration])
   ```

5. **Row UI.** At `:371-381`, keep the start as the seek button, and make the end
   click-to-edit: clicking the end time opens an `<input>` (copy the speaker `<input>` at
   `:402-422`: `autoFocus`, commit on blur/Enter, cancel on Escape, `stopPropagation` on
   click). Seed `endDraft` with `formatTime(group.end)`. Optionally show a subtle marker
   (e.g. accent-colored dot) when `group.end !== naturalEnd(group)` so "held/extended"
   groups are visible at a glance.

6. **New prop:** add `mediaDuration?: number` to `GroupEditorProps` so the **last** group
   can be extended to the end of the media (otherwise the last caption can't be held).
   Pass it from ResultsScreen (`result.duration` or `sourceVideoInfo` duration — pick the
   one already available in that scope).

**Documentation references:** speaker inline edit is the exact template —
state `:68-70`, input `:402-422`, commit `:135-143`; `formatTime` at `:557-561`.

**Verification checklist:**
- [ ] `npm run typecheck` clean.
- [ ] Click a group's end time → input appears seeded with current end; type `0:06.5`, Enter → end updates, row shows new `→0:06.5`, `groupsEdited` flips (verify a subsequent render sends `custom_groups`).
- [ ] Typing a value above the next group's start clamps to next start; below natural end clamps to natural end; garbage input is ignored (no change).
- [ ] Escape cancels without changing the group.
- [ ] Cmd+Z reverts an end edit.
- [ ] After baking (Phase 1) then pulling one group's end back to its natural end, the preview shows that caption disappearing during the gap while neighbors persist.

**Anti-pattern guards:**
- Route through `onChange` (→ `handleGroupsChange` → `groupsEdited=true`), NEVER `onPositionChange`.
- Immutable `.map` — never mutate `group.end` in place.
- Always clamp; never allow `end <= start` or overlap past the next group.

---

## Phase 3 — Remove the dead backend `fill_gaps` flag (recommended, independently skippable)

Once Phase 1 lands, the frontend never sends `fill_gaps=true`, so the backend flag +
Python `fill_group_gaps` are dead. Remove them for a clean tree (the repo's own
no-dead-code rule), but this phase is self-contained and can be deferred without affecting
the feature (the field would just sit inert at its `False` default).

**What to implement:**
- Delete the `fill_gaps` field (`schemas.py:157`).
- Delete `fill_group_gaps()` and its call site (`video_render.py:298-318`, `:1241-1242`).
- Remove import + use in `frame_qa.py:22, 51-52`.
- Remove import + the 3 apply sites in `hyperframes_project.py:35, 736-737, 776-777, 859-860`.
- Delete `backend/tests/test_fill_group_gaps.py`.
- Remove the `fill_gaps` doc entry in `test_caption_cfg_contract.py:118-119`.
- **Repoint** `test_caption_parity.py::test_fill_gaps_parity` (`:361-388`): instead of
  setting the `fill_gaps` config flag, pass `custom_groups` with an **extended `end`**
  (a two-group fixture where group 0's end reaches group 1's start) and keep the existing
  "render at t inside the former gap, assert Pillow≈HyperFrames" assertion. This preserves
  the valuable coverage that a *baked* stretched end renders identically across renderers.
- `grep -rn "fill_gaps\|fill_group_gaps" backend CLAUDE.md docs` → confirm nothing stale
  remains (update CLAUDE.md if it references the flag).

**Verification checklist:**
- [ ] `.venv-dev/bin/python -m pytest backend/tests` green.
- [ ] Golden frames still pass (`test_render_golden.py`) — unchanged, `fill_gaps` was off in goldens.
- [ ] `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py` green, including the repointed `test_fill_gaps_parity`.
- [ ] No `fill_gaps` references remain anywhere.

**Anti-pattern guard:** Don't just delete `test_fill_gaps_parity` — rewrite it against
`custom_groups`. The cross-renderer "caption persists through a gap" invariant is exactly
what this feature now relies on.

---

## Phase 4 — Timeline drag handle for group end (OPTIONAL / stretch goal)

Deferred. The numeric field (Phase 2) already satisfies the user's need. Timeline drag is
non-trivial because `useTimeline.ts` consumes **raw `segments`, not groups** (verified: it
reads `segments` at ~line 201), so it currently has no notion of group boundaries. Adding a
draggable group-end handle would require the timeline to render group extents and map a drag
back to `group.end` with the same `[naturalEnd, nextStart]` clamp as Phase 2.

If pursued later: investigate the existing word-lane drag/snapping added in the
word-timing-UX work as the interaction template, and reuse the Phase 2 clamp + commit logic
(`onChange` → `groupsEdited`). Do **not** start this before Phase 2 ships and is validated.

---

## Phase 5 — Final Verification

1. `npm run typecheck` clean.
2. `grep -rn "fillGaps" src/renderer/src` → zero. `grep -rn "fill_gaps\|fill_group_gaps" backend` → zero (if Phase 3 done).
3. Frontend tests green (`render.test.ts`, `presets.test.ts`, `groups.test.ts`).
4. `.venv-dev/bin/python -m pytest backend/tests` green; golden 7·7; parity 20/20 (or the repointed count) with `CAPFORGE_PARITY=1`.
5. **Manual in-app QA (three-renderer parity is the whole point):**
   - Transcribe/open a clip with a real silent gap between two spoken sections.
   - In Groups view: click **Fill gaps** → captions now persist through the gap in the live preview.
   - Edit the gap-preceding group's end down to its natural end → caption disappears during the silence; neighbors unaffected.
   - Export the classic video (Pillow) and a HyperFrames render → confirm both match the preview (caption timing during the gap identical).
   - Save the project, reopen → baked/edited ends persist (they ride `studioGroups`; `groupsEdited=true` keeps `custom_groups` flowing).
   - Cmd+Z reverts both the bake and individual end edits.

---

## Known behaviors (document, don't "fix")

- **Changing Words/Grp after baking** re-derives groups from segments and resets
  `groupsEdited=false` (`ResultsScreen.tsx:197`), discarding baked/edited ends — same
  tradeoff as any manual group boundary edit. Expected.
- **Presets don't carry group ends.** Presets are style-only; baked/edited ends are project
  data (persist with the project, not with presets). Intentional — no change.
- The last group has no "next start"; its end is editable only up to `mediaDuration`
  (Phase 2), matching `fillGroupGaps` leaving the last group unchanged.
