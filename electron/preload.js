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
});
