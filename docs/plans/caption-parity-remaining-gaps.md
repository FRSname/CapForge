# Caption Parity — Remaining Preview↔Render Gaps

**Status:** IMPLEMENTED (2026-07-02) — all phases executed; parity suite 16/16, full backend 203 passed, typecheck clean. See "Execution notes" at the bottom for the four additional root causes found and fixed during execution.
**Created:** 2026-07-01
**Symptom:** User reports captions still look different between the in-app/Studio preview and the final rendered video — specifically **size/scale** and **styling** differences, seen in "both / not sure" pipelines (classic Pillow export and HyperFrames render).

---

## Phase 0 — Findings (Documentation Discovery, COMPLETE)

Three parallel audits (static geometry, animation/timing, config-flow + empirical test run) compared the three renderers. All findings below were re-verified with targeted reads before this plan was finalized.

### Current empirical state

`CAPFORGE_PARITY=1` suite: **11/11 pass** (all 8 word modes + stroke/shadow/multiline). Golden frames: **7/7 pass**. The user still sees divergence ⇒ the gaps live in scenarios the suite has **no fixtures for**. Tolerances are loose (`MEAN_MAX = 8.0`, `NOTABLE_FRAC_MAX = 5.0` @ diff>40, `backend/tests/test_caption_parity.py:43-44`), which the spacing-parity plan already flagged as able to hide few-px geometry drift.

### D1 (PRIMARY) — Per-word overrides never reach the HyperFrames HTML renderer

Maps directly to the reported symptoms: `font_size_scale` = **size**, colors/transition/underline = **styling**.

- `caption_markup()` emits bare spans, no style data — `backend/exporters/hyperframes_caption_html.py:103-118`
- `caption_groups_json()` serializes only `{"s", "e"}` per word — `backend/exporters/hyperframes_caption_html.py:121-131`
- Canvas preview honors the full override set — `src/renderer/src/hooks/useSubtitleOverlay.ts:255-304`
- Pillow (source of truth) honors the same set — `backend/exporters/video_render.py:419-434, 475-495, 610-611`

**Authoritative override key list** (snake_case, from Pillow — the contract):
`text_color`, `active_word_color`, `font_size_scale`, `bold`, `font_family`, `custom_font_path`, `word_transition`, `pos_offset_x`, `pos_offset_y`, `bounce_strength`, `scale_factor`, `underline_thickness`, `underline_color`, `underline_offset_y`, `underline_width` (video_render.py:477-491, 610-611) plus active-word pill overrides `highlight_padding_x`, `highlight_padding_y`, `highlight_radius`, `highlight_opacity`, `pos_offset_x/y` (video_render.py:419-434).

**Effect today:** any word the user emphasized in the editor renders as a plain default word in every HyperFrames render (Studio + co-author). The Studio *browser preview* uses the same HTML runtime, so preview and render agree with each other but both disagree with the in-app panel and the classic export.

### D2 — `highlight_animation: "slide"` implemented only in Pillow

- UI exposes `'jump' | 'slide'` — `src/renderer/src/components/studio/StudioPanel.tsx:82,166,838-839`; sent as `highlight_animation` — `src/renderer/src/lib/render.ts:126`
- Pillow implements slide: pill lerps from previous word's rect with `t_ease = 1 - (1 - clamp(raw_t * 2.5, 0, 1))²` — `backend/exporters/video_render.py:436-450`
- Canvas preview: **zero references** to `highlightAnim` in `useSubtitleOverlay.ts` — pill always jumps
- HTML runtime: `caption_cfg()` (hyperframes_caption_html.py:48-100) doesn't include it; pill is `tl.set()` static (hyperframes_caption_html.py:410-414)

**Effect today:** with slide selected, the classic export slides the pill while the preview jumps — a visible styling mismatch in the classic pipeline.

### D3 — Minor, document-and-accept (no code change)

