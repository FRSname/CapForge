import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { WHISPER_MODELS, formatModelSize } from './whisperModels'

const require_ = createRequire(import.meta.url)
const ELECTRON_LIST = resolve(__dirname, '../../../../electron/whisper-models.js')

describe('whisperModels', () => {
  test('mirrors electron/whisper-models.js exactly', () => {
    // The renderer copy and the Electron copy feed the same two dropdowns
    // (Settings and the first-run wizard). Drift means the wizard installs one
    // model and Settings claims another.
    const electron = require_(ELECTRON_LIST) as {
      WHISPER_MODELS: typeof WHISPER_MODELS
    }
    expect(WHISPER_MODELS).toEqual(electron.WHISPER_MODELS)
  })

  test('formatModelSize matches the Electron implementation', () => {
    const electron = require_(ELECTRON_LIST) as {
      formatModelSize: (n: number) => string
    }
    for (const mb of [75, 145, 485, 999, 1000, 1600]) {
      expect(formatModelSize(mb)).toBe(electron.formatModelSize(mb))
    }
  })

  test('offers the four sizes the feature promises, cheapest first', () => {
    expect(WHISPER_MODELS.map((m) => m.id)).toEqual([
      'tiny',
      'base',
      'small',
      'large-v3-turbo',
    ])
    const sizes = WHISPER_MODELS.map((m) => m.sizeMb)
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
  })

  test('every id is a real faster-whisper model name', () => {
    // Pinned against the registry printed by faster-whisper 1.2.1:
    //   python -c "from faster_whisper.utils import _MODELS; print(sorted(_MODELS))"
    // A name outside this set fails at transcription time, not at build time.
    const KNOWN = new Set([
      'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en',
      'medium', 'medium.en', 'large', 'large-v1', 'large-v2', 'large-v3',
      'large-v3-turbo', 'turbo',
      'distil-small.en', 'distil-medium.en',
      'distil-large-v2', 'distil-large-v3', 'distil-large-v3.5',
    ])
    for (const m of WHISPER_MODELS) {
      expect(KNOWN.has(m.id), `${m.id} is not a faster-whisper model`).toBe(true)
    }
  })

  test('formats sizes for the download hint', () => {
    expect(formatModelSize(75)).toBe('75 MB')
    expect(formatModelSize(1600)).toBe('1.6 GB')
  })

  test('the canonical file documents the registry constraint', () => {
    // Guard the comment that stops the next person adding an invented alias.
    const src = readFileSync(ELECTRON_LIST, 'utf-8')
    expect(src).toContain('faster-whisper')
  })
})
