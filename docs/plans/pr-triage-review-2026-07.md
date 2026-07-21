# Plan: Review open PRs #9–#12 (author: pingvis/Augis)

Status: COMPLETE 2026-07-18 — reviews posted to GitHub (#10/#11 approved,
#9/#12 request-changes) and all four action_required CI runs approved.
Remaining: merges (user decision, via git-ops) once author addresses findings.

## RESULTS (2026-07-18)

Five parallel static reviews (adversarial, no PR code executed until cleared),
then local gates on temp merge branches. No malicious code found in any PR.

| PR | Verdict | Gates run on merge with main |
|----|---------|------------------------------|
| #9 Lithuanian alignment | **REQUEST CHANGES** — 2 HIGH correctness | backend pytest 337/337 green |
| #10 NSIS/electron-builder 26.11.1 | **APPROVE** | npm ci clean, AtLeastWin8 guard present in installed templates, build:react OK, **full signed+notarized DMG built successfully under 26.x** |
| #11 volume control | **APPROVE** | typecheck OK, vitest 276/276 green |
| #12 system font picker | **REQUEST CHANGES** — test conflict + 3 MEDIUM | typecheck OK, backend 339/339, golden green, **parity 20/20 green**; vitest 7 FAILURES (see below) |

### PR #9 blocking findings
1. HIGH `realign_segments` wraps the whole realign loop in `except Exception` →
   any bug returns 200 OK with evenly-spaced fabricated timings instead of the
   old 500+toast. Narrow the try to model loading only.
2. HIGH approximate timings carry no flag — indistinguishable downstream
   (timeline word lane, karaoke, grouping); only signal is a transient progress
   message. Needs e.g. `alignment_degraded` on the result + persistent banner.
   (Also LOW: HF model unpinned revision; THIRD_PARTY_MODELS.md not linked.)

### PR #12 blocking findings
1. **Semantic test conflict with main**: PR changed `api.ts` `get()` to send the
   local token on ALL GETs (needed for `/api/fonts/system`); main's new
   `api.test.ts` pins "GET requests never carry the local token header" → 7
   vitest failures on the merge. PR must rebase and reconcile (either loosen
   main's invariant deliberately or send the token only for gated GETs).
   Plus the add/add conflict in the same file (union both suites).
2. MEDIUM Escape in FontCombobox doesn't revert live-previewed font (regression
   vs old `<select>`; no undo net for per-word overrides).
3. MEDIUM system-font presets: `.cfpreset` export stores bare family name →
   silent, renderer-divergent fallback on machines lacking the font
   (`classifyFont` returns 'none'; Pillow → load_default, HTML → no @font-face).
4. Security pass: APPROVED — `/api/fonts/system` token-gated; resolution is
   enumerated-match, not path construction (traversal-safe); auth tests additive.
   Side-finding (ours, pre-existing): legacy `_find_font_candidates` builds
   paths from the family string — bounded, but deserves a hardening ticket.

### PR #10 verification detail
Supply chain: all 115 added tarballs → registry.npmjs.org; zero integrity
changes on unchanged versions; 1 expected install-script package
(electron-winstaller via squirrel-windows); no typosquats. Root cause verified
upstream: electron-builder #8536/#9564, fix shipped 26.9.0. npm audit highs
(electron, vite) are PRE-EXISTING deps, untouched by the PR. A signed +
notarized DMG was produced end-to-end under 26.11.1 during review (custom
afterSign hooks work), so the Mac pipeline is verified, not just assumed.
Note: `dist/CapForge-2.3.0.dmg` in the working tree is that review-build
artifact (gitignored) — not a release.

### CI note
All four PRs' CI runs sit at `action_required` (first-time fork contributor
gate). Approving them on GitHub is a maintainer action — user decision.

### Suggested merge order (after fixes land)
#11 → #10 (then post-merge `npm run release:mac` smoke per checklist) → #9
(after the two HIGH fixes) → #12 (after rebase + test reconciliation).
Created: 2026-07-18. All four PRs opened 2026-07-16; main has since absorbed the
July improvement plan (StudioPanel + video_render.py refactor splits, icon fixes,
v2.3.0 changelog), so **staleness/conflict checks are mandatory in every phase**.

Each phase is self-contained and can run in a fresh context. Reviews are
**read-only + local verification**; posting anything to GitHub (review comments,
approvals, requests for changes) happens only in Phase 5 after explicit user
approval — GitHub comments are outward-facing.

## PR inventory (verified via `gh pr list` / `gh pr view`, 2026-07-18)

