# Caption gap closing — implementation plan

Implements the spec in artifact `92617b94-ac47-4d4e-b880-6f072daeecdc`
("Closing the gaps between caption groups"), with the user's amendment:

> **the final group should stay visible for at least 1s after its original end.**

That amendment *replaces* the spec's Guard 03 ("leave the final group alone").

---

## Phase 0 — Discovery findings

All facts below were read from source in this repo, not assumed.

### 0.1 The feature already half-exists

`fillGroupGaps()` — `src/renderer/src/lib/groups.ts:80`

```ts
export function fillGroupGaps(groups: Segment[]): Segment[] {
  if (groups.length === 0) return []
  return groups.map((group, i) => {
    const next = groups[i + 1]
    if (next && next.start > group.end) return { ...group, end: next.start }
    return { ...group }
  })
}
```

Compared against the spec, it already satisfies:

| Spec item | Status in `fillGroupGaps` |
|---|---|
| Guard 01 — never stretch a non-positive gap | ✅ `next.start > group.end` |
| Guard 03 — leave final group alone | ✅ (but the user wants this changed) |
| Guard 04 — idempotent | ✅ closed gaps become exactly 0 |
| Guard 07 — segment end in sync | n/a — operates on groups, not segments |
| **Threshold** | ❌ **missing — closes every gap, however long** |
| Guard 02 — never bridge a speaker change | ❌ missing |
| Guard 06 — skip words with no timing | ❌ missing |
| Architecture — derived, not baked | ❌ **it is a destructive bake, by design** |

So the real work is: **add a threshold, add two guards, add the tail hold, and make it a
derived pass** — not build the algorithm from scratch.

### 0.2 The stale docstring (correct this while you are in there)

`groups.ts:63-64` claims:

> "Mirrors the backend's `fill_group_gaps()` (`backend/exporters/video_render.py`)."

**No such function exists.** `grep -rn "fill_group_gaps" backend/` returns zero hits.
Gap filling is currently **frontend-only**, and it reaches the render solely by
accident: `handleFillGaps` calls `handleGroupsChange`, which flips `groupsEdited`,
which is what makes `render.ts` send `custom_groups` at all. Fix the comment as part
of Phase 1.

### 0.3 The two group-building choke points

**Frontend** — `src/renderer/src/lib/groups.ts`
- `buildStudioGroups(segments, wordsPerGroup)` → `Segment[]` (groups). Group
  `start`/`end` = outer bounds of first/last word.
- `reconcileGroups(previous, segments, wpg)` — the identity-preserving refresh; its
  Rule 5 keeps `start`/`end` **verbatim** for a group whose word ids are unchanged,
  which is what preserves both a manual timeline drag *and* the baked "Fill gaps" end.
- Consumed by the preview via `AudioPlayer`'s `overlaySegments` prop (`ResultsScreen.tsx:851`)
  → `useSubtitleOverlay`. **The preview renders the groups array**, so anything applied at
  the group layer reaches the canvas for free. The timeline reads the separate `segments`
  prop — see 0.9, which is what makes the derived design cheap.

**Backend** — `backend/exporters/video_render.py:282` `_build_groups(result, words_per_group)`
Single choke point for every server-side renderer. Call sites:
- `video_render.py:1340` (classic Pillow render)
- `hyperframes_project.py:667, 781, 861, 942` (HyperFrames / HTML caption layer)
- `frame_qa.py:49`
- tests: `test_overlay_alpha.py:186,310`, `test_hyperframes_scaffold_cache.py:113,120`

Every one uses the same shape: `custom_groups if custom_groups else _build_groups(...)`.

### 0.4 The `custom_groups` parity trap (most important finding)

`render.ts:168-174`:

```ts
const hasGroupOverrides = groups.some((g) => g.positionOverride)
if ((groupsEdited || hasGroupOverrides) && groups.length > 0) {
  body.custom_groups = groups.map((g) => ({ … }))
}
```

So there are **two mutually exclusive paths** for group timing to reach a render:

1. **Frontend-authored** — `custom_groups` sent verbatim; the backend never re-chunks.
2. **Backend-derived** — `_build_groups` chunks from `result.segments` words.

