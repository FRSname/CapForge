/**
 * Tests for the library folder picker. Run with the built-in node runner:
 *   node --test electron/library-dialogs.test.js
 * `library-dialogs.js` imports no electron — `main.js` hands in `ipcMain`,
 * `dialog`, the window getter and `app-state` — so fakes stand in for all four.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  registerLibraryDialogs,
  mediaFileFilters,
  PICK_FOLDER_CHANNEL,
  PICK_IMPORT_CHANNEL,
  LAST_IMPORT_FOLDER_KEY,
} = require('./library-dialogs')

const MEDIA_EXTENSIONS_FIXTURE = path.join(
  __dirname,
  '..',
  'backend',
  'tests',
  'fixtures',
  'media_extensions.json'
)

const WINDOW = { id: 'main-window' }

/** Records handlers, dialog calls and state writes; `answer` is the dialog's reply. */
function fakes({ answer, stored, directories = [] } = {}) {
  const handlers = new Map()
  const dialogCalls = []
  const state = new Map(stored === undefined ? [] : [[LAST_IMPORT_FOLDER_KEY, stored]])
  return {
    handlers,
    dialogCalls,
    state,
    deps: {
      ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
      dialog: {
        showOpenDialog: async (win, options) => {
          dialogCalls.push({ win, options })
          return answer
        },
      },
      getWindow: () => WINDOW,
      // A fake `fs.promises.stat`: the listed paths are directories, the rest files.
      stat: async (p) => ({ isDirectory: () => directories.includes(p) }),
      appState: {
        get: (key, fallback) => (state.has(key) ? state.get(key) : fallback),
        set: (key, value) => state.set(key, value),
      },
    },
  }
}

async function pick(f) {
  registerLibraryDialogs(f.deps)
  const handler = f.handlers.get(PICK_FOLDER_CHANNEL)
  assert.equal(typeof handler, 'function', 'the pick-folder channel is registered')
  return handler({})
}

test('registers exactly the pick-folder, pick-import and save-frame channels', () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] } })
  registerLibraryDialogs(f.deps)
  assert.deepEqual([...f.handlers.keys()].sort(), [
    'library:pick-folder',
    'library:pick-import',
    'library:save-frame',
  ])
})

test('returns the chosen folder and remembers it', async () => {
  const f = fakes({ answer: { canceled: false, filePaths: ['/Volumes/Rec/Session 1'] } })
  assert.equal(await pick(f), '/Volumes/Rec/Session 1')
  assert.equal(f.state.get(LAST_IMPORT_FOLDER_KEY), '/Volumes/Rec/Session 1')
})

test('asks for a directory, allows creating one, and parents to the main window', async () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] } })
  await pick(f)
  assert.equal(f.dialogCalls.length, 1)
  const { win, options } = f.dialogCalls[0]
  assert.equal(win, WINDOW)
  assert.ok(options.properties.includes('openDirectory'))
  assert.ok(options.properties.includes('createDirectory'))
  assert.equal(options.properties.includes('openFile'), false)
})

test('starts in the last folder picked', async () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] }, stored: '/Users/x/Recordings' })
  await pick(f)
  assert.equal(f.dialogCalls[0].options.defaultPath, '/Users/x/Recordings')
})

test('has no defaultPath when nothing (or garbage) was stored', async () => {
  for (const stored of [undefined, '', 42, null]) {
    const f = fakes({ answer: { canceled: true, filePaths: [] }, stored })
    await pick(f)
    assert.equal(f.dialogCalls[0].options.defaultPath, undefined)
  }
})

test('a cancelled dialog answers null and leaves the remembered folder alone', async () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] }, stored: '/Users/x/Old' })
  assert.equal(await pick(f), null)
  assert.equal(f.state.get(LAST_IMPORT_FOLDER_KEY), '/Users/x/Old')
})

test('an empty selection answers null without persisting', async () => {
  const f = fakes({ answer: { canceled: false, filePaths: [] } })
  assert.equal(await pick(f), null)
  assert.equal(f.state.has(LAST_IMPORT_FOLDER_KEY), false)
})

test('works with no window (dialog is then app-modal)', async () => {
  const f = fakes({ answer: { canceled: false, filePaths: ['/a'] } })
  f.deps.getWindow = () => null
  assert.equal(await pick(f), '/a')
  assert.equal(f.dialogCalls[0].win, undefined)
})

