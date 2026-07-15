# Plan: Highlight pill Offset X / Offset Y (`highlight_offset_x` / `highlight_offset_y`)

**Status:** planned, not started
**Branch suggestion:** `feat/highlight-pill-offset` — branch off `main` once `feat/word-transition-none` is merged, or off `feat/word-transition-none` if it isn't yet (all line numbers below were scouted on that branch; they differ from main only by the "none" changes).
**Orchestration:** each phase runs via the `implementer` agent (no model overrides — agent pins route models). `scout` only for fact gaps.

## Problem

The Highlight word style (pill behind the active word) has Radius / Width / Height / Opacity /
Movement options but no way to nudge the pill's position. Add **Offset X** and **Offset Y**
(px) that move **only the pill**, not the text.

## Semantics (the contract all three renderers implement)

- New global settings `highlight_offset_x` / `highlight_offset_y` (int px, default 0, may be
  negative — precedent: `underline_offset_y`, `schemas.py:184`).
- The offset shifts the **final pill rect** uniformly for BOTH `jump` and `slide` movement —
  i.e. it must be applied identically to the slide tween's *from* and *to* rects (equivalent
  to adding it post-lerp), so the slide path translates rigidly instead of lerping the offset in.
- It stacks ON TOP of the word's `pos_offset_x/y` (which already moves word+pill together);
  the new fields move the pill relative to its word.
- Per-word overridable (`highlight_offset_x`/`highlight_offset_y` in word `overrides`),
  matching every other highlight sub-setting (`highlight_padding_x` precedent).
- Same px space as `pos_offset_x`: each renderer applies the value exactly where/how it
  applies `pos_offset_x` (same scaling, no new conversion invented).

## Phase 0 — Documentation Discovery (DONE — consolidated scout findings)

Two scouts traced every touch point. Definitive list (from a repo-wide `highlight_padding_x` sweep):

### Backend touch points

| Concern | Location | Fact |
|---|---|---|
| Schema | `backend/models/schemas.py:175-180` | existing `highlight_*` fields; add two `int = Field(0, ...)` after `highlight_text_color`; offset precedent `underline_offset_y` at `:184` (int, no ge-constraint) |
| Pillow pill block | `backend/exporters/video_render.py:422-463` | gate `:422`; per-word resolution `:423-426` (`active_ov.get("highlight_padding_x", highlight_padding_x)`); `pos_offset` reads `:433-434`; `target_x` `:435`; slide lerp `:438-447` (`t_ease = 1-(1-clamp(raw_t*2.5))²`); rect draw `:456-463` (top/bottom already carry `+ hl_off_y`) |
| Pillow global read | `video_render.py:395` | `getattr(config, "highlight_padding_x", ...)` fallback pattern to copy |
| CAP_CFG emission | `backend/exporters/hyperframes_caption_html.py:90-95` | `"hlPadX"`, `"hlPadY"`, `"hlRadius"`, `"hlOpacity"`, `"hlAnim"` — add `"hlOffX"`/`"hlOffY"` |
| JS pill creation | `hyperframes_caption_html.py:450-465` (`mkPill`) | `left = (m.x + m.ox - wHlPadX)`, `top = (m.cyc + m.oy - textH/2 - wHlPadY)`; per-word pattern `o.highlight_padding_x != null ? ... : CFG.hlPadX` |
| JS slide tween | `hyperframes_caption_html.py:556-559` | `fromTo(m.pill, {left: (m.prev.x - m.hlPadX)}, {left: (m.x + m.ox - m.hlPadX)})` — offset must go into BOTH from and to |
| Override whitelist | `hyperframes_caption_html.py:128-134` | `_WORD_OVERRIDE_KEYS` tuple — add both keys |
| Contract test | `backend/tests/test_caption_cfg_contract.py:81` (`EXPECTED_IN_CAP_CFG`), `:150-173` (`PILLOW_HONORED_OVERRIDE_KEYS`), `:333-347` (lockstep assertion) | BOTH pinned sets must be extended or the suite fails |
| Scaffold cache | `backend/exporters/hyperframes_project.py:50` | `SCAFFOLD_VERSION = 4` → **bump to 5** (CAP_CFG + runtime shape change) |
| Golden scenarios | `backend/tests/test_render_golden.py:119-141` (`SCENARIOS`); `gen_golden.py` imports `SCENARIOS` (no separate edit) | `highlight_word2` at `:124` is the shape to copy |
| Parity tests | `backend/tests/test_caption_parity.py:201-209` (`test_highlight_slide_parity`), `:221-252` (`test_word_override_parity`, overrides at `:241`) | shapes to copy |