| PR | Title | Files | Size | Risk profile |
|----|-------|-------|------|--------------|
| #9 | Fix Lithuanian WhisperX alignment support | `backend/engine/transcriber.py`, `backend/tests/test_realign.py`, `THIRD_PARTY_MODELS.md` | +219/−23 | Backend pipeline; interacts with shipped `/api/realign` |
| #10 | Fix Windows 11 NSIS installer crash | `package.json`, `package-lock.json`, `README.md`, `DOCS.md` | +949/−1193 | Dependency bump (electron-builder); affects Mac signed-DMG pipeline too |
| #11 | Add media player volume control | `AudioPlayer.tsx`, `VolumeControl.tsx` (+test), `useWaveSurfer.ts` | +112/−1 | Renderer UI; low risk |
| #12 | Add searchable system font picker | 13 files: `backend/engine/system_fonts.py`, `backend/main.py`, `backend/exporters/video_render.py`, `FontPicker/FontCombobox` (+tests), `lib/fonts.ts`, `lib/api.ts`, `WordStylePopup.tsx` | +810/−63 | Largest; touches auth surface, render-parity contract, and a file main just refactored |

No CI checks reported on any PR branch (`gh pr checks` → "no checks reported").

## Phase 0: Discovery & staleness triage (ALWAYS FIRST)

**Do:**
1. `git fetch origin` then for each PR: `gh pr diff <n>` and
   `git merge-tree $(git merge-base origin/main origin/<branch>) origin/main origin/<branch>`
   (or `gh pr view <n> --json mergeable` after fetch) to get real conflict status —
   it showed `UNKNOWN` for #9/#11/#12 at plan time.
2. Confirm why no CI ran: check `.github/workflows/*.yml` triggers (`pull_request`?
   first-time-contributor approval gate?). If workflows exist but need approval,
   note it — reviews below must then run the gates locally.
3. Specifically diff PR #12's `video_render.py` changes against current main —
   main split that file (July improvement plan Phase 5); the PR was authored
   against the pre-split shape.