A gap-closing pass must land on **both**, and must land **exactly once** per path.
Applying it in `_build_groups` alone leaves path 1 unclosed (preview shows held
captions, export flickers). Applying it in both `_build_groups` *and* on the frontend
groups double-applies the tail hold on path 1 (see 0.6).

**Resolution:** put the pass *inside* `_build_groups` (so the `custom_groups` branch
bypasses it naturally, matching the existing `if custom_groups else` structure), and
make the frontend responsible for path 1 by applying the pass to the array it sends as
`custom_groups`. One application per path, no coordination flag needed.

### 0.5 Guard 02 needs a field the backend groups don't carry

`speaker` lives on `Segment`, not `Word` (`types/app.ts:91`; `Segment.speaker?: string`).
- Frontend groups **do** carry it — `buildStudioGroups` sets `speaker: seg.speaker`.
- Backend group dicts **do not** — `_build_groups` emits only `{text, start, end, words}`.

So backend-side, either add `"speaker": seg.speaker` to the emitted dict, or compare
speakers inside the segment loop. Prefer emitting the field (also useful downstream).
Note that a speaker change can only occur at a **cross-segment** boundary, since a
group never spans segments.

### 0.6 The tail hold is NOT idempotent — this constrains the design

`end = end + 1.0` applied twice adds 2s. Every other part of the pass is idempotent
(`gap > 0` excludes already-closed gaps), so this one rule dictates:

- The pass must be applied **once per pipeline**, never composed with itself.
- It must **not be baked into `groups` state**, or `reconcileGroups` Rule 5 would carry
  the held end forward as a "manual bound" and the next pass would extend it again,
  compounding by 1s per edit.
- Express it defensively as `end = max(end, originalEnd + hold)` so a double call is
  harmless *within one pass*, but do not rely on that across passes.

### 0.7 Duration is available for clamping, with an ordering hazard

`video_render.py:1344-1349`:

```python
duration = (
    _probe_duration(ffmpeg_path, result.audio_path)
    or result.duration
    or groups[-1]["end"] + 1.0        # ← already uses last end + 1.0
)
```

`duration` is resolved **after** `groups`. If the tail hold runs inside `_build_groups`,
the `groups[-1]["end"] + 1.0` fallback silently becomes "original end + 2.0". Harmless
(it is only a last-resort fallback) but worth a comment so nobody reads it as a bug later.

**Decision:** do **not** clamp the tail hold to `duration`. Holding a caption past the
end of the media is a no-op in every renderer (frames stop being produced), and clamping
would require threading duration into `_build_groups`, which currently takes only
`(result, words_per_group)`. Revisit only if QA shows a real artifact.

### 0.8 Guard 06 is defensive-only in TypeScript

`Word.start` / `Word.end` are non-optional `number` (`types/app.ts:72-73`), so a missing
timing is only reachable from backend data or an old project file. Implement it as a
`Number.isFinite()` check — cheap, and the spec is right that treating a missing value
as `0` would yank a caption to the start of the clip.

### 0.9 The preview and the timeline are already separate props

`ResultsScreen.tsx:849-851` passes **two** group arrays to `AudioPlayer`:

```tsx
segments={groups}          // → the timeline canvas (drag target)
overlaySegments={groups}   // → useSubtitleOverlay (the caption preview)
```

`AudioPlayer.tsx:68` defaults `overlaySegments = segments`, and `:118` feeds
`overlaySegments` into `useSubtitleOverlay`. So the split the design needs — preview shows
held captions, timeline shows raw draggable ends — **requires no new plumbing**. Change
only `overlaySegments`.

### 0.10 The four sites that touch a group's `end`

Needed to decide where the `endEdited` exemption flag gets set:

| Site | What it is | Sets `endEdited`? |
|---|---|---|
| `ResultsScreen.tsx:416` `handleSegmentEdge`, `edge === 'end'` | Timeline right-edge drag | **Yes** — deliberate |
| `ResultsScreen.tsx:416` `handleSegmentEdge`, `edge === 'body'` | Timeline body drag, both endpoints move | **Yes** — the end is explicitly placed |
| `ResultsScreen.tsx:416` `handleSegmentEdge`, `edge === 'start'` | Left-edge drag | No — end untouched |
| `GroupEditor.tsx:183` `commitEndEdit` | End-time text input | **Yes** — deliberate |
| `ResultsScreen.tsx:444` `handleWordEdge` | Word-lane drag; group bounds *widen* as a side effect | **No** — a consequence, not an intent |
| `handleFillGaps` ("Close all gaps" button) | Bakes `end = next.start` | **No** — it closes gaps to exactly 0, so the derived pass is a no-op there anyway |

Note `commitEndEdit` already clamps to `max = groups[gi+1].start` (`:181`), so a manual end
can never overrun the next group — the exemption only ever *shortens* relative to the pass.

### 0.11 Flag lifecycle in the existing group functions

`endEdited` is a **timing claim**, so it must die whenever bounds are recomputed:

| Function | Behaviour | Action needed |
|---|---|---|
| `buildStudioGroups` | Builds fresh from words | None — never sets it ✅ |
| `mergeGroups` / `splitGroup` | Construct new objects field-by-field, no spread | None — flag drops naturally ✅ |
| `moveWord` | `finalizeBounds({ ...dst, words })` — **spreads** | **Must clear explicitly** ⚠️ |
| `reconcileGroups` Rule 5 | Unchanged word set keeps `start`/`end` verbatim via `{ ...b.base }` | Flag survives — correct ✅ |
| `reconcileGroups` Rule 5 | Changed word set → `finalizeBounds` recomputes | **Must clear** ⚠️ |
| `restoreManualGroupState` | Restores saved `start`/`end` only when words are byte-identical | Carry the flag under that **same** condition ⚠️ |
| `render.ts` `custom_groups` map | Frontend-only state | **Strip it**, as `wid` already is ⚠️ |
| Project save/load | Rides the group objects in `studioGroups` | Persists free ✅ |

**Legacy projects:** a project saved before this feature has no `endEdited`, so a
deliberately-shaped end would get re-closed on load. On restore, treat any group whose
`end` differs from its natural last-word end (`Math.max(...words.map(w => w.end))`) as
`endEdited: true`. This mirrors how `adoptWordIds` retrofits identity onto legacy groups.

### 0.12 Constants convention

`src/renderer/src/lib/renderConstants.ts` holds shared magic numbers
(`DEFAULT_PAD_V`, `CROSSFADE_DUR`, `DEFAULT_LINE_HEIGHT`); per CLAUDE.md the backend
receives them **via the render config** so the three renderers stay synced automatically.
The threshold and hold follow that pattern.

### 0.13 Settings-unit trap

`lib/settingsSanitize.ts` — `NUMERIC_SETTING_SPECS` bounds mirror the `Field(...)`
constraints on `VideoRenderConfig`. Both new settings are **plain seconds**, not
percentages and not 0–1 fractions. **Do not set `fraction: true`** on them — that
heuristic reinterprets a value in (1, 100] as a percentage and would turn a legitimate
`2` second hold into `0.02`.

### Allowed APIs (verified to exist)

| Symbol | Location | Signature |
|---|---|---|
| `buildStudioGroups` | `lib/groups.ts:22` | `(segments: Segment[], wordsPerGroup: number) => Segment[]` |
| `fillGroupGaps` | `lib/groups.ts:80` | `(groups: Segment[]) => Segment[]` |
| `reconcileGroups` | `lib/groups.ts` | `(previous, segments, wordsPerGroup) => Segment[]` |
| `_build_groups` | `video_render.py:282` | `(result: TranscriptionResult, words_per_group: int) -> list[dict]` |
| `buildRenderBody` | `lib/render.ts:72` | builds snake_case config; `custom_groups` gated at `:168` |
| `sanitizeSettingValue` | `lib/settingsSanitize.ts` | `(key, value) => number \| undefined` |
| `VideoRenderConfig` | `backend/models/schemas.py:158` | `words_per_group: int = Field(3, ge=1)` |

**Anti-patterns — do NOT do these:**
- ❌ Do not invent `fill_group_gaps()` in the backend and call it from render entry
  points; the choke point is `_build_groups`, and adding a second application site is
  how the tail hold double-applies.