### Frontend touch points

| Concern | Location | Fact |
|---|---|---|
| Settings fields | `src/renderer/src/components/studio/StudioPanel.tsx:78-83` interface, `:161`-area `STUDIO_DEFAULTS` | existing `highlightRadius/PadX/PadY/Opacity/Anim/TextColor`; add `highlightOffsetX: 0`, `highlightOffsetY: 0` |
| UI rows | `StudioPanel.tsx:773-856` (Highlight options), offset-slider precedent `:692-712` | copy `<StudioRow label="Offset X" value={s.textOffsetX} min={-100} max={100} unit="px" def={...} onChange={...}/>`; insert after the Movement row (`:837-854`) |
| Bridge | `src/renderer/src/lib/render.ts:124-129` | add `highlight_offset_x: settings.highlightOffsetX ?? 0` (+ Y); update fixture expectations in `src/renderer/src/lib/render.test.ts:64`-area |
| Canvas pill | `src/renderer/src/hooks/useSubtitleOverlay.ts:287-347` | defaults `:287-296`; `targetX` `:308`, `hlY` `:309`; slide lerp `:312-325`; per-word resolution `:328-331` (`ov?.highlight_padding_x ?? hlPadX`); rect draw `:332-344` (`roundRect(ctx, hlX - wHlPadX, hlY - textH/2 - wHlPadY, ...)`) — add effective offsets to the DRAWN coords (post-lerp) |
| Per-word type | `src/renderer/src/types/app.ts:8-31` (`WordOverrides`) | add `highlight_offset_x?/highlight_offset_y?: number` next to the other `highlight_*` keys |
| Per-word popup | `src/renderer/src/components/editor/WordStylePopup.tsx:98-105` (state), `:386-400` (Highlight options `<SubSettings>` with `NumberRow`s), `:225-230` (`buildOverrides` conditional save) | copy the `hlPadX` pattern exactly; `NumberRow` supports negative min (see `:435-439` Position offset, min -200 max 200) |
| Presets | `src/renderer/src/lib/presets.ts:55-60` (`VanillaPreset`), `:137-148` (`vanillaToStudio`), `:221-226` (`studioToVanilla`) | copy the `highlightPadX` line in all three places |
| Settings search | `src/renderer/src/lib/settingsSearch.ts:62-78` (`CARD_SETTINGS` — powers dirty-detection/reset) and `:195-199` (registry entries) | add both fields to the `animation` card list + two registry entries |

### Anti-patterns (repo-verified — do NOT do)

- **Do not** lerp the offset in during slide: adding the offset only to `target_x`/the tween's
  *to* value makes the pill drift by the offset during the slide instead of translating
  rigidly. Apply it to from AND to (Pillow: post-lerp on `hl_x`, or to both `prev_x` and
  `target_x`; JS: in both `fromTo` left values; Canvas: on the drawn rect after the lerp).
- **Do not** move the text — `highlight_text_color` case (`useSubtitleOverlay.ts:446-451`)
  and Pillow word drawing stay untouched; only the pill rect shifts.
- **Do not** reuse `pos_offset_x/y` for this — those move word+pill together and are per-word
  position nudges, a different feature.
- **Do not** add `ge=0` constraints in the schema — offsets are signed (`underline_offset_y`
  precedent).
- **Do not** add the override keys to only one of `_WORD_OVERRIDE_KEYS` /
  `PILLOW_HONORED_OVERRIDE_KEYS` — `test_caption_cfg_contract.py:333-347` enforces lockstep
  and will fail.
- **Do not** forget `SCAFFOLD_VERSION` 4→5 — CAP_CFG gains keys and the runtime JS changes.
- **Do not** invent preview-space scaling for the offset — apply it exactly where each
  renderer applies `pos_offset_x` (Canvas `:308-309`, Pillow `:433-436,459-461`, JS `m.ox`/`m.oy`).
- **Do not** touch `mcp_server/server.py` example docstrings.

---

## Phase 1 — Backend: schema + Pillow + HTML runtime + contract tests (agent: implementer)

### What to implement

