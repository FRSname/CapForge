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
  pickImageFile: () => Promise<string | null>
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
  autosaveWrite: (data: unknown) => Promise<void>
  autosaveRead: () => Promise<unknown | null>
  autosaveClear: () => Promise<void>
  openLogsFolder: () => Promise<void>
  openLogFile: () => Promise<void>
  showInFolder: (filePath: string) => Promise<void>
  openStudio: (projectDir: string) => Promise<{ url?: string; error?: string }>
  stopStudio: () => Promise<boolean>
  claude: ClaudeConnectApi
}

interface ClaudeDetect {
  desktop: boolean
  code: boolean
  runtimeReady: boolean
}

interface ClaudeConnectResult {
  ok: boolean
  path?: string
  reason?: 'runtime-not-ready' | 'not-installed' | 'write-failed'
  detail?: string
}

interface ClaudeManualConfig {
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  desktopPath: string
  codePath: string
  desktopJson: string
  codeCommand: string
}

interface ClaudeConnectApi {
  detect: () => Promise<ClaudeDetect>
  connectDesktop: () => Promise<ClaudeConnectResult>
  connectCode: () => Promise<ClaudeConnectResult>
  getManualConfig: () => Promise<ClaudeManualConfig>
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
  pickImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),
  getBackendPort: () => ipcRenderer.invoke('backend:port'),
  saveFont: (fileName: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('fonts:save', fileName, data),
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  listBundledFonts: () => ipcRenderer.invoke('fonts:listBundled'),
  deleteFont: (fontPath: string) => ipcRenderer.invoke('fonts:delete', fontPath),
  readFont: (fontPath: string) => ipcRenderer.invoke('fonts:read', fontPath),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  loadPreset: (name: string) => ipcRenderer.invoke('presets:load', name),
  savePreset: (name: string, settings: PresetSettings) =>
    ipcRenderer.invoke('presets:save', name, settings),
  deletePreset: (name: string) => ipcRenderer.invoke('presets:delete', name),
  saveProject: (projectData: unknown) => ipcRenderer.invoke('project:save', projectData),
  openProject: () => ipcRenderer.invoke('project:open'),
  getState: <T>(key: string, fallback: T) => ipcRenderer.invoke('state:get', key, fallback),
  setState: (key: string, value: unknown) => ipcRenderer.invoke('state:set', key, value),
  autosaveWrite: (data: unknown) => ipcRenderer.invoke('autosave:write', data),
  autosaveRead: () => ipcRenderer.invoke('autosave:read'),
  autosaveClear: () => ipcRenderer.invoke('autosave:clear'),
  openLogsFolder: () => ipcRenderer.invoke('logs:openFolder'),
  openLogFile: () => ipcRenderer.invoke('logs:openFile'),
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),
  openStudio: (projectDir: string) => ipcRenderer.invoke('studio:open', projectDir),
  stopStudio: () => ipcRenderer.invoke('studio:stop'),
  claude: {
    detect: () => ipcRenderer.invoke('claude:detect'),
    connectDesktop: () => ipcRenderer.invoke('claude:connectDesktop'),
    connectCode: () => ipcRenderer.invoke('claude:connectCode'),
    getManualConfig: () => ipcRenderer.invoke('claude:getManualConfig'),
  },
} satisfies SubforgeApi)