test('a dialog failure rejects (the renderer toasts it), never answers null', async () => {
  const f = fakes()
  f.deps.dialog.showOpenDialog = async () => {
    throw new Error('dialog exploded')
  }
  await assert.rejects(() => pick(f), /dialog exploded/)
})

test('mediaFileFilters: the fixture list first, then All Files', () => {
  const fixture = JSON.parse(fs.readFileSync(MEDIA_EXTENSIONS_FIXTURE, 'utf-8'))
  const filters = mediaFileFilters()
  assert.equal(filters.length, 2)
  assert.equal(filters[0].name, 'Audio / Video')
  assert.deepEqual([...filters[0].extensions].sort(), [...fixture.extensions].sort())
  // A record the agent's load_video made can have any extension — Locate must reach it.
  assert.deepEqual(filters[1], { name: 'All Files', extensions: ['*'] })
})

test('mediaFileFilters hands out a fresh copy each call', () => {
  const first = mediaFileFilters()
  first[0].extensions.push('exe')
  assert.equal(mediaFileFilters()[0].extensions.includes('exe'), false)
})

// ── library:pick-import ─────────────────────────────────────────────────────

async function pickImport(f, mode) {
  registerLibraryDialogs(f.deps)
  const handler = f.handlers.get(PICK_IMPORT_CHANNEL)
  assert.equal(typeof handler, 'function', 'the pick-import channel is registered')
  return handler({}, mode)
}

test("'any' opens one dialog for files and folders, several at once", async () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] } })
  await pickImport(f, 'any')
  assert.equal(f.dialogCalls.length, 1)
  const { win, options } = f.dialogCalls[0]
  assert.equal(win, WINDOW)
  for (const property of ['openFile', 'openDirectory', 'multiSelections']) {
    assert.ok(options.properties.includes(property), property)
  }
})

test("'files' picks several files and no folders", async () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] } })
  await pickImport(f, 'files')
  const { properties } = f.dialogCalls[0].options
  assert.ok(properties.includes('openFile'))
  assert.ok(properties.includes('multiSelections'))
  assert.equal(properties.includes('openDirectory'), false)
})

test("'folder' picks folders only, with no file filters", async () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] } })
  await pickImport(f, 'folder')
  const { options } = f.dialogCalls[0]
  assert.ok(options.properties.includes('openDirectory'))
  assert.equal(options.properties.includes('openFile'), false)
  assert.equal(options.filters, undefined)
})

test('the file modes filter for media, CapForge projects and All Files', async () => {
  const fixture = JSON.parse(fs.readFileSync(MEDIA_EXTENSIONS_FIXTURE, 'utf-8'))
  for (const mode of ['any', 'files']) {
    const f = fakes({ answer: { canceled: true, filePaths: [] } })
    await pickImport(f, mode)
    const { filters } = f.dialogCalls[0].options
    const media = filters.find((filter) => filter.name === 'Audio / Video')
    assert.deepEqual([...media.extensions].sort(), [...fixture.extensions].sort(), mode)
    assert.ok(
      filters.some((filter) => filter.extensions.join() === 'capforge'),
      mode
    )
    assert.deepEqual(filters[filters.length - 1], { name: 'All Files', extensions: ['*'] }, mode)
    // The default (first) filter must not hide projects behind media, or the reverse.
    assert.ok(filters[0].extensions.includes('capforge'), mode)
    assert.ok(filters[0].extensions.includes('mp4'), mode)
  }
})

test('stats every pick for its kind', async () => {
  const f = fakes({
    answer: { canceled: false, filePaths: ['/rec/Session 1', '/rec/a.mp4', '/rec/b.capforge'] },
    directories: ['/rec/Session 1'],
  })
  assert.deepEqual(await pickImport(f, 'any'), [
    { path: '/rec/Session 1', kind: 'directory' },
    { path: '/rec/a.mp4', kind: 'file' },
    { path: '/rec/b.capforge', kind: 'file' },
  ])
})

test('a cancelled or empty import pick answers [] and persists nothing', async () => {
  for (const answer of [
    { canceled: true, filePaths: ['/x'] },
    { canceled: false, filePaths: [] },
  ]) {
    const f = fakes({ answer })
    assert.deepEqual(await pickImport(f, 'any'), [])
    assert.equal(f.state.has(LAST_IMPORT_FOLDER_KEY), false)
  }
})

