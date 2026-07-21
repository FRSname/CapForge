# Plan: Re-review and merge PR #9 + PR #12 after author updates

**Goal**: Verify the author's review-response commits on PR #9 (Lithuanian WhisperX alignment) and PR #12 (searchable system font picker) fully address the 2026-07-18 CHANGES_REQUESTED reviews, run a fresh security pass, and merge if green.

**State as of 2026-07-19**: Both PRs updated today by author `pingvis`:
- PR #9 — new commit `2815bade` "Address Lithuanian alignment review feedback" (pushed 20:20 UTC)
- PR #12 — rebased + new commit `35f3a601` "Address system font picker review feedback" (pushed 21:09 UTC)
- Both still show CHANGES_REQUESTED (GitHub review state does not auto-refresh on new commits)
- main is green (CI run on `0353d97` merge passed)

---

## Phase 0: Consolidated findings (COMPLETE — scouted 2026-07-19)

Fact-gathering already done by two scout agents against the live PR heads. Executors of later phases should treat this section as the authoritative map and **spot-verify citations rather than re-derive them**.

### PR #9 — review items vs. response commit `2815bade`

| Review item | Verdict | Evidence |
|---|---|---|
| Narrow `try/except` in `realign_segments` to model-load only (errors must still 500) | **ADDRESSED** | `backend/engine/transcriber.py` — try wraps only `_load_align_model`; `whisperx.load_audio` and the realign loop are outside; test `test_realign_alignment_error_is_not_hidden_by_fallback` + `test_endpoint_returns_500_for_alignment_errors` |
| Add `alignment_degraded` flag + persistent UI notice | **ADDRESSED** | `backend/models/schemas.py` (flag on `TranscriptionResult` + `RealignResponse`); `backend/main.py` persists flag to `current_result`; new `src/renderer/src/components/screens/AlignmentNotice.tsx` (`role="status"`, `aria-live="polite"`); `ResultsScreen.tsx` one-way ratchet + info toast; 5 backend tests + `AlignmentNotice.test.tsx` |
| Nit: pin HF model to a revision hash | **NOT ADDRESSED** | `ALIGNMENT_MODELS = {"lt": "m3hrdadfi/wav2vec2-large-xlsr-lithuanian"}` — no revision. **Escalated in Phase 3** (supply-chain, not just reproducibility). |

### PR #12 — review items vs. response commit `35f3a601`

| Review item | Verdict | Evidence |
|---|---|---|
| Rebase + preserve "generic GET never carries local token" invariant | **ADDRESSED** | `src/renderer/src/lib/api.ts:194-203` — dedicated `getWithLocalToken<T>()`; generic `get()` unchanged; `api.test.ts:128-141` pins it; backend route gated via `Depends(require_local_token)` (`backend/main.py:396`) |
| Escape must revert live-previewed font | **ADDRESSED** | `FontCombobox.tsx` — `openingSelectionRef` snapshot + `cancelPicker()` (lines 115–123) wired to Escape (line 215); test at `FontCombobox.test.tsx:29-37` |
| Warn that system fonts don't embed in exported `.cfpreset` | **ADDRESSED** | `classifyFont()` returns `'system'` (`electron/preset-io.js:33-34`); pre-export confirm + info-level toast (`PresetPicker.tsx:165-185`); `getSystemFontExportWarning()` (`presets.ts:90-96`); `src/preload/index.ts` union updated |

### Security surfaces (scouted, to be adversarially re-checked in Phase 3)

- `/api/fonts/system`: token-gated, returns **family names only** (no paths), cache pre-scanned from hardcoded OS dirs — no client-input path construction. Tests: `backend/tests/test_local_auth.py:112-126`.
- `find_system_font_face(family)`: resolves against the enumerated cache, never builds paths from input.
- No changes to `_is_servable_path`, `resolve_output_dir`, or the workspace sandbox in either PR.
- Dual-preload convention respected in #12 (`electron/preload.js` unchanged; `src/preload/index.ts` types only).
- PR #9 `/api/realign`: audio path still comes from `current_result.audio_path`, existing gating unchanged.

**Allowed APIs for later phases** (do not invent alternatives): `gh pr view/diff/review/merge`, `git fetch origin refs/pull/N/head`, `npm run typecheck`, `npm test`, `.venv-dev/bin/python -m pytest backend/tests`, `CAPFORGE_PARITY=1` parity suite, `Agent(subagent_type: "git-ops")` for any git/gh **write**.

---

## Phase 1: Local gate runs on merge-with-main for each PR

