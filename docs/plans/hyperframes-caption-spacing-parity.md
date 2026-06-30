# HyperFrames Caption Word-Spacing Parity Fix

**Status:** IMPLEMENTED 2026-06-30 (all 6 phases)
**Created:** 2026-06-30
**Symptom:** Captions look correct in HyperFrames Studio *preview*, but the *final rendered video* shows wrong inter-word spacing — some words touch/overlap with no space between them.

## Outcome

Both root causes fixed and verified:
- **RC1 (the user's trigger — custom font):** `__capWhenFontsReady` in `hyperframes_caption_html.py` defers `__capBuild` + `__timelines` registration until `document.fonts.load()`/`.ready` resolves (3s timeout fallback). `_build_index_html` wraps the classic-caption build in this gate; native-caption path stays synchronous. `window.__renderReady = true` set after build.
- **RC2 (latent — bundled/system fonts):** `resolve_font_file()` added to `video_render.py` (reuses `_find_font_candidates`, mirrors `_get_font` order); `_font_face_block` now embeds the resolved file for *any* family, not just custom uploads.
- **CLI contract verified** (hyperframes 0.6.120): `pollSubCompositionTimelines` waits for `window.__timelines["root"]`; `getCompositionDuration` reads `data-duration` first → deferring registration is safe (Variant A).
- **Deterministic repro:** forcing the font-load race (delay the font response) collapsed the word gap to **5.84px** vs the correct **31.11px**; after the fix the gap stays **31.09px** even with the delay.
- **Tests:** +6 deterministic unit tests in `test_hyperframes_project.py` (RC1 gate wired, RC2 embed, resolver↔`_get_font` parity). Full suite `197 passed`; golden frames `7 passed` (Pillow unchanged); gated parity `11 passed` through the real `npx hyperframes` engine.

---

## Root-Cause Summary (from Phase 0 investigation)

The HyperFrames caption layer does **not** space words with CSS. Every word is a
`position: absolute` `.cw` span placed by a JS pixel cursor:

```
wx += wordWidth + spaceW   // wordWidth = measureWord(span), spaceW = measureText(' ').width
```

Both `wordWidth` and `spaceW` come from canvas `measureText(...)` evaluated **in the
render browser**. Spacing is therefore only correct if the browser has the *real* font
loaded at the instant `measureText` runs. Two independent ways this fails — both produce
identical "connected words" symptoms because the fallback font is narrower:

- **RC2 — bundled/system fonts are never delivered to the renderer (most likely trigger).**
  `_font_face_block()` returns `""` unless `config.custom_font_path` is set. For a bundled
  CapForge font or a system font picked by family name, **no `@font-face` is emitted**.
  Preview (user's OS browser, font installed) looks right; headless render
  (`chrome-headless-shell`, font NOT installed) falls back → wrong metrics → wrong spacing.
  - File: `backend/exporters/hyperframes_project.py:455-471` (`_font_face_block`, early `return ""` at 457-458).

- **RC1 — font-load race (latent; affects custom fonts).**
  `CAPTION_RUNTIME_JS` measures synchronously at script-parse time with no
  `document.fonts.ready` / `document.fonts.load` wait. On a cold headless render the
  `@font-face` file may not be decoded yet → fallback metrics baked into the paused GSAP
  timeline.
  - File: `backend/exporters/hyperframes_caption_html.py:210-235` (sync `measureText`),
    `backend/exporters/hyperframes_project.py:380-387,447-448` (inline `<script>` runs `__capBuild` immediately).

Why preview ≠ render (both mechanisms):
- Preview = `npx hyperframes preview` opened in the user's **system browser**
  (`electron/hyperframes-studio.js`); fonts installed/warm-cached → correct.
- Final render = `npx hyperframes render` (and `snapshot`) in a **cold headless browser**
  on a **cold tempdir scaffold** (`backend/main.py:756-768`, `backend/exporters/hyperframes_render.py:73-182`) → fonts missing/undecoded → fallback metrics.

The clean unifying fix: **make the render browser measure the exact same font file that the
Pillow renderer rasterizes.** Pillow already resolves `font_family` → a concrete TTF/OTF via
`_get_font(...)` in `backend/exporters/video_render.py`. If HyperFrames embeds *that same file*
via `@font-face` **and** waits for it to load before measuring, all three renderers measure
identical metrics → parity by construction.

---

## Phase 0 — Allowed APIs / Confirmed Facts (read before coding)

These are verified against the codebase. Do **not** invent alternatives.

### Caption layout (the spacing math — DO NOT change the formula, only the font correctness)
- `backend/exporters/hyperframes_caption_html.py`
  - `caption_cfg()` — style payload, lines `48-100`. Carries `fontFamily`, `fontSize`, `tracking`. **No `wordSpacing` key** (note for the optional Phase 6 cleanup).
  - `caption_markup()` — lines `103-118`. Words: `html.escape(w["word"].strip())`, joined with `"".join(spans)` (zero separator — spacing is JS-only, by design).
  - `.cw` CSS — lines ~`158-167`: `position: absolute; white-space: nowrap;` no margin/gap/word-spacing.
  - `CAPTION_RUNTIME_JS` measurement — `mc.font` + `measureText('Ayg')` at `210-214`; `measureWord` + `spaceW = mc.measureText(' ').width` at ~`219-221`; per-word widths at `235`; row widths at ~`256`; **position cursor `wx += m.width + spaceW`** at ~`295-305`.
- Reference renderers (the spacing formula is already correct and matched here — do not touch):
  - Canvas `src/renderer/src/hooks/useSubtitleOverlay.ts`: space `143-144` (`measureText(' ')`), `measureWord` `133-141`, position loop `217-220`, row widths `186-190`.
  - Pillow `backend/exporters/video_render.py`: `effective_space_w = font.getlength(" ") + extra_word_spacing` at `669`, `_measure_word` `658-666`, position loop `385-390`, draw advance `604-606`, `reveal` skip `494-500`.

### Font resolution (reuse, do not reinvent)
- `backend/exporters/video_render.py` — `_get_font(...)` resolves `font_family` (+ `custom_font_path`) to a concrete font file the Pillow renderer loads. **This is the canonical family→file resolver to reuse.** Confirm its exact signature/return (a `FreeTypeFont`; locate the underlying file path it opens — it may keep the path separately, e.g. a helper that returns the resolved path before `ImageFont.truetype`).
- `backend/exporters/hyperframes_project.py` — `_font_face_block(config, project_dir)` lines `455-471`: copies `config.custom_font_path` into `<project>/fonts/<name>` and emits `@font-face { ...; src: url("fonts/<name>"); font-display: block; }`. Uses `shutil.copy` (not `copy2` — copystat fails on flagged system fonts). **This is the function to generalize.**

### Render / preview / test plumbing
- Render: `backend/exporters/hyperframes_render.py` — `render_hyperframes_project()` ~`73-152` (`npx hyperframes render`, `cwd=project_dir`); `snapshot_hyperframes_project()` ~`155-182` (`npx hyperframes snapshot --at <t> --describe false`, reads newest PNG from `<project>/snapshots/`).
- Preview: `electron/hyperframes-studio.js` — `npx hyperframes preview --no-open --port <port>`; `PUPPETEER_CACHE_DIR` ~line `84`; `shell.openExternal` opens the **system browser**.
- Scaffold divergence: `backend/main.py:746-768` — preview writes to the canonical workspace (`hyperframes_workspace()`); render writes to a fresh `tempfile.mkdtemp(prefix="capforge-hf-")` (cold cache).
- Timeline registration: `backend/exporters/hyperframes_project.py:376-378` registers `window.__timelines["root"] = tl;` inside the IIFE; the HyperFrames CLI seeks this paused timeline per frame.
- GSAP is loaded from CDN: `<script src="{GSAP_CDN}">` at `447`. (Secondary robustness note, not the spacing bug.)

### Tests
- `backend/tests/test_caption_parity.py` — `_render_both` `113-123` (Pillow PNG vs `snapshot_hyperframes_project` PNG over a synthetic solid MP4); `_diff` `102-110`; tolerances `MEAN_MAX = 8.0`, `NOTABLE_FRAC_MAX = 5.0` at `43-44`; all 8 word modes `127-134`; gated by `CAPFORGE_PARITY=1` (line ~`15`, `51-54`); needs Node 22 + ffmpeg + network (GSAP CDN). **Known weakness:** loose, frame-wide tolerance can miss a few-px word shift; and if the fixture font is system-available the RC1/RC2 race never reproduces.
- `backend/tests/test_render_golden.py` — Pillow-only golden frames; scenarios `120-134`; tolerances `MAX_MEAN_DIFF=2.0`, `MAX_PIXEL_DIFF=40` at `35-36`; regen via `.venv-dev/bin/python -m backend.tests.gen_golden`. **No HTML coverage.**
- Test runner: `.venv-dev/bin/python -m pytest ...`.

### Anti-patterns to avoid
- ❌ Changing the spacing **formula** (`wx += m.width + spaceW`) — it is already correct and matches Pillow/Canvas. The bug is font metrics, not the formula.
- ❌ Adding CSS `word-spacing`/`gap`/literal spaces — would double-space and break per-word effect positioning (karaoke/underline/highlight read the same absolute coords).
- ❌ Blocking the render indefinitely on `document.fonts.ready` with no timeout — a never-loading font would hang every render. Always race against a timeout fallback.
- ❌ Assuming the HyperFrames CLI waits for `document.fonts.ready` before seeking — it is a third-party package (`hyperframes@0.6.x`); its timeline-discovery contract MUST be verified (Phase 3).
- ❌ Using `shutil.copy2`/`copystat` on font files — fails on macOS system fonts with flags. Match the existing `shutil.copy`.

---

## Phase 1 — Reproduce & Confirm Which Root Cause

**Goal:** Deterministically reproduce the bug headlessly and identify whether RC2, RC1, or both are in play for the user's case.

**What to do (copy the snapshot harness, don't invent):**
1. Write a throwaway repro script (or a `-x` pytest) that builds a project with a **multi-word** caption group (e.g. `["Hello", "brave", "world"]`) and renders one headless frame via `snapshot_hyperframes_project(project, t)` — exactly as `test_caption_parity.py:113-123` does.
2. Run it twice:
   - (a) with a **bundled/system font selected by family name only** (`custom_font_path` unset) → expect RC2 (no `@font-face` in the generated `index.html`; inspect `<project>/index.html`).
   - (b) with a **custom font file** (`custom_font_path` set to a TTF that is NOT installed in the OS) → expect RC1 (the `@font-face` is present but spacing still wrong on cold render).
3. Compare each HF snapshot against the Pillow `render_qa_frame_png(...)` for the same config/time. Save both PNGs side by side for visual confirmation of "connected words."
4. Inspect the generated `index.html` in each case; grep for `@font-face` and `document.fonts`.

**Verification checklist:**
- [ ] Case (a): generated `index.html` contains **no** `@font-face` (confirms RC2). HF snapshot shows tighter/wrong spacing vs Pillow.
- [ ] Case (b): generated `index.html` **has** `@font-face` but HF snapshot still mis-spaced on a cold run (confirms RC1).
- [ ] Saved PNGs visually reproduce the user's "connected words."

**Anti-pattern guards:** Don't fix anything yet. This phase only proves the mechanism so the fix can be verified against a real repro.

---

## Phase 2 — Fix RC2: Always Embed the Resolved Font File as `@font-face`

**Goal:** The HyperFrames HTML must always carry the *actual font file* (the same one Pillow
rasterizes), not just when a user uploaded a custom font.

**What to do:**
1. In `backend/exporters/video_render.py`, locate `_get_font(...)` and confirm how it resolves
   `font_family` (+ `custom_font_path`) to a concrete file path. If it only returns a
   `FreeTypeFont`, extract/expose the resolved **path** (add a small helper like
   `resolve_font_path(config) -> Path | None` next to `_get_font`, reusing its exact lookup
   order so the file is byte-identical to what Pillow loads).
2. Generalize `_font_face_block(config, project_dir)` in
   `backend/exporters/hyperframes_project.py:455-471`:
   - Resolve the font file via the Phase 2.1 helper (custom path first, else the bundled/system
     file the resolver returns).
   - Copy it into `<project>/fonts/<name>` with `shutil.copy` (keep the existing comment about
     `copy2`/system fonts).
   - Emit the `@font-face` with the same `font-family: "{config.font_family}"`, `src: url("fonts/<name>")`,
     `font-weight: 400`. Keep `font-display: block`.
   - Only return `""` when the resolver genuinely finds no file (then the OS-fallback path is
     unavoidable, but it now matches Pillow's own fallback — document this).
3. Keep the `.cw` / `.fx-*` CSS `font-family` references unchanged — they already name
   `"{config.font_family}"`, which now always has a matching `@font-face`.

**Documentation references:** `_font_face_block` `455-471`; `_get_font` in `video_render.py`
(family→file resolver — reuse, do not reimplement).

**Verification checklist:**
- [ ] Phase 1 case (a) now emits an `@font-face` pointing at the bundled font file; the file
      exists under `<project>/fonts/`.
- [ ] HF snapshot spacing for case (a) now matches Pillow (within tight tolerance — see Phase 4).
- [ ] No regression when `custom_font_path` IS set (case (b) still embeds the custom file).
- [ ] `resolve_font_path` returns the same file `_get_font` opens (assert equality in a unit test).

**Anti-pattern guards:** Don't duplicate the font-lookup order in two places — reuse Pillow's
resolver so HF and Pillow can never diverge. Don't base64-inline (keep the `fonts/` file copy
pattern already used; base64 doesn't remove the async decode and bloats the HTML).

---

## Phase 3 — Fix RC1: Measure Only After the Font Is Loaded

**Goal:** `measureText`-based word widths/positions must be computed after the embedded font is
decoded, in both headless and live browsers — without ever hanging the render.

**Step 3.0 — Verify the HyperFrames CLI timeline contract (BLOCKING, do first):**
Determine how `npx hyperframes render`/`snapshot` discovers and drives
`window.__timelines["root"]`. Inspect the installed package (via the managed Node runtime /
`node_modules/hyperframes`, or `npm view hyperframes` source) and/or test empirically:
- Does it **poll/wait** for `window.__timelines["root"]` to appear, or read it **once** at a
  fixed early moment?
- Does it begin frame capture only after `load`/network-idle/`document.fonts.ready`?

This determines which implementation variant is safe.

**Step 3.1 — Implement the deferred build.** Edit `CAPTION_RUNTIME_JS` /
`_build_index_html` IIFE assembly (`hyperframes_project.py:380-387`):

- **Variant A (use if Step 3.0 shows the CLI waits for / polls `__timelines`, or waits for fonts.ready before seeking):**
  Wrap the whole build+register in a font gate:
  ```js
  function __capStart(){
    var tl = gsap.timeline({ paused: true });
    __capBuild(tl, CAP_CFG, CAP_GROUPS);
    /* effects + window.__timelines["root"] = tl; */
  }
  var __fontStr = 'normal ' + CAP_CFG.fontSize + 'px "' + (CAP_CFG.fontFamily || '-apple-system') + '"';
  var __ready = (document.fonts && document.fonts.load)
    ? Promise.race([
        Promise.all([document.fonts.load(__fontStr), document.fonts.ready]),
        new Promise(function(r){ setTimeout(r, 3000); })   // never hang the render
      ])
    : Promise.resolve();
  __ready.then(__capStart);
  ```

- **Variant B (use if Step 3.0 shows the CLI reads `__timelines` ONCE at a fixed early time):**
  Register the paused timeline **synchronously** so `__timelines["root"]` exists immediately,
  but add the caption tweens inside the font gate (effects can stay synchronous):
  ```js
  var tl = gsap.timeline({ paused: true });
  window.__timelines = window.__timelines || {}; window.__timelines["root"] = tl;
  /* effects forEach … (synchronous) */
  __fontReady(__fontStr, 3000).then(function(){ __capBuild(tl, CAP_CFG, CAP_GROUPS); });
  ```
  Confirm the CLI seeks per-frame at capture time (after load), so late-added tweens are honored,
  and that timeline duration isn't snapshotted before captions are added (composition duration
  comes from `data-duration` on `#root`, set independently — verify).

Pick the variant per Step 3.0. Default to **Variant A** if the CLI clearly waits; otherwise B.

**Documentation references:** sync measurement at `hyperframes_caption_html.py:210-235`; IIFE
assembly + `__timelines` registration at `hyperframes_project.py:376-387`.

**Verification checklist:**
- [ ] Step 3.0 contract is documented in the PR description with evidence (package source or
      empirical snapshot test).
- [ ] After the fix, a **cold** headless snapshot (fresh tempdir, cleared Puppeteer cache if
      feasible) with the custom font (Phase 1 case b) shows correct spacing.
- [ ] Captions still appear and animate (timeline not broken) — snapshot at a mid-word time for
      `karaoke`/`highlight` shows the active-word state.
- [ ] A missing/never-loading font does NOT hang render (timeout fallback fires; render still
      completes).

**Anti-pattern guards:** Don't move `__timelines` registration into the async callback unless
Step 3.0 proves the CLI waits for it. Don't drop the timeout. Don't remove `font-display: block`.

---

## Phase 4 — Make the Tests Actually Catch This

**Goal:** Lock in the fix with regression coverage that would have failed before it.

**4.1 — Cheap deterministic unit tests (no browser; always run in CI):**
- Assert the generated `index.html` for a **bundled-font** config contains an `@font-face` whose
  `src` points at an existing `fonts/<name>` file (guards RC2).
- Assert the generated caption script contains the font-ready gate (e.g. substring
  `document.fonts` and the timeout fallback) (guards RC1).
- Assert `resolve_font_path(config)` equals the file `_get_font(config)` opens.

**4.2 — Strengthen the parity harness (`test_caption_parity.py`):**
- Add a fixture variant that uses a **real custom TTF shipped in test assets** (not OS-installed)
  so the headless path must load it — this is what reproduces RC1/RC2 if regressed.
- Add a **spacing-specific** assertion that's robust to small global shifts: from each rendered
  caption frame, threshold to the text mask and compare the **horizontal extent** (left edge of
  first word ↔ right edge of last word) and/or the count/width of inter-word gaps between Pillow
  and HF, with a tight pixel tolerance. A spacing regression changes total extent measurably even
  when the frame-wide mean diff stays under the loose `NOTABLE_FRAC_MAX`.
- Keep it under the existing `CAPFORGE_PARITY=1` opt-in gate.

**Documentation references:** `_render_both` `113-123`, `_diff` `102-110`, tolerances `43-44`,
modes `127-134`.

**Verification checklist:**
- [ ] New unit tests fail on `git stash` of Phase 2/3, pass with the fix.
- [ ] Parity test with the custom-font fixture fails pre-fix (reverting Phase 2/3) and passes post-fix.
- [ ] `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -v` green.

**Anti-pattern guards:** Don't merely loosen tolerances to make things pass. Don't assert exact
pixel equality across browser vs Pillow (anti-aliasing differs) — assert spacing/extent.

---

## Phase 5 — Final Verification

1. Run the full backend test suite: `.venv-dev/bin/python -m pytest backend/tests -v`
   and the gated parity suite with `CAPFORGE_PARITY=1`.
2. Re-run golden frames (`test_render_golden.py`) — Pillow output must be unchanged (this work
   touches only HyperFrames HTML + font embedding, not `_render_frame`). If any golden differs,
   STOP — something leaked into the Pillow path.
3. End-to-end manual check in the app: generate subtitles with a **bundled** font, open
   HyperFrames Studio (preview correct), then **render** the final video and confirm word spacing
   matches the preview. Repeat with a **custom uploaded** font.
4. Grep guards:
   - `grep -n "document.fonts" backend/exporters/hyperframes_caption_html.py backend/exporters/hyperframes_project.py` → present.
   - Confirm `_font_face_block` no longer early-returns `""` for bundled fonts.
5. Update `CLAUDE.md` "Preview ↔ Render Parity" section: note that HyperFrames now embeds the
   Pillow-resolved font file and gates measurement on `document.fonts`.

**Verification checklist:**
- [ ] All non-gated backend tests pass; gated parity passes locally.
- [ ] Golden frames unchanged.
- [ ] Manual bundled-font and custom-font renders match their previews.
- [ ] CLAUDE.md updated.

---

## Out of Scope (note, don't fix here)

- **`word_spacing` three-way drift (latent, currently 0 everywhere):** Pillow honors
  `config.word_spacing` (`video_render.py:669`), but Canvas hardcodes `+ 0`
  (`useSubtitleOverlay.ts:144`) and the HTML runtime has no `wordSpacing`
  (`caption_cfg` `48-100`). `render.ts:76` hardcodes `word_spacing: 0`, so all three agree at 0
  today. If a word-spacing control is ever exposed, thread it through all three (Canvas `+0`,
  HTML `spaceW`, and the `caption_cfg` payload) in lockstep. Tracked separately.
- **GSAP via CDN in headless render** (`hyperframes_project.py:447`): a slow/blocked CDN delays
  GSAP, not spacing. Consider bundling GSAP locally for offline robustness — separate task.
