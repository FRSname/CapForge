/**
 * Pure-logic tests for whisper-models — the canonical model list and the
 * first-run wizard's model suggestion. Run with the built-in node runner:
 *   node --test electron/whisper-models.test.js
 * No electron required; every export here is pure.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { WHISPER_MODELS, formatModelSize, RECOMMENDED_MODEL } = require('./whisper-models')

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

// --- RECOMMENDED_MODEL -------------------------------------------------------

test('the wizard recommends Large Turbo', () => {
  // Quality first: smaller models are noticeably worse, so turbo is the default
  // everywhere. The picker makes the 1.6 GB an informed choice, not a silent one.
  assert.equal(RECOMMENDED_MODEL, 'large-v3-turbo')
})

test('the recommendation is a model the wizard can actually install', () => {
  const ids = new Set(WHISPER_MODELS.map((m) => m.id))
  assert.ok(ids.has(RECOMMENDED_MODEL), `${RECOMMENDED_MODEL} is not in WHISPER_MODELS`)
})

test('the recommendation is the largest option', () => {
  // If a bigger model is ever added, this fails as a prompt to decide whether
  // it should become the new recommendation rather than sitting unused.
  const largest = WHISPER_MODELS.reduce((a, b) => (b.sizeMb > a.sizeMb ? b : a))
  assert.equal(RECOMMENDED_MODEL, largest.id)
})
