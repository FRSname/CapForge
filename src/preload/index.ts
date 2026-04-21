/**
 * Preload — typed bridge between Electron main and React renderer.
 * Mirrors electron/preload.js with full TypeScript types.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface FontInfo {
  name: string
  path: string
}

export interface PresetSettings {
  [key: string]: unknown
}

export interface SubforgeApi {
  /** Electron 32+ replacement for File.path (sync). */
  getPathForFile: (file: File) => string
  pickAudioFile: () => Promise<string | null>
  pickOutputDir: () => Promise<string | null>
  getBackendPort: () => Promise<number>
  saveFont: (fileName: string, data: ArrayBuffer) => Promise<string>
  listFonts: () => Promise<FontInfo[]>
  listBundledFonts: () => Promise<FontInfo[]>
  deleteFont: (fontPath: string) => Promise<boolean>
  readFont: (fontPath: string) => Promise<ArrayBuffer>
  listPresets: () => Promise<string[]>
  loadPreset: (name: string) => Promise<PresetSettings | null>
  savePreset: (name: string, settings: PresetSettings) => Promise<void>
  deletePreset: (name: string) => Promise<void>
  saveProject: (projectData: unknown) => Promise<string | null>
  openProject: () => Promise<unknown | null>
  getState: <T>(key: string, fallback: T) => Promise<T>
  setState: (key: string, value: unknown) => Promise<void>
  openLogsFolder: () => Promise<void>
  openLogFile: () => Promise<void>
  showInFolder: (filePath: string) => Promise<void>
}

declare global {
  interface Window {
    subforge: SubforgeApi
  }
}

contextBridge.exposeInMainWorld('subforge', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  pickAudioFile: () => ipcRenderer.invoke('dialog:openFile'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:openDir'),
  getBackendPort: () => ipcRenderer.invoke('backend:port'),
  saveFont: (fileName: string, data: ArrayBuffer) => ipcRenderer.invoke('fonts:save', fileName, data),
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  listBundledFonts: () => ipcRenderer.invoke('fonts:listBundled'),
  deleteFont: (fontPath: string) => ipcRenderer.invoke('fonts:delete', fontPath),
  readFont: (fontPath: string) => ipcRenderer.invoke('fonts:read', fontPath),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  loadPreset: (name: string) => ipcRenderer.invoke('presets:load', name),
  savePreset: (name: string, settings: PresetSettings) => ipcRenderer.invoke('presets:save', name, settings),
  deletePreset: (name: string) => ipcRenderer.invoke('presets:delete', name),
  saveProject: (projectData: unknown) => ipcRenderer.invoke('project:save', projectData),
  openProject: () => ipcRenderer.invoke('project:open'),
  getState: <T>(key: string, fallback: T) => ipcRenderer.invoke('state:get', key, fallback),
  setState: (key: string, value: unknown) => ipcRenderer.invoke('state:set', key, value),
  openLogsFolder: () => ipcRenderer.invoke('logs:openFolder'),
  openLogFile: () => ipcRenderer.invoke('logs:openFile'),
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),
} satisfies SubforgeApi)