1. `backend/models/schemas.py` — after `highlight_text_color` (`:180`), add:
   `highlight_offset_x: int = Field(0, description="Horizontal offset of the highlight pill in px (may be negative)")`
   and the matching `highlight_offset_y`. Copy the `underline_offset_y` shape (`:184`).
2. `backend/exporters/video_render.py`:
   - Read globals next to the other highlight reads (`:395` pattern):
     `highlight_offset_x = getattr(config, "highlight_offset_x", 0)` (+ Y).
   - In the pill block (`:422-463`): resolve effective per-word values like `:423-426`
     (`w_hl_off_x = float(active_ov.get("highlight_offset_x", highlight_offset_x))`), then
     apply **post-lerp**: add `w_hl_off_x` to the final `hl_x` used in the rect (after the
     jump/slide branch resolves) and `w_hl_off_y` alongside the existing `+ hl_off_y` terms
     on the rect top/bottom (`:459-461`). Slide must translate rigidly (offset on both ends).
3. `backend/exporters/hyperframes_caption_html.py`:
   - CAP_CFG: emit `"hlOffX": config.highlight_offset_x`, `"hlOffY": ...` next to `:90-95`
     (use `getattr(config, ..., 0)` if the sibling keys do).
   - `_WORD_OVERRIDE_KEYS` (`:128-134`): add both keys.
   - `mkPill` (`:450-465`): resolve `var wHlOffX = o.highlight_offset_x != null ? o.highlight_offset_x : (CFG.hlOffX||0);`
     (+ Y), stash on `m` (like `m.hlPadX`) for the slide tween, add to `left` and `top`.
   - Slide tween (`:556-559`): add the stashed offset to BOTH the `fromTo` from-left and
     to-left values.
4. `backend/tests/test_caption_cfg_contract.py`: add the two config keys to
   `EXPECTED_IN_CAP_CFG` (`:81`) and the two override keys to `PILLOW_HONORED_OVERRIDE_KEYS`
   (`:150-173`).
5. `backend/exporters/hyperframes_project.py:50`: `SCAFFOLD_VERSION` 4 → 5.

### Verification checklist

- `.venv-dev/bin/python -m pytest backend/tests/ -x -q` — green (contract test proves the
  lockstep sets and CAP_CFG emission).
- `grep -n "highlight_offset" backend/models/schemas.py backend/exporters/video_render.py backend/exporters/hyperframes_caption_html.py backend/tests/test_caption_cfg_contract.py` — all present.
- `grep -n "SCAFFOLD_VERSION = 5" backend/exporters/hyperframes_project.py`.

### Anti-pattern guards

Signed ints, no `ge=0`. Offset applied post-lerp / both tween ends. No text movement.

---

## Phase 2 — Frontend: settings, UI, Canvas, per-word popup, presets, search (agent: implementer)

### What to implement

1. `StudioPanel.tsx`: add `highlightOffsetX: number` / `highlightOffsetY: number` to the
   interface (`:78-83`) and `0`/`0` to `STUDIO_DEFAULTS`. Add two `StudioRow` sliders in the
   Highlight options section after Movement (`:837-854`), copying the text-offset rows
   (`:692-712`): labels "Offset X" (min −100, max 100, unit px) and "Offset Y" (min −50,
   max 50, unit px).
2. `src/renderer/src/lib/render.ts` (`:124-129`): `highlight_offset_x: settings.highlightOffsetX ?? 0`
   (+ Y). Update `render.test.ts` fixtures/expectations accordingly.
3. `src/renderer/src/hooks/useSubtitleOverlay.ts`: read defaults next to `:287-296`
   (`settings.highlightOffsetX ?? 0`); in the pill block resolve per-word
   (`ov?.highlight_offset_x ?? hlOffsetX`, pattern `:328-331`) and add to the **drawn rect
   coords** (`:332-344`), i.e. after the jump/slide lerp — NOT into `targetX`.
4. `src/renderer/src/types/app.ts` (`WordOverrides`, `:8-31`): add
   `highlight_offset_x?: number` / `highlight_offset_y?: number`.
5. `WordStylePopup.tsx`: two `useState` hooks (pattern `:98-105`), two `NumberRow`s in the
   Highlight options `<SubSettings>` (`:386-400`; min −100 max 100), and conditional save in
   `buildOverrides` (`:225-230`) — save when ≠ the studio default, like `hlPadX`.
