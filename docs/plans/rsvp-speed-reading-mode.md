# Plan: RSVP "speed reading" caption mode (`reading_mode: rsvp`)

**Status:** planned, not started
**Branch suggestion:** `feat/rsvp-reading-mode`
**Orchestration:** each phase is dispatched to the `implementer` agent (never pass a model override — agent pins handle routing). Use `scout` only if a phase hits a fact gap. Phases are self-contained; run them consecutively in fresh contexts.
**Reference clip:** `~/Downloads/ScreenRecording_08-11-2026 20-51-44_1.mov` (1320×2868, 60fps, 5.2s)

---

## Problem

CapForge has nine per-word *decoration* modes (`word_transition`: instant, crossfade, highlight,
underline, bounce, scale, karaoke, reveal, none). All nine share one layout: words are wrapped
into rows and drawn at fixed positions; only the active word's **color/scale/offset** changes.

The requested effect is different in kind. It is **RSVP** (Rapid Serial Visual Presentation, the
"Spritz" reading technique): a single unwrapped line of text that **slides horizontally** so that
one specific letter of the active word — the Optimal Recognition Point (ORP) — always lands on a
**fixed pivot column**. The eye never moves; the text moves under it. That is a *layout* mode,
not a decoration mode.

### Measurements taken from the reference clip (do not re-derive; these are ground truth)

| Property | Measured value | Method |
|---|---|---|
| Pivot column | **x = 479 px, stable ±2 px across all 156 sampled frames** | tracked the orange focus glyph's bbox centre at 30fps over the whole clip |
| Pivot as fraction of caption band | **≈ 35 %** of band width (band ≈ x 66→1260) | 413 / 1194 |
| Focus-letter rule | **Spritz ORP** (see table below) | `eliminates`(10)→3, `surprising`(10)→3, `concept`(7)→2, `movements`(9)→2, `amount`(6)→2, `small`(5)→1, `rapid`(5)→1, `the`(3)→1, `eye`(3)→1 — 9/9 agree |
| Focus-letter colour | **rgb(228, 133, 31) ≈ `#E4851F`** | mean of saturated-orange pixels across 3 tight crops |
| Active word | white, visually heavier; **same cap-height as context words** | strip comparison — no size change |
| Context words | desaturated cyan/teal, both sides of the active word | hue-gated sampling |
| Word cadence | **117 ms**, constant (≈510 WPM) | frame-difference transition detection, modal gap |
| Slide duration | **≈33 ms (2 frames @60fps), range 17–50 ms**, eased | length of each motion run |
| Reticle | a short horizontal rule with a small orange notch at the pivot, **above and below** the line | zoom crops `z1_02.png`, `z2_02.png` |

### Spritz ORP table (the exact rule, confirmed 9/9 against the clip)

| Token length | Focus index (0-based) |
|---|---|
| ≤ 1 | 0 |
| 2 – 5 | 1 |
| 6 – 9 | 2 |
| 10 – 13 | 3 |
| ≥ 14 | 4 |

---

## Decisions already taken (user-confirmed — do not re-litigate)

1. **Timing is audio-driven, not constant-WPM.** The reference runs at a fixed 510 WPM because
   it is a text reader with no audio. CapForge captions are locked to WhisperX word timings, so
   each word holds for its real `start`→`end` and the slide fires at each word boundary. This
   preserves the repo-wide invariant "Timing is never shifted" (`CLAUDE.md` → Word-timing
   locality). **Do not add a WPM dial.**
2. **The window is group-scoped.** The RSVP line contains exactly the current group's words and
   resets at each group boundary. Every existing setting (`words_per_group`, position, per-group
   `positionOverride`) keeps working unchanged, and no cross-group plumbing is needed. **Do not
   make the line span the whole transcript.**

---

## Architectural decision: RSVP is a new **layout** axis, NOT a `word_transition` value