**Allowed sources of truth (read, don't assume):**
- `CLAUDE.md` → "Preview ↔ Render Parity", "Key Conventions" (local media token,
  dual preload gotcha), "HyperFrames Integration"
- `backend/main.py` `require_local_token` / `_is_servable_path`
- `backend/exporters/video_render.py` `resolve_font_file()`

**Verify:** a written per-PR note: mergeable yes/no, CI situation, contract areas touched.

**Anti-patterns:** don't trust the PR body's claims about root cause or behavior —
verify in the diff; don't assume `mergeable: MERGEABLE` from a stale cache.

### Phase 0 findings (2026-07-18) — DONE

All four PRs are **cross-repo fork PRs** from `pingvis/CapForge`; fetch heads via
`refs/pull/<n>/head`. All are 17 commits behind main (base `67c0e27`).

| PR | Merge vs current main | CI |
|----|----------------------|----|
| #9 | CLEAN (`git merge-tree`) | run exists, `action_required` |
| #10 | CLEAN | `action_required` |
| #11 | CLEAN | `action_required` |
| #12 | **1 conflict**: add/add on `src/renderer/src/lib/api.test.ts` | `action_required` |

- **CI mystery solved:** `ci.yml` does trigger on `pull_request`; all four runs sit
  at `action_required` — the maintainer-approval gate for first-time fork
  contributors. Approving is a user decision (fork `pull_request` runs get no
  secrets + read-only token, so low risk after eyeballing the diffs). Until then,
  run all gates locally.
- **PR #12 vs the video_render.py refactor:** better than feared. The PR touches
  only an import, `_get_font`, and `resolve_font_file` — all still present in the
  refactored file (1626 → 1257 lines on main); merge-tree auto-merges it. The one
  real conflict is trivial: main added its own `api.test.ts` (normalizeResult
  tests), the PR added one with `getSystemFonts` tests — resolution = combine
  both suites into the existing file.
- Review each PR **merged onto current main** (e.g. worktree with
  `git merge pr/<n>`), not at its stale base.

## Phase 1: Review PR #9 — Lithuanian alignment (backend)

**Do:** checkout the PR branch locally (`gh pr checkout 9`), review with a
Python-focused pass, run the gates.

**Review focus:**
- The centralized language→align-model mapping: does the realign endpoint
  (`/api/realign`, shipped on main `89757c6` with tests) use the same helper,
  or does the PR fork the loading path?
- Fallback behavior "preserve Whisper segments when alignment unavailable" +
  "evenly distributed approximate word timings": approximate timings feed the
  timeline word lane, grouping, and karaoke/word transitions — flag UX blast
  radius, don't just check it compiles.
- New model `m3hrdadfi/wav2vec2-large-xlsr-lithuanian`: license noted in
  `THIRD_PARTY_MODELS.md`? Downloaded at runtime — size/offline implications?

**Verify:** `.venv-dev/bin/python -m pytest backend/tests/test_realign.py` (and
full backend suite) on the PR branch merged onto current main.

**Anti-patterns:** approving because tests pass without checking the fallback's
effect on word-level features; accepting hardcoded model IDs sprinkled in
multiple places instead of the claimed central mapping.

## Phase 2: Review PR #10 — NSIS installer crash (packaging)

**Do:** this is effectively an electron-builder version bump + config change.
Review `package.json` diff first, then spot-check the lockfile delta.

**Review focus:**
- Exactly which electron-builder version, and is the stated root cause
  (Win7 compat path / `System::Store()` race) verifiable in electron-builder
  release notes? (WebFetch the changelog — cite it in the review.)
- **Mac blast radius:** the signed + notarized arm64 DMG pipeline
  (`npm run release:mac`) and the just-fixed `build/icon.icns`/`icon.ico`
  handling must survive the bump. Check electron-builder breaking changes
  between 25.1.8 and the target version.
- Lockfile hygiene: +949/−1193 should be pure transitive churn from the one
  bump — grep the lockfile diff for *new* top-level deps or registry changes.

**Verify:** `npm ci && npm run build:react && npm run dist:mac` locally
(unsigned build is enough to prove packaging still works). Windows claim can't
be verified on this Mac — say so explicitly in the review rather than implying it was tested.

**Anti-patterns:** rubber-stamping a lockfile diff; claiming the Windows fix is
verified when it wasn't; ignoring that `mergeable` was the only one already
MERGEABLE (don't let that substitute for review).

## Phase 3: Review PR #11 — volume control (renderer)

**Do:** `gh pr checkout 11`, React-focused review pass.

**Review focus:**
- Theming contract: no hardcoded colors (`text-white`/`bg-black`); CSS vars via
  `var(--color-*)`; beware the Tailwind v4 `text-[var(--color-text)]` misparse
  (CLAUDE.md → Theming). Check both dark and light.
- Volume must drive **WaveSurfer** volume (it does per description) — confirm it
  also covers the `<video>` element path and survives source reload without
  fighting the existing `useWaveSurfer` lifecycle.
- Accessibility: slider keyboard operability, `aria-label`, muted-state feedback.
- Does `VolumeControl.test.tsx` actually run under the repo's vitest setup?

**Verify:** `npm run typecheck`, frontend test suite, and a quick in-app smoke
(`npm run dev:react`) checking both themes.

**Anti-patterns:** hidden state duplication (volume stored in two places),
`onWheel` React handlers on canvas-ish surfaces (must be native non-passive
listeners per CLAUDE.md), hardcoded palette values.

## Phase 4: Review PR #12 — system font picker (largest, highest risk)

**Do:** `gh pr checkout 12`; split the review into three sub-passes — security,
render parity, UI.

**Security pass (backend/main.py + system_fonts.py):**
- New font-listing/resolution endpoints: are they gated by
  `require_local_token`? (`test_local_auth.py` is touched — check it *adds*
  coverage for the new routes, not weakens existing.)
- `system_fonts.py` enumerates OS font dirs and the render path resolves a
  client-supplied family/weight to a **file path** that Pillow opens — audit
  for path traversal / arbitrary-file-read via crafted family names. Compare
  with the `_is_servable_path` philosophy.

**Parity pass (video_render.py + the three-renderer contract):**
- CLAUDE.md's parity section: any font-resolution change must keep
  (1) Canvas `@font-face`, (2) Pillow `resolve_font_file()`, (3) the HyperFrames
  HTML `_font_face_block` embedding **the same file**. A system font picked by
  name must still be embeddable for the headless render machine.
- This file was refactored on main after the PR branched — expect conflicts;
  the review verdict should state the rebase cost.
- Run golden frames + (if env available) `CAPFORGE_PARITY=1` parity suite on
  the merged result.

**UI pass:**
- Dual-preload gotcha: if any new `window.subforge.*` API was added it needs
  BOTH `electron/preload.js` and `src/preload/index.ts`. (File list suggests
  they went through the backend HTTP API instead — confirm.)
- snake_case↔camelCase bridge: new render-config fields must appear in all
  three places (StudioSettings → `render.ts` → `VideoRenderConfig`).
- Preset interaction: does a system-font selection survive preset save/load and
  `.cfpreset` export? (Presets re-materialize fonts to local paths — a system
  font referenced by name may not exist on the importing machine.)

**Verify:** `npm run typecheck`, backend pytest (incl. `test_system_fonts.py`,
`test_local_auth.py`), golden frames `backend/tests/test_render_golden.py`,
parity suite if runnable.

**Anti-patterns:** treating this as one review — the security and parity
concerns are independent and each can block; assuming the PR's
`resolve the correct installed font file` claim covers the HTML-embed path
(the caption-spacing bug history says this is exactly where it breaks).

## Phase 5: Consolidate & respond (outward-facing — needs user approval)

1. Produce a verdict table: per PR — approve / request changes / needs rebase,
   with the 2–3 highest-severity findings each.
2. **Ask the user** before posting anything to GitHub. Then post via
   `gh pr review <n> --comment|--request-changes --body ...`.
3. Suggested merge order if all pass: #11 (smallest) → #9 → #10 (then rebuild
   DMG) → #12 (after rebase onto refactored main).
4. Nothing is merged in this plan — merging is a separate user decision and
   goes through the git-ops agent.

## Global verification checklist

- [ ] Every finding cites file:line from the actual diff, not the PR body
- [ ] All local gates run per phase: typecheck, backend pytest, golden frames
- [ ] PR #12 security pass explicitly answers: token-gated? traversal-safe?
- [ ] No GitHub-visible action taken before user approval