6. `presets.ts`: `highlightOffsetX?/Y?: string | number` on `VanillaPreset` (`:55-60`) +
   `vanillaToStudio` (`:137-148`) + `studioToVanilla` (`:221-226`) lines, copying `highlightPadX`.
7. `settingsSearch.ts`: add both field names to the `animation` entry in `CARD_SETTINGS`
   (`:62-78` — required for dirty-detection/section-reset) and two registry entries near
   `:195-199`: `{ label: 'Offset X', cardId: 'animation', keywords: ['highlight offset', 'pill position', 'nudge'] }`
   (+ Y). Check first how the registry matches rows when the same label exists in another
   card ('Offset X' also exists under `background`) — if matching is label-only, disambiguate
   the label (e.g. "Pill offset X") in BOTH StudioPanel and the registry.

### Verification checklist

- `npm run typecheck` — clean.
- Frontend unit tests (`render.test.ts`) green — run them the way the repo does (check
  `package.json` scripts; likely `npx vitest run` or `npm test`).
- `grep -n "highlightOffset" src/renderer/src/components/studio/StudioPanel.tsx src/renderer/src/lib/render.ts src/renderer/src/lib/presets.ts src/renderer/src/lib/settingsSearch.ts src/renderer/src/hooks/useSubtitleOverlay.ts` — all touched.

### Anti-pattern guards

Don't change existing defaults; don't fold the offset into `targetX` (slide rigidity);
per-word popup saves only non-default values.

---

## Phase 3 — Tests: golden + parity (agent: implementer)

### What to implement

1. Golden: add a `highlight_offset` scenario to `SCENARIOS`
   (`test_render_golden.py:119-141`), copying `highlight_word2` (`:124`) with
   `word_transition="highlight"`, `highlight_offset_x=20`, `highlight_offset_y=-12`, same
   `t=1.75` (directly comparable to `highlight_word2`). Regenerate:
   `.venv-dev/bin/python -m backend.tests.gen_golden`. **Existing goldens must stay
   byte-identical** (report `git status backend/tests/golden/`). Visually review the new PNG
   (composite over black — white-on-transparent looks blank in viewers): pill shifted
   right+up relative to `highlight_word2`, text NOT shifted.
2. Parity: add `test_highlight_offset_parity` to `test_caption_parity.py`, copying
   `test_highlight_slide_parity` (`:201-209`) but with global offsets set AND
   `highlight_animation="slide"` at a mid-slide `t` (offset + slide is the riskiest
   combination). Also extend the overrides dict in `test_word_override_parity` (`:241`) with
   per-word `highlight_offset_x/y` on the highlight word if that test's group uses highlight
   — otherwise add a small second overrides case, copying the existing shape.

### Verification checklist

- `.venv-dev/bin/python -m pytest backend/tests/ -x -q` — green.
- `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q`
  — green including the new case(s) (needs Node 22 + ffmpeg).

### Anti-pattern guards

Never hand-edit goldens; don't loosen tolerances; a parity failure on the slide case means an
endpoint got the offset and the other didn't — fix the renderer, not the test.

---

## Phase 4 — Final Verification (agent: implementer; code-reviewer pass)

1. Full backend suite + `npm run typecheck` + frontend unit tests.
2. Grep sweep: `grep -rn "highlight_padding_x" --include="*.py" --include="*.ts" --include="*.tsx" backend src | grep -v test`
   — every non-test file that handles `highlight_padding_x` should now also handle
   `highlight_offset_x` (schema, video_render, caption_html ×3 spots, render.ts,
   useSubtitleOverlay, WordStylePopup, app.ts).
3. Code review of the branch diff (parity focus: slide from/to symmetry, per-word override
   both directions, preset round-trip).
4. Manual QA (user): drag Offset X/Y sliders with Highlight style active → pill moves in
   preview, text stays; slide Movement still lands the pill correctly; HyperFrames render
   matches preview; per-word offset override on one word; preset save/load round-trips.

## Open decisions (defaults chosen, flag if user disagrees)

- **Ranges:** X −100..100 px, Y −50..50 px (mirrors the text-offset rows). Cosmetic.
- **Labels:** "Offset X"/"Offset Y" inside the Highlight options group; switch to
  "Pill offset X/Y" only if settings-search matching requires unique labels (checked in
  Phase 2 step 7).
- **Per-word overrides included** (consistent with all other highlight sub-settings). Drop
  Phase 1 item 4's override keys + Phase 2 items 4-5 if global-only is preferred.
