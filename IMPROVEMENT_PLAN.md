# CapForge — Improvement Plan (v1.4.0 → v1.5.x)

Phased plan, each phase self-contained and executable in a fresh chat context.
Generated 2026-06-10 from a survey of the actual codebase (see Phase 0).

---

## Phase 0: Discovery Findings (already done — reference only)

Sources read: `package.json`, `CLAUDE.md`, `DEVELOPMENT_PLAN.md`, `CHANGELOG.md`,
`backend/main.py`, `backend/exporters/` (all files), `backend/exporters/video_render.py`
(frame loop at lines ~780–1060), grep for TODO/maxWidth/safe-zone across `src/`, `backend/`, `electron/`.

**Current state:**
- v1.4.0, feature-rich editor (timeline drag, groups editor, per-word styles, autosave/crash recovery).
- **No test suite, no linter, no formatter, no CI.** Only check is `npm run typecheck`.
- Renderer parity invariant (Canvas `useSubtitleOverlay.ts` ↔ Pillow `video_render.py`) is enforced
  only by discipline + shared constants in `src/renderer/src/lib/renderConstants.ts`. No automated check.
- `video_render.py` (1290 lines): ThreadPool frame rendering (half the cores), blank-frame bytes cached,
  but **frames identical between word-highlight boundaries are re-rendered from scratch** (`_render_one`, ~line 1053).
- Exporters: `srt_standard.py`, `srt_word.py`, `vtt_export.py`, `json_export.py`, `premiere_export.py`,
  video (webm/VP9, mp4/x264, mov/ProRes 4444 alpha). **No ASS/SSA export.**
- `maxWidth` + greedy word-wrap shipped (`useSubtitleOverlay.ts:156`, `video_render.py:705`).
  **No safe-zone guides** anywhere (grep confirms).
- Open TODOs: `src/main/index.ts:11` (TS port of `electron/main.js`),
  `electron/platform/mac.js:13` (whisper-cpp perf path).
- Backend API: transcribe / result GET+PUT / export / render-video / cancel / serve-audio / video-info / ws-progress.

**Allowed-API notes (anti-hallucination):**
- PIL text width = `font.getlength()` — NOT `textbbox` (strips side bearings; documented in CLAUDE.md).
- No synthetic bold anywhere — bold = separate font file.
- React `onWheel` is passive; canvas zoom must use native `addEventListener('wheel', …, { passive: false })`.
- snake_case↔camelCase bridge lives only in `src/renderer/src/lib/render.ts` (`buildRenderBody()`).
- New settings touch all three: `StudioSettings` (StudioPanel.tsx) → `render.ts` → `VideoRenderConfig` (backend/models/schemas.py).

---

## Phase 1: Test & Lint Foundation

**Goal:** Stop relying on manual QA for a codebase this stateful. Cheapest, highest-leverage phase; everything later builds on it.

**Implement:**
1. Add `vitest` (devDependency) + `npm run test`. No jsdom needed initially — target pure modules:
   - `src/renderer/src/lib/groups.ts` — `buildStudioGroups`, `reorderGroup`, merge/split. This file caused
     4 of the last 6 bug fixes (see CHANGELOG v1.4.0); test the exact regressions: word-sync preserving
     per-word overrides, manual group timing surviving text edits, word-count changes.
   - `src/renderer/src/lib/presets.ts` — serialize/deserialize round-trip.
   - `src/renderer/src/lib/render.ts` — `buildRenderBody()` snake_case mapping (golden-object test so a
     missing field in the bridge fails loudly).
2. Add `pytest` for backend pure functions: `exporters/srt_standard.py`, `srt_word.py`, `vtt_export.py`
   with a small fixture `TranscriptionResult` (build from `models/schemas.py`).
3. Add ESLint (flat config, typescript-eslint) + Prettier; format only `src/`, leave `electron/` JS alone for now.
4. Add a GitHub Actions workflow: `typecheck` + `vitest` + `pytest` on push.

**Verification:**
- [ ] `npm run test` passes; at least 15 tests across groups/presets/render.
- [ ] `pytest backend/tests` passes.
- [ ] A deliberately broken `buildRenderBody` field fails the golden test.
- [ ] CI workflow green on a test push.

**Anti-pattern guards:** Do NOT add jsdom/component tests yet (brittle, low signal per web testing rules — visual regression covers components better). Do NOT auto-fix lint across `electron/` (vanilla JS, churn risk).

---

## Phase 2: Preview ↔ Render Parity Harness

**Goal:** Turn the project's #1 invariant (CLAUDE.md "Preview ↔ Render Parity") from a convention into a test.

**Implement:**
1. Backend golden frames: pytest that calls `_render_frame()` (video_render.py) with a frozen config +
   bundled font from `Fonts/` and compares against checked-in PNGs (pixel diff with small tolerance,
   e.g. mean abs diff < 2/255). Cover: plain group, active-word highlight, bg box, shadow, pop animation mid-phase, word-wrap at maxWidth.
2. Frontend counterpart: Playwright (or a minimal electron-vite page) screenshots the Canvas overlay with
   the same config/group, diffed against the backend golden with a looser tolerance (fonts/AA differ slightly).
   If Playwright is too heavy, start with formula-level unit tests: extract row-gap / box-sizing / word-position
   math from `useSubtitleOverlay.ts` into pure functions in `lib/` and assert identical numbers to a Python
   port test via shared JSON fixtures.
3. Document the harness in CLAUDE.md under the parity section.