- ❌ Do not bake the derived pass into `groups` state via `setGroups` / `handleGroupsChange`
  (that flips `groupsEdited`, poisons `reconcileGroups` Rule 5, and compounds the hold).
- ❌ Do not re-slice `segments.flatMap(s => s.words)` anywhere in this work.
- ❌ Do not mark the new settings `fraction: true` in `NUMERIC_SETTING_SPECS`.
- ❌ Do not use `word.speaker` — the field is on `Segment`, not `Word`.

---

## Stated decisions and assumptions

| Decision | Value | Rationale |
|---|---|---|
| Threshold default | **0.25s** | The artifact's explicit recommendation; 0.30 differs by 6 of 547 boundaries. |
| Threshold range | 0–0.6s, `0` disables | Per artifact. |
| Boundary test | `gap <= threshold` (inclusive) | Artifact test case 3 says pick a side and pin it. |
| Tail hold default | **1.0s** | The user's amendment. Exposed as a setting, `0` disables. |
| Tail hold scope | The **last group of the whole transcript** | Confirmed by the user. Not "every group before a preserved gap" — that is a different feature, out of scope. |
| When it applies | **Automatically, as soon as results land** — no button press | User's requirement. Falls out of the derived design for free; see 4.0. |
| Manual end edits | **Win** — an explicitly retimed group is exempt from then on | User's choice. Needs a per-group `endEdited` flag; see 0.10-0.11. |
| Tail hold clamping | None | See 0.7. |
| On by default | **Yes**, threshold 0.25 | Artifact's "Recommended default". |
| Manual "Fill gaps" button | **Kept, unchanged** | It is a deliberate bake (`ce73fef`, `docs/plans/fill-gaps-resets-custom-groups.md`) so users can then shorten individual ends. Deleting it is out of scope. |
| Editors vs preview | GroupEditor + timeline edit **raw** groups; preview + render consume **derived** | Keeps drag targets honest; see Phase 4 note. |

**Flagged tension (not blocking):** with an automatic threshold pass on by default, the
"Fill gaps" button now means "close *all* gaps, including real pauses". Recommend
relabelling it **"Close all gaps"** and updating its tooltip. Cosmetic; call it in Phase 4.

---

## Phase 1 — Pure core + tests (frontend)

**TDD: write the tests first.** This phase is pure functions, no React, no backend.

### 1.0 Add the `endEdited` field and its lifecycle

`src/renderer/src/types/app.ts` — add to `Segment` (group-only, alongside
`positionOverride` at `:92-94`, and documented the same way):

```ts
/** Group-only: set when the user placed this group's `end` by hand (timeline
 *  right-edge/body drag, or the Groups editor's end-time field). Exempts the
 *  group from automatic gap closing and from the final-group hold, so a
 *  deliberately carved-out gap survives. Cleared whenever the group's bounds are
 *  recomputed from its words. Never set on source segments. */
endEdited?: boolean
```

Then apply the lifecycle table in 0.11 — three edits inside `groups.ts`:

- `moveWord` — it spreads `{ ...dst }` / `{ ...src }` into `finalizeBounds`, so the flag
  would survive a membership change. Clear it in `finalizeBounds` itself (that function is
  *the* "bounds recomputed from words" primitive, so clearing there covers every caller and
  is the least surprising place for it).
- `reconcileGroups` Rule 5 — the `sameWords` branch keeps the flag (correct); the
  `finalizeBounds(next)` branch clears it via the change above. Verify, don't re-implement.
- `restoreManualGroupState` — it already gates restoring `start`/`end` on byte-identical
  words; carry `endEdited` inside that **same** gate, next to `start`/`end`. Do **not** let
  it ride the group ID alone the way `positionOverride` does — this is a timing claim, and
  the function's own docstring explains why timing claims must not survive a re-chunk.

### 1.1 Add constants

`src/renderer/src/lib/renderConstants.ts` — follow the existing one-const-plus-comment
style at `:11-17`:

```ts
/** Gaps at or below this (seconds) are closed so captions don't flicker off
 *  between groups. 0 disables the pass. Travels to the backend as
 *  `gap_close_threshold`. */
export const DEFAULT_GAP_CLOSE_THRESHOLD = 0.25

/** The last group holds this long (seconds) past its own last word's end, so the
 *  final caption doesn't vanish the instant speech stops. Travels as
 *  `last_group_hold`. NOT idempotent — apply once per pipeline. */
export const DEFAULT_LAST_GROUP_HOLD = 1.0
```

### 1.2 Add `closeGroupGaps` to `lib/groups.ts`

New export, alongside `fillGroupGaps` (which stays). Signature:

```ts
export function closeGroupGaps(
  groups: Segment[],
  threshold: number,
  lastGroupHold: number
): Segment[]
```

Rules, in order — mirror the artifact's twelve-line algorithm:

1. Return `[]` for an empty input; never mutate the input (return new objects, per the
   immutability rule in the global coding-style rules).
2. For each consecutive pair `(a, b)`:
   - **Exemption** — skip if `a.endEdited` (the user placed that end by hand; see 0.10).
     This is checked on `a`, the group whose `end` would move — never on `b`.
   - **Guard 06** — skip unless `Number.isFinite` holds for `a`'s last word `end` and
     `b`'s first word `start`.
   - **Guard 02** — skip if `a.speaker !== b.speaker` (compare group `speaker`; both
     `undefined` counts as the same speaker).
   - `gap = b.start - a.end`
   - **Guards 01 + threshold** — apply only when `gap > 0 && gap <= threshold`; set
     `end = b.start`.
3. **Tail hold (replaces Guard 03)** — for the final group only, when `lastGroupHold > 0`
   **and not `endEdited`**: `end = Math.max(end, originalEnd + lastGroupHold)`.
4. `threshold <= 0` disables step 2 but **not** step 3 — they are independent dials.
5. Group `words`, `text`, `start`, membership, count, `positionOverride`, `endEdited` and
   per-word `overrides` are all untouched. Only group `end` moves.

Write the doc comment in the style of the surrounding functions in this file — they are
unusually thorough, and this one carries the non-idempotency warning from 0.6.

### 1.3 Fix the stale docstring

`groups.ts:63-64` — delete the "Mirrors the backend's `fill_group_gaps()`" claim (0.2)
and point at `closeGroupGaps` for the automatic path.

### 1.4 Tests — `src/renderer/src/lib/groups.test.ts`

Extend the existing `describe('fillGroupGaps')` block at `:136` with a new
`describe('closeGroupGaps')`. Use the AAA structure and descriptive names already used
in that file. The artifact's six cases, plus the amendment:

1. `closes a gap at or below the threshold` — end 2.31, next start 2.40, threshold 0.25 → 2.40.
2. `leaves a gap longer than the threshold alone` — end 2.31, next start 2.86 → unchanged.
3. `closes a gap exactly equal to the threshold` — pins the inclusive boundary.
4. `is idempotent for gap closing` — apply twice with `lastGroupHold: 0`, deep-equal.
5. `never bridges a speaker change` — 0.02s gap, differing `speaker` → unchanged.
6. `never changes group count, text, or start times` — assert before/after.
7. `holds the final group for lastGroupHold past its original end` — **the amendment.**
8. `does not hold the final group when lastGroupHold is 0`.
9. `does not apply the hold to any group but the last`.
10. `leaves a boundary alone when a word timing is not finite` — guard 06.
11. `never shortens an end` — overlapping groups (negative gap) unchanged.
12. `threshold 0 disables closing but still applies the hold`.