- **Stroke joins:** Canvas `lineJoin='round'` (useSubtitleOverlay.ts:324) vs PIL miter (no join API) vs CSS `-webkit-text-stroke`. Imperceptible ≤5px strokes.
- **Shadow blur:** Pillow `GaussianBlur(radius=shadow_blur/2)` (video_render.py:870) matches the Canvas/CSS spec (sigma = blur/2). Intentional, already commented in source.

### Falsified claim — GSAP bounce is NOT divergent (do not "fix" it)

An audit flagged the two-tween bounce (`sine.out` then `sine.in`, hyperframes_caption_html.py:420-426) as diverging from `sin(progress·π)` (Canvas/Pillow). Verified analytically: first half `-BO·sin(t·π/2)|t=2τ = -BO·sin(τπ)`; second half `-BO·cos((2τ-1)·π/2) = -BO·sin(τπ)`. **Exact match.** Leave as-is.

### Allowed APIs (verified to exist — use these, nothing else)

| Purpose | API | Source |
|---|---|---|
| Font file for @font-face embed | `resolve_font_file(family, custom_path, bold)` | video_render.py:212-231 |
| Main-font embed pattern to copy | `_font_face_block()` | hyperframes_project.py:484-511 |
| Caption payload assembly | `caption_block(config, groups)` → `{css, markup, payload_js, runtime_js}` | hyperframes_caption_html.py:458-467 |
| Font-load gate (registration must stay inside it) | `__capWhenFontsReady()` | hyperframes_caption_html.py:210-230 |
| Per-word resolution pattern to copy | Canvas override block | useSubtitleOverlay.ts:276-304 |
| Slide easing to copy | Pillow slide block | video_render.py:436-450 |

**Anti-patterns (global):** no camelCase override keys (stored overrides are snake_case end-to-end); no synthetic bold (font file *is* the weight); never measure text before `document.fonts` resolves; layout `pos_offset_x/y` is additive per word and must NOT shift subsequent words (video_render.py:484 comment); Pillow is the source of truth — **no Pillow changes** in this plan, goldens must not be regenerated.

---

## Phase 1 — Thread per-word overrides into the HTML caption path (fixes D1)

**Pre-flight (fresh context):** re-verify D1 still holds: `grep -n '"s": w\["start"\]' backend/exporters/hyperframes_caption_html.py` — if the word payload already carries an `"o"` key, this phase shipped; skip to Phase 2.

### 1.1 Extend the payload — `backend/exporters/hyperframes_caption_html.py`

In `caption_groups_json()` (:121-131), add an optional compact `"o"` object per word containing **only the keys present** in `w["overrides"]`, whitelisted to the authoritative list in Phase 0/D1. Groups arriving here are the same dicts Pillow consumes (`overrides` already attached — video_render.py:476), so this is a pass-through, not a new bridge.

### 1.2 Embed per-word fonts — `backend/exporters/hyperframes_project.py`

Copy the `_font_face_block()` pattern (:484-511): collect distinct `(font_family, custom_font_path)` pairs from word overrides across all groups, resolve each via `resolve_font_file()`, and emit one additional `@font-face` per distinct file. This is the exact mechanism of commit 580dad1 — do not invent a second font path.

### 1.3 Per-word resolution + measurement in the runtime — `CAPTION_RUNTIME_JS`

In `__capBuild()` measurement loop, copy the Canvas resolution block (useSubtitleOverlay.ts:276-304): for each word compute effective `fontSize = Math.round(CFG.fontSize * (o.font_size_scale ?? 1))`, `fontFamily = o.font_family ?? CFG.fontFamily`, and measure **with that font string** — the cursor advance must use per-word metrics or layout diverges from Canvas/Pillow. Apply `pos_offset_x/y` after layout (additive, non-propagating). Set the resolved `font-size`/`font-family`/`color` on each span from JS (keep `caption_markup()` clean).

### 1.4 Per-word timelines + pill overrides

