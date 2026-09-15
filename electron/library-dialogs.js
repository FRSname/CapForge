/**
 * Native dialogs for the v3 library (docs/plans/library-folder-import.md).
 *
 * `main.js` is past its size ceiling, so the library's pickers register from
 * here with one call. Electron main never calls REST and never scans the
 * folder: it hands the chosen path back to the renderer, which asks the
 * backend to import (or watch) it.
 *
 * Deliberately imports no Electron — `ipcMain`, `dialog`, the window getter,
 * `app-state` and `fs.promises.stat` are injected — so it runs under plain
 * `node --test electron/library-dialogs.test.js`.
 */

const path = require('node:path')
const { MEDIA_EXTENSIONS } = require('./single-instance')

/** The renderer's `window.subforge.pickLibraryFolder()` invokes this. */
const PICK_FOLDER_CHANNEL = 'library:pick-folder'

/** `app-state` key: the folder last picked, reopened as the dialog's start. */
const LAST_IMPORT_FOLDER_KEY = 'lastImportFolder'

const PICK_FOLDER_TITLE = 'Choose a Folder of Recordings'

/** The renderer's `window.subforge.pickImport(mode)` invokes this. */
const PICK_IMPORT_CHANNEL = 'library:pick-import'

const PICK_IMPORT_TITLE = 'Import into the Library'

/** The `.capforge` project extension, dotless like `MEDIA_EXTENSIONS`. */
const PROJECT_EXTENSION = 'capforge'

/**
 * Dialog properties per import mode. `any` combines files and folders in one
 * dialog, which only macOS can show — on Windows and Linux Electron turns that
 * into a folder picker, so the renderer offers `files` and `folder` there.
 */
const IMPORT_MODE_PROPERTIES = {
  any: ['openFile', 'openDirectory', 'multiSelections', 'createDirectory'],
  files: ['openFile', 'multiSelections'],
  folder: ['openDirectory', 'multiSelections', 'createDirectory'],
}

/**
 * Filters for the media file picker (`dialog:openFile`, used by "Locate…").
 * The media list is `MEDIA_EXTENSIONS` — the fixture-pinned copy — and "All
 * Files" follows it, because a record the agent's `load_video` made can have
 * any extension. A fresh array per call, so a caller cannot mutate the list.
 *
 * @returns {{ name: string, extensions: string[] }[]}
 */
function mediaFileFilters() {
  return [
    { name: 'Audio / Video', extensions: [...MEDIA_EXTENSIONS] },
    { name: 'All Files', extensions: ['*'] },
  ]
}

/**
 * Filters for the import picker's file modes. The first filter is the default
 * one, so it takes media *and* projects — neither is hidden until the user
 * finds the filter menu. A fresh array per call.
 *
 * @returns {{ name: string, extensions: string[] }[]}
 */
function importFileFilters() {
  return [
    { name: 'Videos, Audio and Projects', extensions: [...MEDIA_EXTENSIONS, PROJECT_EXTENSION] },
    { name: 'Audio / Video', extensions: [...MEDIA_EXTENSIONS] },
    { name: 'CapForge Project', extensions: [PROJECT_EXTENSION] },
    { name: 'All Files', extensions: ['*'] },
  ]
}

/**
 * @param {{ get: (key: string, fallback?: unknown) => unknown }} appState
 * @returns {string | undefined}
 */
function rememberedFolder(appState) {
  const stored = appState.get(LAST_IMPORT_FOLDER_KEY)
  return typeof stored === 'string' && stored !== '' ? stored : undefined
}

/**
 * Show the directory picker. Resolves to the chosen folder, or `null` when the
 * user cancels. A dialog failure rejects — the renderer toasts it.
 *
 * @param {object} deps
 * @param {{ showOpenDialog: Function }} deps.dialog
 * @param {() => unknown} deps.getWindow
 * @param {{ get: Function, set: Function }} deps.appState
 * @returns {Promise<string | null>}
 */
