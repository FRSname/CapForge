# RSVP continuous flow — one sliding line across the transcript

> **Status: implemented 2026-08-12.** Read this section before the plan below it —
> two design calls changed during execution, and the plan's own numbers were
> guesses that measurement replaced.
>
> **What shipped**
> - `backend/exporters/rsvp_reels.py` + `src/renderer/src/lib/rsvpReels.ts`, pinned
>   by `backend/tests/fixtures/rsvp_reel_cases.json` (21 cases, read by both).
> - The merge is applied at exactly two points: `groups_for_render()` (which serves
>   Pillow, the HyperFrames caption track and frame QA) and `useSubtitleOverlay`.
> - Culling + a per-reel layout cache in Pillow and Canvas; `_frame_state_key`
>   fixed for RSVP; `SCAFFOLD_VERSION` 10 → 11.
> - Tests: `test_rsvp_reels.py` (75), `rsvpReels.test.ts` (76),
>   `test_rsvp_reels_render.py` (12), three RSVP dedup scenarios, a `cull` section
>   in the generated Canvas↔Pillow fixture, five hook tests, and a cross-boundary
>   case in the opt-in three-way parity suite (26 → 27, unmodified tolerances).
>
> **Where it deviated from the plan below**
> - **The reel rule is not in the three-way scalar core (§3).** It is a group-list
>   transform, not a rendering formula — exactly the shape of gap closing, which
>   likewise has a TS twin and a Python twin and no HTML copy. The HTML layer is
>   handed merged groups by Python, so a third implementation would be a third
>   thing to drift. The cull helpers went to the *layout* twins
>   (`rsvp_layout.py` ↔ `overlayGeometry.ts`) for the same reason, where the
>   existing two-sided numeric fixture already pins that pair.
> - **No speaker-change break** (the plan's D2 included one). `CustomGroup` carries
>   no `speaker`, so the rule would fire in the Canvas preview and not in the
>   render — a parity divergence. Gap closing already refuses to bridge a speaker
>   change, so any real pause between speakers breaks the reel anyway. The fixture
>   pins the *ignoring* of it.
> - **Per-group `position_override` is honoured, not ignored** (the plan's D4). A
>   differing override breaks the reel, so no user setting is silently dropped and
>   the vertical jump the plan worried about cannot happen mid-reel.
> - **The plan's §0.2 cache bug was real**: reproduced with the dedup harness (the
>   stale key `(0, ('P','A','F'))` replayed a mid-slide frame for a whole word),
>   then fixed.
> - **The HTML layer needed no work and got smaller** (300 clips → 1; 65.6KB →
>   41.0KB of markup for 900 words). Node count is unchanged, but they now live in
>   one clip that is visible for the whole reel — browser paint cost at that scale
>   is the one thing still unverified, and belongs to manual QA.
> - **New accepted delta**: reels accumulate the pre-existing Chromium-vs-PIL
>   kerning difference over more words (bounded by the visible window). Documented
>   in `docs/caption-parity.md`.

**Status**: implemented — the plan as written follows
**Branch**: builds on `feat/rsvp-reading-mode` (6 commits, pushed, **unmerged**)
**Goal**: in `reading_mode: 'rsvp'`, words flow continuously through the transcript
instead of restarting at every caption group. Crossing a group boundary must look
exactly like crossing a word boundary — one more slide, no snap, no fade-out/in, no
re-layout.

---

## 0. What is true today (verified against source, 2026-08-12)

RSVP is currently **scoped to one group**. All three renderers do the same four steps:

| Step | Pillow (truth) | Canvas | HTML/GSAP |
|---|---|---|---|
| pick active group (`start <= t < end`) | `_FrameSource.frame_group_indices` (`video_render.py:1398-1406`) | `useSubtitleOverlay.ts:106-113` | one clip per group, `caption_markup()` / `caption_groups_json()` (`hyperframes_caption_html.py:119,184`) |
| layout the group's words as one unwrapped row | `video_render.py:1014-1023` (`rows = [all_metrics]`) | `useSubtitleOverlay.ts:262` (`rows = isRsvp ? [wm] : splitIntoRows(...)`) | `__capRsvpBuild` (`hyperframes_rsvp_runtime.py:251-277`) |
| cumulative `wordX` + one `focusOffset` per word | `rsvp_layout.layout_line` (`rsvp_layout.py:252`) | `computeRsvpPositions` (`overlayGeometry.ts`) | `hyperframes_rsvp_runtime.py:264-277` |
| translate the whole row by `lineOffsetAt(t, …)` | `rsvp_layout.draw_line` (`rsvp_layout.py:421`) | `useSubtitleOverlay.ts:318-337` | `setLineX` / `tl.fromTo` (`hyperframes_rsvp_runtime.py:399,419-427`) |

Consequences of "one group": at each group boundary the line **re-lays out from zero**,
snaps to `target(0)` (`lib/rsvp.ts:330` — index 0 snaps, never eases), the previous
group's context words vanish, and the group entry/exit animation fires again.

Shared scalar core, already triplicated and fixture-pinned (`lib/rsvp.ts:10-23`):
`backend/exporters/rsvp.py` · `src/renderer/src/lib/rsvp.ts` · `RSVP_RUNTIME_JS` in
`backend/exporters/hyperframes_rsvp_runtime.py`, pinned by
`backend/tests/fixtures/rsvp_{orp,focus_offset,focus_slices,last_started,line_offset}_cases.json`.

Two facts that shape the whole plan:

1. **Layout is recomputed every frame.** At 3 words/group that is free. Over a
   1500-word reel it is 1500 `font.getlength()` / `measureText()` calls **per frame**.
   Continuous flow is not just a scoping change — it forces layout to be computed
   **once per reel** and cached.
2. **The Pillow frame cache is already RSVP-unsafe.** `_frame_state_key`
   (`video_render.py:1275`) keys on `(group_index, per-word A/P/F states)` and has no
   RSVP term — nothing in `video_render.py:1262-1420` mentions RSVP, and
   `backend/tests/test_render_dedup.py` has no RSVP case. During the
   `rsvp_slide_duration` window (default `0.06 s`, `schemas.py:188`) the state tuple is
   constant while the line offset animates, so the first mid-slide frame of a word is
   cached and replayed for that word's whole span — the line freezes mid-slide.
   Reproduce it before fixing it; it is a pre-existing bug on the branch, and
   continuous flow does not create it but does make every boundary hit it.

---

## 1. Design decisions (recommended, with the alternative stated)

**D1 — No new setting. RSVP becomes continuous, full stop.**
The branch is unmerged, so there is no behaviour to preserve. A `rsvpContinuous`
toggle would mean the 7-file settings dance (CLAUDE.md → snake_case bridge) *plus* a
second RSVP code path in three renderers *plus* doubled fixtures, to keep a mode
nobody has shipped. If QA later wants per-group RSVP back, add the toggle then.

**D2 — The unit of layout becomes a *reel*: a maximal run of groups that touch.**

```
reel break between groups a, b  iff  a.end < b.start
```

Nothing else. This is deliberately the existing blanking rule: today the caption is
blank exactly when `a.end < b.start`, so **continuity is added without changing when
captions appear or disappear**. Gap closing already snaps `a.end` to `b.start` when
the gap is ≤ `gap_close_threshold` (default `0.25 s`, `schemas.py:159`) and never
bridges a speaker change (`video_render.py:309`), so in ordinary speech a reel is a
whole sentence or paragraph, and a real pause or a speaker change breaks it — which is
where an RSVP line *should* break.

No new knob, no epsilon: `gapCloseThreshold` becomes the continuity control.
Consequence to document: with `gapCloseThreshold = 0` reels degenerate to single
groups (i.e. today's behaviour). If QA finds reels too fragmented, the follow-up is a
dedicated `rsvpReelGap` — not part of this plan.

Reels are **derived**, never stored: a pure function of the (already gap-closed)
group list, computed identically in all three renderers. No schema change, no
`custom_groups` payload change.

**D3 — Group entry/exit animation applies per reel, not per group.**
Otherwise the line fades out and in at every boundary — the exact artefact being
removed. `animation`/`animation_duration` key off `reel.start` / `reel.end`.

**D4 — Per-group `position_override` is ignored in RSVP.**
A reel spans groups, so a per-group vertical position has no single answer; honouring
the anchored word's group would make the whole line jump mid-sentence. Add it to
"Settings RSVP ignores" (`docs/caption-parity.md:112`), alongside `lines` and
`word_transition`. Per-**word** `pos_offset_x/y` are unaffected — they move the drawn
word, never the layout (`hyperframes_rsvp_runtime.py:296-298`).

**D5 — Culling must be provably pixel-neutral, so the window is generous.**
Pillow and Canvas must skip words far outside the visible window or a 1500-word reel
costs 1500 draw ops per frame. The window is **not** the band: with
`rsvp_edge_fade == 0` there is no mask and the line deliberately overflows the band to
the frame edges (`hyperframes_rsvp_runtime.py:374-376`). So:

```
visible window = band            when fadePx > 0   (the mask zeroes everything outside)
               = [0, resW)       when fadePx == 0
then widen by `bleed` on both sides
```

`bleed` covers stroke, shadow offset+blur, per-word box padding and per-word
`pos_offset_x`. Make it deliberately loose (a whole em plus the measured extras) —
drawing a handful of invisible words costs nothing, and a tight window that clips one
antialiased pixel is a parity break. The HTML layer does **not** cull: its mask already
produces the same pixels by construction, which is what makes the cull safe to reason
about (Pillow/Canvas skip only what HTML draws at alpha 0).

---

## 2. Phase 0 — Documentation discovery (the executing session starts here)

Read, in this order, before writing any code. Do not skip: every rule below has a
"don't reinvent this" trap attached.

1. `docs/caption-parity.md` — whole file, then `## RSVP reading mode` (L35-135)
   closely: the band/pivot derivation (L77), the half-open box convention (L108),
   settings RSVP ignores (L112), accepted deltas (L120), how to run the suites (L130).
2. `src/renderer/src/lib/rsvp.ts` — the whole file is the contract, including the
   docstring invariants (L25-40: presentation only, injected measurement,
   `lineOffsetAt` a pure function of `t`, code points not code units).
3. `backend/exporters/rsvp.py` and `RSVP_RUNTIME_JS`
   (`backend/exporters/hyperframes_rsvp_runtime.py:1-250`) — the two twins.
4. `backend/exporters/rsvp_layout.py` — `caption_band` (L212), `layout_line` (L252),
   `apply_edge_fade` (L305), `draw_line` (L421).
5. `backend/tests/fixtures/rsvp_*_cases.json` + the three suites that read them:
   `backend/tests/test_rsvp_core.py`, `src/renderer/src/lib/rsvp.embedded.test.ts`,
   `src/renderer/src/lib/rsvpFixtures.testutil.ts`. **Copy this fixture pattern** for
   the two new functions; do not hand-write three parallel test bodies.
6. `backend/exporters/video_render.py:1262-1420` — `_frame_state_key` and
   `_FrameSource`, plus `backend/tests/test_render_dedup.py` (the equivalence test that
   must be extended).
7. `docs/plans/rsvp-speed-reading-mode.md` — the original plan, for the ORP table
   provenance and the reference-clip evidence.

**Allowed-API note**: everything this feature needs already exists. The only new
public functions are the two added in Phase 1. Do not invent helpers on
`CaptionBand`, do not add parameters to `lineOffsetAt` / `lastStartedIndex` /
`focusOffset` — they are fixture-pinned in three languages and their signatures are
part of the contract.

---

## 3. Phase 1 — Shared core: reels + visible window (TDD, fixtures first)

**What to implement** — two pure functions, added to all three twins with identical
semantics, in the same style as the existing five:

```
buildReels(groups) -> list of {startIndex, endIndex, start, end}
    Maximal runs where groups[i].end >= groups[i+1].start.
    Empty list -> empty. Never mutates or re-orders groups.

rsvpVisibleWindow(band, fadeFrac, resW, bleed) -> {left, right}
    fadeFrac > 0 -> band widened by bleed; else [0, resW) widened by bleed.
```

Order of work:

1. Write `backend/tests/fixtures/rsvp_reel_cases.json` and
   `rsvp_visible_window_cases.json` **first**. Cover: single group; two touching; two
   with a gap; exact equality (`a.end == b.start` → same reel); overlapping
   (`a.end > b.start` → same reel); a zero-length group; empty input; a speaker-change
   break (already expressed as a gap by the time RSVP sees it); `fadeFrac == 0`;
   `fadeFrac > 0`; `bleed == 0`.
2. Add the three test bodies that read them, copying
   `backend/tests/test_rsvp_core.py` / `rsvp.embedded.test.ts` /
   `rsvpFixtures.testutil.ts` verbatim in structure. Watch them fail.
3. Implement in `backend/exporters/rsvp.py`, `src/renderer/src/lib/rsvp.ts` and
   `RSVP_RUNTIME_JS`, in that order (Pillow is the source of truth).

**Verification**
- `pytest backend/tests/test_rsvp_core.py` green.
- `npx vitest run src/renderer/src/lib/rsvp` green (both the TS and the embedded suite).
- `grep -c "buildReels\|build_reels" ` finds it in exactly the three twins plus tests.

**Anti-pattern guards**
- No fourth copy of the reel rule inline in a renderer — call the core.
- Do not fold the reel rule into gap closing (`lib/groups.ts` / `video_render.py:353`).
  Gap closing *moves* a group's `end`; reels only *read* it. Keep them separate or the
  next `endEdited` change silently reshapes reels.
- No `Date`, no accumulated state: `buildReels` is a pure function of the group list
  and `rsvpVisibleWindow` a pure function of its four scalars.

---

## 4. Phase 2 — Pillow (the source of truth)

**What to implement**

1. **Reel selection.** In `_FrameSource.__init__` (`video_render.py:1396-1406`), build
   `frame_reel_indices` alongside the existing group lookup when
   `reading_mode == 'rsvp'`. Same shape, same blank-frame fast path — a frame with no
   reel is blank exactly as a frame with no group is today.
2. **Cached per-reel layout.** New helper (put it in `rsvp_layout.py`, not
   `video_render.py`, which is far past the size ceiling): given a reel's word list +
   font + config, return the frozen layout — per-word metrics, cumulative `wordX`,
   `focusOffsets`, `pieces`. Memoize per `(reel_index, font, config)` for the render
   job. `_render_frame` looks it up instead of re-measuring. **This is the perf
   deliverable**, not an optimisation to defer: without it a 1500-word reel re-measures
   every word on every frame.
3. **Draw the reel, culled.** `rsvp_layout.draw_line` takes the visible window from
   `rsvpVisibleWindow` and skips words entirely outside it. `lineOffsetAt` /
   `lastStartedIndex` still run over the **whole reel** (indices must not shift), only
   drawing is culled.
4. **Per-reel animation** (D3) and **ignore `position_x`/`position_y` overrides**
   (D4) in the `is_rsvp` branch at `video_render.py:1003-1010`.
5. **Fix `_frame_state_key` for RSVP.** Add an RSVP term: return `None` while
   `t ∈ [anchor.start, anchor.start + rsvp_slide_duration)`, and include
   `(reel_index, lastStartedIndex(...))` in the key. Extend
   `backend/tests/test_render_dedup.py` with an RSVP case that **fails first** against
   today's key (that is the reproduction of the bug in §0.2).

**Verification**
- `pytest backend/tests/test_rsvp_layout.py test_rsvp_render.py test_rsvp_reticle.py test_rsvp_background_box.py test_rsvp_canvas_fixture.py test_render_dedup.py test_render_golden.py`
- New test: rendering a two-group reel produces **no** discontinuity — the line offset
  at `t = boundary - ε` and `t = boundary + ε` differs by less than one word advance,
  and the frame at the boundary is not `target(0)`.
- New test: the cull is pixel-neutral — same frame bytes with the cull forced off.
- Perf gate: record ms/frame for a ≥ 1000-word transcript before and after; the
  cached-layout path must not be worse than the current per-group path.

**Anti-pattern guards**
- Do not re-slice `segments.flatMap(s => s.words)` to build a reel's word list — the
  reel is a run of **groups**; concatenate `group["words"]` in group order (CLAUDE.md →
  group membership is reconciled by word identity, never position).
- Do not touch any word's `start`/`end`. RSVP is presentation only (`lib/rsvp.ts:27`).
- Do not let the cull change indices handed to `lineOffsetAt`.

---

## 5. Phase 3 — Canvas preview

**What to implement** — mirror Phase 2 exactly, in the same order, in
`src/renderer/src/hooks/useSubtitleOverlay.ts` (+ `lib/overlayGeometry.ts`):

1. Replace the active-**group** scan (L106-113) with an active-**reel** scan in RSVP
   mode; the wrap path keeps the group scan untouched.
2. Memoize the reel layout in a ref keyed by `(reelIndex, settings-that-affect-layout,
   font)` — the hook currently re-measures every word inside `draw()` (L250-262),
   which is per-frame at 60 fps.
3. Cull with `rsvpVisibleWindow`, same bleed formula as Pillow.
4. Per-reel `age`/`remaining` (L164-165); ignore `positionOverride` (L267) in RSVP.

**Verification**
- `npx vitest run src/renderer/src/hooks/useSubtitleOverlay.rsvp.test.ts`
- `pytest backend/tests/test_rsvp_canvas_fixture.py` — the Canvas↔Pillow numeric
  fixture must be extended with a cross-boundary case and stay asserted from both sides.
- `npm run typecheck && npm run lint`

**Anti-pattern guards**
- The hook renders in the vitest **node** environment via `react-dom/server`
  (CLAUDE.md → Testing): no DOM events, no effect-driven assertions. Write the new
  tests as pure calls into `overlayGeometry` / `rsvp` helpers, which is how the
  existing RSVP hook tests are shaped.
- Always call `draw()` after mutating a ref — a React re-render does not repaint a
  canvas.

---

## 6. Phase 4 — HTML/GSAP runtime

**What to implement**

1. `hyperframes_caption_html.py` emits **one clip per reel** in RSVP mode instead of
   one per group (`caption_markup` L119-124, `caption_groups_json` L184,
   `caption_payload_js` L246). The wrap path is unchanged.
2. `__capRsvpBuild` (`hyperframes_rsvp_runtime.py:251`) already builds the whole row
   from `wm` and schedules one `setLineX` per word start — feed it the reel's words and
   it is correct with no algorithmic change. **No culling here** (D5): the mask already
   yields the right pixels.
3. **Bump `SCAFFOLD_VERSION`** in `backend/exporters/hyperframes_project.py` — the
   embedded runtime changes shape, and a stale fingerprint serves a stale cached
   preview runtime (`docs/caption-parity.md:151`).

**Verification**
- `pytest backend/tests/test_rsvp_html_layout.py test_hyperframes_project.py`
- `node backend/tests/rsvp_html_harness.js` path exercised by the above.
- Opt-in parity (needs Node 22 + ffmpeg): `pytest backend/tests/test_caption_parity.py`
  with a **new cross-boundary RSVP case** added to the existing four
  (`docs/caption-parity.md:164`). Do not loosen a tolerance to make it pass — the branch
  currently passes unloosened and must keep doing so.
- Perf gate: DOM node count and HyperFrames render time for a ≥ 1000-word reel
  (≈ 4 nodes/word). If it regresses materially, the fix is timeline-scheduled
  `display` toggles at each word's computable enter/leave time — **not** splitting the
  reel, which would reintroduce the seam this whole plan removes. Record the numbers
  either way.

---

## 7. Phase 5 — Verification, docs, QA

1. **Full gates**: `npm run typecheck`, `npm test`, `npm run lint`,
   `pytest backend/tests`, `pytest mcp_server/tests` (bare `pytest` silently skips it —
   CLAUDE.md), `pytest backend/tests/test_caption_parity.py` and the golden-frame suite.
2. **Anti-pattern grep sweep**:
   - `grep -rn "reading_mode\|readingMode" backend src` — no new `'rsvp'` value leaked
     into the `WordTransition` union or `WordStylePopup`.
   - reel rule appears only in the three twins.
   - no new `Field(...)` in `VideoRenderConfig` (D1) — if one appears,
     `backend/tests/test_caption_cfg_contract.py` fails the backend job by design, and
     the 7-file settings change from CLAUDE.md is now mandatory.
3. **Docs**: update `docs/caption-parity.md` — a "continuous flow / reels" subsection
   under `## RSVP reading mode` stating the reel rule, per-reel animation, the ignored
   per-group position override (add to L112 list), the cull-is-pixel-neutral argument
   and the new fixtures. Update the CLAUDE.md RSVP paragraph to say the layout unit is
   the reel, not the group.
4. **Manual QA** (still open for the whole RSVP branch per memory): a real clip in the
   app — scrub backwards across a boundary and confirm the offset is identical to
   playing forwards (`lineOffsetAt` is a pure function of `t`); `gapCloseThreshold = 0`
   degrades to today's behaviour; long pause still blanks; speaker change still breaks.
5. **Commit** per logical change via the `git-ops` agent, on `feat/rsvp-reading-mode`.

---

## 8. Out of scope (say no to these)

- A `rsvpContinuous` toggle (D1) or an `rsvpReelGap` knob (D2) — follow-ups if QA asks.
- Changing gap closing, `endEdited`, or the last-group hold.
- Any re-timing, re-ordering or re-slicing of words.
- Touching the wrap path. Every change is inside an `is_rsvp` branch.