In the `__timelines` registration: per-word `word_transition` (fallback `CFG.wordTransition`) selects the mode branch per word — mirroring Pillow's `w_word_trans` (:483) and pill gating via the *active* word's transition (:419-420). Per-word colors feed the tweens; per-word `bounce_strength`/`scale_factor`/underline params replace the CFG constants in their branches (hyperframes_caption_html.py:403-439). `mkPill()` (:336-347) takes the active word's `highlight_padding_x/y`, `highlight_radius`, `highlight_opacity`, `pos_offset_x/y` (copy Pillow :423-434).

### 1.5 Verification checklist

- [ ] New parity fixture: 4-word group with one size-scaled word (`font_size_scale: 1.5`), one recolored word, one per-word `word_transition` override, one `pos_offset` word — Pillow ↔ HyperFrames within tolerance
- [ ] `grep -n '"o":' backend/exporters/hyperframes_caption_html.py` returns the payload line
- [ ] Existing 11 parity tests + 7 goldens still pass **unchanged** (Pillow untouched)
- [ ] Registration still happens inside `__capWhenFontsReady` (grep `__capWhenFontsReady` wraps `__capBuild`)

**Anti-pattern guards:** don't add override keys Pillow doesn't read; don't emit `"o": {}` for override-free words (payload bloat); don't move measurement outside the font gate.

## Phase 2 — Implement `highlight_animation: "slide"` in Canvas + HTML (fixes D2)

**Pre-flight:** `grep -n highlightAnim src/renderer/src/hooks/useSubtitleOverlay.ts` — hits mean this shipped; skip.

### 2.1 Canvas preview — `src/renderer/src/hooks/useSubtitleOverlay.ts`

In the pill block (:251-274), when `settings.highlightAnim === 'slide'` and an earlier word exists, copy Pillow's formula (video_render.py:438-450): `raw_t = (currentTime - m.start) / wordDur`, `t_ease = 1 - (1 - min(max(raw_t * 2.5, 0), 1))**2`, lerp pill x and width from the previous word's rect to the active word's rect. `highlightAnim` is already in `StudioSettings`.

### 2.2 HTML runtime — `backend/exporters/hyperframes_caption_html.py`

Add `hlAnim` to `caption_cfg()` from `config.highlight_animation`. In the highlight branch, when `hlAnim === 'slide'` and a previous word exists, tween the pill's `left`/`width` from the previous word's pill rect over `duration = wordDur / 2.5` with `ease: 'power1.out'` — GSAP's power scale is `power1` = quad, `power2` = cubic, so `power1.out` is the exact match for Pillow's `clamp(raw_t*2.5)` quadratic ease-out (full ease completes at 40% of word duration). *(Corrected during execution: this doc originally said `power2.out`, which is cubic.)*

### 2.3 Verification checklist

- [ ] New parity fixture: highlight mode + `highlight_animation: "slide"`, snapshot at a mid-slide time (e.g. 20% into word 2) — Pillow ↔ HyperFrames within tolerance
- [ ] `npm run typecheck` passes (renderer edit)
- [ ] Manual: in-app preview with slide selected shows the pill gliding, matching a rendered clip
- [ ] Goldens unchanged

**Anti-pattern guard:** do not implement slide by changing Pillow; do not slide when `active_idx == 0` (Pillow gates on `active_idx > 0`).

## Phase 3 — Test expansion + geometry tightening