This is the load-bearing call in the plan. Add a new orthogonal field `reading_mode`
(`'wrap' | 'rsvp'`, default `'wrap'`); do **not** add `'rsvp'` to `word_transition`.

Three repo-verified reasons:

1. **`word_transition` is per-word overridable.** `_WORD_OVERRIDE_KEYS`
   (`backend/exporters/hyperframes_caption_html.py:128-134`) includes `word_transition`, and
   `WordStylePopup.tsx` exposes it per word. "Make *this one word* use RSVP layout" is
   meaningless — RSVP is a property of the whole line.
2. **Every existing mode branches inside the per-word draw loop, after layout is fixed.** RSVP
   must replace layout itself:
   - Canvas: `computeWordPositions()` — `src/renderer/src/lib/overlayGeometry.ts:193-219`
   - Pillow: the x-accumulation loop — `backend/exporters/video_render.py:558-566`
   - HTML: browser CSS flow layout
   None of these are reachable from the mode switch (`useSubtitleOverlay.ts:506-576`,
   `video_render.py:776-841`, `hyperframes_caption_html.py:601-669`).
3. **Scout confirmed no existing animation translates a word in x/y.** Position offsets
   (`pos_offset_x/y`) are static deltas; only the highlight *pill* slides, and that animates the
   pill box, not text. RSVP is the first motion of this class — it does not belong in a switch
   whose every other arm leaves layout alone.

### The one formula that makes parity tractable

Do **not** position each word independently. Lay the group out as a single unwrapped line using
the **existing** per-word width measurement in each renderer, then apply **one line-level x
translation**:

```
focusOffset(i)  = wordX[i] + measure(word[i][0 : f]) + measure(word[i][f]) / 2
                  where f = orpIndex(word[i])
lineX(t)        = pivotPx − focusOffset(activeIndex)
```

and ease `lineX` between consecutive words over `rsvp_slide_duration`. Because the only new
per-renderer primitive is "measure a prefix of a word" — and all three already measure word
widths the same way (`ctx.measureText` ≡ `font.getlength`, per `docs/caption-parity.md:11-21`) —
parity reduces to one shared scalar. The HTML layer gets this for free as
`transform: translateX()` on the row container, which GSAP tweens natively.

---

## Phase 0 — Documentation Discovery (DONE — consolidated scout findings)

Sources: `StudioPanel.tsx`, `AnimationCard.tsx`, `LayoutCard.tsx`, `render.ts`,
`overlayGeometry.ts`, `useSubtitleOverlay.ts`, `settingsSanitize.ts`, `settingsSearch.ts`,
`schemas.py`, `video_render.py`, `hyperframes_caption_html.py`, `hyperframes_project.py`,
`test_caption_cfg_contract.py`, `test_caption_parity.py`, `test_render_golden.py`,
`gen_golden.py`, `docs/caption-parity.md`, `.github/workflows/ci.yml`.

### Allowed APIs / exact touch points

