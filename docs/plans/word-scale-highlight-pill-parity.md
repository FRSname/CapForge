# Per-Word font_size_scale → Highlight Pill (and effect geometry) Parity Fix

**Bug (user report):** editing a single word's scale (`font_size_scale` override via
WordStylePopup) does not adjust the highlight effect — with `word_transition='highlight'`
the pill behind the active word keeps the global size even when the word renders scaled.

**Status:** PLANNED · 2026-07-21
**Executor note:** each phase is self-contained; read Phase 0 before any implementation
phase. This change touches the three-renderer parity contract (CLAUDE.md → "Preview ↔
Render Parity"): Pillow is the source of truth; Canvas and the HTML runtime must match.

---

## Phase 0 — Documentation Discovery (consolidated findings)

All findings verified against source on 2026-07-21 (main @ fc75711).

### The two distinct defects

**Defect A — pill HEIGHT ignores per-word scale, in ALL THREE renderers.**
Each renderer already computes a per-word scaled text height for drawing the word
itself, but the pill rect is built from the *global* text height:

| Renderer | Scaled height available at | Pill uses global height at |
|---|---|---|
| Canvas `src/renderer/src/hooks/useSubtitleOverlay.ts` | `wTextH`, lines 360–368 (word loop) | lines 314 + 316 (`textH`), pill block 273–323 runs BEFORE the word loop |
| Pillow `backend/exporters/video_render.py` | `w_text_h`, lines 526–538 (word loop) | lines 484–487 (`text_h`) in `_draw_word_list` |
| HTML runtime `backend/exporters/hyperframes_caption_html.py` | `m.textH`, JS lines ~346–354 | `mkPill` lines ~463 (top) + ~465 (height) use closure `textH` |

**Defect B — Canvas alone measures word WIDTHS at the base font.**
- Pillow: `all_metrics[].width` measured with the scaled per-word font
  (`video_render.py:736–748`, `_get_font(..., round(font_size * w_scale), ...)`).
- HTML runtime: `mc.font = wStr` (scaled font string) is set *before*
  `measureWord(sp.textContent)` (`hyperframes_caption_html.py` JS lines 340–342). Widths scaled.
- Canvas: `wm[].width = measureWord(w.word)` at line 172–178 with the BASE font
  (`ctx.font` set at line 147, never changed before measuring). NOT scaled.

Defect B means in the Canvas preview a scaled word gets wrong: row splitting,
x-positions of it and every following word, pill width (line 283), slide lerp widths
(lines 294–296), underline width (430–431), scale-transition pivot (443), and karaoke
clip width (461). The backend and HTML renders are already correct on all of these.

### What is already correct (do not touch)

- Pillow: underline (641–653), bounce (566–570), scale (576–606), karaoke (608–639),
  reveal — all use `w_text_h` / scaled metrics where needed.
- HTML runtime: underline top uses `m.textH` (line ~480); karaoke fill uses `m.width`
  (scaled); slide width endpoints use `m.prev.width` / `m.width` (both scaled).
- Bounce amplitude is *global-height-based in all three by design* (HTML `BO = textH *
  strength`, JS line ~576; Pillow uses a `(w_text_h - text_h)/2` centering correction at
  line 569, amplitude itself global; Canvas `computeBounceAmount(textH, …)` line 436).
  All three agree → leave bounce alone. If an implementer believes otherwise they must
  first prove a Pillow-vs-Canvas divergence with a rendered frame, not by reading code.

### Allowed APIs (verbatim from existing code — copy these, do not invent)

- Canvas re-measure pattern: set `ctx.font` to the word's font string, `ctx.measureText('Ayg')`,
  `actualBoundingBoxAscent || wSize * 0.8`, `actualBoundingBoxDescent || wSize * 0.2` —
  exactly as at `useSubtitleOverlay.ts:361–368`. Tracked width via the existing
  `measureWord` / `measureTrackedWidth` helpers (lines 166–167).
- Pillow scaled font: `_get_font(config.font_family, round(config.font_size * w_scale),
  getattr(config, "custom_font_path", None), w_bold)` + `draw.textbbox((0,0), word, font=...)`
  for height, `_measure_with_font` for width — as at lines 726–748 and 526–538.
- HTML runtime: word metrics object `m` already carries scaled `textH`; the pill element
  is created in `mkPill(m)`; the slide tween is the GSAP `tl.fromTo(m.pill, …)` at ~561–564
  with `ease: 'power1.out'`.

### Anti-pattern guards (violations = review reject)

1. **Never** use PIL `textbbox` for word *widths* — widths use `font.getlength()`
   (`_measure_with_font`); `textbbox` is height-only. (CLAUDE.md parity section.)
2. **Never** change GSAP eases — the shared curve is `power1.out` (quad). No `power2`.
3. Slide stays **row-local** (same-row previous word only) in all three.
4. Pill min padding stays `max(pad, stroke + 2)` — do not fold the fix into padding.
5. Pill offset (`highlight_offset_x/y`) stays applied **post-lerp** (rigid translate),
   never folded into slide endpoints (comment at `useSubtitleOverlay.ts:304–307`).
6. Any change to the JS caption runtime **requires bumping `SCAFFOLD_VERSION`**
   (`backend/exporters/hyperframes_project.py:51`, currently 5) or cached scaffolds
   serve the stale runtime.
7. Golden PNG changes must come from `.venv-dev/bin/python -m backend.tests.gen_golden`
   and be visually reviewed — never hand-edited or tolerance-widened to pass.
8. Do not "fix" the documented accepted deltas (stroke joins, shadow kernel,
   translucent-bg entry frames — CLAUDE.md).

### Test-coverage gap (why this bug shipped)

`backend/tests/test_caption_parity.py::test_word_override_parity` (line ~272) defines a
word with `font_size_scale: 1.5` and `word_transition='highlight'`, but snapshots at
t=1.9 when that word (active 0.0–0.75) is no longer active — the scaled-word-active pill
is never asserted. Also: parity tests compare Pillow ↔ HyperFrames, and both are wrong
*identically* today, so parity alone cannot catch Defect A. A golden frame (absolute
pixels) is required to pin the corrected behavior.

---

## Phase 1 — Pillow (source of truth): scale the pill rect

**Implement** in `backend/exporters/video_render.py` `_draw_word_list`:

1. In the highlight-pill block (lines ~441–489), resolve the ACTIVE word's scaled text
   height: reuse the exact lookup used later in the word loop (lines 526–538) — font
   cache key `(w_font_family, round(base_size * w_scale), w_bold)`, `textbbox('Ayg')`
   height. Factor a small helper if it avoids duplicating the cache logic.
2. Replace `text_h` with the active word's scaled height in the pill rect
   (lines 485–487, both the top and bottom edge).
3. Slide (`highlight_animation='slide'`, lines ~459–471): lerp the pill *height* from
   the previous word's scaled height to the active word's scaled height with the same
   `t_ease` already used for `hl_w` — width lerp already uses scaled widths, keep it.

**Docs to follow:** the existing per-word font resolution at lines 526–538 is the copy
source; the slide lerp shape at 459–471 is the copy source for the height lerp.

**Verify:**
- `.venv-dev/bin/python -m pytest backend/tests/test_render_golden.py` — existing goldens
  must still pass (no scenario has a scaled active word yet; if any golden moves, the
  change leaked outside the override path — stop and fix).
- Quick manual check: render one frame with a `font_size_scale: 1.6` active word +
  highlight; pill must visibly hug the bigger word.

---

## Phase 2 — Canvas preview: scaled widths + scaled pill

**Implement** in `src/renderer/src/hooks/useSubtitleOverlay.ts`:

1. **Defect B (root):** measure `wm[].width` (lines 172–178) with each word's own font.
   For each word with an override that changes the font string (font_size_scale ≠ 1,
   bold, font_family): set `ctx.font` to the word string (same construction as line
   352–354), `measureWord(w.word)`, then restore `ctx.font = baseFontStr`. Mirrors the
   HTML runtime's measure loop (set font → measure → restore, JS lines 340–356).
   This automatically fixes row splitting, x-positions, underline width, scale pivot,
   karaoke clip, and the slide width endpoints — they all read `wm[].width`.
2. **Defect A:** in the pill block (273–323), compute the active word's `wTextH` (copy
   the metric block from lines 361–368, keyed off the active word's overrides) and use
   it in place of `textH` at lines 314 and 316.
3. Slide: lerp pill height from the previous word's scaled `wTextH` to the active
   word's, same `tEase` — mirroring Phase 1.

**Verify:**
- `npm run typecheck` clean.
- In-app (`npm run dev:react`): word with scale 1.6 + highlight → pill matches word in
  both dimensions; slide between differently-scaled words animates size smoothly;
  word x-positions of trailing words shift to match the backend render.

**Guard:** do not move the pill block after the word loop or restructure the draw order
(pill must stay drawn BEFORE words). Keep `baseFontStr` restoration — leaking a scaled
font into subsequent measurements is the failure mode this file already defends against.

---

## Phase 3 — HTML runtime: scaled pill + scaffold bump

**Implement** in `backend/exporters/hyperframes_caption_html.py`:

1. `mkPill` (~452–471): use `m.textH` instead of closure `textH` for both `top` (~463)
   and `height` (~465).
2. Slide tween (~561–564): add `top`/`height` to the `fromTo` — from the previous
   word's rect (`m.prev`'s scaled textH) to the active word's (`m.textH`), same
   duration/ease (`power1.out`). Ensure `m.prev` carries (or can reach) the previous
   word's `textH`; extend the prev-capture the same way `m.prev.width` is captured.
