# Overlay MOV Opacity — Round 2 (issue persists after premultiply fix)

**Status**: Phase 1 COMPLETE (2026-07-16) — verdict: **the MOV is correct; the wash-out happens in
Premiere's linear-color compositing** (see "Phase 1 — RESULTS" below). H1/H2/H4 dead; H3 (untagged
color metadata) confirmed present and worth fixing as hardening, but it is not the primary cause.

**Phases 2B-b + 3 IMPLEMENTED (2026-07-16, uncommitted on main)**: BT.709 hardening landed in
`video_render.py` — forced conversion matrix + stream tags (`_BT709_TAGS`) on overlay MOV, overlay
MP4, and baked MP4; WebM untouched. Empirical constraints discovered: the mov muxer needs
`-movflags write_colr` (experimental) or it writes NO `colr` atom for ProRes, and even then only
`color_space=bt709` is ffprobe-visible (legacy 3-field `nclc`, no range bit); libx264 lands
`color_range=tv` + `color_space=bt709` but never primaries/trc on this FFmpeg build. Pixel data is
fully BT.709/limited in all three branches regardless. Tests: 4 added in `test_overlay_alpha.py`
(MOV tags, MOV saturated-color premultiply+tags, MP4 tags, baked MP4 tags via lavfi source),
RED→GREEN verified; full suite 333 passed. Remaining open: user confirms the Premiere-side setting
fix (Phase 2B-a) + commit via git-ops.
**Symptom**: Transparent overlay MOV layered over source video in the NLE still shows the
caption background box (48% opacity) weaker / washed out vs the same subtitles baked into MP4 —
*after* the premultiplied-alpha fix (merge `4b4b693`) supposedly shipped.

---

## Phase 0 — Documentation Discovery (DONE — consolidated findings)

Gathered by two scout agents on 2026-07-16. All claims cited.

### Established facts

| Fact | Evidence |
|---|---|
| Premultiply fix IS on main | `backend/exporters/video_render.py:1308` — `-vf premultiply=inplace=1` in the ProRes branch (`:1298-1316`); merge `4b4b693` |
| A build containing the fix exists | `CapForge-2.3.0.dmg` built Jul 16 **12:08**, fix merged **11:45** — but any DMG installed earlier predates it |
| Encode path empirically verified | `backend/tests/test_overlay_alpha.py` **decodes the real MOV** and asserts (1) premultiplied invariant `RGB ≈ RGB_straight·a/255` (`:193-212`), (2) round-trip composite over gray vs Pillow reference (`:214-226`) — at 320×180, opacity 0.5 |
| Frames leave Python as straight alpha | raw RGBA piped to FFmpeg stdin (`video_render.py:1362-1367`); box alpha = `int(bg_opacity·anim_alpha·255)` (`:85-89`, `:855`) — same math for baked & overlay |
| **No color range/matrix tags on ProRes cmd** | `video_render.py:1298-1316` has no `-color_range`/`-colorspace`/`-color_primaries`/`-color_trc`; swscale RGB→YUV output is untagged → NLE guesses |
| FFmpeg resolution | `CAPFORGE_FFMPEG` env (set by `electron/python-manager.js:188` to bundled binary) → PATH fallback (`video_render.py:234-257`); no `premultiply` filter pre-flight, but failure is **loud** (`:1359-1388` raises with stderr tail) |
| Backend code source: dev = live repo, packaged = `app.asar.unpacked/backend` snapshot | `electron/python-manager.js:342-343` |
| Export path | CustomRenderPanel format/renderMode → `render.ts:112-113` (`output_format`, `render_mode`) → POST `/api/render-video` (`api.ts:292-293`); no renderer/backend settings cache found |
| WebM branch is straight alpha **by design** | `video_render.py:1265-1282`; CLAUDE.md "Overlay MOV alpha convention" |

### Competing hypotheses (ranked)

1. **H1 — Stale artifact**: the MOV tested was produced by pre-fix code (old DMG, or a dev/packaged app whose backend process predated the merge — the backend is spawned at app startup, so an app left running keeps old code). Build timing (12:08 build vs test shortly after) makes this very plausible.
2. **H2 — NLE alpha interpretation**: file is correctly premultiplied, but Premiere's *Interpret Footage → Alpha* is set to "Straight" (or "Ignore") for the clip → premultiplied RGB composited as straight → box reads wrong.
3. **H3 — Color range/gamma mismatch**: untagged YUV (limited vs full range, 601 vs 709 matrix) → NLE lifts blacks → the dark translucent box looks washed out. Independent of alpha; NOT caught by the existing test (it decodes with ffmpeg, which round-trips its own untagged assumption symmetrically).
4. **H4 — Scale-dependent encode defect**: fix correct at 320×180/opacity 0.5 but misbehaves at the user's real resolution/opacity/fps (unlikely; premultiply is per-pixel).

### Allowed APIs (verified to exist)