| Concern | Location | Fact |
|---|---|---|
| Settings interface | `src/renderer/src/components/studio/StudioPanel.tsx:27-102` | flat `StudioSettings`; `DEFAULTS` at 143-161 |
| Existing colours to REUSE | `render.ts:100-101` | `text_color: settings.textColor`, `active_word_color: settings.activeColor` — context + active words need **no new settings** |
| `pct()` helper | `src/renderer/src/lib/render.ts:24` | divides 0–100 settings by 100 |
| Canvas layout | `src/renderer/src/lib/overlayGeometry.ts:193-219` | `computeWordPositions()` builds `wordXPos[]`/`wordYPos[]` |
| Canvas measurement | `useSubtitleOverlay.ts:166-167` | `measureTrackedWidth(text, trk, s => ctx.measureText(s).width)` |
| Canvas mode switch | `useSubtitleOverlay.ts:506-576` | per-word draw switch |
| Canvas active word | `useSubtitleOverlay.ts:425` | `m.start <= currentTime && currentTime < m.end` |
| Pillow layout | `backend/exporters/video_render.py:558-566` | x-accumulation loop over `word_metrics` |
| Pillow measurement | `video_render.py:948-956` | `_measure_word()` → `font.getlength()` + tracking |
| Pillow draw dispatch | `video_render.py:776-841` | colour branches + position branches in `_draw_word_list()` |
| Pillow active word | `video_render.py:661-662` | `active_idx = next(...)` |
| HTML runtime | `backend/exporters/hyperframes_caption_html.py:601-669` | GSAP timeline construction in `CAPTION_RUNTIME_JS` |
| HTML `caption_cfg()` | `hyperframes_caption_html.py` | every new EXPECTED field must be emitted here |
| Scaffold cache | `backend/exporters/hyperframes_project.py:50` | `SCAFFOLD_VERSION` — **MUST bump** (runtime JS shape changes) |
| Partition test | `backend/tests/test_caption_cfg_contract.py:44-94` / `102-153` / `212-262` | `EXPECTED_IN_CAP_CFG`, `INTENTIONALLY_ABSENT`, `_SENTINELS` |
| Parity suite | `backend/tests/test_caption_parity.py:158-159` | `@pytest.mark.parametrize("mode", [...])` |
| Goldens | `backend/tests/golden/` (11 PNGs), `backend/tests/gen_golden.py` | tolerance `MAX_MEAN_DIFF=2.0`, `MAX_PIXEL_DIFF=40` (`test_render_golden.py:34-36`) |

### Anti-patterns (repo-verified — do NOT do these)

- **Do not** add `'rsvp'` to `word_transition` / `wordStyle`, `types/app.ts`'s `WordTransition`
  union, or `WordStylePopup.tsx`. See the architectural decision above.
- **Do not** synthesize bold for the active word. `docs/caption-parity.md:11-21` and CLAUDE.md
  both state there is no synthetic bold — all three renderers use the chosen font file as-is.
  The reference's "bolder" active word is reproduced with **colour + context opacity** only.
  (An optional `font_size_scale`-style bump is explicitly out of scope for v1.)
- **Do not** re-time, re-order, or re-slice words. RSVP is presentation-only; it reads
  `start`/`end` and never writes them.
- **Do not** position words individually in the HTML layer with per-word `left:` values —
  measure-and-translate the row container instead, or the browser's sub-pixel layout will
  diverge from Pillow's float accumulation and blow the 3px parity tolerance.
- **Do not** mark `rsvp_slide_duration` as `fraction: true` in `NUMERIC_SETTING_SPECS` — it is
  **plain seconds**, same unit contract as `gapCloseThreshold`/`lastGroupHold`
  (`settingsSanitize.ts:48-57`). Marking it `fraction` would re-read a legitimate `0.06` fine
  but a future `1` as `0.01`.
- **Do not** forget `SCAFFOLD_VERSION` — byte-identical inputs would serve a stale preview
  runtime (CLAUDE.md → HyperFrames Integration).
- **Do not** duplicate the ORP table by hand in three places without the shared literal test
  table from Phase 1 — three drifting copies is precisely the bug class the parity suite exists
  to catch.

### New settings (7 fields) — unit contract fixed up front

| `StudioSettings` (camel) | `VideoRenderConfig` (snake) | Unit | `pct()`? | `NUMERIC_SETTING_SPECS` |
|---|---|---|---|---|
| `readingMode` | `reading_mode` | `'wrap'\|'rsvp'`, default `'wrap'` | no | n/a (string) |
| `rsvpPivotX` | `rsvp_pivot_x` | 0–100 % of caption band | **yes** | `{ min: 0, max: 100 }` |
| `rsvpFocusColor` | `rsvp_focus_color` | hex, default `#E4851F` | no | n/a (string) |
| `rsvpContextOpacity` | `rsvp_context_opacity` | **0–1 fraction**, default `0.75` | no | `{ min: 0, max: 1, fraction: true }` |
| `rsvpSlideDuration` | `rsvp_slide_duration` | **plain seconds**, default `0.06` | no | `{ min: 0, max: 1 }` — **not** `fraction` |
| `rsvpEdgeFade` | `rsvp_edge_fade` | 0–100 % of band width, default `12` | **yes** | `{ min: 0, max: 50 }` |
| `rsvpReticle` | `rsvp_reticle` | bool, default `true` | no | n/a (bool) |

