/**
 * Native dialogs for the v3 library (docs/plans/library-folder-import.md).
 *
 * `main.js` is past its size ceiling, so the library's pickers register from
 * here with one call. Electron main never calls REST and never scans the
 * folder: it hands the chosen path back to the renderer, which asks the
 * backend to import (or watch) it.
 *
 * Deliberately imports no Electron — `ipcMain`, `dialog`, the window getter
 * and `app-state` are injected — so it runs under plain
 * `node --test electron/library-dialogs.test.js`.
 */

const { MEDIA_EXTENSIONS } = require('./single-instance')

/** The renderer's `window.subforge.pickLibraryFolder()` invokes this. */
const PICK_FOLDER_CHANNEL = 'library:pick-folder'

/** `app-state` key: the folder last picked, reopened as the dialog's start. */
const LAST_IMPORT_FOLDER_KEY = 'lastImportFolder'

const PICK_FOLDER_TITLE = 'Choose a Folder of Recordings'

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
 * Register the library's dialog IPC handlers.
 *
 * @param {object} deps
 * @param {{ handle: Function }} deps.ipcMain
 * @param {{ showOpenDialog: Function }} deps.dialog
 * @param {() => unknown} deps.getWindow - the main window, or null
 * @param {{ get: Function, set: Function }} deps.appState
 */
function registerLibraryDialogs({ ipcMain, dialog, getWindow, appState }) {
  ipcMain.handle(PICK_FOLDER_CHANNEL, () => pickLibraryFolder({ dialog, getWindow, appState }))
}

module.exports = {
  registerLibraryDialogs,
  pickLibraryFolder,
  mediaFileFilters,
  PICK_FOLDER_CHANNEL,
  LAST_IMPORT_FOLDER_KEY,
}
