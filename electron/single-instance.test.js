/**
 * Pure-logic tests for single-instance argv parsing. Run with the built-in
 * node runner:
 *   node --test electron/single-instance.test.js
 * No electron required — `main.js` hands the `second-instance` argv array in.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { firstMediaArg, MEDIA_EXTENSIONS } = require('./single-instance')

/** Stand-in for argv[0] — never a candidate, even in the packaged app. */
const EXE = '/Applications/CapForge.app/Contents/MacOS/CapForge'

const MEDIA_EXTENSIONS_FIXTURE = path.join(
  __dirname,
  '..',
  'backend',
  'tests',
  'fixtures',
  'media_extensions.json'
)

test('returns null for a bare launch', () => {
  assert.equal(firstMediaArg([EXE]), null)
})

test('finds a media path passed as the only argument', () => {
  assert.equal(firstMediaArg([EXE, '/Users/x/clip.mp4']), '/Users/x/clip.mp4')
})

test('returns the FIRST media path when several are passed', () => {
  assert.equal(firstMediaArg([EXE, '/a/one.mov', '/a/two.mp3']), '/a/one.mov')
})

test('ignores flags even when they end in a media extension', () => {
  assert.equal(firstMediaArg([EXE, '--trace=warnings.mp4', '-v']), null)
  assert.equal(firstMediaArg([EXE, '--dev', '/a/clip.wav']), '/a/clip.wav')
})

test('ignores the executable path itself', () => {
  assert.equal(firstMediaArg(['/opt/player.mp4']), null)
})

test('ignores the dev script path (`electron . --dev`)', () => {
  const argv = ['/repo/node_modules/.bin/electron', '.', '--dev']
  assert.equal(firstMediaArg(argv), null)
})

test('ignores a non-media argument', () => {
  assert.equal(firstMediaArg([EXE, '/a/project.capforge']), null)
  assert.equal(firstMediaArg([EXE, '/a/notes.txt']), null)
})

test('matches the extension case-insensitively', () => {
  assert.equal(firstMediaArg([EXE, '/a/CLIP.MP4']), '/a/CLIP.MP4')
  assert.equal(firstMediaArg([EXE, '/a/clip.MoV']), '/a/clip.MoV')
})

test('requires a dot before the extension (no bare "mp4" suffix match)', () => {
  assert.equal(firstMediaArg([EXE, '/a/videomp4']), null)
})

test('accepts a Windows-style path', () => {
  assert.equal(firstMediaArg([EXE, 'C:\\Users\\x\\clip.mkv']), 'C:\\Users\\x\\clip.mkv')
})

test('tolerates a missing / non-array argv', () => {
  assert.equal(firstMediaArg(undefined), null)
  assert.equal(firstMediaArg(null), null)
  assert.equal(firstMediaArg('/a/clip.mp4'), null)
})

test('skips non-string entries', () => {
  assert.equal(firstMediaArg([EXE, 42, null, '/a/clip.aac']), '/a/clip.aac')
})

test('ignores empty / whitespace-only arguments', () => {
  assert.equal(firstMediaArg([EXE, '', '   ']), null)
})

test('MEDIA_EXTENSIONS equals the shared fixture, lowercase and dotless', () => {
  // One list, three copies (backend media_scan.py, renderer libraryView.ts,
  // this file) — all pinned to backend/tests/fixtures/media_extensions.json.
  const fixture = JSON.parse(fs.readFileSync(MEDIA_EXTENSIONS_FIXTURE, 'utf-8'))
  assert.deepEqual([...MEDIA_EXTENSIONS].sort(), [...fixture.extensions].sort())
  assert.equal(new Set(MEDIA_EXTENSIONS).size, MEDIA_EXTENSIONS.length)
  for (const ext of MEDIA_EXTENSIONS) {
    assert.equal(ext, ext.toLowerCase())
    assert.equal(ext.startsWith('.'), false)
  }
})

test('every declared extension is actually matched', () => {
  for (const ext of MEDIA_EXTENSIONS) {
    assert.equal(firstMediaArg([EXE, `/a/clip.${ext}`]), `/a/clip.${ext}`)
  }
})
