/**
 * The Appearance choice, as pure data: Light, Dark, or System (follow the OS
 * live). `hooks/useTheme.ts` owns the storage, the media query and the `.light`
 * class; everything that can be decided without a browser lives here.
 */

/** What the user picked. `'system'` defers to the OS preference. */
export type ThemeMode = 'light' | 'dark' | 'system'

/** Every choice the Appearance control offers, in the order it shows them. */
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'] as const

/**
 * Read the persisted choice. Pre-System builds stored `'light'`/`'dark'`, which
 * still mean exactly what they meant; anything else — nothing stored on a fresh
 * install, or a value written by a build we do not know — means System, which is
 * what the old first-launch branch did by reading the OS preference once.
 */
export function parseThemeMode(stored: string | null | undefined): ThemeMode {
  return THEME_MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : 'system'
}

/** Which palette a mode resolves to: `true` is light, `false` is dark. */
export function resolveLightMode(mode: ThemeMode, systemPrefersLight: boolean): boolean {
  if (mode === 'system') return systemPrefersLight
  return mode === 'light'
}
