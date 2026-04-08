/**
 * Preload script — exposes safe IPC methods to the renderer.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("subforge", {
  /** Open native file picker for audio files. Returns path or null. */
  pickAudioFile: () => ipcRenderer.invoke("dialog:openFile"),

  /** Open native directory picker. Returns path or null. */
  pickOutputDir: () => ipcRenderer.invoke("dialog:openDir"),

  /** Get backend port number. */
  getBackendPort: () => ipcRenderer.invoke("backend:port"),

  /** Save a font file to persistent storage. Returns saved path. */
  /** Save a font file to persistent storage. Accepts filename + ArrayBuffer. Returns saved path. */
  saveFont: (fileName, data) => ipcRenderer.invoke("fonts:save", fileName, data),

  /** List all saved custom fonts. Returns [{name, path}]. */
  listFonts: () => ipcRenderer.invoke("fonts:list"),

  /** Delete a saved font. Returns boolean. */
  deleteFont: (fontPath) => ipcRenderer.invoke("fonts:delete", fontPath),

  /** Read a saved font file as ArrayBuffer. */
  readFont: (fontPath) => ipcRenderer.invoke("fonts:read", fontPath),

  /** List all preset names. Returns string[]. */
  listPresets: () => ipcRenderer.invoke("presets:list"),

  /** Load a preset by name. Returns settings object or null. */
  loadPreset: (name) => ipcRenderer.invoke("presets:load", name),

  /** Save a preset. */
  savePreset: (name, settings) => ipcRenderer.invoke("presets:save", name, settings),

  /** Delete a preset by name. */
  deletePreset: (name) => ipcRenderer.invoke("presets:delete", name),

  /** Save a project file. Returns saved path or null. */
  saveProject: (projectData) => ipcRenderer.invoke("project:save", projectData),

  /** Open a project file. Returns parsed data or null. */
  openProject: () => ipcRenderer.invoke("project:open"),
});
