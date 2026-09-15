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

export type ExportPresetResult =
  | { filePath: string; fontStatus: 'embedded' | 'bundled' | 'missing' | 'system' | 'none' }
  | { error: string }

export type ImportPresetResult =
  | { name: string; fontStatus: 'embedded' | 'bundled' | 'missing' | 'none' }
  | { error: string }

/** What the library's Import… picker opens: both (macOS only), files, or folders. */
export type ImportPickMode = 'any' | 'files' | 'folder'

/** One path the Import… picker returned, stat'ed by the main process. */
export interface PickedImportEntry {
  path: string
  kind: 'file' | 'directory'
}

export interface SubforgeApi {
  /** Electron 32+ replacement for File.path (sync). */
  getPathForFile: (file: File) => string
  pickAudioFile: () => Promise<string | null>
  /** Subscribe to "open this media file" pushes from the main process (a second
   *  launch with a media argument, or macOS `open-file`). Returns an unsubscribe fn. */
  onOpenPath: (cb: (filePath: string) => void) => () => void
  pickOutputDir: () => Promise<string | null>
  pickImageFile: () => Promise<string | null>
  getBackendPort: () => Promise<number>
  getLocalToken: () => Promise<string>
  saveFont: (fileName: string, data: ArrayBuffer) => Promise<string>
  listFonts: () => Promise<FontInfo[]>
  listBundledFonts: () => Promise<FontInfo[]>
  deleteFont: (fontPath: string) => Promise<boolean>
  readFont: (fontPath: string) => Promise<ArrayBuffer>
  listPresets: () => Promise<string[]>
  loadPreset: (name: string) => Promise<PresetSettings | null>
  savePreset: (name: string, settings: PresetSettings) => Promise<void>
  deletePreset: (name: string) => Promise<void>
  exportPreset: (name: string) => Promise<ExportPresetResult | null>
  importPreset: () => Promise<ImportPresetResult | null>
  saveProject: (projectData: unknown) => Promise<string | null>
  openProject: () => Promise<unknown | null>
  getState: <T>(key: string, fallback: T) => Promise<T>
  setState: (key: string, value: unknown) => Promise<void>
  autosaveWrite: (data: unknown) => Promise<void>
  autosaveRead: () => Promise<unknown | null>
  autosaveClear: () => Promise<void>
  /** v3 library (docs/plans/library-home-screen.md): the record folder to Trash — the main
   *  process refuses any path not strictly under `<CAPFORGE_HOME>/library/`. */
  trashLibraryFolder: (folderPath: string) => Promise<void>
  /** Open `<CAPFORGE_HOME>/library` in the file manager (created if missing). */
  revealLibraryFolder: () => Promise<void>
  /** Folder picker for the library's folder import and watch folder; null when cancelled. */
  pickLibraryFolder: () => Promise<string | null>
  /** The library's Import… picker; resolves to the stat'ed picks, [] when cancelled. */
  pickImport: (mode: ImportPickMode) => Promise<PickedImportEntry[]>
  /** "Save cover…": copy `<library>/<videoId>/thumbnails/<name>` (resolved and guarded in
   *  main) to a file the user picks; `title` only names it. Null when cancelled. */
  saveLibraryFrame: (videoId: string, name: string, title: string) => Promise<string | null>
  /** Multi-select `.capforge` picker; resolves to the chosen paths (empty when cancelled). */
  openProjectFiles: () => Promise<string[]>
  openLogsFolder: () => Promise<void>
  openLogFile: () => Promise<void>
  showInFolder: (filePath: string) => Promise<void>
  openStudio: (projectDir: string) => Promise<{ url?: string; error?: string }>
  stopStudio: () => Promise<boolean>
  claude: ClaudeConnectApi
  skills: SkillsApi
  hyperframes: HyperframesApi
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

/**
 * Bundled Claude skills (`mcp_server/skills/<name>/`).
 *
 * CapForge keeps an editable *user copy* per skill under `~/.capforge/skills/`;
 * installing copies that (never the bundle) into `~/.claude/skills/`, so a
 * newer bundled version never silently overwrites the user's edits.
 */
export interface SkillSummary {
  name: string
  description: string
  /** State of `~/.claude/skills/<name>/` relative to the user copy. */
  installStatus: 'not-installed' | 'up-to-date' | 'outdated'
  /** The shipped skill changed since the user copy was seeded/acknowledged. */
  bundleChanged: boolean
  userDir: string
  installDir: string
}

export interface SkillDetail extends SkillSummary {
  /** The user copy's SKILL.md — what the editor edits and what installs. */
  text: string
  /** The bundled SKILL.md, for an "Open both" comparison. */
  bundledText: string
  /** Relative `.md` paths in the user copy, SKILL.md first. */
  files: string[]
}

export type SkillInstallResult =
  | { ok: true; path: string; status: 'installed' | 'updated' | 'up-to-date' }
  | { ok: false; reason: 'write-failed' | 'unknown-skill'; detail?: string }

export interface SkillsApi {
  list: () => Promise<SkillSummary[]>
  read: (name: string) => Promise<SkillDetail>
  write: (name: string, text: string) => Promise<SkillDetail>
  reset: (name: string) => Promise<SkillDetail>
  /** "Keep mine": clear `bundleChanged` without touching the user's text. */
  acknowledgeBundle: (name: string) => Promise<SkillDetail>
  install: (name: string) => Promise<SkillInstallResult>
  reveal: (name: string) => Promise<void>
}

interface HyperframesStatus {
  /** Managed Node runtime is installed. */
  nodeReady: boolean
  /** The pinned hyperframes CLI is installed into the managed Node. */
  hyperframesReady: boolean
}

interface HyperframesProvisionProgress {
  stage: string
  message: string
}

interface HyperframesApi {
  status: () => Promise<HyperframesStatus>
  provision: () => Promise<{ ok: boolean; error?: string }>
  /** Subscribe to provisioning progress; returns an unsubscribe fn. */
  onProvisionProgress: (cb: (p: HyperframesProvisionProgress) => void) => () => void
}

declare global {
  interface Window {
    subforge: SubforgeApi
  }
}

contextBridge.exposeInMainWorld('subforge', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  pickAudioFile: () => ipcRenderer.invoke('dialog:openFile'),
  onOpenPath: (cb: (filePath: string) => void) => {
    const listener = (_e: unknown, filePath: string) => cb(filePath)
    ipcRenderer.on('file:open-path', listener)
    return () => ipcRenderer.removeListener('file:open-path', listener)
  },
  pickOutputDir: () => ipcRenderer.invoke('dialog:openDir'),
  pickImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),
  getBackendPort: () => ipcRenderer.invoke('backend:port'),
  getLocalToken: () => ipcRenderer.invoke('backend:local-token'),
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
  exportPreset: (name: string) => ipcRenderer.invoke('presets:export', name),
  importPreset: () => ipcRenderer.invoke('presets:import'),
  saveProject: (projectData: unknown) => ipcRenderer.invoke('project:save', projectData),
  openProject: () => ipcRenderer.invoke('project:open'),
  getState: <T>(key: string, fallback: T) => ipcRenderer.invoke('state:get', key, fallback),
  setState: (key: string, value: unknown) => ipcRenderer.invoke('state:set', key, value),
  autosaveWrite: (data: unknown) => ipcRenderer.invoke('autosave:write', data),
  autosaveRead: () => ipcRenderer.invoke('autosave:read'),
  autosaveClear: () => ipcRenderer.invoke('autosave:clear'),
  trashLibraryFolder: (folderPath: string) =>
    ipcRenderer.invoke('library:trash-folder', folderPath),
  revealLibraryFolder: () => ipcRenderer.invoke('library:reveal'),
  pickLibraryFolder: () => ipcRenderer.invoke('library:pick-folder'),
  pickImport: (mode: ImportPickMode) => ipcRenderer.invoke('library:pick-import', mode),
  saveLibraryFrame: (videoId: string, name: string, title: string) =>
    ipcRenderer.invoke('library:save-frame', videoId, name, title),
  openProjectFiles: () => ipcRenderer.invoke('dialog:open-projects'),
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
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    read: (name: string) => ipcRenderer.invoke('skills:read', name),
    write: (name: string, text: string) => ipcRenderer.invoke('skills:write', name, text),
    reset: (name: string) => ipcRenderer.invoke('skills:reset', name),
    acknowledgeBundle: (name: string) => ipcRenderer.invoke('skills:acknowledgeBundle', name),
    install: (name: string) => ipcRenderer.invoke('skills:install', name),
    reveal: (name: string) => ipcRenderer.invoke('skills:reveal', name),
  },
  hyperframes: {
    status: () => ipcRenderer.invoke('hyperframes:status'),
    provision: () => ipcRenderer.invoke('hyperframes:provision'),
    onProvisionProgress: (cb: (p: HyperframesProvisionProgress) => void) => {
      const listener = (_e: unknown, p: HyperframesProvisionProgress) => cb(p)
      ipcRenderer.on('hyperframes:provision-progress', listener)
      return () => ipcRenderer.removeListener('hyperframes:provision-progress', listener)
    },
  },
} satisfies SubforgeApi)