All seven are `EXPECTED_IN_CAP_CFG` (all affect HTML caption rendering) and therefore all seven
need `_SENTINELS` entries.

### Settings ignored while `reading_mode == 'rsvp'` (document, don't silently drop)

`lines` (forced to 1), `alignment` (the pivot governs), and `word_transition` (RSVP owns word
colouring). Group entry/exit `animation` **still applies** to the line as a whole — keep it.

---

## Phase 1 — Shared ORP core + its cross-language pin (agent: implementer)

Do this first and alone. It is ~80 lines of pure logic with no rendering, and every later phase
depends on it agreeing byte-for-byte across three languages.

### What to implement

1. Create `src/renderer/src/lib/rsvp.ts` exporting pure functions:
   - `orpIndex(token: string): number` — the Spritz table above, operating on the **whole
     whitespace token including punctuation** (see Open decisions).
   - `focusOffset(wordX: number, token: string, f: number, measure: (s: string) => number): number`
     — implements the `focusOffset` formula verbatim.
   - `lineOffsetAt(...)` — eased interpolation of `lineX` between the previous and current
     active word over `rsvpSlideDuration`, returning the line's x translation at time `t`.
     Use the repo's shared quadratic ease-out `1 − (1−t)²` (`docs/caption-parity.md` — this is
     GSAP `power1.out`, **not** `power2`).
   - `RSVP_ORP_TABLE` — the length→index breakpoints as an exported const, so the test can
     assert against the data rather than the function.
2. Create `backend/exporters/rsvp.py` with the identical three functions in Python
   (`orp_index`, `focus_offset`, `line_offset_at`) and the same table constant.
3. Add the same three functions to the embedded JS in
   `hyperframes_caption_html.py`'s `CAPTION_RUNTIME_JS`, as a small `RSVP` helper object placed
   above the timeline-construction block (601-669).
4. Create the **shared literal fixture** `backend/tests/fixtures/rsvp_orp_cases.json`:
   a list of `{ "token": "...", "index": N }` covering at minimum every token measured from the
   reference clip (`eliminates`→3, `surprising`→3, `concept`→2, `movements`→2, `amount`→2,
   `small`→1, `rapid`→1, `the`→1, `eye`→1, `a`→0) plus boundary cases at lengths
   1/2/5/6/9/10/13/14 and tokens with trailing punctuation.
5. Write `src/renderer/src/lib/rsvp.test.ts` and `backend/tests/test_rsvp_core.py` that both
   read that **same JSON file** and assert the table. Copy the pattern from
   `src/renderer/src/lib/groups.gaps.test.ts`, which already pins a frontend table literally
   against its Python counterpart.

### Documentation references

- Ease naming trap and measurement equivalence: `docs/caption-parity.md:11-21`.
- Cross-language literal-table test to copy: `src/renderer/src/lib/groups.gaps.test.ts`.
- Pure-lib + colocated-test convention: `src/renderer/src/lib/wordTiming.ts` + `.test.ts`.

### Verification checklist

- `npm test -- rsvp` — TS core green.
- `.venv-dev/bin/python -m pytest backend/tests/test_rsvp_core.py -q` — Python core green.
- Both suites read `backend/tests/fixtures/rsvp_orp_cases.json`:
  `grep -rn "rsvp_orp_cases.json" src backend` returns **two** test files.
- `npm run typecheck` clean.

### Anti-pattern guards

- No rendering, no Canvas/PIL imports, no I/O in either core module — pure functions only.
- Do not hand-write the expected indices twice; both tests read the one JSON fixture.

---