Exemption cases (the user's "manual edits win" choice):

13. `never extends a group whose end was edited by hand` — `endEdited: true`, 0.1s gap → unchanged.
14. `still closes the gap into an endEdited group` — the flag exempts `a`, not `b`; a
    preceding group with a short gap into an exempt group still closes.
15. `does not hold the final group when its end was edited by hand`.
16. `preserves endEdited on every returned group` — the pass must not strip it.

Lifecycle cases (add to the existing `describe`s for those functions):

17. `finalizeBounds clears endEdited` — via `moveWord` across two groups.
18. `mergeGroups / splitGroup drop endEdited` — they rebuild bounds from words.
19. `reconcileGroups keeps endEdited when the word set is unchanged`.
20. `reconcileGroups clears endEdited when the word set changed`.
21. `restoreManualGroupState carries endEdited only when words are byte-identical`.

**Verification:** `npx vitest run src/renderer/src/lib/groups.test.ts` — all green, and
the pre-existing `fillGroupGaps` tests still pass untouched.

---

## Phase 2 — Settings + config wiring

Per CLAUDE.md's snake_case↔camelCase bridge rule, a new setting means **three**
coordinated edits, plus sanitizer bounds.

### 2.1 `StudioSettings` — `src/renderer/src/components/studio/StudioPanel.tsx`

Add to the flat interface (near `wordsPerGroup` at `:57`) and to `STUDIO_DEFAULTS` (`:128`):

```ts
gapCloseThreshold: number   // seconds; 0 disables
lastGroupHold: number       // seconds; 0 disables
```

Defaults from the Phase 1 constants — import them, do not retype the numbers.

### 2.2 UI controls

Two sliders in the same StudioRow/StudioCard as `wordsPerGroup` (grouping is where a
user looks for this). Labels from the artifact: *"Hold captions across gaps shorter
than…"* (0–0.6s, step 0.05) and *"Hold final caption"* (0–3s, step 0.1).

### 2.3 `lib/settingsSanitize.ts`

Add to `NUMERIC_SETTING_SPECS`:

```ts
gapCloseThreshold: { min: 0, max: 5 },
lastGroupHold: { min: 0, max: 30 },
```

Bounds must mirror the Pydantic `Field(...)` added in 2.5. **No `fraction: true`** (0.13).
Add a case to `settingsSanitize.test.ts` proving a value of `2` survives unscaled — that
is the regression the `fraction` trap would cause.

### 2.4 `lib/render.ts`

In `buildRenderBody()`, alongside `words_per_group: settings.wordsPerGroup` (`:116`):

```ts
gap_close_threshold: settings.gapCloseThreshold,
last_group_hold: settings.lastGroupHold,
```

Plain seconds — **no `pct()`**.

Also confirm the `custom_groups` mapping at `:174` does not leak `endEdited` to the
backend. It is frontend-only state and `VideoRenderConfig` has no such field; the mapping
already picks fields explicitly (that is how `wid` is stripped), so this is a check, not
necessarily an edit.

### 2.5 `backend/models/schemas.py`

On `VideoRenderConfig`, next to `words_per_group` (`:158`):

```python
gap_close_threshold: float = Field(0.25, ge=0, le=5, description="Close inter-group gaps at or below this many seconds; 0 disables")
last_group_hold: float = Field(1.0, ge=0, le=30, description="Hold the final caption group this many seconds past its last word")
```

**Verification:** `npm run typecheck` clean; a config round-trip test asserting both
fields survive `buildRenderBody` → Pydantic without transformation.

---

## Phase 3 — Backend parity

### 3.1 Apply the pass inside `_build_groups`

`backend/exporters/video_render.py:282`. Change the signature to accept the two dials and
apply the pass to the assembled list **before returning**:

```python
def _build_groups(
    result: TranscriptionResult,
    words_per_group: int,
    gap_close_threshold: float = 0.0,
    last_group_hold: float = 0.0,
) -> list[dict]:
```

Defaults of `0.0` keep every existing caller — including the six test call sites in
0.3 — behaviourally identical until it opts in. Update the four `hyperframes_project.py`
call sites and `frame_qa.py:49` and `video_render.py:1340` to pass
`config.gap_close_threshold, config.last_group_hold`.

Also emit `"speaker": seg.speaker` in the group dicts (0.5) so Guard 02 is expressible.

Implement the pass as a small module-level helper (e.g. `_close_group_gaps(groups, threshold, hold)`)
so it is unit-testable without a `TranscriptionResult`, and mirror the TS rule order
from 1.2 **exactly** — same inclusive boundary, same guards, same tail-hold formula.

### 3.2 Leave the `custom_groups` branch alone

Per 0.4 the `custom_groups if custom_groups else _build_groups(...)` shape at all six
call sites is already correct: frontend-authored groups arrive pre-closed and must not be
passed through again. Add a one-line comment at `video_render.py:1337` recording *why*,
so a future reader does not "fix" the asymmetry.

### 3.3 Note the duration fallback

Add a comment at `video_render.py:1344-1349` (0.7) recording that `groups[-1]["end"]` is
now already held, so the `+ 1.0` fallback compounds — intentional and harmless.

### 3.4 Backend tests

New `backend/tests/test_group_gap_closing.py`, mirroring the twelve TS cases from 1.4 —
the two implementations must agree case for case. Add one cross-check asserting the
Python helper and the documented TS rules produce the same ends for a shared fixture
(hand-written word list; no audio, no model, no fixtures needed — the artifact's point
about testability).

**Verification:**
```bash
.venv-dev/bin/python -m pytest backend/tests/test_group_gap_closing.py
.venv-dev/bin/python -m pytest backend/tests/test_render_golden.py backend/tests/test_overlay_alpha.py
```
Goldens take a frozen group dict directly (`test_render_golden.py:102`), so
`_render_frame` output must be **byte-identical** — if a golden moves, the change leaked
somewhere it shouldn't have. `test_overlay_alpha.py` *does* call `_build_groups`
(`:186,310`) with a default config; confirm whether the new defaults shift its groups and,
if so, whether that is intended before touching any expectation.

---

## Phase 4 — Frontend integration

### 4.0 "Automatically after transcription/diarization" needs no pipeline hook

The user's requirement is that gap closing is already applied by the time a finished
transcription is presented — no button press. With the derived design that is **free and
automatic**: `displayGroups` is a `useMemo` over `groups`, and `groups` is populated by
`ResultsScreen`'s existing sync effect the moment `segments` arrive. There is nothing to
call at the end of the WhisperX pipeline, and nothing to add to `transcriber.py`.

Do **not** add a post-transcription hook, and do **not** write closed ends back through
`PUT /api/result`. Both would bake the pass into the stored transcript, which is exactly
what the artifact's Architecture section argues against and what makes the tail hold
compound (0.6).

### 4.1 Derive, don't bake

In `ResultsScreen.tsx`, add a `useMemo` deriving display groups from raw state:

```ts
const displayGroups = useMemo(
  () => closeGroupGaps(groups, settings.gapCloseThreshold, settings.lastGroupHold),
  [groups, settings.gapCloseThreshold, settings.lastGroupHold]
)
```

Then:
- **Preview** — change `:851` `overlaySegments={groups}` → `overlaySegments={displayGroups}`.
  **Leave `segments={groups}` at `:850` alone** — that is the timeline, and its drag
  targets must stay on raw ends (0.9).
- **Render payload** — the `onGroupsUpdate(groups, …)` call at `:187` publishes groups to
  `App` for `buildRenderBody`. Publish `displayGroups` there, so path 1 of 0.4 ships closed
  groups. Everything else in `ResultsScreen` keeps using raw `groups`.
- **GroupEditor** — keeps raw `groups`; it is an edit surface.

Do **not** route `displayGroups` through `setGroups` or `handleGroupsChange` — that flips
`groupsEdited` and bakes the hold into state.

### 4.2 Set `endEdited` at the three deliberate sites

Per 0.10:
- `ResultsScreen.tsx:416` `handleSegmentEdge` — set `endEdited: true` when
  `edge === 'end'` or `edge === 'body'`. Not for `'start'`.
- `GroupEditor.tsx:183` `commitEndEdit` — set it on the group it patches.
- `ResultsScreen.tsx:444` `handleWordEdge` — **do not** set it. The group's bounds widen
  there as a side effect of retiming a word, which is not a statement about the group's end.
  Add a comment saying so, because it is the one site where the omission looks like a bug.

Add a way back out: in `GroupEditor`, when a group is `endEdited`, show a small "reset"
affordance on the end field that clears the flag and restores `naturalEnd(g)` (that helper
already exists at `:160`). Without it an accidental 2px drag permanently exempts a group.

### 4.3 Legacy project migration

Per the note at the end of 0.11 — on project restore, adopt `endEdited: true` for any group
whose `end` differs from `Math.max(...words.map(w => w.end))`. A project saved before this
feature otherwise loses its hand-shaped gaps the first time it is opened.

### 4.4 Known cosmetic consequence — decide and record

The Groups editor and timeline show the *original* end while the preview holds the caption
longer. That is the correct trade (raw is the edit target) but it is visible. Options: leave
it (recommended for v1), or draw the held extension on the timeline as a non-draggable
ghost. Record the choice here rather than leaving it implicit.

### 4.5 Relabel the manual button

`ResultsScreen.tsx:790` — "Fill gaps" → "Close all gaps", and update the `title` tooltip
to say it ignores the threshold and closes every gap including real pauses.

**Verification:** `npm run typecheck`; `npx vitest run`; then `npm run dev:react` (not
`npm run dev` — it does not run Vite) and confirm by eye: captions no longer flicker
between groups, the screen still clears on a long pause, and the last caption lingers ~1s.

---

## Phase 5 — Verification

1. **Full suites**
   ```bash
   npm run typecheck
   npx vitest run
   .venv-dev/bin/python -m pytest backend/tests/
   ```
   (If pytest fails on a missing `huggingface_hub`, that is the known `.venv-dev` gap —
   install it, don't work around it.)

2. **Three-renderer parity** — this change moves group `end` values, which every renderer
   consumes, so the parity suite is mandatory, not optional:
   ```bash
   CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py
   ```
   Requires Node 22 + ffmpeg.

3. **Anti-pattern greps** — each must return nothing:
   ```bash
   grep -rn "fill_group_gaps" backend/                      # invented API (0.2)
   grep -rn "closeGroupGaps" src/renderer/src/components     # only the useMemo in ResultsScreen
   grep -rn "fraction: true" src/renderer/src/lib/settingsSanitize.ts | grep -i "gapclose\|lastgroup"
   grep -rn "word\.speaker\|w\.speaker" src/renderer backend # speaker is on Segment (0.5)
   grep -rn "endEdited" backend/                              # frontend-only state (2.4)
   grep -rn "closeGroupGaps" src/renderer/src/components/screens/ResultsScreen.tsx
   #   ↑ exactly one hit: the useMemo. More than one means it is being baked somewhere.
   ```

4. **Idempotency proof** — assert in a test that
   `closeGroupGaps(closeGroupGaps(g, 0.25, 0), 0.25, 0)` deep-equals one application, and
   document in the test name that this deliberately excludes the tail hold, which is not
   idempotent by design.

5. **Regression fixture** (artifact): if a `Vaclav Holusa.mp4` transcript is available,
   pin it — at `wordsPerGroup = 3`, threshold 0.30 it closed 11 of 13 boundaries and
   preserved 2, reproducibly across two runs. Optional; skip if the asset isn't in-repo.

6. **Manual QA checklist**
   - [ ] A freshly finished transcription already has gaps closed, with **no button press**
         and no visible re-layout after results appear (4.0).
   - [ ] Shorten a group's end by 0.1s in the timeline → the gap **stays open**; every other
         gap stays closed; the reset affordance restores it.
   - [ ] Shorten a group's end, then edit a word inside that group → bounds recompute and
         the exemption clears (0.11), i.e. the gap closes again.
   - [ ] Open a project saved before this change that had hand-shaped ends → they survive (4.3).
   - [ ] Threshold slider at 0 restores pre-change flicker behaviour exactly.
   - [ ] A multi-speaker clip (the artifact names `Christopher Nassare.mp4`, `SPEAKER_00`
         + `SPEAKER_01`) never holds one speaker's caption into the other's.
   - [ ] Last caption holds ~1s; verify in **both** the canvas preview and an exported MP4.
   - [ ] Change `wordsPerGroup` after rendering — boundaries re-derive, no stale holds.
   - [ ] Apply a preset and restore a project — both go through `sanitizeSettings`; confirm
         the two new seconds-valued fields survive unscaled.
   - [ ] Edit group membership by hand (merge/split/drag a word), then render — the
         `custom_groups` path still ships closed gaps (0.4 path 1).

---

## Out of scope

- Changing the destructive `PUT /api/agent/result` behaviour of any one-off batch script.
- Extending the tail hold to every group that precedes a *preserved* gap (a different,
  larger feature — see the Decisions table).
- Any change to `reconcileGroups`, `retimeWords`, or `/api/realign`.