0. **Group-animation ease correction (added during execution):** the runtime's group enter tweens (fade/slide/pop) and exit tween use `power2.out`/`power2.in` (cubic) while Canvas (`easeOut = 1-(1-t)²`, useSubtitleOverlay.ts:95) and Pillow (`_ease_out`, video_render.py:328-331) are quadratic — the original audit blessed this under the same power-naming confusion corrected in Phase 2.2. Change all four to `power1.out`/`power1.in` in `CAPTION_RUNTIME_JS`, and add a mid-entry parity fixture (snapshot at `group.start + animDur/2` with `animation: "pop"`) to lock it.
1. **Resolution fixtures:** duplicate one highlight scenario at 1920×1080 and portrait 1080×1920 (suite currently only 1280×720 — coverage gap behind "size/scale" reports).
2. **Extent assertion:** in the parity harness, compute the bounding box of non-background pixels for both frames and assert extents agree within a small pixel budget (~3px). This catches the few-px word-drift class that the mean-diff tolerance hides (weakness documented in `docs/plans/hyperframes-caption-spacing-parity.md`).
3. **Docs:** update the CLAUDE.md "Preview ↔ Render Parity" section — per-word overrides and `highlight_animation` are now part of the three-renderer contract; record D3 (stroke joins, shadow-blur kernel) as documented accepted deltas; record the bounce false-alarm so nobody "fixes" it later.

Verification: full backend suite green; `CAPFORGE_PARITY=1` suite green including new fixtures; goldens untouched (`git status backend/tests/golden/` clean).

## Phase 4 — Final verification

1. `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -v` — all pass, including the 4+ new fixtures
2. `.venv-dev/bin/python -m pytest backend/tests/` — full suite green
3. `npm run typecheck` — green
4. Grep guards: `"o":` payload key present; `hlAnim` in both `caption_cfg` and runtime; no `bold: true` synthesis anywhere; `__capWhenFontsReady` still gates registration
5. **User repro:** open the project that showed the mismatch, compare in-app preview / HyperFrames Studio preview / rendered frame side-by-side. If a **global** (not per-word) size offset remains after D1+D2, escalate to a resolution/aspect investigation (untested >720p) as a new plan — do not bolt it onto this one.
6. Update this doc's status to IMPLEMENTED; ship per repo convention (direct commit to main, detailed body).

**Out of scope (recorded, not planned):** automated Canvas-preview parity (needs Playwright against the running app — candidate follow-up); `word_spacing` config field (unused everywhere, parity-neutral at 0).

---

## Execution notes (2026-07-02) — additional root causes found & fixed

The extent assertion + new fixtures surfaced four defects beyond D1/D2, all fixed:

1. **Snapshot picker grabbed the wrong frame** — HyperFrames CLI ≥ 0.7.25 auto-saves an extra end-of-timeline frame after the requested one; `snapshot_hyperframes_project()` picked by newest mtime → every parity comparison silently used a blank frame (and the co-author preview tool returned the wrong image in production). Fixed: pick by the `frame-NN-at-<t>s.png` filename time closest to `t` (`hyperframes_render.py`).
2. **DOM span baseline used ink ascent** — the runtime positioned spans as if ink starts at the span top; the browser actually places the baseline at half-leading + font ascent. ~8px vertical offset for CaviarDreams **in every shipped HyperFrames render**, hidden under the loose tolerances (box fixtures masked it; thin-font ghosting stayed just under `NOTABLE_FRAC_MAX`). Fixed: `spanBaseline()` wired into span positioning, per-word.
3. **Scaled-word vertical anchor** — Pillow's ascender-anchored draw places `font_size_scale` words at `rowCenter + (scaled−base ascender→ink gap)`; the runtime ink-centered them (~4-6px off) and the Canvas preview baseline-aligned them (worse). Both now reproduce Pillow's formula (`gapBase`/`m.gap` in the runtime; `wBaselineShift` in `useSubtitleOverlay.ts`).
4. **Group-entry ease was cubic in the runtime** (`power2.*`) vs quadratic in Canvas/Pillow — fixed to `power1.*` (Phase 3.0); the mid-entry slide fixture locks it (revert-check: flipping back to `power2.out` fails extent by 4px > 3px budget, exactly the predicted 7.2 vs 3.6px offset).

Also learned: a mid-entry frame of an animation over a translucent bg box can never be pixel-exact — the browser flattens group opacity where Canvas/Pillow stack per-element alpha. Documented as an accepted delta (CLAUDE.md); the ease fixture therefore uses `bg_opacity=0` + instant words to isolate the curve.
