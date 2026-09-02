# Plan: user-selectable Whisper model + deferred model download

**Status:** IMPLEMENTED 2026-09-02 on `feat/selectable-whisper-model` (all phases; manual QA outstanding)
**Origin:** user request — 8 GB RAM / integrated Intel laptop cannot run `large-v3-turbo`;
asks for Tiny / Base / Small / Large-Turbo choice, and for Large-Turbo not to be
downloaded until actually chosen.

**Verdict: feasible, and cheaper than it looks.** Most of the machinery already exists.
`ModelSize` is already a full enum, and `Transcriber._load_model` already downloads
on demand into `CAPFORGE_MODEL_DIR` with WebSocket progress. The gaps are: (1) nothing
can *pass* a model choice — `transcribe()` hardcodes the hardware recommendation, and
(2) first-run setup unconditionally pre-downloads ~1.6 GB of turbo.

---

## Phase 0 — Documentation discovery (facts, already gathered)

### Allowed APIs / existing surfaces (verified by reading the source)

| Fact | Location |
|---|---|
| `ModelSize` str-enum: `tiny, base, small, medium, large, large-v2, large-v3, large-v3-turbo` — **already complete, do not add values** | `backend/models/schemas.py:22-30` |
| `TranscribeRequest` fields: `audio_path, language, enable_diarization, hf_token, output_dir, export_formats` — **no model field yet** | `backend/models/schemas.py:69-75` |
| `SystemInfo.recommended_model: ModelSize` already returned by `/api/system-info` | `backend/models/schemas.py:59-65`, `backend/main.py:384` |
| `transcribe()` overrides everything with `model_size = hw.recommended_model.value` | `backend/engine/transcriber.py:95` |
| `_load_model(model_size, device, compute_type, on_progress)` — **downloads on demand already**, `whisperx.load_model(model_size, device, compute_type=…, download_root=…)`; model name is the **first positional arg**, `compute_type` and `download_root` are the only kwargs used | `backend/engine/transcriber.py:279-333` |
| Download progress: tqdm is monkey-patched inside `_load_model` and mapped to `JobStatus.LOADING_MODEL` at 5–14% — a first-use download of a newly chosen model already surfaces "Downloading model: … MB" in ProgressScreen | `backend/engine/transcriber.py:295-327` |
| Model cache short-circuit: `if self._model is not None and self._model_size == model_size: return` — switching model already reloads correctly | `backend/engine/transcriber.py:283-285` |
| `_configure_cpu()` hardcodes `LARGE_V3_TURBO` for every CPU machine, with a comment saying users "can downgrade in Settings" — **that Settings control does not exist**; this plan is the missing half | `backend/engine/hardware.py:~100-112` |
| First-run pre-download: `DEFAULT_MODEL = 'large-v3-turbo'`, `downloadDefaultModel(report)`, called unconditionally from `ensureRuntime` | `electron/runtime-setup.js:61`, `:265`, `:359` |
| `RUNTIME_VERSION = 10` — a bump forces a **full Python + torch reinstall** for every existing user | `electron/runtime-setup.js:41` |
| Wizard UI: "~1.6 GB" line, 4-step `stageOrder = ["extract","pip","install","model"]` | `electron/setup-window.html:162`, `:170-174`, `:235` |
| Settings persistence pattern: `window.subforge.getState(key, fallback)` / `setState` → `electron/app-state.js`; existing keys `language`, `diarize`, `hf_token` | `electron/app-state.js:40-56`, `SettingsPanel.tsx:78-107` |
| Settings UI pattern to **copy**: `handleLanguageChange` + `<Select>` | `src/renderer/src/components/SettingsPanel.tsx:95-98` |
| Transcription kickoff reads the three state keys and passes them to `start()` | `src/renderer/src/components/screens/ProgressScreen.tsx:57-68` |
| Frontend payload chain: `TranscriptionOptions` → `api.startTranscription` → `TranscribeParams` | `hooks/useTranscription.ts:12-17,57-63`, `lib/api.ts:54`, `:353` |
| MCP tool `transcribe(audio_path, language, diarize, output_dir)` → `POST /api/transcribe` | `mcp_server/server.py:165-178`, `mcp_server/client.py:87-89` |
| No existing tests cover `detect_hardware` or model selection — new test files needed | `backend/tests/` (only `test_realign.py` touches the transcriber) |

