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

  /** Open native directory picker. Returns path or null. */
  pickOutputDir: () => ipcRenderer.invoke('dialog:openDir'),

  /** Open native image-file picker (logos/overlays). Returns path or null. */
  pickImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),

  /** Get backend port number. */
  getBackendPort: () => ipcRenderer.invoke('backend:port'),

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