async function pickLibraryFolder({ dialog, getWindow, appState }) {
  const options = {
    title: PICK_FOLDER_TITLE,
    defaultPath: rememberedFolder(appState),
    properties: ['openDirectory', 'createDirectory'],
  }
  const win = getWindow() || undefined
  const result = await dialog.showOpenDialog(win, options)
  if (!result || result.canceled) return null
  const picked = Array.isArray(result.filePaths) ? result.filePaths[0] : undefined
  if (typeof picked !== 'string' || picked === '') return null
  appState.set(LAST_IMPORT_FOLDER_KEY, picked)
  return picked
}

/**
 * Show the import picker for `mode` and say what each pick is. Resolves to
 * `[]` on cancel. An unknown mode, a dialog failure or a pick that cannot be
 * stat'ed rejects — the renderer toasts it; a kind is never guessed.
 *
 * Remembers the folder picked, or the folder the first picked file is in, in
 * the same `app-state` key `pickLibraryFolder` uses.
 *
 * @param {object} deps
 * @param {{ showOpenDialog: Function }} deps.dialog
 * @param {() => unknown} deps.getWindow
 * @param {{ get: Function, set: Function }} deps.appState
 * @param {(p: string) => Promise<{ isDirectory: () => boolean }>} deps.stat
 * @param {unknown} mode - 'any' | 'files' | 'folder'
 * @returns {Promise<{ path: string, kind: 'file' | 'directory' }[]>}
 */
async function pickImport({ dialog, getWindow, appState, stat }, mode) {
  if (typeof mode !== 'string' || !Object.hasOwn(IMPORT_MODE_PROPERTIES, mode)) {
    throw new Error(`Unknown import picker mode: ${String(mode)}`)
  }
  const options = {
    title: PICK_IMPORT_TITLE,
    defaultPath: rememberedFolder(appState),
    properties: [...IMPORT_MODE_PROPERTIES[mode]],
    filters: mode === 'folder' ? undefined : importFileFilters(),
  }
  const win = getWindow() || undefined
  const result = await dialog.showOpenDialog(win, options)
  if (!result || result.canceled || !Array.isArray(result.filePaths)) return []
  const paths = result.filePaths.filter((p) => typeof p === 'string' && p !== '')
  if (paths.length === 0) return []

  const picked = []
  for (const pickedPath of paths) {
    const stats = await stat(pickedPath)
    picked.push({ path: pickedPath, kind: stats.isDirectory() ? 'directory' : 'file' })
  }
  const first = picked[0]
  appState.set(
    LAST_IMPORT_FOLDER_KEY,
    first.kind === 'directory' ? first.path : path.dirname(first.path)
  )
  return picked
}

/**
 * Register the library's dialog IPC handlers.
 *
 * @param {object} deps
 * @param {{ handle: Function }} deps.ipcMain
 * @param {{ showOpenDialog: Function }} deps.dialog
 * @param {() => unknown} deps.getWindow - the main window, or null
 * @param {{ get: Function, set: Function }} deps.appState
 * @param {(p: string) => Promise<{ isDirectory: () => boolean }>} deps.stat - `fs.promises.stat`
 */
function registerLibraryDialogs({ ipcMain, dialog, getWindow, appState, stat }) {
  ipcMain.handle(PICK_FOLDER_CHANNEL, () => pickLibraryFolder({ dialog, getWindow, appState }))
  ipcMain.handle(PICK_IMPORT_CHANNEL, (_event, mode) =>
    pickImport({ dialog, getWindow, appState, stat }, mode)
  )
}

module.exports = {
  registerLibraryDialogs,
  pickLibraryFolder,
  pickImport,
  mediaFileFilters,
  importFileFilters,
  PICK_FOLDER_CHANNEL,
  PICK_IMPORT_CHANNEL,
  LAST_IMPORT_FOLDER_KEY,
}
