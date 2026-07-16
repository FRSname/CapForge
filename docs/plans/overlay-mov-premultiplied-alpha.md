# Overlay MOV: premultiplied-alpha mismatch (washed-out bg box in NLE)

**Status:** PLAN — not started
**Branch suggestion:** `fix/overlay-premultiplied-alpha`

## Problem

With `bg_opacity = 0.48`, the caption background box looks correct in the **baked MP4**
(and the in-app preview) but noticeably lighter/weaker when the **transparent ProRes 4444
MOV overlay** is layered over the original video in an NLE (Premiere).

## Root-cause hypothesis (to be confirmed in Phase 1)

CapForge writes **straight (unassociated) alpha**; the ProRes 4444 / QuickTime ecosystem
convention is **premultiplied (with black)** alpha, and Premiere/FCP interpret it that way.

Evidence chain (Phase 0 scout findings, all verified against source):

| Fact | Location |
|---|---|
| Both modes render the same straight-alpha RGBA frame; box alpha = `int(opacity*255)` | `backend/exporters/video_render.py:85-89`, `:823`, `:855` (`_hex_to_rgba`, `_render_frame`) |
| Baked path composites in Pillow (straight alpha, correct by construction), encodes plain RGB | `video_render.py:1546` (`src_frame.paste(sub_frame, (0,0), sub_frame)`), encode cmd `:1467-1485` |
| Overlay MOV path pipes raw straight-alpha RGBA into `prores_ks -profile:v 4444 -pix_fmt yuva444p10le -vendor apl0` — **no premultiply step, no alpha filter** | `video_render.py:1299-1313` (cmd), `:1362-1364` (pipe) |
| No `premultiply`/`straight` handling exists anywhere in `backend/exporters/` | grep, Phase 0 |
| No test covers the FFmpeg encode side of overlay export | `backend/tests/test_render_golden.py` covers `_render_frame` only |

Why this produces exactly the observed artifact: Premiere assumes the ProRes 4444 alpha is
premultiplied and **un-premultiplies on import** (`RGB' = RGB / a`). For the dark box at
`a = 0.48`, RGB is divided by 0.48 → ~2.1× brighter box color → composite looks washed out.
White text (`a = 1.0`) is unaffected — matching the screenshots (text identical, box lighter).

The baked path can never exhibit this because alpha is consumed inside Pillow.

## Allowed APIs (Phase 0 documentation discovery)

- FFmpeg `premultiply` video filter with `inplace=1` (single-input self-premultiply):
  `-vf premultiply=inplace=1`. Documented in FFmpeg filters docs (`ffmpeg -h filter=premultiply`
  on the **bundled** ffmpeg 8.1 must confirm availability — verify in Phase 1).
