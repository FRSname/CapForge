/**
 * Renderer mirror of `electron/whisper-models.js`.
 *
 * The renderer can't require() a CommonJS file from the Electron layer, so the
 * canonical list is duplicated here and pinned by `whisperModels.test.ts`.
 * Change one, change both — the test fails otherwise.
 */

export interface WhisperModelOption {
  id: string
  label: string
  blurb: string
  sizeMb: number
}

export const WHISPER_MODELS: WhisperModelOption[] = [
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
export function formatModelSize(sizeMb: number): string {
  return sizeMb >= 1000 ? `${(sizeMb / 1000).toFixed(1)} GB` : `${sizeMb} MB`
}

/**
 * The model the first-run wizard pre-selects, on every machine. Mirrored from
 * the Electron module; see the note there on why accepting it deliberately
 * leaves the Settings dropdown on "Auto".
 */
export const RECOMMENDED_MODEL = 'large-v3-turbo'
