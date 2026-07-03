# Fix: Diarization crash — `DiarizationPipeline.__init__() got an unexpected keyword argument 'use_auth_token'`

## Summary

Speaker diarization crashes because CapForge calls WhisperX's `DiarizationPipeline`
with the **old** parameter name. The runtime now ships **whisperx 3.8.6** (with
**pyannote.audio 4.0.4**), where the constructor was refactored.

- Broken call: `backend/engine/transcriber.py:117-119`
- Fix: rename `use_auth_token=` → `token=` (plus two hardening steps below).

This is a small, well-scoped fix. The "documentation discovery" was done against the
**actual installed source**, which is authoritative (better than release notes).

---

## Phase 0 — Allowed APIs (verified against installed whisperx 3.8.6)

Source of truth: `<userData>/runtime/python/lib/python3.11/site-packages/whisperx/`

**`whisperx.diarize.DiarizationPipeline`** — `diarize.py:91-104`
```python
DiarizationPipeline(
    model_name=None,          # defaults to "pyannote/speaker-diarization-community-1"
    token=None,               # <-- was `use_auth_token` in older whisperx
    device="cpu",
    cache_dir=None,
)
```

**`DiarizationPipeline.__call__`** — `diarize.py:105-118`
```python
diarize_model(
    audio,                    # str path or np.ndarray (existing usage passes np array)
    num_speakers=None,
    min_speakers=None,
    max_speakers=None,
    return_embeddings=False,  # default False -> returns just the DataFrame
    progress_callback=None,
)  # returns diarization DataFrame (embeddings off)
```

**`whisperx.assign_word_speakers(diarize_df, result)`** — `diarize.py:185`, re-exported
`whisperx/__init__.py:29`. Unchanged; existing positional call still valid.

**Canonical WhisperX usage** to copy from — `whisperx/transcribe.py:218`:
```python
diarize_model = DiarizationPipeline(
    model_name=diarize_model_name, token=hf_token, device=device, cache_dir=model_dir
)
```

### Anti-patterns to avoid
- ❌ Keep `use_auth_token=` — removed in 3.8.6.
- ❌ Assume the default model is `pyannote/speaker-diarization-3.1` — 3.8.6 defaults to
  the **new gated** `pyannote/speaker-diarization-community-1`.
- ❌ Blindly downgrade whisperx to restore the old kwarg — loses 3.8.6 fixes and doesn't
  address the unpinned-dependency drift.
- ❌ Invent `hf_token=` / `auth_token=` kwargs — the only accepted name is `token`.

---

## Phase 1 — Fix the constructor call (required)

**File:** `backend/engine/transcriber.py:116-120`

Copy the WhisperX-canonical signature. Replace:
```python
from whisperx.diarize import DiarizationPipeline
diarize_model = DiarizationPipeline(
    use_auth_token=request.hf_token, device=device
)
diarize_segments = diarize_model(audio)
```
with:
```python
from whisperx.diarize import DiarizationPipeline
diarize_model = DiarizationPipeline(token=request.hf_token, device=device)
diarize_segments = diarize_model(audio)
```

Minimal change = `use_auth_token` → `token`. (Optionally also pass
`cache_dir=<runtime model dir>` to keep the diarization model alongside the ASR model
— see Phase 3.)

### Verify
- `grep -n "use_auth_token" backend/` returns **nothing**.
- `grep -n "token=request.hf_token" backend/engine/transcriber.py` matches.

---

## Phase 2 — Gated-model decision (required; otherwise it still fails at download)

After the param fix, `Pipeline.from_pretrained` loads the **default**
`pyannote/speaker-diarization-community-1`, a **gated** repo. If the user's HF token
hasn't accepted *that* model's conditions, it fails with a 401/gated-repo error even
though the kwarg is now correct. The old default (`speaker-diarization-3.1`) is a
*different* gated repo, so a token that worked before may not cover the new one.

**Pick one (recommendation: Option A):**

- **Option A — pin the known-good model** (least user friction, matches prior behavior):
  ```python
  diarize_model = DiarizationPipeline(
      model_name="pyannote/speaker-diarization-3.1",
      token=request.hf_token, device=device,
  )
  ```
  Keeps the model the existing user base already accepted the license for.

- **Option B — adopt the new default** and update user-facing docs/UI to link the
  license page for `pyannote/speaker-diarization-community-1` (and confirm the accept
  step in the diarization settings help text).

Whichever is chosen, surface a **clear error toast** when diarization fails on a gated
repo (catch the exception around the pipeline load and report "accept the model license
at <url> and re-enter your HF token" rather than a raw stack trace) — matches the repo
convention of wrapping errors in `toast(...)`.

### Verify
- Enable diarization with a valid HF token in-app → completes without `TypeError` and
  without a gated-repo 401; `result` has per-word `speaker` labels.

---

## Phase 3 — Prevent recurrence: pin the dependency (required)

**File:** `backend/requirements.txt` — line 1 is bare `whisperx`, which is why an install
drifted to a version with a breaking API change.

Pin to the version the runtime is validated against:
```
whisperx==3.8.6
```
Also bump `RUNTIME_VERSION` in `electron/runtime-setup.js` (currently `10`) if the pin
should force existing installs to reinstall the matching version.

### Verify
- `grep -n "whisperx" backend/requirements.txt` shows the pin.
- A fresh `runtime-setup` install resolves whisperx 3.8.6 (not a newer drift).

---

## Phase 4 — Verification

1. `grep -rn "use_auth_token" backend/` → **no matches** (anti-pattern gone).
2. Confirm accepted kwargs against installed source:
   `grep -n "def __init__" "<userData>/runtime/python/.../whisperx/diarize.py"` shows
   `model_name`, `token`, `device`, `cache_dir` — the call uses only these.
3. Manual in-app run: transcribe a 2-speaker clip with diarization ON + valid HF token →
   no crash, speaker labels present, `moments.py` speaker-change logic populated.
4. `moments.py` unit test (`test_speaker_change_empty_without_diarization`) still passes
   (`.venv-dev/bin/python -m pytest backend/tests/test_moments.py`).

---

## Notes / context
- Installed runtime: whisperx **3.8.6**, pyannote.audio **4.0.4**, python 3.11, at
  `~/Library/Application Support/CapForge/runtime/python/lib/python3.11/site-packages/`.
- `assign_word_speakers` and the `diarize_model(audio)` call shape are unchanged — no
  edits needed beyond the constructor kwarg (+ optional model_name/cache_dir).
- The `.venv-dev` test venv does **not** have whisperx installed; diarization can only be
  exercised in the packaged runtime.
