/**
 * Tests for the library trash guard. Run with the built-in node runner:
 *   node --test electron/library-fs.test.js
 * `library-fs.js` imports no electron, so this runs in plain node against a
 * temp `CAPFORGE_HOME`.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  assertTrashable,
  capforgeHome,
  libraryRoot,
  TRASH_REFUSED_MESSAGE,
} = require('./library-fs')

const IS_WINDOWS = process.platform === 'win32'

/**
 * Run `fn` with `CAPFORGE_HOME` pointed at a fresh temp dir, restoring the
 * previous value afterwards. The dir is realpath'd because macOS hands out
 * `/var/...` symlinks for `os.tmpdir()`.
 */
function withTempHome(fn) {
  const previous = process.env.CAPFORGE_HOME
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-lib-')))
  process.env.CAPFORGE_HOME = home
  try {
    return fn(home)
  } finally {
    if (previous === undefined) delete process.env.CAPFORGE_HOME
    else process.env.CAPFORGE_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('capforgeHome honours the CAPFORGE_HOME override', () => {
  withTempHome((home) => {
    assert.equal(capforgeHome(), home)
    assert.equal(libraryRoot(), path.join(home, 'library'))
  })
})

test('capforgeHome falls back to ~/.capforge', () => {
  const previous = process.env.CAPFORGE_HOME
  delete process.env.CAPFORGE_HOME
  try {
    assert.equal(capforgeHome(), path.join(os.homedir(), '.capforge'))
  } finally {
    if (previous !== undefined) process.env.CAPFORGE_HOME = previous
  }
})

test('capforgeHome expands a leading ~ in the override', () => {
  const previous = process.env.CAPFORGE_HOME
  process.env.CAPFORGE_HOME = path.join('~', 'capforge-data')
  try {
    assert.equal(capforgeHome(), path.join(os.homedir(), 'capforge-data'))
  } finally {
    if (previous === undefined) delete process.env.CAPFORGE_HOME
    else process.env.CAPFORGE_HOME = previous
  }
})

test('accepts a record folder directly inside the library root', () => {
  withTempHome(() => {
    const record = path.join(libraryRoot(), 'abc123')
    fs.mkdirSync(record, { recursive: true })
    assert.equal(assertTrashable(record), record)
  })
})

test('accepts a nested folder inside a record', () => {
  withTempHome(() => {
    const nested = path.join(libraryRoot(), 'abc123', 'renders')
    fs.mkdirSync(nested, { recursive: true })
    assert.equal(assertTrashable(nested), nested)
  })
})

test('accepts a not-yet-existing path inside the library root', () => {
  withTempHome(() => {
    const record = path.join(libraryRoot(), 'gone-already')
    fs.mkdirSync(libraryRoot(), { recursive: true })
    assert.equal(assertTrashable(record), record)
  })
})

test('refuses the library root itself', () => {
  withTempHome(() => {
    fs.mkdirSync(libraryRoot(), { recursive: true })
    assert.throws(() => assertTrashable(libraryRoot()), { message: TRASH_REFUSED_MESSAGE })
  })
})

test('refuses a `..` traversal that escapes the library root', () => {
  withTempHome((home) => {
    const outside = path.join(home, 'skills')
    fs.mkdirSync(outside, { recursive: true })
    fs.mkdirSync(libraryRoot(), { recursive: true })
    const traversal = path.join(libraryRoot(), '..', 'skills')
    assert.throws(() => assertTrashable(traversal), { message: TRASH_REFUSED_MESSAGE })
  })
})

test('refuses a sibling directory that merely shares the root prefix', () => {
  withTempHome((home) => {
    const sibling = path.join(home, 'libraryX')
    fs.mkdirSync(sibling, { recursive: true })
    assert.throws(() => assertTrashable(sibling), { message: TRASH_REFUSED_MESSAGE })
  })
})

test('refuses the home folder and an unrelated absolute path', () => {
  withTempHome((home) => {
    assert.throws(() => assertTrashable(home), { message: TRASH_REFUSED_MESSAGE })
    assert.throws(() => assertTrashable(os.homedir()), { message: TRASH_REFUSED_MESSAGE })
  })
})

test('refuses a non-string / empty path', () => {
  withTempHome(() => {
    for (const bad of [undefined, null, 42, '', '   ', {}]) {
      assert.throws(() => assertTrashable(bad), { message: TRASH_REFUSED_MESSAGE })
    }
  })
})

test('refuses a symlink inside the library that points outside it', { skip: IS_WINDOWS }, () => {
  withTempHome((home) => {
    const outside = path.join(home, 'precious')
    fs.mkdirSync(outside, { recursive: true })
    fs.mkdirSync(libraryRoot(), { recursive: true })
    const link = path.join(libraryRoot(), 'escape')
    fs.symlinkSync(outside, link, 'dir')
    assert.throws(() => assertTrashable(link), { message: TRASH_REFUSED_MESSAGE })
  })
})

test(
  'resolves a symlinked library root so a real record still passes',
  { skip: IS_WINDOWS },
  () => {
    withTempHome((home) => {
      // CAPFORGE_HOME/library is itself a symlink to a real folder elsewhere.
      const real = path.join(home, 'real-library')
      fs.mkdirSync(path.join(real, 'rec1'), { recursive: true })
      fs.symlinkSync(real, libraryRoot(), 'dir')
      assert.equal(assertTrashable(path.join(libraryRoot(), 'rec1')), path.join(real, 'rec1'))
    })
  }
)
