# Timeline Inline Editing — Double-Click Word & Group Popups

**Goal:** Edit directly from the canvas timeline. Double-click a **word** in the timeline word lane → popup with text correction + all per-word style overrides (color, size, transition, etc.). Double-click a **group** block → popup to change that group's position override (position_x/position_y).

**Strategy:** Reuse the existing popups (`WordStylePopup`, `GroupPositionPopup`) and the existing apply paths. The only genuinely new pieces are (1) double-click detection + hit→identity mapping in `useTimeline`, (2) a text-correction field added to `WordStylePopup` (optional prop, existing call sites unaffected), and (3) popup state + apply handlers in `ResultsScreen`.

Each phase is self-contained and executable in a fresh context. Verified facts below carry exact file:line references — **read the cited lines before coding; do not invent APIs.**

---

## Phase 0 — Documentation Discovery (COMPLETE — consolidated findings)

### Architecture facts (verified 2026-07-20)

**The timeline draws GROUPS, not raw segments.** `ResultsScreen.tsx:678` passes `segments={groups}` to `AudioPlayer`. Every "segment" inside `useTimeline` is a derived group (`Segment` type) with a stable-ish id `${seg.id}:${i}` from `buildStudioGroups` (`lib/groups.ts:21–59`). Map a timeline hit to a group index via `groups.findIndex(g => g.id === segId)`.

**State owner is ResultsScreen**, not AudioPlayer:
- `groups` state + `groupsEdited` flag: `ResultsScreen.tsx:70`
- `handleGroupsPositionChange` (`ResultsScreen.tsx:222`) — position-only group updates; **must NOT flip `groupsEdited`** (comment at line 219)
- `handleWordEdge` (`ResultsScreen.tsx:449`) — existing timeline→groups word-timing update; the pattern to copy for word override/text updates from the timeline
- `wordStyleDefaults` memo (`ResultsScreen.tsx:547`) — already built for GroupEditor, reuse as-is
- Undo snapshot hook: GroupEditor calls `onBeforeEdit?.()` before mutations — find ResultsScreen's equivalent near the handlers above and call it the same way

### Allowed APIs (exact, verified)

**`useTimeline` hook** (`src/renderer/src/hooks/useTimeline.ts`):
- `findEdge(clientX): { segId; edge: 'start'|'end'|'body' } | null` — lines 402–419 (group hit-test)
- `findWordHit(clientX, clientY): { wordIdx; edge } | null` — lines 432–456 (word hit-test; only valid when `selectedSegId` set and Y in word lane)
- `isInWordLane(clientY)` — lines 421–428; word lane occupies `TOTAL_H..TOTAL_H+WORD_TRACK_H` (`WORD_TRACK_H = 24`, line 27)
- Click-vs-drag: `movedRef` + `CLICK_SLOP_PX = 2` (line 31); mouseUp logic lines 658–678 (no-drag click → `onSeek` / selection toggle)
- Native listener pattern with cleanup: wheel handler lines 691–720
- Constants: `EDGE_HIT = 6` (line 28), `TOTAL_H = 52`, expanded height 76 (`AudioPlayer.tsx:34,317`)

**`lib/timelineMath.ts`**: `timeToPixel(t, t0, pps)` (37–39), `clientXToTime(...)` (42–51), `computePixelsPerSecond(widthPx, visibleDur)` (32–34) — use these for computing a word/group's on-screen rect; do not re-derive the math.

**`WordStylePopup`** (`src/renderer/src/components/editor/WordStylePopup.tsx:42–50`):
```ts
{ word, overrides: WordOverrides, anchorRect: DOMRect, defaults: WordStyleDefaults,
  onApply(overrides), onReset(), onClose() }
```
Fixed-position, viewport-clamped, Escape/outside-click close built in. Reusable from anywhere that can supply a `DOMRect`. **Currently style-only — no text editing** (gap addressed in Phase 2).

**`GroupPositionPopup`** (`src/renderer/src/components/editor/GroupPositionPopup.tsx:40–159`):
```ts
{ groupLabel, override: GroupPositionOverride, anchorRect: DOMRect,
  defaults: GroupPositionDefaults, onApply(override), onReset(), onClose() }
```
Two percent sliders, live-apply, sparse `buildOverride()` (98–105) that omits axes equal to global defaults. Reusable as-is — no extraction needed.

