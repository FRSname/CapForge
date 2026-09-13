/**
 * Search index for the app Settings dialog (`components/settings/SettingsDialog`).
 *
 * Deliberately pure and React-free: the dialog's category rail and its search
 * box both read from here, so there is exactly one inventory of "what lives in
 * Settings". This is the *app* settings index — the caption-style search over
 * `StudioSettings` is a different, unrelated file (`lib/settingsSearch.ts`).
 *
 * Adding a control to a pane means adding its entry here, otherwise search
 * cannot find it.
 */

export type AppSettingsCategoryId = 'general' | 'transcription' | 'claude' | 'shortcuts'

export interface AppSettingsCategory {
  id: AppSettingsCategoryId
  label: string
}

export interface AppSettingsEntry {
  category: AppSettingsCategoryId
  /** Human label, matched case-insensitively as a substring. */
  label: string
  /** Extra words a user might type instead of the label. */
  keywords: string[]
}

/** Rail order, top to bottom. */
export const APP_SETTINGS_CATEGORIES: ReadonlyArray<AppSettingsCategory> = [
  { id: 'general', label: 'General' },
  { id: 'transcription', label: 'Transcription' },
  { id: 'claude', label: 'Claude & Skills' },
  { id: 'shortcuts', label: 'Shortcuts' },
]

/** One entry per control the panes render. */
export const APP_SETTINGS_ENTRIES: ReadonlyArray<AppSettingsEntry> = [
  {
    category: 'general',
    label: 'Appearance',
    keywords: ['theme', 'dark', 'light', 'mode', 'colour', 'color'],
  },
  {
    category: 'general',
    label: 'Logs',
    keywords: ['log', 'folder', 'debug', 'diagnostics', 'troubleshoot'],
  },
  {
    category: 'transcription',
    label: 'Hardware',
    keywords: ['gpu', 'cpu', 'vram', 'device'],
  },
  {
    category: 'transcription',
    label: 'Language',
    keywords: ['locale', 'auto-detect', 'spoken'],
  },
  {
    category: 'transcription',
    label: 'Transcription Model',
    keywords: ['whisper', 'model', 'accuracy', 'download'],
  },
  {
    category: 'transcription',
    label: 'Free model memory after each job',
    keywords: ['memory', 'ram', 'unload', 'whisper'],
  },
  {
    category: 'transcription',
    label: 'Speaker Diarization',
    keywords: ['diarize', 'speakers', 'pyannote'],
  },
  {
    category: 'transcription',
    label: 'HuggingFace Token',
    keywords: ['hf', 'token', 'api key', 'pyannote'],
  },
  {
    category: 'claude',
    label: 'Connect Claude Desktop',
    keywords: ['claude', 'desktop', 'mcp', 'agent', 'ai'],
  },
  {
    category: 'claude',
    label: 'Connect Claude Code',
    keywords: ['claude', 'code', 'cli', 'mcp', 'agent', 'ai'],
  },
  {
    category: 'claude',
    label: 'Copy config manually',
    keywords: ['config', 'json', 'clipboard', 'mcp'],
  },
  {
    category: 'claude',
    label: 'Skills',
    keywords: ['skill', 'workflow', 'SKILL.md', 'install'],
  },
  {
    category: 'claude',
    label: 'Publish skill',
    keywords: ['publish', 'skill', 'youtube', 'capforge-publish'],
  },
  {
    category: 'shortcuts',
    label: 'Keyboard Shortcuts',
    keywords: ['keys', 'hotkey', 'shortcut', 'keyboard'],
  },
]

export interface AppSettingsSearchResult {
  /** Categories that have at least one match, in rail order. */
  categories: AppSettingsCategoryId[]
  /** Matching entries, in declaration order. */
  entries: AppSettingsEntry[]
}

/** All category ids in rail order — the empty-query answer. */
const ALL_CATEGORY_IDS: AppSettingsCategoryId[] = APP_SETTINGS_CATEGORIES.map((c) => c.id)

function matches(entry: AppSettingsEntry, needle: string): boolean {
  if (entry.label.toLowerCase().includes(needle)) return true
  return entry.keywords.some((k) => k.toLowerCase().includes(needle))
}

/**
 * Case-insensitive substring search over labels and keywords.
 * An empty (or whitespace-only) query means "no filter": every category, no
 * entry highlights.
 */
export function filterAppSettings(query: string): AppSettingsSearchResult {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { categories: [...ALL_CATEGORY_IDS], entries: [] }

  const entries = APP_SETTINGS_ENTRIES.filter((e) => matches(e, needle))
  const hit = new Set(entries.map((e) => e.category))
  return { categories: ALL_CATEGORY_IDS.filter((id) => hit.has(id)), entries }
}