3. Bump `SCAFFOLD_VERSION` 5 → 6 in `backend/exporters/hyperframes_project.py:51`.

**Verify:**
- `grep -n "SCAFFOLD_VERSION = 6" backend/exporters/hyperframes_project.py`
- `grep -n "m.textH" backend/exporters/hyperframes_caption_html.py` shows pill usage.
- Phase 4 parity suite is the real gate.

---

## Phase 4 — Tests that pin the contract

**Implement:**

1. **Golden frame (absolute truth for Defect A):** add a scenario to
   `backend/tests/gen_golden.py` + `test_render_golden.py` — group where the ACTIVE word
   at the snapshot time has `font_size_scale: 1.5` (or 1.6) with
   `word_transition='highlight'`. Regenerate goldens
   (`.venv-dev/bin/python -m backend.tests.gen_golden`), visually review the new PNG
   (pill hugs the scaled word), commit it.
2. **Parity test (locks all-three agreement):** in `backend/tests/test_caption_parity.py`
   add `test_word_scale_highlight_parity` — copy the fixture/assert shape of
   `test_highlight_offset_parity` (~237–268): custom group with a scaled word, snapshot
   at a time when that word IS active (e.g. mid-word), compare Pillow ↔ HyperFrames with
   the standard mean/notable + 3px bounding-box-extent assertions. Add a slide variant
   (or parameterize) snapshotting mid-slide between a scale-1.0 word and a scaled word.