- FFmpeg `unpremultiply=inplace=1` — diagnostic only (simulates Premiere's import behavior).
- FFmpeg `overlay` filter — composites assuming **straight** alpha (diagnostic reference).
- Existing cmd construction at `video_render.py:1299-1313` is the only place to modify.

**Anti-patterns / do NOT:**
- Do NOT invent flags like `-alpha_channel`, `-alpha_mode`, or `-alpha_ex` on `prores_ks` —
  they do not exist. Premultiplication is a pixel operation (filter), not an encoder flag.
- Do NOT premultiply in Python/numpy per-frame — the ffmpeg filter does it off the GIL for free.
- Do NOT touch the WebM path (`:1265-1282`): VP9-with-alpha consumers (browsers) expect
  **straight** alpha. Only the MOV/ProRes path changes.
- Do NOT change `_render_frame` or anything shared with baked/preview — parity suite guards this.
- Do NOT "fix" the golden frames; they are straight-alpha `_render_frame` output and stay valid.

---

## Phase 1 — Empirical confirmation (no code changes)

Goal: prove the file is a *correct straight-alpha* file and that the divergence is interpretation.

1. Render a short overlay MOV + a baked MP4 from the same source with `bg_opacity=0.48`
   (use the app, or call the backend directly). Pick a timestamp with the box visible.
2. Inspect the stream:
   ```bash
   ffprobe -v error -show_streams -select_streams v:0 overlay.mov
   # expect: prores, pix_fmt yuva444p10le, no alpha_mode metadata
   ```
3. **Straight-alpha composite (what CapForge intends):**
   ```bash
   ffmpeg -y -i source.mp4 -i overlay.mov \
     -filter_complex "[0:v][1:v]overlay" -ss <t> -frames:v 1 straight.png
   ```
4. **Simulate Premiere's premultiplied interpretation:**
   ```bash
   ffmpeg -y -i source.mp4 -i overlay.mov \
     -filter_complex "[1:v]unpremultiply=inplace=1[u];[0:v][u]overlay" \
     -ss <t> -frames:v 1 as_premult.png
   ```
5. Extract the same frame from the baked MP4 and diff (mean abs diff per channel, PIL/numpy).

**Verification checklist (expected outcome):**
- [ ] `straight.png` ≈ baked frame (box matches Image #2) → file content is correct.
- [ ] `as_premult.png` shows the washed-out box (matches Image #1) → Premiere-interpretation
      mismatch confirmed.
- [ ] Bundled ffmpeg has the filters: `ffmpeg -h filter=premultiply` / `filter=unpremultiply`.

If `straight.png` is ALSO washed out, the hypothesis is wrong — stop, report, re-scout
(next suspects: color-range/matrix flags on the rgba→yuva conversion).

## Phase 2 — Fix: premultiply the ProRes 4444 output

Single change in the MOV branch of the overlay cmd (`video_render.py:1299-1313`): insert
`"-vf", "premultiply=inplace=1",` before the codec args (ffmpeg auto-inserts pixel-format
conversions around the filter; output stays `yuva444p10le`).

Design decision (recommended default, revisit only if a user asks):
- Premultiplied **by default** for MOV — matches Premiere/FCP/QuickTime convention.
  No new config field / UI toggle yet (YAGNI); Resolve users can set "premultiplied" in
  clip attributes. If a straight-alpha workflow surfaces later, add `alpha_mode` to
  `VideoRenderConfig` then (snake_case ↔ camelCase bridge: `StudioSettings` →
  `render.ts` → schema, per CLAUDE.md).

**Verification checklist:**
- [ ] Re-run Phase 1 step 4 on the NEW file (`unpremultiply` + overlay) → now matches baked.
- [ ] WebM cmd unchanged (grep: `yuva420p` block untouched).
- [ ] Full backend suite green; golden 7/7; typecheck clean.

**Anti-pattern guards:** only the ProRes cmd list changes; no schema, no frontend, no
`_render_frame` edits in this phase.

## Phase 3 — Regression test for the encode path (first coverage of FFmpeg side)

New `backend/tests/test_overlay_alpha.py`, opt-in like the parity suite if it needs the
bundled ffmpeg (skip when ffmpeg unavailable; follow `test_caption_parity.py` gating style):

1. Render a tiny (e.g. 320×180, ~5 frames) overlay MOV with `bg_opacity=0.5`, dark bg box.
2. Decode a frame back to RGBA:
   ```bash
   ffmpeg -i out.mov -frames:v 1 -pix_fmt rgba -f rawvideo -
   ```
3. Assert **premultiplied invariant** on box pixels: `RGB_decoded ≈ RGB_expected × (a/255)`
   within a 10-bit-roundtrip tolerance, and `a ≈ 128`.
4. Assert equivalence: `unpremultiply` + composite over a solid color ≈ Pillow
   `alpha_composite` of the source frame over the same color (mean diff tolerance,
   reuse the parity suite's tolerance helpers).

**Verification checklist:**
- [ ] Test fails if `premultiply=inplace=1` is removed (run once reverted to prove RED).
- [ ] Test passes on the fix; suite time impact negligible.

## Phase 4 — Docs + final verification

1. CLAUDE.md: one bullet under the export/render notes: MOV overlay is **premultiplied**
   alpha (ProRes 4444 convention; Premiere/FCP-correct), WebM stays straight (VP9/browser
   convention). Note the diagnostic recipe (unpremultiply+overlay simulates NLE import).
2. Run: full pytest, `npm run typecheck`, golden suite, and (opt-in) parity suite.
3. Manual QA (user): re-export the same clip, drop the MOV over the video in Premiere,
   compare against the baked MP4 at the same frame — box density must now match Image #2.

**Verification checklist:**
- [ ] All suites green.
- [ ] grep `premultiply` appears exactly once in `backend/exporters/` (the MOV cmd) plus tests.
- [ ] User confirms Premiere result.