**Verification:**
- [ ] Changing a constant in `renderConstants.ts` without the backend pass-through fails a test.
- [ ] Golden PNGs reviewed visually once and committed.

**Anti-pattern guards:** Don't compare Canvas vs Pillow pixel-exact (browser shadow kernel ≠ Gaussian — documented at video_render.py ~line 838). Tolerance-based or formula-based only.

---

## Phase 3: Render Performance — Frame Dedup Cache

**Goal:** Large speedup for overlay/baked renders by not re-rendering identical frames.

**Implement (in `backend/exporters/video_render.py`, `_render_overlay` and `_render_baked`):**
1. Compute a frame "state key" instead of rendering blindly per frame:
   `(group_index, active_word_index, quantized_anim_phase)` where anim phase is only non-steady during
   the entry/exit animation window; in steady state it's a constant. Frames sharing a key reuse cached bytes
   (same pattern as the existing `blank_bytes` reuse, ~line 1047).
2. For a typical clip (1 word highlight change ~3×/sec, 30–60 fps), this skips 90%+ of Pillow work.
   Cache bound: LRU of ~32 entries (frames are `W*H*4` bytes; 1080×1920 ≈ 8 MB each).
3. Benchmark before/after on a fixed 60 s clip; record numbers in the PR description.

**Verification:**
- [ ] Output video is byte-comparable (or pixel-identical per frame) to pre-change render for the benchmark clip.
- [ ] Golden-frame tests from Phase 2 still pass.
- [ ] Measured wall-clock improvement recorded (expect 3–10× on steady-state-heavy clips).

**Anti-pattern guards:** Don't key the cache on time `t` directly (defeats dedup). Don't cache during animation windows where every frame differs. Keep the existing ThreadPool — the cache check happens before submit.

---

## Phase 4: Safe-Zone Guides + Platform Export Presets

**Goal:** The app targets short-form video; users currently eyeball whether captions collide with TikTok/Reels/Shorts UI.

**Implement:**
1. New toggle in StudioPanel ("Safe zones": off / TikTok / Reels / Shorts) — UI-only setting, NOT part of the
   render config (guides never render to video). Add to `StudioSettings` + `STUDIO_DEFAULTS` but deliberately
   exclude from `buildRenderBody()` — note this in a comment, it's the one exception to the three-place rule.
2. Draw guides in the preview overlay canvas (`useSubtitleOverlay.ts` or a separate overlay layer in
   `AudioPlayer.tsx` — prefer separate layer so parity tests are unaffected): semi-transparent hatched margins
   using published safe-area specs per platform.
3. Optional second step: resolution presets in `CustomRenderPanel` (1080×1920 / 1080×1350 / 1920×1080 one-click).

**Verification:**
- [ ] Guides visible in preview at each aspect ratio, absent from rendered output.
- [ ] Theme-aware colors (CSS vars, no hardcoded white/black — CLAUDE.md theming rules).
- [ ] Parity tests from Phase 2 unaffected.

**Anti-pattern guards:** Don't pipe the safe-zone setting through `render.ts` to the backend. Don't draw guides inside the subtitle overlay draw function used for parity.

---

## Phase 5: ASS/SSA Export (karaoke word highlighting)

**Goal:** Pro-workflow export — ASS with `\k` karaoke tags carries word timing + basic styling into
Premiere/Resolve/ffmpeg pipelines without rendering video.

**Implement:**
1. New `backend/exporters/ass_export.py` copying the structure of `srt_word.py` / `vtt_export.py`
   (module-level `export_ass(result: TranscriptionResult) -> str`).
2. Map StudioSettings basics where representable (font family/size, primary/highlight color → ASS
   `PrimaryColour`/`SecondaryColour` in &HBBGGRR& order, alignment, maxWidth → margins). Word timing via
   `{\k<centiseconds>}` per word from existing word timestamps.
3. Register in `_do_export` (backend/main.py ~line 398) and in the ExportPanel format list
   (`src/renderer/src/components/studio/ExportPanel.tsx`).

**Verification:**
- [ ] pytest: golden ASS file for fixture transcript; timing sums match segment durations.
- [ ] Output plays with word highlight in VLC / ffplay (`ffplay -vf "subtitles=out.ass"`).
- [ ] Export panel shows the new format and round-trips through the existing export flow.

**Anti-pattern guards:** ASS colors are &HAABBGGRR (blue-first) — don't copy hex RGB straight in. Don't attempt full per-word style override fidelity in v1; basic style block only.

---

## Phase 6 (backlog — do not start without explicit go-ahead)

- TS port of `electron/main.js` (`src/main/index.ts:11` TODO) — high churn, low user value right now.
- whisper.cpp / WhisperKit transcription path (`electron/platform/mac.js:13` TODO) — big perf win on Mac,
  but a separate project-sized effort; prior session research exists in memory (Jun 10 session).
- Batch queue (transcribe multiple files), translation pass, model download manager UI.

---

## Final Phase: Verification Sweep

1. `npm run typecheck && npm run test && pytest` all green.
2. `npm run build:react && npm start` — smoke: load clip → transcribe → edit → render overlay → export ASS.
3. Grep guards: no `textbbox` for width math in backend; no safe-zone keys in `buildRenderBody`;
   no hardcoded colors in new UI (`grep -rn "text-white\|bg-black" src/renderer/src/components`).
4. Benchmark numbers from Phase 3 recorded in CHANGELOG.