3. Fix the latent gap in `test_word_override_parity` only if cheap: either leave it
   (documented here) or add a second snapshot time while the scaled word is active.

**Verify (full gate):**
- `.venv-dev/bin/python -m pytest backend/tests` green.
- `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py`
  green (needs Node 22 + ffmpeg).
- `npm run typecheck` green.

---

## Phase 5 — Final verification sweep

1. Re-run all Phase 4 gates from a clean state.
2. Anti-pattern grep checks:
   - `grep -n "power2" backend/exporters/hyperframes_caption_html.py` → no new hits.
   - `grep -rn "textbbox" backend/exporters/video_render.py` → none used for widths.
   - Confirm `SCAFFOLD_VERSION` bumped exactly once.
3. Confirm the three pill formulas are textually parallel (same variables scaled the
   same way) — this is what the next maintainer reads.
4. Manual in-app QA (user): scale a word via WordStylePopup with highlight active;
   check jump + slide; export via HyperFrames and compare against the preview.
5. Delegate commit/branch/PR to the `git-ops` subagent (conventional commits; branch
   off main, e.g. `fix/word-scale-highlight-pill`).

## Out of scope (explicitly)

- Bounce amplitude semantics (consistent across renderers today).
- Per-word `custom_font_path` handling (separate mechanism, already contract-documented).
- Any change to accepted parity deltas or the WebM/MOV alpha paths.
