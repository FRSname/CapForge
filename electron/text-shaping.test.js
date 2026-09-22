/**
 * Pure-logic tests for text-shaping. Run with the built-in node runner:
 *   node --test electron/text-shaping.test.js
 * No electron required: a temp dir stands in for resources/bin-* and the
 * managed Python runtime.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { resolveShapingLibCopy, ensureShapingLib } = require('./text-shaping')

const quiet = { log() {}, warn() {} }

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-shaping-'))
  const binDir = path.join(root, 'bin')
  const pythonDir = path.join(root, 'python')
  fs.mkdirSync(binDir)
  fs.mkdirSync(pythonDir)
  return { root, binDir, pythonDir }
}

test('macOS: the dylib goes into the interpreter rpath dir, <pythonDir>/lib', () => {
  const { binDir, pythonDir } = scratch()
  fs.writeFileSync(path.join(binDir, 'libfribidi.dylib'), 'mach-o')
  const plan = resolveShapingLibCopy({ platformName: 'darwin', binDir, pythonDir, fs, path })
  assert.deepEqual(plan, {
    src: path.join(binDir, 'libfribidi.dylib'),
    dest: path.join(pythonDir, 'lib', 'libfribidi.dylib'),
  })
})

test('Windows: the DLL goes next to python.exe, first bundled name wins', () => {
  const { binDir, pythonDir } = scratch()
  fs.writeFileSync(path.join(binDir, 'fribidi.dll'), 'pe')
  const plan = resolveShapingLibCopy({ platformName: 'win32', binDir, pythonDir, fs, path })
  assert.deepEqual(plan, {
    src: path.join(binDir, 'fribidi.dll'),
    dest: path.join(pythonDir, 'fribidi.dll'),
  })
})

test('nothing bundled, or an unsupported platform, is a no-op', () => {
  const { binDir, pythonDir } = scratch()
  assert.equal(resolveShapingLibCopy({ platformName: 'darwin', binDir, pythonDir, fs, path }), null)
  assert.equal(resolveShapingLibCopy({ platformName: 'linux', binDir, pythonDir, fs, path }), null)
  assert.equal(ensureShapingLib({ platformName: 'darwin', binDir, pythonDir, fs, path, log: quiet }), 'missing')
  assert.equal(fs.existsSync(path.join(pythonDir, 'lib')), false)
})

test('ensureShapingLib copies once, is idempotent, and replaces a stale copy', () => {
  const { binDir, pythonDir } = scratch()
  const src = path.join(binDir, 'libfribidi.dylib')
  const dest = path.join(pythonDir, 'lib', 'libfribidi.dylib')
  fs.writeFileSync(src, 'build one')
  const args = { platformName: 'darwin', binDir, pythonDir, fs, path, log: quiet }

  assert.equal(ensureShapingLib(args), 'copied')
  assert.equal(fs.readFileSync(dest, 'utf8'), 'build one')
  assert.equal(ensureShapingLib(args), 'present')

  fs.writeFileSync(src, 'build two')
  assert.equal(ensureShapingLib(args), 'copied')
  assert.equal(fs.readFileSync(dest, 'utf8'), 'build two')
})

test('a copy failure is reported, never thrown', () => {
  const { binDir, pythonDir } = scratch()
  fs.writeFileSync(path.join(binDir, 'libfribidi.dylib'), 'mach-o')
  // A file where the `lib` directory must go makes mkdir fail.
  fs.writeFileSync(path.join(pythonDir, 'lib'), 'not a directory')
  const warned = []
  const log = { log() {}, warn: (m) => warned.push(m) }
  assert.equal(ensureShapingLib({ platformName: 'darwin', binDir, pythonDir, fs, path, log }), 'error')
  assert.equal(warned.length, 1)
})
