# Performance baselines

Wall-clock numbers do not belong in CI (they vary by host); they live here as
per-host baseline files, and the backend emits the raw measurements as
structured `[perf]` log lines so a baseline can be captured from a normal run.

## The `[perf]` lines

The backend logs one line per pipeline step and one summary per job, all
`key=value`, greppable from `backend.log` (Settings → Open log) or from the
Electron console in dev:

```
[perf] job=transcribe step=load_model ms=6712
[perf] job=transcribe step=transcribe ms=…
[perf] job=transcribe step=align ms=…
[perf] job=transcribe step=diarize ms=…
[perf] job=transcribe model=large-v3-turbo device=cpu compute=int8 audio_s=… load_ms=… transcribe_ms=… align_ms=… diarize_ms=… total_ms=… rtf=…
[perf] job=warm model=… device=… load_ms=…
```

`rtf` is the realtime factor, `audio_s / total_s` — higher is faster
(`4.9` means a 60-minute talk transcribes in ~12 minutes). `load_ms` is `0`
when the model was already resident (a warm-on-drop or a second job).

## Capturing a baseline

1. Quit and relaunch CapForge (a cold model).
2. Drop a real speech recording of known length and press Start.
3. Copy the `[perf] job=transcribe …` summary line into
   `docs/perf/baseline-<host>.json` (see the file's shape below), plus the
   `git rev-parse --short HEAD` it was measured at.
4. Repeat once with the model already loaded to record the warm `load_ms`.

Baseline file shape:

```json
{
  "host": "M4 MacBook Pro, 24 GB",
  "commit": "abcdef0",
  "measured_at": "2026-09-12",
  "jobs": [
    { "job": "transcribe", "model": "large-v3-turbo", "device": "cpu", "compute": "int8",
      "audio_s": 3600.0, "load_ms": 6712, "transcribe_ms": 0, "align_ms": 0,
      "diarize_ms": 0, "total_ms": 0, "rtf": 0.0, "note": "cold" }
  ]
}
```

## What CI asserts instead

Ratios and counts, never seconds: the readiness poll constants
(`electron/python-manager.test.js`), one hardware probe per process
(`backend/tests`), the alignment model loaded once across jobs, and the
`threads=os.cpu_count()` kwarg. See `docs/plans/creator-hub-vision.md` §5.