### RESOLVED 2026-09-02 — accepted model names

Verified against the **installed** CapForge runtime
(`~/Library/Application Support/CapForge/runtime/python`), faster-whisper **1.2.1**:

```
['base', 'base.en', 'distil-large-v2', 'distil-large-v3', 'distil-large-v3.5',
 'distil-medium.en', 'distil-small.en', 'large', 'large-v1', 'large-v2', 'large-v3',
 'large-v3-turbo', 'medium', 'medium.en', 'small', 'small.en', 'tiny', 'tiny.en', 'turbo']
```

All four names this feature exposes — `tiny`, `base`, `small`, `large-v3-turbo` — are
present. No aliasing needed. (Reproduce with
`python -c "from faster_whisper.utils import _MODELS; print(sorted(_MODELS))"`.)

### Anti-patterns (do NOT do these)

- ❌ **Do not** bump `RUNTIME_VERSION`. It gates the *whole* runtime (Python + torch),
  not just the model. Bumping it forces every existing user through a multi-GB
  reinstall to gain a dropdown.
- ❌ **Do not** add the model to `StudioSettings` / `VideoRenderConfig` / `DEFAULTS`, and
  **do not** add a `StudioRow`. That is the seven-file *caption-style* path (see
  CLAUDE.md). This is a transcription setting: it lives in `app-state.json`, is not a
  preset field, and is not part of a render config.
- ❌ **Do not** route it through `lib/settingsSanitize.ts` — that file is scoped to
  `StudioSettings`, and CLAUDE.md is explicit that enrolling additional enum settings is
  its own change.
- ❌ **Do not** add new `ModelSize` enum values. The enum is already complete.
- ❌ **Do not** pass the model name as a kwarg (`load_model(model_size=…)`). It is the
  first positional argument.
- ❌ **Do not** make `model` a required field on `TranscribeRequest`. It must default to
  `None` = "auto", or the existing MCP `transcribe` tool and any saved automation breaks.
- ❌ **Do not** hand-write an `X-CapForge-Local-Token` header — `/api/transcribe` is
  ungated and `api.ts`'s `post()` attaches it centrally anyway.

---

## Phase 1 — Backend: accept and honour an explicit model

**Goal:** `POST /api/transcribe` can carry a model choice; omitting it preserves today's
behaviour exactly.

1. **Verify the accepted model-name list** (Phase 0 item above). Write the result into
   this file before continuing.
2. `backend/models/schemas.py` — add to `TranscribeRequest`:
   ```python
   model: Optional[ModelSize] = Field(
       None, description="Whisper model; None = hardware-recommended auto-selection"
   )
   ```
   Copy the field style of the existing `language` field two lines above.
3. `backend/engine/transcriber.py:95` — replace the unconditional line:
   ```python
   model_size = (request.model or hw.recommended_model).value
   ```
   Leave `device` and `compute_type` sourced from `hw` untouched — a user picking `tiny`
   on a CUDA box should still get the hardware's compute type.
4. Log the resolved choice next to the existing `[capforge]` prints so `backend.log`
   shows whether a run was auto or explicit.

**Verification checklist**
- [ ] `pytest backend/tests/test_model_selection.py` (new): a `TranscribeRequest` with no
      `model` resolves to `hw.recommended_model`; with `model=ModelSize.TINY` resolves to
      `"tiny"`. Monkeypatch `_load_model` (copy the pattern at
      `backend/tests/test_realign.py:416`) and `detect_hardware`; assert on the string
      passed to `_load_model`, never actually load a model.
- [ ] `pytest backend/tests` — full suite green.
- [ ] `grep -n "hw.recommended_model" backend/engine/transcriber.py` — exactly one hit,
      inside the new `or` expression.

---

## Phase 2 — Frontend: plumb the choice through, add the Settings control

**Goal:** a Settings dropdown that persists, and is read at transcription start.

1. `src/renderer/src/lib/api.ts` — add `model?: string` to `TranscribeParams` (line 54).
2. `src/renderer/src/hooks/useTranscription.ts` — add `model?: string` to
   `TranscriptionOptions` (line 12) and forward it in the `startTranscription` body as
   `model: options.model || undefined` — copy the `language:` line at :59 verbatim in shape.