## Phase 2 — Settings plumbing: the seven-file change ×7 fields (agent: implementer)

No rendering behaviour yet. Land the full contract so CI's always-on partition test is
satisfied and the dials exist before anything reads them.

### What to implement

Follow the `gapCloseThreshold` precedent (commit `950f076`) exactly, for each of the 7 fields in
the table above:

1. `StudioPanel.tsx` — add the 7 fields to `StudioSettings` (27-102) and `DEFAULTS` (143-161).
   Copy the doc-comment style used on `gapCloseThreshold`, and **write the unit contract into
   the comment** for `rsvpContextOpacity` (fraction) and `rsvpSlideDuration` (seconds).
2. `src/renderer/src/lib/render.ts` — add the 7 to the config object. `rsvpPivotX` and
   `rsvpEdgeFade` go through `pct(...)`; the rest pass through untouched. Copy the
   plain-seconds comment at `render.ts:114-122`.
3. `backend/models/schemas.py` — 7 new `VideoRenderConfig` fields with `Field(...)` bounds that
   **mirror** the sanitize spec table exactly.
4. New `components/studio/sections/` UI — add a **"Reading" `StudioCard`**, or a subsection of
   the existing Animation card, containing: a `readingMode` select (Wrap / Speed-read), and
   `StudioRow`s for pivot, slide duration, context opacity, edge fade, plus a reticle toggle and
   a focus-colour swatch. Copy the `StudioRow` shape from
   `components/studio/sections/LayoutCard.tsx:28-55`. Gate the six RSVP rows on
   `readingMode === 'rsvp'`.
5. `src/renderer/src/lib/settingsSanitize.ts:48-57` — add the 4 numeric specs from the table.
   `rsvpContextOpacity` is the **only** one marked `fraction: true`.
6. `src/renderer/src/lib/settingsSearch.ts` — add all 7 to `CARD_SETTINGS` under the chosen card
   **and** add `SETTINGS_REGISTRY` entries with keywords (`speed read`, `rsvp`, `spritz`,
   `pivot`, `focus letter`, `orp`, `reading`).
7. `backend/tests/test_caption_cfg_contract.py` — add all 7 to `EXPECTED_IN_CAP_CFG` (44-94)
   with their camelCase HTML keys, add 7 distinctive `_SENTINELS` values (212-262), **and** emit
   all 7 from `caption_cfg()` in `hyperframes_caption_html.py`.

Also add frontend unit tests mirroring `render.test.ts:123-141` and
`settingsSanitize.test.ts:35-53`: assert `rsvpSlideDuration` crosses the bridge in plain seconds,
that `rsvpContextOpacity: 90` is read as `0.9` (the fraction heuristic), and that
`rsvpPivotX: 35` becomes `0.35`.

### Verification checklist

- `.venv-dev/bin/python -m pytest backend/tests/test_caption_cfg_contract.py -q` — green
  (this is the always-on CI guard; it fails with explicit guidance until all 7 are classified).
- `npm run typecheck` && `npm test` && `npm run lint` — all clean.
- `grep -rn "rsvpPivotX" src/renderer/src | wc -l` ≥ 5 (interface, defaults, render, sanitize,
  search, UI).

### Anti-pattern guards

- Do not put any of the 7 in `INTENTIONALLY_ABSENT` — they all reach the HTML layer.
- Do not give `rsvpSlideDuration` `fraction: true`.
- Do not add a UI control without the matching `settingsSearch.ts` entry — that ships a control
  settings-search cannot find.

---

## Phase 3 — Pillow renderer: the source of truth (agent: implementer)

Implement RSVP in Pillow **first**. `docs/caption-parity.md` names Pillow the source of truth;
the other two renderers are then written to match a rendered PNG rather than to a description.

### What to implement

In `backend/exporters/video_render.py`:

1. In `_render_frame()` / `_draw_word_list()`, branch on `config.reading_mode == "rsvp"` **at
   the layout step**, before the existing x-accumulation loop (558-566):
   - lay out all group words on one row (no wrapping, ignore `lines`), reusing `_measure_word()`
     (948-956) so tracking is honoured;
   - compute `focus_offset` for every word via `backend/exporters/rsvp.py`;
   - compute the animated line translation with `line_offset_at(...)` using
     `config.rsvp_slide_duration` and the active index from 661-662 (reuse it verbatim — do not
     write a second active-word test);
   - draw words at `x = base_x + line_x`.
2. Colouring: focus glyph in `rsvp_focus_color`; the rest of the active word in
   `active_word_color`; all other words in `text_color` at `rsvp_context_opacity`. Draw the
   active word as **three pieces** (prefix / focus char / suffix) using `_measure_word()` for
   the prefix advance so the focus glyph lands exactly on the pivot.
3. Edge fade: alpha-ramp the leftmost and rightmost `rsvp_edge_fade` fraction of the caption
   band. Composite via an alpha mask on the caption layer — do **not** clip hard.
4. Reticle: when `rsvp_reticle`, draw the short rule + notch above and below the line, centred on
   the pivot column, in `rsvp_focus_color`.

### Documentation references

- Existing branch shapes to copy: the scale branch (`video_render.py:811-841`) for
  "render this word differently at a computed position", and the karaoke branch (843-869) for
  "split one word into pieces and draw them separately".
- Measurement contract: `docs/caption-parity.md:11-21` — `font.getlength()`, never `textbbox`.

### Verification checklist

- `.venv-dev/bin/python -m pytest backend/tests/ -x -q` — full suite green.
- Add two golden scenarios to `backend/tests/gen_golden.py` — `rsvp_mid_word` (a frame during a
  hold) and `rsvp_mid_slide` (a frame during the 60ms slide) — then
  `.venv-dev/bin/python -m backend.tests.gen_golden` and **visually review both PNGs before
  committing**: the focus glyph's centre must sit on the pivot column in `rsvp_mid_word`.
- Determinism: `.venv-dev/bin/python -m backend.tests.gen_golden /tmp/out` twice → byte-identical.

### Anti-pattern guards

- Never hand-edit a golden PNG; only regenerate via `gen_golden` and eyeball it.
- Do not loosen `MAX_MEAN_DIFF` / `MAX_PIXEL_DIFF` (`test_render_golden.py:34-36`).
- Do not call `font.getbbox()` for advance widths.

---

## Phase 4 — Canvas preview + HTML/GSAP runtime, matched to Phase 3 (agent: implementer)

### What to implement

**Canvas** (`src/renderer/src/hooks/useSubtitleOverlay.ts`, `lib/overlayGeometry.ts`):

1. Add `computeRsvpPositions()` beside `computeWordPositions()`
   (`overlayGeometry.ts:193-219`), taking the same inputs plus pivot/slide and returning
   single-row `wordXPos[]` shifted by the animated `lineX` from `lib/rsvp.ts`.
2. In `useSubtitleOverlay.ts`, select it when `readingMode === 'rsvp'`, reusing the existing
   `measureWord` (166-167) and the existing `isActive` test (425).
3. Draw the active word in three pieces exactly as Pillow does; apply context opacity, edge-fade
   gradient (`createLinearGradient` on a mask), and the reticle.

**HTML/GSAP** (`backend/exporters/hyperframes_caption_html.py`):

4. Emit the group as one `white-space: nowrap` row inside an `overflow: hidden` band, with the
   active word split into three `<span>`s.
5. In `CAPTION_RUNTIME_JS` (601-669) add an `rsvp` branch that tweens the **row container's**
   `x` between per-word `lineX` values with `ease: 'power1.out'` and
   `duration: CFG.rsvpSlideDuration`, plus `tl.set()` colour changes at each word boundary.
   Measure prefix widths in-browser with the same `measureText` approach the layer already uses.
6. Apply the edge fade with a CSS `mask-image: linear-gradient(...)` on the band.
7. `backend/exporters/hyperframes_project.py:50` — **bump `SCAFFOLD_VERSION`** (runtime JS shape
   changed).

