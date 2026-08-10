# Word-Edit Timing Locality — Corrections Must Not Move Other Words' Timing

**Reported symptom:** "When there is a mistake — for example I need to add or separate a
single word — then after the manual correction the whole timing moves and is not synced.
It must not affect other words."

**Verdict: confirmed, two independent root causes, both in the renderer.** The Python side is
already correct and states the invariant explicitly (`mcp_server/cleanup.py:19–21`:
*"Timing is never shifted. CapForge is a finishing tool used after the video is cut elsewhere,
so captions must stay synced to the original audio."*). The React editor violates that
invariant. This plan makes the renderer obey it.

**Goal invariant (the thing to test):** after any text correction, every word the user did
**not** touch keeps a **byte-identical** `start`/`end`. Only the edited run is retimed, and
only within its own time span.

**Scope:** renderer only. No backend changes, no MCP changes, no rendering-formula changes
(the three-renderer parity contract in CLAUDE.md is untouched).

---

## Phase 0 — Documentation Discovery (COMPLETE — verified 2026-08-07 on `main` @ `9f009d8`)

### Root cause A — index-keyed retiming in `SubtitleEditor`

`src/renderer/src/components/editor/SubtitleEditor.tsx:196–209` (`handleTextEdit`) and the
identical helper at `743–753` (`remapWordsFromText`, used by `handleSplitSegment` at line 176):

```ts
const words = newText.split(/\s+/).filter(Boolean)
const newWords = words.map((word, i) => {
  if (i < seg.words.length) return { ...seg.words[i], word }   // ← timing keyed by INDEX
  const last = seg.words[seg.words.length - 1]
  if (last) return { ...last, word }                            // ← duplicates last timing
  return { word, start: seg.start, end: seg.end }
})
```

Word timings are assigned **by array position**. Insert or split a word and every subsequent
word inherits its neighbour's slot.

**Concrete repro** — segment words
`[("Hello", 0.0–0.5), ("world", 0.6–1.2), ("today", 1.3–2.0)]`, user types
`"Hello big world today"`:

| new token | assigned timing | correct timing |
|---|---|---|
| Hello | 0.0–0.5 | 0.0–0.5 ✅ |
| big   | 0.6–1.2 | (carved from a neighbour) ❌ |
| world | 1.3–2.0 | 0.6–1.2 ❌ |
| today | 1.3–2.0 (**duplicate**) | 1.3–2.0 ❌ shared with "world" |

Every word after the edit point is off by one, and the last two words highlight
simultaneously. Splitting one word (`"wecan"` → `"we can"`) produces the same shift.

### Root cause B — flat-pool group sync misaligns on word-count change

`src/renderer/src/components/screens/ResultsScreen.tsx:139–171`. The effect deps are
`[segments, settings.wordsPerGroup]` (line 217), so it re-runs on **every** segment edit.
The `groupsEdited && !wpgChanged && !segCountChanged` branch syncs words by walking a flat
pool:

```ts
const allWords = segments.flatMap((s) => s.words)
setGroups((prev) => { let wi = 0; return prev.map((g) => {
  const count = g.words.length
  const slice = allWords.slice(wi, wi + count)   // ← assumes the pool length is stable
  wi += count
  ...
```

The guard only checks **segment** count. Adding or splitting a word changes the **word**
count without changing the segment count, so `wi` drifts by one and every group after the
edit gets the wrong words — a second, independent "everything shifted" symptom, visible in
the Groups view and the timeline whenever the user has manual group edits.

### What is already correct (do NOT change)

- `mcp_server/cleanup.py:83–173` — `apply_word_edits`. `replace` touches text only
  (line 133); `delete` absorbs the removed span into the **previous survivor's `end`**
  (`prev["end"] = max(prev["end"], w["end"])`), or pulls the **next survivor's `start`** back
  for a leading run. This is the reference semantics to mirror in the renderer.
- `mcp_server/cleanup.py:41–44` — `_rebuild_text` filters empty tokens so an emptied word
  never leaves a double space. The renderer's `join(' ')` calls should match.
- `backend/main.py:581–593` — `PUT /api/result` replaces the whole `TranscriptionResult`.
  Nothing to change; it just persists whatever the renderer produces.
- `src/renderer/src/lib/groups.ts:49–50` — group bounds are `words[0].start` /
  `words[n-1].end`. Correct by construction, and the reason bad word timings cascade
  into group bounds.
- `/api/realign` (`backend/main.py:596–631`, WhisperX forced alignment; frontend button at
  `SubtitleEditor.tsx:591–600`) — already shipped. It is the **whole-segment re-alignment**
  escape hatch and is deliberately global; it is not a substitute for local edits and must
  not be auto-triggered by this work.
- `groups.ts` `mergeGroups` (94–107), `splitGroup` (114–137), `moveWord` (145–177) — all
  slice/concatenate word objects without touching timing. Correct; leave alone.
- `WordStylePopup.tsx:388–395` (`commitText`) — trims and early-returns on empty or unchanged
  text before calling `onTextCommit` (prop declared at line 67). The popup itself needs no
  change; only its consumer does (Phase 3).

### Allowed APIs / patterns to COPY

| Need | Copy from |
|---|---|
| Word text edit preserving timing + overrides | `SubtitleEditor.tsx:200–201` spread `{ ...seg.words[i], word }` |
| Delete-absorbs-span semantics | `mcp_server/cleanup.py:147–162` |
| Sparse override storage | `GroupEditor.tsx:200–218` (`overrides: Object.keys(o).length ? o : undefined`) |
| Pure-lib module + colocated vitest | `src/renderer/src/lib/groups.ts` + `groups.test.ts` |
| Undo before mutation | `onBeforeEdit?.()` (`SubtitleEditor.tsx:153, 174, 197`) |

### Data model (verified)

`src/renderer/src/types/app.ts` — `Word { word: string; start: number; end: number; score?: number; overrides?: WordOverrides }`,
`Segment { id, start, end, text, words, speaker?, positionOverride? }`. `start`/`end` are
**required numbers** on `Word` — there is no legal `undefined` timing, so the new code must
never emit one.

### Anti-patterns (things that do NOT exist — do not invent them)

- ❌ There is **no** word-insert or word-split operation anywhere (UI or MCP). You are adding
  the retiming primitive, not calling an existing one.
- ❌ Do not add a `redistribute-all-words-evenly` helper. Even spacing across a segment is
  precisely the bug being fixed.
- ❌ Do not call `/api/realign` automatically on a text edit — it rewrites *every* word in
  the segment, which is the reported complaint by another name. It stays a manual button.
- ❌ Do not touch `useSubtitleOverlay.ts` rendering formulas, `video_render.py`
  `_render_frame()`, or `hyperframes_caption_html.py` — parity contract, CLAUDE.md.
- ❌ Do not mutate arrays in place (immutability rule) — return new arrays/objects.

### Open decisions (defaults chosen; flag to the user if changing)

1. **Pure insertion with no gap** ("Hello world" → "Hello big world", where
   `prev.end === next.start`): carve the new word's span off the **end of the preceding
   word**, proportional to character length, floored at `MIN_WORD_DUR`. Only one neighbour is
   shortened; nothing shifts. Chosen because it mirrors the MCP absorb-into-neighbour model in
   reverse and keeps the segment's outer bounds fixed.
2. **Pure insertion with a gap available** (`prev.end < next.start`): the inserted word takes
   the silent gap and **no existing word is touched at all**. Preferred whenever possible.
3. **Overrides on a changed run:** carried by position when the run's word count is unchanged;
   dropped when the count changes (styling of a rewritten run is ambiguous). Untouched words
   always keep their overrides.
4. **Matching is punctuation/case-insensitive** for diff purposes, so `"world"` → `"World,"`
   is a match (timing preserved), not a rewrite.

---

## Phase 1 — `lib/wordTiming.ts`: the pure retiming primitive (TDD)

**Files:** `src/renderer/src/lib/wordTiming.ts` (new),
`src/renderer/src/lib/wordTiming.test.ts` (new).

Write the tests first (repo rule: RED → GREEN → refactor).

### Implement

```ts
/** Minimum duration a retimed word may occupy, in seconds. */
export const MIN_WORD_DUR = 0.04

/**
 * Re-derive word timings after a text edit, changing ONLY the words that
 * actually changed. Words matched between old and new keep byte-identical
 * start/end and their overrides.
 */
export function retimeWords(
  oldWords: readonly Word[],
  newTokens: readonly string[],
  bounds: { start: number; end: number }
): Word[]
```

Algorithm:

1. **Normalize for matching** — `normalizeToken(s)` = lowercase + strip surrounding
   punctuation/whitespace. Copy the shape of `mcp_server/cleanup.py:36–38` (`_normalize`) so
   the two layers agree on what "the same word" means.
2. **LCS diff** over the normalized sequences → a list of matched `(oldIdx, newIdx)` pairs.
   Plain dynamic-programming LCS; segment word counts are small (tens), so no optimization
   is warranted (KISS).
3. **Matched pair** → `{ ...oldWords[oldIdx], word: newTokens[newIdx] }`. Timing and
   `overrides` preserved exactly. This is the untouched-word guarantee.
4. **Changed run** (`oldWords[i0..i1)` ↔ `newTokens[j0..j1)`):
   - `i1 > i0` (rewrite / split / merge): span = `[oldWords[i0].start, oldWords[i1-1].end]`.
     Distribute across the new tokens **proportional to token character length**, each at
     least `MIN_WORD_DUR`. Neighbours are never read or written.
   - `i1 === i0` (pure insertion): let `prevEnd` = previous surviving word's `end`
     (or `bounds.start`), `nextStart` = next surviving word's `start` (or `bounds.end`).
     - If `nextStart - prevEnd >= MIN_WORD_DUR * count` → **use the gap; touch nothing else**
       (Open decision #2).
     - Else → carve proportionally off the **tail of the previous word**, shortening only it,
       never below `MIN_WORD_DUR` (Open decision #1). If there is no previous word, carve off
       the **head of the next word**.
   - `j1 === j0` (pure deletion): drop the tokens and absorb their span into the previous
     survivor's `end`, else the next survivor's `start` — **mirroring
     `mcp_server/cleanup.py:147–162` exactly. Read that function before writing this branch.**
   - Overrides per Open decision #3.
5. **Post-condition assertions** (cheap, in-function): result is monotonic
   (`w.start < w.end`, `w[i].end <= w[i+1].start`) and stays inside `bounds`. Clamp rather
   than throw — a corrupted transcript must not white-screen the editor.

Also export a small helper used by the call sites:

```ts
/** Split text on whitespace into caption tokens. */
export function tokenize(text: string): string[]
```

### Verify

- [ ] `npx vitest run src/renderer/src/lib/wordTiming.test.ts` green, covering:
  - **The invariant test**: insert a word mid-segment → assert every untouched word's
    `start`/`end` is `toBe`-identical (not `toBeCloseTo`) to its input value.
  - The Phase 0 repro table above produces the "correct timing" column.
  - Split one word into two → the two halves partition exactly the original word's span;
    neighbours identical.
  - Merge two words into one → spans `[first.start, second.end]`; neighbours identical.
  - Delete a word → span absorbed by previous survivor (and by *next* survivor when the
    deleted word was leading), matching `cleanup.py`.
  - Text-only correction (`"world"` → `"World,"`) → zero timing change, override preserved.
  - Pure insertion **with** a gap → no existing word modified at all.
  - Pure insertion **without** a gap → only the previous word's `end` moves.
  - Degenerate inputs: empty `oldWords`, empty `newTokens`, single word, all words replaced,
    a run so short that `MIN_WORD_DUR` floors bind.
  - Monotonicity holds in every case.
- [ ] `npm run typecheck` clean.

### Anti-pattern guards

- No mutation of `oldWords` or its members.
- No reading of any word outside the changed run in the rewrite branch.
- No `any` — `unknown` + narrowing if needed (TS style rules).

---

## Phase 2 — Wire into `SubtitleEditor` (the primary offender)

**File:** `src/renderer/src/components/editor/SubtitleEditor.tsx`

### Implement

1. Replace the body of `remapWordsFromText` (`743–753`) with a delegation to
   `retimeWords(seg.words, tokenize(text), { start: seg.start, end: seg.end })`. Keep the
   function name and signature so `handleSplitSegment` (line 176) needs no change.
2. Replace the index-mapping block in `handleTextEdit` (`199–205`) with the same call. Keep
   `onBeforeEdit?.()` (line 197) exactly where it is — undo behaviour is unchanged.
3. `handleSplitSegment` (169–194): with correct word timings, `splitTime` (line 180) is now
   the true end of the last word in the left half. Leave the fallback
   `(seg.start + seg.end) / 2` for the no-words case. Re-read lines 176–190 and confirm the
   `wordsB.length > 0 ? ... : [{ word: textB, ... }]` fallback still makes sense.
4. Segment bounds: after a retime, recompute `seg.start`/`seg.end` from the words **only if
   the words now fall outside them** (they should not, since `retimeWords` clamps to
   `bounds`). Prefer leaving bounds untouched — mirrors `cleanup.py`'s
   `_segment_bounds` fallback behaviour.

### Verify

- [ ] `npm run typecheck` clean; `npm test` green.
- [ ] Grep guard — the index-keyed pattern is gone:
      `grep -n "i < seg.words.length" src/renderer/src/components/editor/SubtitleEditor.tsx`
      → no hits.
- [ ] Manual (`npm run dev:react`), the reported scenario end to end:
  - Text view → insert a word mid-sentence → **play back**: every other word still highlights
    on beat; only the new word's neighbourhood changed.
  - Split a run-together word (`"wecan"` → `"we can"`) → the two halves highlight inside the
    original word's slot; the rest of the caption is untouched.
  - Delete a word from the text box → remaining words keep their exact timings.
  - Fix a typo (no word-count change) → zero timing change anywhere.
  - Cmd+Z restores the pre-edit timings; Cmd+Shift+Z re-applies.
  - Split a segment at the cursor → both halves keep sane per-word timings.

### Anti-pattern guards

- Do not change `onChange` call shapes — `ResultsScreen` owns segments state.
- Do not add a re-align call to the edit path (Phase 0 anti-pattern list).

---

## Phase 3 — Wire into the timeline word popup

**File:** `src/renderer/src/components/screens/ResultsScreen.tsx`

`applyTimelineWordText` (`548–564`, wired to the popup at `ResultsScreen.tsx:867–869`)
currently does `{ ...w, word: newText }`. That is correct
for a 1:1 correction but wrong when the user types **two** words into the field (the
"separate a single word" case from the report) — it produces one token containing a space,
which all three renderers then treat as a single timed word.

### Implement

1. In `applyTimelineWordText`, tokenize `newText`. If it yields exactly one token, keep the
   existing spread (fast path, byte-identical behaviour). If it yields 0 or ≥2 tokens, splice
   via `retimeWords` **over just that word's span**:
   `retimeWords([g.words[wi]], tokens, { start: g.words[wi].start, end: g.words[wi].end })`,
   then rebuild `g.words` with the result in place of the single original.
2. Rebuild `g.text` with the empty-token filter, matching `cleanup.py:41–44`:
   `words.map(w => w.word).filter(w => w.trim()).join(' ')`.
3. Keep the lazy one-snapshot-per-session undo (`wordPopupUndoPushedRef`, 550–553) and the
   `setGroupsEdited(true)` at line 561 — unchanged semantics.
4. **Stale-index guard:** splitting a word changes `g.words.length`, so an open popup's
   `wordIdx` can go stale. Extend the existing popup-close effect (the one that clears
   `wordPopup` when groups change — locate it with
   `grep -n "setWordPopup(null)" src/renderer/src/components/screens/ResultsScreen.tsx`) to
   also close when the target group's word count changes.

### Verify

- [ ] `npm run typecheck` clean; `npm test` green.
- [ ] Manual: right-click a word in the timeline word lane → type two words → both appear as
      separately-timed words inside the original word's slot; neighbouring words unchanged;
      the word lane redraws with two blocks; Cmd+Z restores one word.
- [ ] Per-word style overrides on *other* words in that group survive the split.

---

## Phase 4 — Fix the flat-pool group sync (root cause B)

**File:** `src/renderer/src/components/screens/ResultsScreen.tsx:123–217`

### Implement

1. Add a word-count ref beside the existing `prevWpg` / `prevSegCount` refs (123–124):
   ```ts
   const prevWordCount = useRef(segments.reduce((n, s) => n + s.words.length, 0))
   ```
   Compute `wordCountChanged` the same way `segCountChanged` is computed at line 136, and
   update the ref unconditionally in the same place (including the `isRestoringRef` early
   return at 127–132, so an undo doesn't leave the ref stale).
2. Change the branch condition at line 139 from
   `groupsEdited && !wpgChanged && !segCountChanged` to additionally require
   `!wordCountChanged`. The flat-pool sync is only sound when the pool length is stable —
   the comment at 142–143 already says exactly this; the guard just never covered the word
   case.
3. Route `wordCountChanged` into the **ID-based rebuild branch** (172–197), which already
   restores manual `start`/`end`, `positionOverride`, and per-word overrides for any group
   whose `${seg.id}:${offset}` ID survived. Widen its condition to
   `groupsEdited && !wpgChanged && (segCountChanged || wordCountChanged)`.
4. Note the known limitation in a comment: within the *edited* segment, a word insert shifts
   the `${seg.id}:${offset}` chunk IDs after the insertion point, so those groups rebuild from
   scratch and lose manual bounds. That is correct — their contents genuinely changed. Groups
   in *other* segments keep their IDs and are fully preserved.

### Verify

- [ ] `npm run typecheck` clean; `npm test` green (extend `groups.test.ts` if the rebuild
      helpers change — they should not).
- [ ] **The regression this branch exists to prevent:** with manual group edits in place
      (merge two groups in the Groups editor), insert a word in an *earlier* segment via the
      Text view → the merged group still shows its own words, not a one-off slice of the
      neighbours'.
- [ ] Changing words-per-group still re-groups (i.e. no new `setGroupsEdited(true)` crept in).
- [ ] Undo/redo across a word insert leaves groups consistent with segments (exercises the
      `isRestoringRef` ref-update path).

### Anti-pattern guards

- Do not flip `groupsEdited` anywhere in this effect beyond the existing
  `if (wpgChanged) setGroupsEdited(false)` at line 215.
- Do not "fix" this by rebuilding groups unconditionally — that would discard the user's
  manual group boundaries, which is a worse bug than the one being fixed.

---

## Phase 5 — Final verification

1. **Gates:**
   - [ ] `npm run typecheck` clean.
   - [ ] `npm test` (vitest) green.
   - [ ] `npm run lint` clean.
   - [ ] `.venv-dev/bin/python -m pytest backend/tests` green — should be **untouched**;
         this plan makes no backend change.
2. **Parity contract untouched:**
   - [ ] `git diff --stat` shows **zero** changes under `backend/` and zero changes to
         `src/renderer/src/hooks/useSubtitleOverlay.ts`. If either moved, stop — out of scope.
3. **Anti-pattern sweep:**
   - [ ] `grep -rn "seg.words.length" src/renderer/src/components/editor/SubtitleEditor.tsx`
         → no index-keyed timing assignment remains.
   - [ ] `grep -rn "realign" src/renderer/src/components/editor/SubtitleEditor.tsx` → the
         re-align call is still only on the explicit button, never in an edit handler.
   - [ ] `grep -rn "console.log" src/renderer/src/lib/wordTiming.ts` → none.
4. **End-to-end manual QA** (the user's actual report):
   - Transcribe a real clip → find a genuine ASR mistake → fix it three ways: (a) retype the
     word, (b) split one word into two, (c) insert a missing word. After each, scrub the
     whole caption and confirm nothing but the edited neighbourhood moved.
   - Render classic (Pillow) **and** HyperFrames from the same edited project → exported
     timings match the in-app preview.
   - Save → reopen the project → timings persist.
5. Update `CLAUDE.md` **Key Conventions** with a new bullet stating the locality invariant and
   pointing at `lib/wordTiming.ts` as the single place text→timing reconciliation happens
   (currently the convention is only documented on the Python side, in `cleanup.py`'s
   module docstring).
6. Commit via the `git-ops` agent — feature branch off `main`, conventional commits.

---

## Execution notes

- Phases are sequential: 2, 3 and 4 all depend on Phase 1's module. 2/3/4 touch two different
  files but 3 and 4 both edit `ResultsScreen.tsx` — run them in order, not in parallel.
- Phase 4 is independently valuable and independently testable; if Phase 1–3 slip, Phase 4
  still fixes a real "everything shifted" symptom on its own.
- Line numbers verified 2026-08-07 on `main` @ `9f009d8`. Re-run the cited greps before
  coding if `main` has moved.