3. `src/renderer/src/components/screens/ProgressScreen.tsx:57-68` — add a fourth
   `window.subforge.getState<string>('whisper_model', '')` to the existing
   `Promise.all`, and pass `model: whisperModel || undefined` into `start()`.
4. `src/renderer/src/components/SettingsPanel.tsx` — add a `<Select>` in the
   transcription section. **Copy the language control** (`handleLanguageChange`, :95-98)
   as the exact pattern: local `useState`, load in the existing `init()` `Promise.all`,
   `setState('whisper_model', v)` on change.
   Curated options — the four the user asked for, plus auto:
   | Label | value |
   |---|---|
   | Auto (recommended for your hardware) | `''` |
   | Tiny — fastest, lowest accuracy (~75 MB) | `tiny` |
   | Base — 4 GB RAM systems (~145 MB) | `base` |
   | Small — balanced (~485 MB) | `small` |
   | Large Turbo — best quality (~1.6 GB) | `large-v3-turbo` |
   Sizes are the on-disk CT2 footprints — **confirm each against the actual files under
   `CAPFORGE_MODEL_DIR` after a download rather than quoting these numbers blind.**
   `medium` / `large` / `large-v2` / `large-v3` stay out of the UI but remain valid over
   the API. Add one line of helper text under the select: a model not yet on disk
   downloads on first use, and progress shows in the transcription screen.
5. `electron/app-state.js` — add `whisper_model` to the key list in the header comment.
   No code change needed; the store is schemaless.

**Verification checklist**
- [ ] `npm run typecheck` clean.
- [ ] `npm test` — extend `src/renderer/src/lib/api.test.ts` (pattern at :313) with a case
      asserting `model` reaches the POST body, and a case asserting it is **absent** when
      not set. Remember: vitest here runs in the **node** environment via
      `react-dom/server` — assert on rendered markup, no DOM events.
- [ ] `npm run lint` clean.
- [ ] `grep -rn "whisper_model" src electron` — hits in exactly: SettingsPanel,
      ProgressScreen, app-state.js comment.

---

## Phase 3 — Choose the model at install time (the primary UX)

**Goal:** the first-run wizard asks which model to install, defaulting to a
hardware-appropriate suggestion, and downloads only that one. **Existing installs are
not disturbed.**

This is the headline of the feature: the 1.6 GB is spent *before* the user has any way
to object, so the fix has to land in the wizard. Phase 2's Settings dropdown is still
required — the wizard runs once, and a user who picks Tiny and later wants better
quality (or picks Turbo and finds it unusable) must be able to change their mind without
reinstalling.

### 3a. Give the wizard something to recommend from

`platform.detectAccelerator()` currently returns only `{present, name, kind}` — GPU vs
CPU (`electron/platform/mac.js:159`, and the win.js counterpart). It reports **no RAM and
no VRAM**, so today the wizard has no basis for suggesting a model to an 8 GB laptop —
exactly the machine in the original request.

Add total system RAM in the main process, where it is free:
```js
const os = require('os')
const totalRamGb = os.totalmem() / 1024 ** 3
```
Do **not** extend `detectAccelerator()` for this — it is a per-platform GPU probe with two
implementations that must stay in contract-symmetry (see the `void` params in
`mac.js:177-184`). Read RAM in `runtime-setup.js` alongside the accelerator call instead.

Suggested default (a *pre-selection*, never a lock — every option stays choosable):

| Condition | Suggested |
|---|---|
| CUDA GPU with ≥ 4 GB VRAM | `large-v3-turbo` |
| CPU-only, ≥ 16 GB RAM | `small` |
| CPU-only, 8–16 GB RAM | `base` |
| CPU-only, < 8 GB RAM | `tiny` |

This mirrors the VRAM ladder already in `backend/engine/hardware.py:38-52` — keep the two
consistent in spirit, but note they are **separate** ladders: the backend's is VRAM-based
and runs per-transcription, the wizard's is RAM-based and runs once.

### 3b. Wizard UI