test('remembers the folder picked, or the folder the picked files are in', async () => {
  const folder = fakes({
    answer: { canceled: false, filePaths: ['/Volumes/Rec/Day 1'] },
    directories: ['/Volumes/Rec/Day 1'],
  })
  await pickImport(folder, 'folder')
  assert.equal(folder.state.get(LAST_IMPORT_FOLDER_KEY), '/Volumes/Rec/Day 1')

  const files = fakes({ answer: { canceled: false, filePaths: ['/Volumes/Rec/a.mp4'] } })
  await pickImport(files, 'files')
  assert.equal(files.state.get(LAST_IMPORT_FOLDER_KEY), '/Volumes/Rec')
})

test('the import picker starts in the last folder picked (shared with pick-folder)', async () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] }, stored: '/Users/x/Recordings' })
  await pickImport(f, 'any')
  assert.equal(f.dialogCalls[0].options.defaultPath, '/Users/x/Recordings')
})

test('an unknown mode rejects without opening a dialog', async () => {
  for (const mode of ['everything', undefined, 42]) {
    const f = fakes({ answer: { canceled: true, filePaths: [] } })
    await assert.rejects(() => pickImport(f, mode), /import picker mode/)
    assert.equal(f.dialogCalls.length, 0)
  }
})

test('a stat failure rejects (the renderer toasts it) rather than guessing a kind', async () => {
  const f = fakes({ answer: { canceled: false, filePaths: ['/gone.mp4'] } })
  f.deps.stat = async () => {
    throw new Error('ENOENT: /gone.mp4')
  }
  await assert.rejects(() => pickImport(f, 'files'), /ENOENT/)
})

// ── library:save-frame ──────────────────────────────────────────────────────

const os = require('node:os')
const libraryFs = require('./library-fs')
const { SAVE_FRAME_CHANNEL, FRAME_REFUSED_MESSAGE, frameFileName } = require('./library-dialogs')

const VIDEO_ID = 'a'.repeat(32)
const FRAME = `${'b'.repeat(32)}.jpg`
const ROOT = '/home/u/.capforge/library'
const CHOSEN = '/Users/u/Desktop/out.jpg'

/** Fakes for the save handler: the save dialog's answer, recorded copies and guard calls. */
function saveFakes({ answer = { canceled: false, filePath: CHOSEN } } = {}) {
  const f = fakes()
  const copies = []
  const guarded = []
  const saveDialogCalls = []
  f.deps.dialog.showSaveDialog = async (win, options) => {
    saveDialogCalls.push({ win, options })
    return answer
  }
  f.deps.copyFile = async (from, to) => {
    copies.push({ from, to })
  }
  f.deps.libraryRoot = () => ROOT
  f.deps.assertInLibrary = (p) => {
    guarded.push(p)
    return p
  }
  return { ...f, copies, guarded, saveDialogCalls }
}

async function saveFrame(f, ...args) {
  registerLibraryDialogs(f.deps)
  const handler = f.handlers.get(SAVE_FRAME_CHANNEL)
  assert.equal(typeof handler, 'function', 'the save-frame channel is registered')
  return handler({}, ...args)
}

const REFUSED = new RegExp(FRAME_REFUSED_MESSAGE)

test('save-frame resolves the frame path itself, guards it and copies it to the chosen file', async () => {
  const f = saveFakes()
  const expected = path.join(ROOT, VIDEO_ID, 'thumbnails', FRAME)
  assert.equal(await saveFrame(f, VIDEO_ID, FRAME, 'My Talk'), CHOSEN)
  assert.deepEqual(f.guarded, [expected])
  assert.deepEqual(f.copies, [{ from: expected, to: CHOSEN }])
  const { win, options } = f.saveDialogCalls[0]
  assert.equal(win, WINDOW)
  assert.equal(options.defaultPath, 'My Talk-thumbnail.jpg')
  assert.ok(options.filters.some((filter) => filter.extensions.includes('jpg')))
})

test('save-frame copies the path the guard resolved, not the one it built', async () => {
  const f = saveFakes()
  f.deps.assertInLibrary = () => '/real/resolved.jpg'
  await saveFrame(f, VIDEO_ID, FRAME, 'T')
  assert.equal(f.copies[0].from, '/real/resolved.jpg')
})

