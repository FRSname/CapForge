/**
 * Preload script — exposes safe IPC methods to the renderer.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('subforge', {
  /**
   * Electron 32+ removed File.path; use webUtils.getPathForFile(file) instead.
   * Call this from drag/drop or <input type=file> handlers in the renderer.
   */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  /** Open native file picker for audio files. Returns path or null. */
  pickAudioFile: () => ipcRenderer.invoke('dialog:openFile'),

  /** Subscribe to "open this media file" pushes from the main process: a second
   *  launch that carried a media argument, or macOS' `open-file`. Returns an
   *  unsubscribe fn. */
  onOpenPath: (cb) => {
    const listener = (_event, filePath) => cb(filePath)
    ipcRenderer.on('file:open-path', listener)
    return () => ipcRenderer.removeListener('file:open-path', listener)
  },

  /** Open native directory picker. Returns path or null. */
  pickOutputDir: () => ipcRenderer.invoke('dialog:openDir'),

  /** Open native image-file picker (logos/overlays). Returns path or null. */
  pickImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),

  /** Get backend port number. */
  getBackendPort: () => ipcRenderer.invoke('backend:port'),

  /** Per-launch token the renderer must send on the local media endpoints. */
  getLocalToken: () => ipcRenderer.invoke('backend:local-token'),

  /** Save a font file to persistent storage. Returns saved path. */
  /** Save a font file to persistent storage. Accepts filename + ArrayBuffer. Returns saved path. */
  saveFont: (fileName, data) => ipcRenderer.invoke('fonts:save', fileName, data),

  /** List all saved custom fonts. Returns [{name, path}]. */
  listFonts: () => ipcRenderer.invoke('fonts:list'),

  /** List fonts bundled with the app. Returns [{name, path}]. */
  listBundledFonts: () => ipcRenderer.invoke('fonts:listBundled'),

  /** Delete a saved font. Returns boolean. */
  deleteFont: (fontPath) => ipcRenderer.invoke('fonts:delete', fontPath),

  /** Read a saved font file as ArrayBuffer. */
  readFont: (fontPath) => ipcRenderer.invoke('fonts:read', fontPath),

  /** List all preset names. Returns string[]. */
  listPresets: () => ipcRenderer.invoke('presets:list'),

  /** Load a preset by name. Returns settings object or null. */
  loadPreset: (name) => ipcRenderer.invoke('presets:load', name),

  /** Save a preset. */
  savePreset: (name, settings) => ipcRenderer.invoke('presets:save', name, settings),

  /** Delete a preset by name. */
  deletePreset: (name) => ipcRenderer.invoke('presets:delete', name),

  /** Export a preset to a .cfpreset file. Returns {filePath, fontStatus} | {error} | null. */
  exportPreset: (name) => ipcRenderer.invoke('presets:export', name),

  /** Import a preset from a .cfpreset file. Returns {name, fontStatus} | {error} | null. */
  importPreset: () => ipcRenderer.invoke('presets:import'),

  /** Save a project file. Returns saved path or null. */
  saveProject: (projectData) => ipcRenderer.invoke('project:save', projectData),

  /** Open a project file. Returns parsed data or null. */
  openProject: () => ipcRenderer.invoke('project:open'),

  /** Read a persisted UI preference. Returns stored value or `fallback`. */
  getState: (key, fallback) => ipcRenderer.invoke('state:get', key, fallback),

  /** Write a persisted UI preference. */
  setState: (key, value) => ipcRenderer.invoke('state:set', key, value),

  /** Crash-recovery autosave: write the current session snapshot. */
  autosaveWrite: (data) => ipcRenderer.invoke('autosave:write', data),

  /** Read the latest autosave snapshot, or null when there is none. */
  autosaveRead: () => ipcRenderer.invoke('autosave:read'),

  /** Clear all autosave data (on explicit Save / New). */
  autosaveClear: () => ipcRenderer.invoke('autosave:clear'),

  /** v3 library: move a record folder to the OS Trash. The main process refuses
   *  any path not strictly under `<CAPFORGE_HOME>/library/`. */
  trashLibraryFolder: (folderPath) => ipcRenderer.invoke('library:trash-folder', folderPath),

  /** Open `<CAPFORGE_HOME>/library` in the OS file manager, creating it if missing. */
  revealLibraryFolder: () => ipcRenderer.invoke('library:reveal'),

  /** Folder picker for the library's folder import and watch folder. Returns path or null. */
  pickLibraryFolder: () => ipcRenderer.invoke('library:pick-folder'),

  /** The library's Import… picker. `mode` is 'any' (files and folders, macOS only),
   *  'files' or 'folder'. Resolves to `[{ path, kind: 'file' | 'directory' }]`, [] on cancel. */
  pickImport: (mode) => ipcRenderer.invoke('library:pick-import', mode),

  /** Save a grabbed thumbnail frame out ("Save cover…"). The main process resolves
   *  `<library>/<videoId>/thumbnails/<name>` itself; `title` only names the file.
   *  Returns the saved path, or null when cancelled. */
  saveLibraryFrame: (videoId, name, title) =>
    ipcRenderer.invoke('library:save-frame', videoId, name, title),

  /** Multi-select .capforge picker. Returns the chosen paths ([] when cancelled). */
  openProjectFiles: () => ipcRenderer.invoke('dialog:open-projects'),

  /** Open the folder containing backend logs in the OS file manager. */
  openLogsFolder: () => ipcRenderer.invoke('logs:openFolder'),

  /** Open the current backend log file in the default text viewer. */
  openLogFile: () => ipcRenderer.invoke('logs:openFile'),

  /** Reveal a file/folder in the OS file manager. */
  showInFolder: (filePath) => ipcRenderer.invoke('shell:showInFolder', filePath),

  /** Launch the HyperFrames Studio (local preview webapp) for a project folder
   *  and open it in the browser. Returns {url} or {error}. */
  openStudio: (projectDir) => ipcRenderer.invoke('studio:open', projectDir),

  /** Stop the HyperFrames Studio preview server. */
  stopStudio: () => ipcRenderer.invoke('studio:stop'),

  /** One-click "Connect to Claude" (MCP control layer). */
  claude: {
    detect: () => ipcRenderer.invoke('claude:detect'),
    connectDesktop: () => ipcRenderer.invoke('claude:connectDesktop'),
    connectCode: () => ipcRenderer.invoke('claude:connectCode'),
    getManualConfig: () => ipcRenderer.invoke('claude:getManualConfig'),
  },

  /** Bundled Claude skills: read/edit CapForge's user copy, then install it. */
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    read: (name) => ipcRenderer.invoke('skills:read', name),
    write: (name, text) => ipcRenderer.invoke('skills:write', name, text),
    reset: (name) => ipcRenderer.invoke('skills:reset', name),
    acknowledgeBundle: (name) => ipcRenderer.invoke('skills:acknowledgeBundle', name),
    /** Copy the user copy into ~/.claude/skills/<name>/. */
    install: (name) => ipcRenderer.invoke('skills:install', name),
    reveal: (name) => ipcRenderer.invoke('skills:reveal', name),
  },

  /** Opt-in provisioning of the HyperFrames extras (managed Node + CLI + browser). */
  hyperframes: {
    status: () => ipcRenderer.invoke('hyperframes:status'),
    provision: () => ipcRenderer.invoke('hyperframes:provision'),
    /** Subscribe to provisioning progress; returns an unsubscribe fn. */
    onProvisionProgress: (cb) => {
      const listener = (_event, p) => cb(p)
      ipcRenderer.on('hyperframes:provision-progress', listener)
      return () => ipcRenderer.removeListener('hyperframes:provision-progress', listener)
    },
  },
})