- FFmpeg filters: `premultiply=inplace=1`, `unpremultiply=inplace=1`, `overlay`, `format`
- FFmpeg output tags: `-color_range`, `-colorspace`, `-color_primaries`, `-color_trc` (standard output options)
- `ffprobe -show_streams` for `pix_fmt`, `color_range`, `color_space` fields
- Pillow `Image.alpha_composite` (straight-alpha over)
- NLE-import simulation recipe (CLAUDE.md): `[1:v]unpremultiply=inplace=1[u];[0:v][u]overlay`

### Anti-pattern guards (carried over from round 1 + new)

- ❌ No invented `prores_ks` flags (`-alpha_mode`, `-alpha_channel` do not exist)
- ❌ Do NOT touch the WebM branch (straight alpha is the VP9/browser convention)
- ❌ Do NOT premultiply in Python/`_render_frame` (breaks golden frames + three-renderer parity)
- ❌ Do NOT regenerate golden frames (they pin straight-alpha frame output, which is still correct)
- ❌ Do NOT stack a second `premultiply` "just in case" — double-premultiply darkens edges
- ❌ Do NOT change encode flags without a discriminating A/B result from Phase 1/2 first

---

## Phase 1 — Provenance + empirical diagnosis of the *tested* artifact

**Agent**: implementer (needs Bash; read-only w.r.t. repo code).
**Goal**: decide between H1/H2/H3/H4 with file evidence, not reasoning.

### Inputs needed from the user (blocking)

1. Path to the exact MOV file that was imported into the NLE for this test.
2. Which app produced it: installed DMG (which version / when installed) or dev (`npm start` / `npm run dev`) — and whether the app was restarted after the fix landed.
3. Which NLE + what the clip's alpha interpretation shows (Premiere: right-click clip → *Modify → Interpret Footage → Alpha*).

### Tasks

1. **Classify the tested MOV** (this alone resolves H1):
   - `ffprobe -v error -show_streams <file>` → record `codec_name`, `pix_fmt`, `color_range`, `color_space`, `color_transfer`, `color_primaries`.
   - Decode a caption-visible frame to RGBA, sample box-interior pixels, and test the premultiplied invariant `RGB ≈ RGB_visible_straight·(a/255)` exactly as `test_overlay_alpha.py:193-212` does.
   - **Verdict**: straight alpha ⇒ H1 confirmed (stale artifact) → go to Phase 2A. Premultiplied ⇒ H1 dead → continue.
2. **Simulate both NLE interpretations** against a baked reference:
   - Render (or reuse) the matching baked MP4 for the same source + settings — ground truth for what the box should look like.
   - Sim "premultiplied" interpretation: `ffmpeg -i src.mp4 -i overlay.mov -filter_complex "[1:v]unpremultiply=inplace=1[u];[0:v][u]overlay" -frames:v 1 simA.png`
   - Sim "straight" interpretation: same without `unpremultiply`.
   - Diff both sims vs the baked frame at box-interior pixels. Whichever sim matches baked tells us what interpretation the file *needs*; compare with what the user's NLE clip is actually set to → resolves H2.
3. **Range/gamma probe** (resolves H3): compare box-interior luma between the baked frame and the correctly-interpreted sim. A uniform lift ≈ 16/255 on dark pixels, or `color_range: unknown` in the stream, implicates range tagging.
4. Grep `backend.log` (dev) for the ffmpeg command actually run — confirm `premultiply` was present at render time.

### Verification checklist

- [x] One-page verdict: which of H1–H4, with pixel numbers (sampled RGBA values, luma deltas) pasted into the report.
- [x] Premultiplied-invariant result on the user's actual file (pass/fail + max deviation).
- [x] ffprobe stream metadata recorded for the tested file.

### Phase 1 — RESULTS (2026-07-16, executed inline)

Tested artifact: `/Volumes/A053/Project/katerina-fiss/Stromy-noSub_subtitles.mov`
(rendered 12:11–12:13 by installed DMG 2.3.0, app installed 12:06; its
`app.asar.unpacked/backend/exporters/video_render.py` contains `premultiply` → post-fix code).

1. **File classification**: ProRes 4444, `yuva444p12le`, 2160×3840@25. Premultiplied invariant
   holds with **0 violations** across 5 sampled frames (t=5/15/30/60/90s). Box alpha is exactly
   **123/255 = 0.48**; box RGB is **pure black (0,0,0)**. → the fix is present and working; **H1 dead**.
2. **Black-box nullifier**: with a pure-black box, straight-vs-premultiplied interpretation is
   mathematically irrelevant for the box interior (0·a = 0) — the round-1 premultiply fix could
   never have changed this user-visible symptom. It only affects anti-aliased edges of bright text.
3. **Premiere alpha interpretation** (user screenshot): *"Use Alpha Premultiplication from File:
   Straight Alpha"* — Premiere does **not** un-premultiply this file; round-1's assumption that
   Premiere unpremultiplies ProRes 4444 does not hold for this Premiere version/config. **H2 dead**
   for the box (still recommend conforming the clip to Premultiplied for correct text edges).
