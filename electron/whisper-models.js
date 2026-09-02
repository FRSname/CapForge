/**
 * The Whisper models CapForge offers users, in ascending cost order.
 *
 * Canonical list — the first-run wizard (setup-window.html) and the renderer's
 * Settings dropdown both present exactly these. The renderer cannot require()
 * this file, so `src/renderer/src/lib/whisperModels.ts` mirrors it and
 * `whisperModels.test.ts` pins the two together.
 *
 * `id` values are verified against faster-whisper 1.2.1's `_MODELS` registry;
 * every one resolves without aliasing. Do NOT add an id that is not in that
 * registry — a bad name fails at transcription time, long after the user picked it.
 *
 * `sizeMb` is the approximate CTranslate2 on-disk footprint, used for the
 * download-size hint. It is a label only; nothing branches on it.
 */

const WHISPER_MODELS = [
  {
    id: 'tiny',
    label: 'Tiny',
    blurb: 'Fastest, lowest accuracy — for very low-end machines',
    sizeMb: 75,
  },
  {
    id: 'base',
    label: 'Base',
    blurb: 'Good on CPU-only laptops with 8 GB RAM',
    sizeMb: 145,
  },
  {
    id: 'small',
    label: 'Small',
    blurb: 'Balanced speed and accuracy',
    sizeMb: 485,
  },
  {
    id: 'large-v3-turbo',
    label: 'Large Turbo',
    blurb: 'Best accuracy — needs a GPU or a fast, roomy machine',
    sizeMb: 1600,
  },
]

/** Human-readable download size, e.g. "75 MB" / "1.6 GB". */
function formatModelSize(sizeMb) {
  return sizeMb >= 1000 ? `${(sizeMb / 1000).toFixed(1)} GB` : `${sizeMb} MB`
}

// RAM thresholds (GB) for the CPU-only ladder. Named rather than inlined so the
// wizard copy and the test read the same numbers.
const RAM_GB_FOR_SMALL = 16
const RAM_GB_FOR_BASE = 8

/**
 * Which model to PRE-SELECT in the first-run wizard. A suggestion only — every
 * option stays choosable, and the user can change it later in Settings.
 *
 * Note this is a *different* ladder from `backend/engine/hardware.py`'s: that one
 * is VRAM-based and re-runs per transcription, this one is RAM-based and runs
 * once, because `platform.detectAccelerator()` reports no VRAM (only
 * `{present, name, kind}`) — so any CUDA GPU is treated as turbo-capable here and
 * the backend's finer VRAM ladder still applies at transcription time.
 *
 * @param {{ acceleratorKind?: string, totalRamGb?: number }} profile
 * @returns {string} a model id from WHISPER_MODELS
 */
function suggestModel({ acceleratorKind, totalRamGb } = {}) {
  if (acceleratorKind === 'cuda') return 'large-v3-turbo'
  // Unknown RAM (detection failed) is treated as the conservative middle rather
  // than as 0 — guessing 'tiny' for a capable machine is as wrong as the reverse.
  if (typeof totalRamGb !== 'number' || !Number.isFinite(totalRamGb)) return 'base'
  if (totalRamGb >= RAM_GB_FOR_SMALL) return 'small'
  if (totalRamGb >= RAM_GB_FOR_BASE) return 'base'
  return 'tiny'
}

module.exports = {
  WHISPER_MODELS,
  formatModelSize,
  suggestModel,
  RAM_GB_FOR_SMALL,
  RAM_GB_FOR_BASE,
}