### Documentation references

- Pill-slide tween (the closest existing "animate a box between two computed rects") —
  `hyperframes_caption_html.py:608-636`.
- Bounce branch, for GSAP branch style — `hyperframes_caption_html.py:642-649`.
- Canvas bounce branch, for the Canvas switch style — `useSubtitleOverlay.ts:529-533`.
- Ease trap (`power1.out`, not `power2`) and baseline-placement rule —
  `docs/caption-parity.md:11-21`.

### Verification checklist

- `npm run typecheck` && `npm test` && `npm run lint` — clean.
- `grep -n "SCAFFOLD_VERSION" backend/exporters/hyperframes_project.py` — bumped.
- Parity (opt-in; needs Node 22 + ffmpeg):
  `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q`
  — add `rsvp` to the parametrize list at `test_caption_parity.py:158-159`; the existing 3px
  per-edge bounding-box tolerance must hold **without being loosened**.
- Add a parity case sampled **mid-slide**, not only mid-hold — a static-only case would pass
  even if one renderer's ease were wrong.

### Anti-pattern guards

- Do not per-word-absolutely-position in HTML; translate the row container.
- Do not let the browser's default font kick in — the existing `document.fonts` /
  `__capBuild` deferral must still gate measurement.
- Do not widen parity tolerances. A failure here means a renderer's `lineX` or prefix
  measurement is wrong.

---

## Phase 5 — Final Verification (agent: implementer; scout for any fact gap)

1. `.venv-dev/bin/python -m pytest backend/tests/ -q` — full backend suite.
2. `npm run typecheck && npm test && npm run lint`.
3. `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q`.
4. Anti-pattern grep sweep:
   - `grep -rn "rsvp" src/renderer/src/types/app.ts src/renderer/src/components/editor/WordStylePopup.tsx`
     → **must be empty** (RSVP must not have leaked into `word_transition`).
   - `grep -rn "orpIndex\|orp_index\|RSVP_ORP_TABLE" src backend` → three implementations + the
     two fixture-driven tests, and nothing else.
   - `grep -rn "fraction: true" src/renderer/src/lib/settingsSanitize.ts` → exactly three hits
     (`shadowOpacity`, `highlightOpacity`, `rsvpContextOpacity`).
5. Docs:
   - `docs/caption-parity.md` — add an RSVP section documenting the `focusOffset`/`lineX`
     formula, the ORP table, and any newly accepted delta.
   - `CLAUDE.md` — mention `reading_mode` in the Preview↔Render Parity section and add the
     RSVP settings to the units list in Key Conventions.
6. **Manual QA (user)** — the parts CI cannot cover:
   - Pick Speed-read in Studio → preview line slides, focus glyph pinned to the pivot column.
   - Scrub the timeline backwards → the line must land correctly on a seek, not only on
     forward playback (seek-safety is the classic failure mode for a GSAP translate).
   - Run a HyperFrames render → exported video matches the preview frame-for-frame.
   - Save → reload a project, and save → apply a preset: all 7 settings round-trip.
   - A one-word group and a 12-word group both render sanely.

---

## Open decisions (defaults chosen — implementer proceeds unless the user objects)

1. **Punctuation counts toward token length** for `orpIndex` (so `saccades,` is length 9 → index
   2). Matches Spritz, which tokenizes on whitespace. The clip could not disambiguate this.
   Reversing it is a one-line change in three files plus the JSON fixture.
2. **UI label**: "Speed read (RSVP)" for the mode, "Focus column" for the pivot dial. Cosmetic.
3. **Card placement**: a new "Reading" card vs. a subsection of the Animation card. The plan
   assumes a new card; fold it into Animation if the sidebar feels crowded.
4. **v1 excludes** a per-word size bump for the active word (blocked by the no-synthetic-bold
   rule) and a WPM override (blocked by decision 1 above). Both are additive later.
