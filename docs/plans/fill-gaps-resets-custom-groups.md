# Fill gaps resets custom group membership

**Reported:** 2026-08-07 — "when I change manually what words are in which groups, then click Fill gaps, it returns those words back to the original groups."

**Status:** Phases 2, 3, 5 implemented; Phase 4 done at the test level. **Phase 1 (live repro) and the
manual QA in Phase 4 / Final verification were NOT run** — they need a human driving the Electron app
with real media. See "Execution notes" at the bottom for exactly what is and is not proven.

Branch: `fix/group-membership-identity`.

---

## Phase 0 — Discovery (DONE — read this before touching code)

Everything below was verified by reading the files on `main` at `f32a578`. Do **not** re-derive it from
assumption; re-read the cited lines if you need more context.

### The three renderers / parity contract are NOT involved

This is a renderer-state bug only (`src/renderer/src/`). No backend, no Canvas/Pillow/HTML parity work.

### Allowed APIs (verified to exist)

| Symbol                                                     | Location                                        | Signature / behaviour                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildStudioGroups`                                        | `src/renderer/src/lib/groups.ts:21`             | `(segments, wordsPerGroup) => Segment[]` — chunks each segment's words into wpg-sized groups, **strict document order**. Group id = `` `${seg.id}:${wordOffset}` ``.                                                                                                       |
| `fillGroupGaps`                                            | `src/renderer/src/lib/groups.ts:77`             | `(groups) => Segment[]` — for each group except the last, `end = next.start` when `next.start > group.end`. Never touches `words`. Pure, non-mutating.                                                                                                                     |
| `mergeGroups` / `splitGroup` / `moveWord` / `reorderGroup` | `src/renderer/src/lib/groups.ts:94,114,145,184` | Pure group-editor primitives. `moveWord` and `reorderGroup` are the two that can produce **non-document-order membership**.                                                                                                                                                |
| `finalizeBounds`                                           | `src/renderer/src/lib/groups.ts:194`            | module-private; recomputes `start`/`end`/`text` from `words`.                                                                                                                                                                                                              |
| `restoreManualGroupState`                                  | `src/renderer/src/lib/groups.ts:221`            | `(rebuilt, previous) => Segment[]` — restores `start`/`end`/per-word `overrides` by group **id**, and only when the rebuilt chunk's words are byte-identical. Restores `positionOverride` on id alone. **Restores no membership.** Single caller: `ResultsScreen.tsx:193`. |
| `retimeWords`                                              | `src/renderer/src/lib/wordTiming.ts`            | LCS-diff retiming; matched words keep byte-identical `start`/`end` **and their `overrides`** (spread-based).                                                                                                                                                               |
| `Word`                                                     | `src/renderer/src/types/app.ts:70`              | `{ word, start, end, score?, overrides? }` — **no id field.**                                                                                                                                                                                                              |
| `Segment`                                                  | `src/renderer/src/types/app.ts:79`              | `{ id, start, end, text, words, speaker?, positionOverride? }`                                                                                                                                                                                                             |
| `CustomGroup.words`                                        | `backend/models/schemas.py:208`                 | `list[dict]` — free-form, no `extra="forbid"`. Extra word keys are tolerated by the backend but still get serialized into the HTML caption payload.                                                                                                                        |

### Anti-patterns / things that do NOT exist

- There is **no** `fillGaps` StudioSettings field any more — the Layout-card toggle was removed in `ce73fef`
  and replaced by the one-shot bake button. `src/renderer/src/lib/settingsSearch.ts:141` still lists a
  `Fill gaps` entry pointing at the (now nonexistent) `layout` control — stale, see Phase 5.
- There is **no** `fill_group_gaps()` in the backend any more. Do not add one.
- The `fillGroupGaps` docstring (`groups.ts:72-76`) still says the result "must never be baked into
  `studioGroups` state" — that is stale prose from the pre-`ce73fef` design and directly contradicts its
  only caller. Do not treat it as a spec.
- Do **not** reach for `@testing-library/react`: it is not installed, and neither is jsdom. Tests must be
  pure-function vitest tests (`npm test` → `vitest run`).

### The state machine (what actually happens)

`ResultsScreen.tsx` owns two pieces of state:

- `segments` (`:64`) — source transcription, always document order.
- `groups` (`:72`) — display groups; **user-editable membership**.
- `groupsEdited` (`:78`) — flips true on any boundary edit.

The reconciliation effect is `ResultsScreen.tsx:131-214`, deps `[segments, settings.wordsPerGroup]`.
It has three branches:

| Branch       | Condition                                          | What it does to membership                                                                                                                                                                                     |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** `:152` | `groupsEdited && !wpgChanged && !structureChanged` | Re-slices `segments.flatMap(s => s.words)` into the existing group **word counts, in array order**. → membership snaps back to document order. Preserves `g.start`/`g.end` and per-word `overrides` by index.  |
| **B** `:186` | `groupsEdited && !wpgChanged && structureChanged`  | `restoreManualGroupState(buildStudioGroups(segments, wpg), prev)` → membership is **fully rebuilt** from document order; only bounds/overrides/positionOverride come back, and only for byte-identical chunks. |
| **C** `:195` | otherwise                                          | Full rebuild; carries `positionOverride` forward by group id; resets `groupsEdited` on a wpg change.                                                                                                           |

`structureChanged = segCountChanged || wordCountChanged` (`:150`).

### Root cause (confirmed by reading, not assumed)

**No branch preserves custom word→group membership.** All three reconstruct membership from document
order. Concretely:

- `moveWord` to a **non-adjacent** group and `reorderGroup` create membership that is not
  document-order contiguous. Branch A's count-based re-slice silently reassigns those words back —
  this is _exactly_ "it returns those words back to original groups".
- `mergeGroups`/`splitGroup` survive branch A (counts are preserved) but are destroyed by branch B.
- Branch B fires on any word or segment insert/delete — i.e. an ordinary typo fix in the Text tab that
  adds or removes a word wipes every manual merge/split.

There is a second, related loss the same fix must cover: a Fill-gaps-baked `end` is a _manual bound_.
Branch B drops it whenever the chunk is no longer byte-identical.

### Open question the fix must not paper over

On `main` as read, **`handleFillGaps` (`ResultsScreen.tsx:232`) cannot by itself re-run the
reconciliation effect**: it calls `pushUndo()` + `handleGroupsChange(fillGroupGaps(groups))`, which
touch `groups` and `groupsEdited` only. `segments` and `settings.wordsPerGroup` — the effect's only
deps — are untouched. Nothing in `GroupEditor.tsx` writes `segments` either (every action routes
through `onChange` → `handleGroupsChange`, verified at `GroupEditor.tsx:85,93,108,123,130,148,185,215`).

So one of these is true, and **Phase 1 must decide which before any code changes**:

- **H1 (most likely)** — the user's real flow includes a `segments`-touching action (Text-tab edit,
  "+ Add subtitle", `/api/realign`, agent apply) somewhere before or between the manual regroup and the
  Fill gaps click. The reset already happened (or happens on the next commit); Fill gaps is where it
  becomes visible. The Phase 2-4 fix addresses this directly.
- **H2** — there is a trigger not found by static reading (or the user is on a stale bundle: note
  `npm run dev` does **not** run Vite — only `npm run dev:react` picks up renderer changes).

Do not skip Phase 1. If H2 turns out to be real, the fix in Phases 2-4 is still correct but may not be
sufficient, and the plan needs revising rather than declaring victory.

---

## Phase 1 — Reproduce and pin the trigger

**Goal:** a written, exact click-sequence that reproduces the reset, plus proof of which branch fires.

1. Start the renderer with `npm run dev:react` (NOT `npm run dev` — it does not run Vite).
2. Add temporary instrumentation at the top of the effect body in `ResultsScreen.tsx:131`:
   ```ts
   console.log('[grp-sync]', {
     groupsEdited,
     wpgChanged,
     segCountChanged,
     wordCountChanged,
     groupWordCounts: groups.map((g) => g.words.length),
   })
   ```
   and one line in `handleFillGaps` (`:232`) logging `groups.map(g => g.words.map(w => w.word))`.
3. Run these sequences, capturing the log and the Groups list after each step:
   - **S1:** transcribe/open a project → Groups tab → drag one word from group 2 into group 5
     (non-adjacent) → click **Fill gaps**.
   - **S2:** same, but merge two groups instead of dragging a word → **Fill gaps**.
   - **S3:** drag a word to a non-adjacent group → switch to Text tab → fix a typo _without_ changing
     the word count → back to Groups.
   - **S4:** merge two groups → Text tab → add or delete a word → back to Groups.
   - **S5:** merge two groups → **Fill gaps** → Text tab → any edit → back to Groups (does the baked
     `end` survive?).
4. **Verification checklist**
   - [ ] Written down: which sequence(s) reset membership, and for each, which branch logged.
   - [ ] Explicitly recorded whether S1/S2 (Fill gaps with no segments edit) reset anything. If they
         do, H2 is real — **stop and report** with the log before continuing; the effect deps do not
         explain it and the plan needs a new phase.
   - [ ] Instrumentation removed (`git diff` clean of `console.log`) before Phase 2 starts.
5. **Anti-pattern guards**
   - Do not "fix while reproducing". Phase 1 produces evidence only.
   - Do not conclude from S3/S4 alone that the report is invalid — the user's flow is the target.

---

## Phase 2 — Give words a stable identity

Membership can only survive a segments edit if a group word can be matched to a segment word by
identity rather than position. Words currently have no id (`types/app.ts:70`).

1. `src/renderer/src/types/app.ts` — add to `Word`:
   ```ts
   /** Stable per-word identity, minted on ingest. Survives text edits, re-grouping and
    *  project save/load; used to reconcile manually-grouped words against source segments. */
   wid?: string
   ```
   Keep it **optional** — old project files and backend payloads have no `wid`.
2. New module `src/renderer/src/lib/wordIds.ts`:
   - `ensureWordIds(segments: Segment[]): Segment[]` — returns a new array where every word without a
     `wid` gets one; words that already have one are returned untouched (identity-stable, non-mutating).
   - `newWordId(): string` — monotonic counter + random suffix (same shape as the manual-segment id at
     `ResultsScreen.tsx:426`). Must be collision-free within a session **and** against ids loaded from
     a saved project.
3. Call `ensureWordIds` at every point where segments enter the editor:
   - `ResultsScreen.tsx:64` — the `useState` initializer.
   - `applyAgentResult` (`ResultsScreen.tsx:372`).
   - the `/api/realign` result handler (`ResultsScreen.tsx:656`).
   - `projectIO.restore` (`ResultsScreen.tsx:356`) — for `file.studioGroups`, mint ids on group words
     too, so an old project reconciles instead of resetting.
4. `src/renderer/src/lib/wordTiming.ts` — `retimeWords()` already spreads matched words, so `wid`
   rides along for free. **Verify this by test**, and mint a fresh `wid` for inserted tokens.
5. `src/renderer/src/lib/render.ts:159` — strip `wid` from the `custom_groups` payload
   (`words: g.words.map(({ wid: _wid, ...w }) => w)`). The backend tolerates the extra key
   (`CustomGroup.words: list[dict]`) but it would otherwise be serialized into the HTML caption
   payload for no reason.

**Verification checklist**

- [ ] `npm run typecheck` clean.
- [ ] New vitest cases: `ensureWordIds` is idempotent; already-id'd words keep their id; two calls on
      different segment arrays never collide.
- [ ] `retimeWords` test: a single-token correction keeps the word's `wid`; a 1→2 token split keeps the
      first word's `wid` and mints a new one for the second.
- [ ] `grep -n "wid" src/renderer/src/lib/render.ts` shows the strip, and a built `custom_groups` body
      snapshot contains no `wid`.

**Anti-pattern guards**

- Do **not** make `wid` required — it breaks every saved project and the backend result shape.
- Do **not** derive `wid` from index or text (`${seg.id}#${i}`, hashes of the word). Those are exactly
  the positional assumptions this bug is made of.