test('save-frame answers null on cancel and copies nothing', async () => {
  for (const answer of [
    { canceled: true, filePath: '/x.jpg' },
    { canceled: false, filePath: '' },
    // null, not undefined: undefined would fall back to saveFakes' default answer.
    null,
  ]) {
    const f = saveFakes({ answer })
    assert.equal(await saveFrame(f, VIDEO_ID, FRAME, 'T'), null)
    assert.equal(f.copies.length, 0)
  }
})

test('save-frame refuses a malformed video id or frame name before any dialog', async () => {
  const bad = [
    ['a'.repeat(31), FRAME],
    ['A'.repeat(32), FRAME],
    ['../../etc', FRAME],
    [VIDEO_ID, '../poster.jpg'],
    [VIDEO_ID, 'poster.jpg'],
    [VIDEO_ID, `${'b'.repeat(32)}.png`],
    [VIDEO_ID, `${'b'.repeat(32)}.jpg/..`],
    [42, FRAME],
    [VIDEO_ID, undefined],
  ]
  for (const [id, name] of bad) {
    const f = saveFakes()
    await assert.rejects(() => saveFrame(f, id, name, 'T'), REFUSED)
    assert.equal(f.saveDialogCalls.length, 0, `${String(id)} ${String(name)}`)
    assert.equal(f.guarded.length, 0)
  }
})

test('save-frame refuses with its own message when the guard rejects the path', async () => {
  const f = saveFakes()
  f.deps.assertInLibrary = () => {
    throw new Error('Refusing to trash a path outside the library')
  }
  await assert.rejects(() => saveFrame(f, VIDEO_ID, FRAME, 'T'), REFUSED)
  assert.equal(f.saveDialogCalls.length, 0)
})

test('save-frame: a copy failure rejects (the renderer toasts it)', async () => {
  const f = saveFakes()
  f.deps.copyFile = async () => {
    throw new Error('ENOENT: no such frame')
  }
  await assert.rejects(() => saveFrame(f, VIDEO_ID, FRAME, 'T'), /ENOENT/)
})

test('frameFileName turns the title into a safe default file name', () => {
  assert.equal(frameFileName('My Talk'), 'My Talk-thumbnail.jpg')
  assert.equal(frameFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j-thumbnail.jpg')
  assert.equal(frameFileName('  ..hidden.   name  '), 'hidden. name-thumbnail.jpg')
  assert.equal(frameFileName(String.fromCharCode(0, 7)), 'thumbnail.jpg')
  for (const empty of ['', '   ', undefined, null, 42]) {
    assert.equal(frameFileName(empty), 'thumbnail.jpg')
  }
  const long = frameFileName('x'.repeat(500))
  assert.ok(long.length <= 120, long)
  assert.ok(long.endsWith('-thumbnail.jpg'))
})

test('save-frame with the real library-fs guard: copies a frame, refuses a symlink out', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-frame-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-outside-'))
  const previous = process.env.CAPFORGE_HOME
  process.env.CAPFORGE_HOME = home
  const realDeps = {
    copyFile: (a, b) => fs.promises.copyFile(a, b),
    libraryRoot: libraryFs.libraryRoot,
    assertInLibrary: libraryFs.assertTrashable,
  }
  try {
    const thumbs = path.join(home, 'library', VIDEO_ID, 'thumbnails')
    fs.mkdirSync(thumbs, { recursive: true })
    fs.writeFileSync(path.join(thumbs, FRAME), 'jpeg-bytes')
    const dest = path.join(home, 'out.jpg')
    const f = saveFakes({ answer: { canceled: false, filePath: dest } })
    Object.assign(f.deps, realDeps)
    assert.equal(await saveFrame(f, VIDEO_ID, FRAME, 'T'), dest)
    assert.equal(fs.readFileSync(dest, 'utf-8'), 'jpeg-bytes')

    // A record whose thumbnails folder is a symlink pointing out of the library.
    fs.writeFileSync(path.join(outside, FRAME), 'secret')
    const other = 'c'.repeat(32)
    fs.mkdirSync(path.join(home, 'library', other))
    fs.symlinkSync(outside, path.join(home, 'library', other, 'thumbnails'))
    const leak = path.join(home, 'leak.jpg')
    const g = saveFakes({ answer: { canceled: false, filePath: leak } })
    Object.assign(g.deps, realDeps)
    await assert.rejects(() => saveFrame(g, other, FRAME, 'T'), REFUSED)
    assert.equal(fs.existsSync(leak), false)
  } finally {
    if (previous === undefined) delete process.env.CAPFORGE_HOME
    else process.env.CAPFORGE_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
