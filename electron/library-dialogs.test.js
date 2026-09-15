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
function fakes({ answer, stored } = {}) {
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

test('registers exactly the library:pick-folder channel', () => {
  const f = fakes({ answer: { canceled: true, filePaths: [] } })
  registerLibraryDialogs(f.deps)
  assert.deepEqual([...f.handlers.keys()], ['library:pick-folder'])
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