- Do **not** mint ids inside `buildStudioGroups` — it must stay a pure chunker of whatever it is given.

---

## Phase 3 — One identity-based reconciler, replacing branches A and B

Add to `src/renderer/src/lib/groups.ts`:

```ts
/**
 * Reconcile manually-edited groups against updated source segments *without*
 * rebuilding membership. Words are matched by `wid`, so a word the user moved
 * to another group stays where the user put it.
 */
export function reconcileGroups(previous: Segment[], segments: Segment[]): Segment[]
```

Rules — implement exactly these, they are the contract the tests pin:

1. **Update in place by identity.** For each group word, look up the segment word with the same `wid`
   and take its `word`/`start`/`end`/`score`. Per-word `overrides` live only on the group word
   (`ResultsScreen.tsx:169-172`) — carry the group's `overrides` forward, never the segment's.
2. **Deleted words** (a `wid` in a group but no longer in any segment) are dropped from the group.
3. **Inserted words** (a `wid` in the segments but in no group) are inserted into the group holding
   their _predecessor in segment order_, immediately after it. If there is no predecessor, prepend to
   the group holding their successor. If neither exists, append a new group at the position implied by
   document order.
4. **Empty groups are dropped** (matches `moveWord`'s existing behaviour, `groups.ts:163`).
5. **Bounds.** If a group's word-id set is _unchanged_, keep `start`/`end` **verbatim** — this is what
   preserves manual timeline drags and the Fill-gaps-baked `end`. If the set changed, recompute from
   the words (`finalizeBounds` semantics), which is the behaviour commit `90c2e7a` established.
6. `text` is always re-joined from the resulting words; `speaker` and `positionOverride` ride the group.
7. **Fallback.** If any group word lacks a `wid` (pre-Phase-2 project), fall back to today's behaviour
   for that call: `restoreManualGroupState(buildStudioGroups(segments, wpg), previous)`. Do not silently
   produce garbage.
8. Pure and non-mutating, like every other export in this file.

Then in `ResultsScreen.tsx:131-214`:

- Replace branches **A** and **B** with a single `if (groupsEdited && !wpgChanged)` →
  `setGroups(prev => reconcileGroups(prev, segments))`.
- Delete the now-unused `structureChanged` / `prevSegCount` / `prevWordCount` bookkeeping **only if
  nothing else reads it** (`grep -n "structureChanged\|prevWordCount\|prevSegCount" src/renderer`).
- Leave branch **C** exactly as is.
- If `restoreManualGroupState` ends up with no callers other than the Phase-3 fallback, keep it — do not
  delete it or its tests.

**Verification checklist**

- [ ] New vitest suite in `src/renderer/src/lib/groups.test.ts`:
  - word moved to a non-adjacent group survives a text-only segment edit;
  - reordered groups survive a text-only segment edit;
  - merged groups survive a word **insert** and a word **delete**;
  - a deleted word disappears from exactly one group and no other group's membership shifts;
  - an inserted word lands after its predecessor's group position;
  - a group whose words are unchanged keeps a manually stretched `end` (the Fill-gaps case) across a
    reconcile;
  - a group whose word set changed gets recomputed bounds;
  - per-word `overrides` and per-group `positionOverride` survive;
  - a group emptied by deletions is dropped;
  - words with no `wid` hit the documented fallback.
- [ ] `npm test` green (existing `groups.test.ts` cases must still pass unmodified — if one has to
      change, say so explicitly and justify it, do not quietly edit the expectation).
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.

**Anti-pattern guards**

- No `flatMap` + index counter anywhere in the new code. That construct _is_ the bug.
- Do not call `buildStudioGroups` on the `groupsEdited` path except inside the documented fallback.
- Do not re-time words here. `/api/realign` is the only thing allowed to rewrite timings wholesale, and
  only from its manual button (see CLAUDE.md, _Word-timing locality_).

---

## Phase 4 — Make Fill gaps demonstrably non-destructive

Whatever Phase 1 concluded, close the loop on the reported action.

1. Re-run Phase 1's **S1**, **S2** and **S5** sequences against the fixed build. Membership must be
   byte-identical before and after the Fill gaps click, and the baked `end` must survive a subsequent
   Text-tab edit.
2. If — and only if — Phase 1 found a direct trigger under H2, fix that trigger here and document it in
   this file under a new "H2 findings" heading before writing the code.
3. Add one regression test at the `lib` level that composes the real sequence:
   `buildStudioGroups → moveWord(non-adjacent) → fillGroupGaps → reconcileGroups(prev, editedSegments)`
   and asserts both membership and the stretched `end`.

**Verification checklist**

- [ ] S1/S2/S5 pass by hand in the running app, recorded in this file.
- [ ] The composed regression test exists and fails against `git stash`-ed Phase 3 (prove it catches the bug).

---

## Phase 5 — Stale-prose cleanup (do last, keep it in its own commit)

1. `src/renderer/src/lib/groups.ts:72-76` — rewrite the `fillGroupGaps` docstring: it is a **bake**
   applied to editable group state via `handleFillGaps`, not a preview-only derived view. The current
   text contradicts its only caller and would mislead the next reader into "fixing" the wrong side.
2. `src/renderer/src/lib/settingsSearch.ts:141` — remove the `Fill gaps` / `layout` entry; that control
   was deleted in `ce73fef` and the search result now points at nothing.
3. `CLAUDE.md` — under _Segments vs Groups_, add one line: group membership is reconciled by `wid`, not
   by position; any new segments→groups sync must go through `reconcileGroups`.

**Verification checklist**

- [ ] `grep -rn "Fill gaps" src/renderer` returns only the button, its tooltip, and the new docstring.
- [ ] `npm run typecheck && npm test && npm run lint` all clean.

---

## Final verification

- [ ] `npm run typecheck` — clean
- [ ] `npm test` — green
- [ ] `npm run lint` — clean
- [ ] `grep -rn "flatMap((s) => s.words)" src/renderer/src/components` — no positional re-slice remains
- [ ] `grep -rn "console.log" src/renderer/src/components/screens/ResultsScreen.tsx` — no leftovers
- [ ] Manual QA in `npm run dev:react`: S1-S5 from Phase 1 all behave; undo/redo (Cmd+Z) still restores
      membership; save → reopen a project preserves membership and baked ends; a project saved _before_
      this change still opens without resetting groups
- [ ] Commits follow conventional format; git write work goes through the `git-ops` subagent

---

## Execution notes (2026-08-07)

### What shipped

| Phase                         | State           | Where                                                                                                                                                                              |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 — word identity             | done            | `lib/wordIds.ts` (new), `Word.wid` in `types/app.ts`, `commitSegments` in `ResultsScreen.tsx`, `wid` carry in `wordTiming.ts` + the realign handler, `wid` stripped in `render.ts` |
| 3 — identity reconciler       | done            | `reconcileGroups()` in `lib/groups.ts`; branches A and B of the sync effect replaced by a single call                                                                              |
| 4 — Fill gaps non-destructive | test level only | regression test "move a word, Fill gaps, then edit text — nothing snaps back" in `groups.test.ts`                                                                                  |
| 5 — stale prose               | done            | `fillGroupGaps` docstring, `settingsSearch.ts` entry removed, CLAUDE.md convention added                                                                                           |

Beyond the plan: `adoptWordIds()` was added so a project saved **before** word ids existed still
reconciles. Without it, restored groups and freshly-minted segment ids would share nothing and the first
segment edit would throw the saved grouping away — no worse than before the fix, but pointlessly lossy.
It matches group words to segment words on text+timing and adopts the id.

Also beyond the plan, and worth knowing: `handleRealignSegment` now carries `wid` across the backend's
re-fitted words by index (the same carry `overrides` already used). Without it a realign reads as "every
word in the segment deleted and re-inserted" and collapses that segment's groups into one.

### Verified

- `npm run typecheck` clean; `npm test` 373 passed (25 files, +29 new); `npm run lint` 0 errors,
  31 warnings (down from 33 — two dep-array warnings fixed, none added).
- The new fixtures were run through the **old** branch-A algorithm in a throwaway test to prove they
  actually exercise the bug: it puts `the` back in group 0, the new reconciler does not. That temp file
  was deleted; re-create it from this paragraph if you ever need to re-prove it.
- `grep` confirms no positional re-slice (`flatMap((s) => s.words)`) remains in components or hooks.

### NOT verified — do this before trusting the fix in the app

1. **Phase 1 was never run.** The trigger question in "Open question the fix must not paper over" is
   still open: on the code as read, `handleFillGaps` alone cannot re-run the sync effect. The fix makes
   the _reconciliation_ correct regardless, so H1 is fully addressed — but if the user's Fill gaps click
   with **no** segments edit still resets groups, H2 is real and something else is doing it. Run S1 and
   S2 from Phase 1 first; they are the cheap discriminator.
2. Manual QA in a running app (`npm run dev:react`, not `npm run dev`): S1-S5, undo/redo across a
   regroup, save → reopen, and opening a project saved before this change.
3. No render-output check was run. `custom_groups` shape is covered by a unit test, but nobody has
   watched an actual exported video.