1. `electron/setup-window.html` — add a model radio group *before* the progress stages,
   with the suggested option pre-selected and labelled as such ("Recommended for your
   computer"). Show each option's download size, and let the user override freely. Reuse
   the existing `.step` / stage CSS; do not introduce a new design language.
   The static "~1.6 GB" line at `:162` becomes dynamic with the selection.
2. Gate the install on the choice: the wizard currently runs straight through. The model
   step must wait for a selection. Keep a sensible timeout-free flow — the user is
   already sitting in front of it.

### 3c. Wire the choice through

1. `electron/runtime-setup.js` — `downloadDefaultModel(report)` takes the chosen model
   name instead of the `DEFAULT_MODEL` constant (`:61`); update the `report()` message
   and the embedded `whisperx.load_model("…")` line (`:296`) to interpolate it.
2. Persist it twice: into the runtime state file next to `accelerator` / `torchVariant`
   (`:366`) for diagnostics, **and** into `app-state.json` as `whisper_model` — so
   Settings opens showing what was actually installed rather than "Auto", and the first
   transcription uses it without a surprise download.
3. **Do not bump `RUNTIME_VERSION`** (`:41`).

### Fallback (only if 3b proves too invasive)

Drop the pre-download entirely: remove the `downloadDefaultModel` call and the `model`
stage, and let the first transcription fetch whatever Settings says. Simpler, but the
first run becomes a silent multi-minute download *after* the user has already picked a
file, and it can fail on a flaky network at the worst moment. Prefer 3b; note the
trade-off if you fall back.

**Verification checklist**
- [ ] `git diff electron/runtime-setup.js | grep RUNTIME_VERSION` → **no output**.
- [ ] `grep -n "totalmem" electron/platform/` → **no hits** (RAM detection must not leak
      into the GPU probe).
- [ ] `node --test electron/` (the existing `*.test.js` files) still green.
- [ ] Manual, on a machine with no `~/Library/Application Support/CapForge/models`:
      run the wizard, confirm the pre-selected suggestion matches the machine, pick
      **Tiny**, confirm only tiny is fetched (`du -sh` the model dir → tens of MB, not 1.6 GB).
- [ ] Manual: after that install, open Settings and confirm the dropdown reads **Tiny**,
      not "Auto".
- [ ] Manual: switch to Large Turbo, transcribe a short clip, confirm ProgressScreen shows
      "Downloading model: … MB" and the run completes.
- [ ] Manual regression: an **existing** install launches without re-running setup.

---

## Phase 4 — Optional follow-ons (do not bundle into the first PR)

- Expose the model on the MCP `transcribe` tool (`mcp_server/server.py:165`) as an
  optional `model: Optional[str] = None` argument passed straight into the payload.
  One-line change on each side; keep it separate so the tool-surface change is reviewable
  on its own.
- Show which models are already on disk in the Settings dropdown (scan
  `CAPFORGE_MODEL_DIR`), so "Large Turbo (not downloaded — 1.6 GB)" is visible before
  choosing.
- Revisit `_configure_cpu()`'s turbo default now that the escape hatch exists. Arguably
  a low-RAM CPU machine should auto-recommend `small`. **Behaviour change for existing
  users — its own decision, its own PR.**

---

## Phase 5 — Final verification

1. `npm run typecheck && npm test && npm run lint`
2. `pytest backend/tests` and `pytest mcp_server/tests` (the bare `pytest` **silently
   skips** `mcp_server/tests` — `pyproject.toml` sets `testpaths`).
3. Anti-pattern grep sweep:
   - `grep -rn "whisper_model\|whisperModel" src/renderer/src/components/studio/` → **no hits**
     (proves it did not leak into the caption-style path)
   - `grep -n "model" src/renderer/src/lib/settingsSanitize.ts` → no new hits
   - `grep -n "RUNTIME_VERSION" electron/runtime-setup.js` → still `10`
   - `grep -n "LARGE_V3_TURBO\|large-v3-turbo" backend/engine/transcriber.py` → no hits
     (the model name must never be hardcoded in the transcriber)
4. Confirm every model string offered in the UI appears in the accepted-names list
   recorded in Phase 0.
5. Manual end-to-end on the target profile: 8 GB RAM, no discrete GPU, model = Base,
   short clip, confirm it completes and the app stays responsive.


---

## Implementation notes (2026-09-02)

Landed on `feat/selectable-whisper-model`. Deviations from the plan as written:

- **The suggestion ladder has no VRAM tier.** The plan proposed "CUDA GPU with ≥ 4 GB
  VRAM". Neither `platform/mac.js` nor `platform/win.js` `detectAccelerator()` reports
  VRAM — win.js queries `nvidia-smi --query-gpu=name` only. So `suggestModel()` treats
  *any* CUDA GPU as turbo-capable and the backend's finer VRAM ladder
  (`hardware.py:38-52`) still applies per-transcription. Documented in the function.
- **The model list is duplicated, not shared.** `electron/whisper-models.js` (CJS) is
  canonical; `src/renderer/src/lib/whisperModels.ts` mirrors it because the renderer
  can't `require()` across the Electron boundary. `whisperModels.test.ts` pins them with
  `toEqual`, following the repo's existing twin-with-fixture convention.
- **The wizard receives the list over IPC, not by `require()`.** `setup-window.html` runs
  with `nodeIntegration: true` so a relative `require` would *probably* resolve, but
  module resolution from a `loadFile`'d page inside an asar is exactly the kind of thing
  that works in dev and breaks in the packaged build. `detectSetupProfile()` ships
  `models` in its reply instead.
- **`setup:detect-accelerator` was replaced, not extended.** Only `setup-window.html`
  invoked it; it is now `setup:detect-profile`, returning `{accelerator, totalRamGb,
  suggestedModel, models}`.
- **`DEFAULT_MODEL` is now `'base'`, not `'large-v3-turbo'`.** It is only reached when the
  wizard passes no choice (e.g. a `force` reinstall). Turbo is the wrong thing to fall
  back to — that is the bug this change exists to fix.
- **The Install button starts disabled** and is enabled when the profile resolves.
  Otherwise a fast click installs `DEFAULT_MODEL` without the user having seen a picker.
- **`downloadModel` validates its argument** against `WHISPER_MODELS` before use, because
  the id is interpolated into a Python source string.
- **Runtime state key renamed** `defaultModel` → `model` (nothing read the old key).
- **Setup window grew 420 → 620 px tall** to fit the picker.
- **Phase 4's MCP change was included** after all — it is two lines and the tool would
  otherwise be the only caller unable to choose a model.

### Verified

- `npm run typecheck` clean; `npm test` 941 passed / 35 files; `npm run lint` 0 errors
  (31 pre-existing warnings, none in changed files).
- `node --test 'electron/*.test.js'` — 109 passed. (Note: `node --test electron/` fails
  on Node 22 with MODULE_NOT_FOUND; the glob form is required.)
- `pytest backend/tests` — 920 passed, 13 failed, all 13 being `test_render_golden.py`
  font-environment failures that **reproduce identically on clean `main`** (verified by
  `git stash`). Nothing in this change touches the render path.
- `pytest mcp_server/tests` — 28 passed.
- Anti-pattern sweep clean: `RUNTIME_VERSION` still 10; no `totalmem` in
  `electron/platform/`; no `whisper_model` in `components/studio/`; `settingsSanitize.ts`
  unmodified; no hardcoded model name left in `transcriber.py`.
- Wizard rendered in a browser with a stubbed IPC profile for the reported machine
  (8 GB RAM, CPU-only): pre-selects **Base — RECOMMENDED**, total download **~775 MB**
  (down from ~2.2 GB). Switching to Large Turbo recomputes to ~2.2 GB, matching the
  previously hardcoded CPU figure.

### Still outstanding — manual QA only

1. A real fresh install on a machine with no `<userData>/models`: pick Tiny, confirm only
   tiny is fetched and Settings then reads "Tiny", not "Auto".
2. Switch to a not-yet-downloaded model in Settings and transcribe: confirm ProgressScreen
   shows "Downloading model: … MB" and the run completes.
3. An existing install must launch without re-running setup (it short-circuits on
   `isRuntimeReady()`, so `whisper_model` stays unset and behaviour is unchanged — but
   confirm it).
4. Windows wizard layout at 560x620 (only checked on macOS).