**What to do** (per PR, sequentially — #9 first since it's older):

1. `git fetch origin main refs/pull/9/head refs/pull/12/head`
2. In a scratch worktree (never on main): `git worktree add <scratch>/pr9 FETCH_HEAD`-style checkout of the PR head, then `git merge origin/main --no-edit` (abort → report conflict, stop).
3. Run gates:
   - `.venv-dev/bin/python -m pytest backend/tests` (expect ≥ the 385-test baseline + new tests)
   - `npm run typecheck`
   - `npm test` (frontend; #12 expects 285+)
   - Golden frames: only if `video_render.py` changed (only #12 touches `resolve_font_file` — run `pytest backend/tests/test_render_golden.py`)
   - Parity (opt-in, #12 only, needs Node 22 + ffmpeg): `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py` — the prior review ran this at 20/20; re-run because `resolve_font_file` changed.
4. Remove worktrees when done.

**Verification checklist**: every suite green on the *merged* tree, not the PR head alone; record exact counts in the phase output.

**Anti-pattern guards**: do NOT run gates on the PR branch without merging main (main moved: `0353d97`). Do NOT skip parity for #12 on the grounds that "fonts are orthogonal" — font resolution is exactly what parity pins.

## Phase 2: Verify review-response commits line-by-line

**What to do**: Spot-verify each ADDRESSED verdict from Phase 0 by reading the cited files at the cited lines on the merged tree (Read tool, exact paths above). For PR #9 additionally confirm:
- The degraded flag is a **one-way ratchet** in `ResultsScreen.tsx` (a later successful realign must not clear a notice that transcription-time degradation set — confirm this is the intended UX, and that it IS one-way per scout).
- `alignment_degraded` survives project save/load (check whether the flag rides `TranscriptionResult` through `PUT /api/result` and project persistence; if it silently drops on save/reopen, note as non-blocking follow-up, not a merge blocker).

For PR #12 additionally confirm:
- `getWithLocalToken` is used **only** for `/api/fonts/system` (grep for other call sites).
- `window.confirm` in `PresetPicker.tsx` — confirm it behaves in Electron renderer (it does; native sync dialog) and matches existing UX conventions (project already uses toasts; a confirm for a destructive-ish export choice is acceptable).

**Verification checklist**: each Phase 0 verdict independently confirmed or contradicted with file:line notes.

**Anti-pattern guard**: do not "improve" the author's code during verification — this phase is read-only; findings go to the review, not into commits.

## Phase 3: Fresh security pass (the "think about security again" phase)

**What to do**: Targeted adversarial review, not a full re-audit (surfaces unchanged since last audit except the two PRs):

1. **HF model supply chain (PR #9 — escalate the "nit")**: `m3hrdadfi/wav2vec2-large-xlsr-lithuanian` is fetched unpinned. HF PyTorch `.bin` weights are pickle-deserialized → a compromised/replaced upstream repo becomes arbitrary code execution on the user's machine at alignment time. Check: (a) does whisperx/transformers load this via safetensors or `.bin`? (b) does the load path pass `revision=`? **Decision to make**: require a pinned `revision` (repo-id + commit hash in `ALIGNMENT_MODELS`, threaded through `_load_align_model`) as a merge condition, or accept with a filed follow-up. Recommendation: request the pin — it's a two-line change and the reviewer already flagged it.
2. **Token invariant (PR #12)**: confirm no generic `get()`/`post()` path gained the token header; confirm `/api/fonts/system` response is names-only (no absolute paths — path leakage would map the user's filesystem/username into anything that persists results).
3. **Traversal re-check (PR #12)**: `find_system_font_face` and `classifyFont` per Phase 0; also confirm `resolve_font_file`'s new system-font branch cannot be steered by a crafted `font` family string in a render config to embed an arbitrary file (it must only ever return paths from the pre-scanned cache).
4. **Preset import surface (PR #12)**: `parsePresetImport` handles the new `'system'` fontStatus — confirm imports with `fontStatus: 'system'` cannot smuggle a path and that the extension allowlist/basename rules are untouched.
5. **DoS/noise**: `/api/realign` on degraded path returns 200 with flag — confirm no unbounded loop/logging regression.

**Verification checklist**: written verdict per item (OK / issue found), CRITICAL/HIGH issues block merge per code-review severity levels.

**Anti-pattern guards**: don't file speculative findings without a concrete failure scenario; don't demand fixes outside the PRs' blast radius.

## Phase 4: Re-review submission and merge

**What to do** (all gh/git writes via `git-ops` subagent; **confirm with the user before merging** — outward-facing):

1. If Phases 1–3 green and the HF-pin decision is "follow-up": submit approving re-reviews on both PRs (`gh pr review N --approve --body ...`) summarizing verification results; if the pin is required, submit a focused re-request on #9 only and merge #12 alone.
2. Merge order: #9 then #12 (or independent — they don't overlap; #12 was already rebased today, #9 may need a post-#12-merge CI re-run; check `gh pr checks`).
3. Use the repo's established merge style (previous PRs #10/#11 were merged via GitHub; remember the fork-CI gotcha: fork PR CI doesn't refresh on close/reopen — re-trigger with an empty commit or merge-commit CI on main instead).
4. After merge: confirm main CI green, pull main locally.

**Verification checklist**: both PRs merged (or #9 explicitly parked awaiting pin), main CI green, local main synced.

## Phase 5: Final verification + memory

1. `grep -rn "alignment_degraded" backend/ src/` on main — flag present end-to-end; `grep -n "getWithLocalToken" src/renderer/src/lib/api.ts` — single scoped helper.
2. Run the full backend + frontend suites once on merged main.
3. Update `project_pr_triage_2026_07.md` memory (+ MEMORY.md index line) with outcomes; note remaining manual QA items: in-app AlignmentNotice visual check, font picker keyboard flow, `.cfpreset` export dialog, Windows registry font codepath.