4. **Composite ground truth** (box-interior mean luma at t=15s, mask = overlay α≈123):
   - source under box: **99.6**
   - baked MP4 (user's reference): **51.7**
   - ffmpeg gamma-space composite of the actual MOV over source: **50.4** → matches baked (Δ1.2 ≈ codec noise)
   - linear-light composite prediction (γ2.2): **73.9** → a ~22-luma lift, i.e. the exact "weaker
     opacity / washed out" look. → **Root cause: Premiere composites the clip in linear color**
     (sequence "Composite in Linear Color" and/or Premiere color management on the untagged file).
5. Stream metadata: `color_range/space/transfer/primaries` all **unknown** on the MOV (and on the
   baked MP4) — H3 confirmed as a real gap that can make Premiere's color management guess.

**Consequence for the plan**: skip Phase 2A. Phase 2B narrows to (a) a Premiere-side setting check
by the user (see below), and (b) a hardening code change: tag the ProRes output
`-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` so Premiere/NLEs stop
guessing (apply to the baked MP4 encode too, which is equally untagged).

**User steps in Premiere** (in order, re-check the box after each):
1. Sequence Settings → uncheck **"Composite in Linear Color"** (Premiere ≤23 dialog) — this is the
   prime suspect.
2. Premiere 2024/2025 color management: Lumetri → Settings (or Project Settings → Color) → set the
   sequence working space to **Rec.709**, disable **linearized compositing / wide-gamut** options and
   **Auto Tone Map Media** for this sequence.
3. Clip → Modify → Interpret Footage → Alpha: **Conform to Premultiplied Alpha** (correctness for
   white-text edges; won't change the black box).

---

## Phase 2A — If H1 (stale artifact): re-deliver, don't re-fix

**Agent**: implementer.

1. Confirm working tree = main @ ≥ `4b4b693`; run `.venv-dev/bin/python -m pytest backend/tests/test_overlay_alpha.py` green.
2. Rebuild the packaged app (`npm run dist:mac`) **or** have the user quit + relaunch the dev app (backend spawns at app startup — an app left running since before the merge still runs old code).
3. Re-export the overlay MOV, re-run the Phase 1 invariant probe on the *new* file (must be premultiplied), hand to user for one NLE import test.

**Verification**: new MOV passes the premultiplied invariant; user confirms box opacity matches baked MP4 in the NLE. Still wrong → fall through to Phase 2B with the new file.

## Phase 2B — If H2/H3 (file correct, NLE still wrong): discriminating A/B/C import test

**Agent**: implementer builds assets (scratchpad script, NOT repo code); **user** performs the one import test (we cannot drive the NLE).

1. Produce three MOVs from the same frame source:
   - **A**: current pipeline output (premultiplied, untagged) — control.
   - **B**: premultiplied + full color tags: base cmd from `video_render.py:1298-1316` plus `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` (output tags only).
   - **C**: straight alpha (fix reverted) — only to detect an NLE set to straight interpretation.
2. User imports all three over the source clip and reports which (if any) matches the baked MP4. Also check/flip Premiere's *Interpret Footage → Alpha* on clip A.
3. Implement the winner:
   - **B wins** ⇒ add the four tag flags to the ProRes branch (`video_render.py:1298-1316`) — encode-cmd-only change, `_render_frame` untouched.
   - **Interpretation flip fixes A** ⇒ no code change; document the NLE setting in CLAUDE.md + user docs (and still prefer B if tagging makes Premiere auto-detect correctly).
   - **C wins** ⇒ the NLE treats ProRes 4444 as straight; STOP and escalate — do not silently revert `premultiply` without reconciling round-1's evidence.

**Anti-pattern guard**: exactly one variable changes per variant; never combine tag changes with alpha changes in one candidate.

## Phase 3 — Pin the outcome in tests

**Agent**: implementer (extend the existing suite, don't fork it).

- If tags were added: extend `backend/tests/test_overlay_alpha.py` with an ffprobe assertion that the encoded stream reports `color_range=tv` / `color_space=bt709` (reuse the subprocess plumbing in `_decode_first_frame_rgba`).
- Add one invariant run at a realistic size/opacity (e.g. 1080p slice, 48% opacity) if Phase 1 showed any scale sensitivity (H4).
- If the resolution was purely stale-build / NLE-setting: no code change; update `docs/` + the CLAUDE.md "Overlay MOV alpha convention" paragraph with the verified NLE guidance instead.

**Verification**: `.venv-dev/bin/python -m pytest backend/tests/` green; golden-frame suite untouched and green.

## Phase 4 — Final verification

- [ ] `grep -n "premultiply" backend/exporters/video_render.py` → exactly one hit, ProRes branch only.
- [ ] `grep -n "color_range\|colorspace" backend/exporters/video_render.py` → present only if Phase 2B chose B; absent from the WebM branch.
- [ ] WebM branch byte-identical to pre-plan (git diff scope check).
- [ ] Full pytest suite + `npm run typecheck` green.
- [ ] User confirms, in the NLE, overlay-over-source visually matches baked MP4 at 48% bg opacity.
- [ ] Update CLAUDE.md convention paragraph + memory (`project_overlay_alpha_premultiply.md`) with the round-2 root cause.
