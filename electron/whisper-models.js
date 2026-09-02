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
    blurb: 'Best accuracy — the default; slower on CPU-only machines',
    sizeMb: 1600,
  },
]

/** Human-readable download size, e.g. "75 MB" / "1.6 GB". */
function formatModelSize(sizeMb) {
  return sizeMb >= 1000 ? `${(sizeMb / 1000).toFixed(1)} GB` : `${sizeMb} MB`
}

/**
 * The model the first-run wizard pre-selects, on every machine.
 *
 * Deliberately the largest option: smaller models are noticeably worse at
 * transcription quality, so turbo is what most users should end up with. The
 * point of the picker is that the 1.6 GB is now an *informed* choice with the
 * size on screen and a one-click downgrade, not a silent default.
 *
 * Note the wizard does NOT record this choice in app-state when the user
 * accepts it — see the seeding rule in main.js — so `hardware.py`'s VRAM ladder
 * still downgrades small-VRAM GPUs at transcription time.
 */
const RECOMMENDED_MODEL = 'large-v3-turbo'

module.exports = { WHISPER_MODELS, formatModelSize, RECOMMENDED_MODEL }
