/**
 * Pure-logic tests for path-validate. Run with the built-in node runner:
 *   node --test electron/path-validate.test.js
 * No electron required — only the import-safe helpers are exercised.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const { resolveExistingFile, resolveExistingDir } = require('./path-validate')

const deps = { fs, path }

function withTempFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-path-validate-'))
  const file = path.join(dir, 'sample.txt')
  fs.writeFileSync(file, 'hello')
  try {
    fn({ dir, file })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// --- resolveExistingFile ----------------------------------------------------

test('resolveExistingFile rejects a null path', () => {
  const result = resolveExistingFile(null, deps)
  assert.equal(result.ok, false)
  assert.match(result.error, /file path/i)
})

test('resolveExistingFile rejects a number', () => {
  const result = resolveExistingFile(42, deps)
  assert.equal(result.ok, false)
})

test('resolveExistingFile rejects an object', () => {
  const result = resolveExistingFile({ path: '/tmp/x' }, deps)
  assert.equal(result.ok, false)
})

test('resolveExistingFile rejects an empty string', () => {
  const result = resolveExistingFile('   ', deps)
  assert.equal(result.ok, false)
})

test('resolveExistingFile rejects a nonexistent path', () => {
  const result = resolveExistingFile(
    path.join(os.tmpdir(), 'capforge-does-not-exist-xyz', 'nope.txt'),
    deps
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /not found/i)
})

test('resolveExistingFile accepts a real temp file and resolves it', () => {
  withTempFile(({ file }) => {
    const result = resolveExistingFile(file, deps)
    assert.equal(result.ok, true)
    assert.equal(result.resolved, path.resolve(file))
  })
})

// --- resolveExistingDir ------------------------------------------------------

test('resolveExistingDir rejects a null path', () => {
  const result = resolveExistingDir(null, deps)
  assert.equal(result.ok, false)
})

test('resolveExistingDir rejects a number', () => {
  const result = resolveExistingDir(7, deps)
  assert.equal(result.ok, false)
})

test('resolveExistingDir rejects an object', () => {
  const result = resolveExistingDir({}, deps)
  assert.equal(result.ok, false)
})

test('resolveExistingDir rejects a nonexistent path', () => {
  const result = resolveExistingDir(
    path.join(os.tmpdir(), 'capforge-does-not-exist-abc'),
    deps
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /not found/i)
})

test('resolveExistingDir rejects a file when a directory is required', () => {
  withTempFile(({ file }) => {
    const result = resolveExistingDir(file, deps)
    assert.equal(result.ok, false)
    assert.match(result.error, /not a folder/i)
  })
})

test('resolveExistingDir accepts a real temp directory and resolves it', () => {
  withTempFile(({ dir }) => {
    const result = resolveExistingDir(dir, deps)
    assert.equal(result.ok, true)
    assert.equal(result.resolved, path.resolve(dir))
  })
})