**Apply patterns to COPY (not reinvent):**
- Word override apply: `GroupEditor.tsx:200–218` (`applyWordOverride`) — sparse storage: `overrides: Object.keys(o).length ? o : undefined`
- Position apply: `GroupEditor.tsx:238–250` (`applyPositionOverride`) — routes through `onPositionChange`, **never** `onChange`
- Word text edit preserving timing+overrides: `SubtitleEditor.tsx:196–209` (`{ ...seg.words[i], word }` spread)
- Right-click→popup open pattern: `GroupEditor.tsx:191–198` / `230–236` (`anchorRect: el.getBoundingClientRect()`)

**Data model** (`src/renderer/src/types/app.ts`): `WordOverrides` (8–33), `Word.overrides?` (57–63), `GroupPositionOverride` (51–54), `Segment.positionOverride?` (75).

**Downstream consumers (already handle everything — no changes needed):** `lib/render.ts:151–169` sends `custom_groups` with word overrides + sparse `position_x/y` whenever `groupsEdited || hasGroupOverrides`; `useSubtitleOverlay.ts:172–178, 201–205` applies both in the preview.

### Anti-pattern guards (things that do NOT exist / must not be done)

- ❌ No `onWordDoubleClick`/`onGroupDoubleClick` exist yet in `UseTimelineOptions` — you are adding them; don't assume other names.
- ❌ There is no group-position or word-style plumbing through `AudioPlayer` today — all popup/apply logic must be threaded as new props.
- ❌ **Never call `onChange`/flip `groupsEdited` for a position-only change** — it must go through `handleGroupsPositionChange` (`ResultsScreen.tsx:219–222` comment explains why: re-grouping must keep working).
- ❌ Don't hardcode colors — CSS vars only (`--color-*`), per CLAUDE.md theming rules.
- ❌ Don't add a React `onWheel` — irrelevant here, but if any new native listener is needed, follow the wheel-handler cleanup pattern (`useTimeline.ts:691–720`).
- ❌ Word identity is positional (`groupIdx` + `wordIdx`), not id-based. Close any open popup when `groups` array identity/length changes to avoid stale-index writes.

### Open decisions (defaults chosen; flag to user if changing)

1. **Word text correction scope:** applied to the group's word only (GroupEditor precedent) — **flips `groupsEdited`** via the normal `onChange` path, exactly like GroupEditor text edits. It does NOT mirror into source `segments`.
2. **Double-click vs selection interplay:** a group double-click *re-selects* the group (first click of the pair may have toggled selection at `useTimeline.ts:658–678`) and then opens the popup — the popup must never open on a deselected group.
3. **Popup render location:** `ResultsScreen` (owns state + defaults). Both popups are `position: fixed`, so tree location is irrelevant.

---

## Phase 1 — Double-click detection in `useTimeline` + AudioPlayer plumbing

**Files:** `src/renderer/src/hooks/useTimeline.ts`, `src/renderer/src/components/player/AudioPlayer.tsx`

### Implement

1. Add to `UseTimelineOptions` (interface near `useTimeline.ts:48`):
   ```ts
   /** Double-click on a word in the open word lane. rect = word's on-screen box (viewport coords). */
   onWordDoubleClick?: (segId: string, wordIdx: number, rect: DOMRect) => void
   /** Double-click on a group block in the segment track. rect = group's on-screen box (viewport coords). */
   onGroupDoubleClick?: (segId: string, rect: DOMRect) => void
   ```
2. Add an `onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>)` handler returned by the hook (same shape as existing `onMouseDown`, lines 458–501):
   - Ignore if a drag is in flight (`dragRef`/`wordDragRef` non-null) or `movedRef` is set.
   - Word first (mirrors mouseDown priority, line 463): if `findWordHit(e.clientX, e.clientY)` returns a `body` hit → compute the word's viewport rect and call `onWordDoubleClick(selectedSegId, wordIdx, rect)`.
   - Else if `findEdge(e.clientX)` returns a `body` hit → compute the group's viewport rect and call `onGroupDoubleClick(segId, rect)`.
   - Edge hits (`'start'|'end'`) do nothing — edges are drag affordances.
   - Rect construction: `canvas.getBoundingClientRect()` + `timeToPixel()` for start/end x, lane Y bands (ruler `RULER_H`..`TOTAL_H` for groups, `TOTAL_H`..`TOTAL_H+WORD_TRACK_H` for words) → `new DOMRect(x, y, w, h)`. Reuse `computePixelsPerSecond` — copy the conversion setup already used inside `findEdge` (402–419), do not re-derive.
