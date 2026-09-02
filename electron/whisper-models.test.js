/**
 * Pure-logic tests for whisper-models — the canonical model list and the
 * first-run wizard's model suggestion. Run with the built-in node runner:
 *   node --test electron/whisper-models.test.js
 * No electron required; every export here is pure.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  WHISPER_MODELS,
  formatModelSize,
  suggestModel,
  RAM_GB_FOR_SMALL,
  RAM_GB_FOR_BASE,
} = require('./whisper-models')

// --- the list ---------------------------------------------------------------

test('offers the four promised sizes, cheapest first', () => {
  assert.deepEqual(
    WHISPER_MODELS.map((m) => m.id),
    ['tiny', 'base', 'small', 'large-v3-turbo']
  )
})

test('every entry carries the fields the wizard and Settings render', () => {
  for (const m of WHISPER_MODELS) {
    assert.equal(typeof m.id, 'string')
    assert.ok(m.label, `${m.id} needs a label`)
    assert.ok(m.blurb, `${m.id} needs a blurb`)
    assert.ok(m.sizeMb > 0, `${m.id} needs a size`)
  }
})

test('every id is a real faster-whisper model name', () => {
  // Pinned against faster-whisper 1.2.1's `_MODELS` registry. An id outside
  // this set fails at transcription time, long after the user picked it.
  const KNOWN = new Set([
    'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en',
    'medium', 'medium.en', 'large', 'large-v1', 'large-v2', 'large-v3',
    'large-v3-turbo', 'turbo',
    'distil-small.en', 'distil-medium.en',
    'distil-large-v2', 'distil-large-v3', 'distil-large-v3.5',
  ])
  for (const m of WHISPER_MODELS) {
    assert.ok(KNOWN.has(m.id), `${m.id} is not a faster-whisper model name`)
  }
})

// --- formatModelSize --------------------------------------------------------

test('formatModelSize switches to GB at 1000 MB', () => {
  assert.equal(formatModelSize(75), '75 MB')
  assert.equal(formatModelSize(999), '999 MB')
  assert.equal(formatModelSize(1000), '1.0 GB')
  assert.equal(formatModelSize(1600), '1.6 GB')
})

// --- suggestModel -----------------------------------------------------------

test('a CUDA GPU is suggested turbo regardless of system RAM', () => {
  // detectAccelerator reports no VRAM, so any CUDA card is treated as capable;
  // the backend's finer VRAM ladder still applies at transcription time.
  assert.equal(suggestModel({ acceleratorKind: 'cuda', totalRamGb: 4 }), 'large-v3-turbo')
  assert.equal(suggestModel({ acceleratorKind: 'cuda', totalRamGb: 64 }), 'large-v3-turbo')
})

test('CPU-only machines get a model matched to their RAM', () => {
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: 4 }), 'tiny')
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: 7.9 }), 'tiny')
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: 8 }), 'base')
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: 12 }), 'base')
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: 16 }), 'small')
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: 64 }), 'small')
})

test('the reported 8 GB / integrated-graphics laptop is suggested base', () => {
  // The machine from the original feature request: 8 GB RAM, no CUDA.
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: 8 }), 'base')
})

test('the ladder boundaries match the exported constants', () => {
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: RAM_GB_FOR_SMALL }), 'small')
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: RAM_GB_FOR_BASE }), 'base')
})

test('unknown RAM falls back to the conservative middle, not to tiny', () => {
  assert.equal(suggestModel({ acceleratorKind: 'cpu' }), 'base')
  assert.equal(suggestModel({ acceleratorKind: 'cpu', totalRamGb: NaN }), 'base')
  assert.equal(suggestModel({}), 'base')
  assert.equal(suggestModel(), 'base')
})

test('every suggestion is an id the wizard can actually install', () => {
  const ids = new Set(WHISPER_MODELS.map((m) => m.id))
  const profiles = [
    { acceleratorKind: 'cuda' },
    { acceleratorKind: 'cpu', totalRamGb: 2 },
    { acceleratorKind: 'cpu', totalRamGb: 8 },
    { acceleratorKind: 'cpu', totalRamGb: 32 },
    {},
  ]
  for (const p of profiles) {
    assert.ok(ids.has(suggestModel(p)), `${JSON.stringify(p)} suggested an unknown id`)
  }
})