3. Wire in `AudioPlayer.tsx`:
   - New props `onWordDoubleClick` / `onGroupDoubleClick` on `AudioPlayerProps`, passed into the `useTimeline` call (194–219).
   - Attach the returned handler to the canvas as React `onDoubleClick` next to the existing handlers (429–439).
   - **Selection guard (Open decision #2):** in the group double-click path, call `setSelectedGroupId(segId)` before forwarding, so the pair's first-click toggle can't leave the popup targeting a deselected group. Read `useTimeline.ts:658–678` first to confirm exactly when the toggle fires and note the finding in the commit message.

### Verify

- [ ] `npm run typecheck` clean.
- [ ] Add unit tests beside the existing timeline tests (`git grep -l timelineMath src/renderer` to locate the test file/pattern) for the rect computation (time↔pixel round-trip for a known zoom/scroll).
- [ ] Grep guard: `grep -n "onDoubleClick" src/renderer/src/hooks/useTimeline.ts src/renderer/src/components/player/AudioPlayer.tsx` shows hook + canvas wiring.
- [ ] Manual: `npm run dev:react` — double-click logs (temporary `console.log` removed before commit) fire with correct segId/wordIdx; drag still works; click-to-seek still works; wheel zoom/pan unaffected.

### Anti-pattern guards

- Do not open popups from inside the hook — the hook only reports hits (keeps it renderer-agnostic like every other callback it has).
- Do not break the `movedRef`/`CLICK_SLOP_PX` click-vs-drag logic; double-click handling must be additive.

---

## Phase 2 — Word popup: text correction + style overrides

**Files:** `src/renderer/src/components/editor/WordStylePopup.tsx`, `src/renderer/src/components/screens/ResultsScreen.tsx`

### Implement

1. **Extend `WordStylePopup` with optional text editing** (existing call site in GroupEditor must keep compiling without changes):
   ```ts
   /** When set, shows an editable text field for the word; called on commit (Enter/blur). */
   onTextCommit?: (newText: string) => void
   ```
   Render a text input at the top of the popup (above the style controls) only when `onTextCommit` is provided. Trim; ignore empty commits. Follow the popup's existing input styling (CSS vars, see its color/size rows) — no hardcoded colors.
2. **ResultsScreen popup state + handlers:**
   - State: `const [wordPopup, setWordPopup] = useState<{ groupIdx: number; wordIdx: number; anchorRect: DOMRect } | null>(null)`
   - `onWordDoubleClick(segId, wordIdx, rect)` (passed to `<AudioPlayer>` at ~line 675): resolve `groupIdx = groups.findIndex(g => g.id === segId)`; bail if `-1`; set state.
   - Apply override: copy `applyWordOverride` from `GroupEditor.tsx:200–218` verbatim, adapted to ResultsScreen's `groups`/`setGroups` + undo-snapshot call — route through the same path `handleWordEdge` (449) uses so `groupsEdited` semantics match word-timing edits. **Read `handleWordEdge` first and mirror its update mechanics exactly.**
   - Text commit: copy the word-spread pattern from `SubtitleEditor.tsx:196–209` — update `groups[gi].words[wi].word` via `{ ...w, word: newText }` AND rebuild the group's `text` by joining word strings; flows through the same `onChange`-equivalent path (flips `groupsEdited`, Open decision #1).
   - Reset: apply `{}` (the sparse-storage line converts it to `undefined`).
   - Close on: popup `onClose`, and a `useEffect` clearing `wordPopup` whenever `groups.length` changes or the target index vanishes (stale-index guard from Phase 0).
   - Render `<WordStylePopup>` at ResultsScreen root, fed by the existing `wordStyleDefaults` memo (547).
3. Live preview works for free: `onApply` mutates `groups` → `useSubtitleOverlay` re-renders (`useSubtitleOverlay.ts:172–178`).

### Verify

- [ ] `npm run typecheck` clean; frontend test suite green (same command CI uses — check `.github/workflows` / `package.json` `test` script).
- [ ] GroupEditor's existing WordStylePopup usage unchanged: `grep -n "WordStylePopup" src/renderer/src -r` — GroupEditor call site has no new required props.
- [ ] Manual: double-click word in timeline lane → popup at word; change color → preview updates live; correct text → word text updates in timeline + preview + Groups editor; Reset clears; Escape/outside-click closes; Cmd+Z undoes.
- [ ] Render path: after an override, `buildRenderBody` output contains the override inside `custom_groups` words (assert via existing render.ts tests pattern — `git grep -l buildRenderBody src/renderer --include='*.test.*'`).

### Anti-pattern guards

- Do not fork a second word-style popup component — one component, optional prop.
- Do not write overrides to source `segments` — they live on the group's word objects (Phase 0 data model).
- Text commit must preserve `start`/`end`/`overrides` on the word (spread pattern) — replacing the word object wholesale loses timing.

---

## Phase 3 — Group popup: position override

**Files:** `src/renderer/src/components/screens/ResultsScreen.tsx` (only — popup + hook work already done)

### Implement

1. State: `const [groupPosPopup, setGroupPosPopup] = useState<{ groupIdx: number; anchorRect: DOMRect } | null>(null)`
2. `onGroupDoubleClick(segId, rect)` → resolve index by `g.id`, set state.
3. Apply: copy `applyPositionOverride` from `GroupEditor.tsx:238–250` — but call `handleGroupsPositionChange` (`ResultsScreen.tsx:222`) directly (it IS the `onPositionChange` target GroupEditor uses via props, see line 657). **This is the whole reason position edits don't flip `groupsEdited` — do not route through the boundary-edit path.**
4. `GroupPositionDefaults`: build from settings the same way GroupEditor's call site does — find GroupEditor's popup render (`grep -n "GroupPositionPopup" src/renderer/src/components/editor/GroupEditor.tsx`) and copy the defaults construction.
5. `groupLabel`: mirror GroupEditor's label format (`#N` + text excerpt).
6. Same stale-index close guard as Phase 2; render `<GroupPositionPopup>` at ResultsScreen root.

### Verify

- [ ] `npm run typecheck` clean; frontend tests green.
- [ ] **The critical invariant:** set a position override via timeline double-click, then change words-per-group in StudioPanel → re-grouping still happens (i.e., `groupsEdited` stayed false). This is the regression the `onPositionChange` split exists to prevent.
- [ ] Manual: double-click group block → popup; sliders move caption live in preview; Reset returns to global position; `⌖` indicator appears on the group row in the Groups editor (existing UI, `GroupEditor.tsx:476–491`); override survives project save/load.
- [ ] Grep guard: `grep -n "groupsEdited" src/renderer/src/components/screens/ResultsScreen.tsx` — confirm no new `setGroupsEdited(true)` was added in the position path.

---

## Phase 4 — Final verification & docs

1. **Full gates:** `npm run typecheck` + complete frontend test run + (if any backend-touching change crept in — it should NOT have) `pytest`. No backend or parity-suite changes are expected in this feature; if any renderer formula was touched, STOP — that's out of scope (Preview ↔ Render parity contract in CLAUDE.md).
2. **Anti-pattern sweep:**
   - `grep -rn "text-white\|bg-black" src/renderer/src/components/editor src/renderer/src/components/player` → no new hits.
   - `grep -n "onChange" ResultsScreen.tsx` position path → confirm position flows only through `handleGroupsPositionChange`.
   - `grep -rn "console.log" src/renderer/src/hooks/useTimeline.ts` → none.
3. **Interaction regression checklist** (manual, `npm run dev:react`): word drag/snapping, segment edge drag, click-to-seek, selection toggle, Escape deselect, wheel zoom/pan, Cmd+Z on both popup edit types, both themes (popups use CSS vars — verify light mode).
4. Update `CLAUDE.md` Renderer Structure bullet for the timeline if behavior description changed; note the new `useTimeline` callbacks.
5. Commit via `git-ops` agent (conventional commits, feature branch off main).

---

## Execution notes

- Phases 1→2→3 are sequential (2 and 3 depend on 1's callbacks); 2 and 3 are independent of each other and could be parallelized in worktrees, but they both edit `ResultsScreen.tsx` — prefer sequential to avoid conflicts.
- No backend changes anywhere in this plan. The render config and preview already consume both override types end-to-end.
- Line numbers verified 2026-07-20 on main @ 0bbc312 — re-verify with the cited greps if main has moved.

## Addendum (2026-07-21)

User feedback: double-click felt clunky. The trigger changed from **double-click to right-click** (`contextmenu`), matching GroupEditor's existing right-click convention:

- `useTimeline.ts`: `onWordDoubleClick`/`onGroupDoubleClick` → `onWordContextMenu`/`onGroupContextMenu`; the returned `onDoubleClick` handler → `onContextMenu`, which calls `e.preventDefault()` first to suppress the native browser context menu over the canvas. `onMouseDown` (and `onMouseUp`, which has an independent seek/deselect path for a "not dragging" release) now guard on `e.button !== 0` so a right-click never starts a drag or triggers the click-to-seek/select path — only the contextmenu handler responds to it.
- `AudioPlayer.tsx` / `ResultsScreen.tsx`: props and handlers renamed to match (`onWordContextMenu`/`onGroupContextMenu`, `handleTimelineWordContextMenu`/`handleTimelineGroupContextMenu`); wired via React's `onContextMenu` instead of `onDoubleClick`.
- All other behavior (popup state, lazy undo snapshots, apply/reset paths, stale-index guards) is unchanged.
