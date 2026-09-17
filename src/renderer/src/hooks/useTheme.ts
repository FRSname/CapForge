/**
 * The Appearance choice — Light, Dark or System — persisted in localStorage and
 * applied as the `.light` class on <html> (all colours are CSS custom
 * properties — see globals.css). System follows the OS *live*: the hook
 * subscribes to the `prefers-color-scheme` media query for as long as that is
 * the mode, where the pre-System build only read the preference once, on the
 * very first launch, and then froze it into a stored 'light'/'dark'.
 *
 * This lived in the always-mounted SettingsPanel. The Settings *dialog* mounts
 * its panes lazily, so the theme has to be owned by the always-mounted shell
 * instead: a hook that the shell calls and passes down to the General pane.
 * A pane that only mounts when selected must never own the theme, or the app
 * would launch un-themed until the user opened Settings.
 */

import { useEffect, useState } from 'react'
import type { ThemeMode } from '../lib/themeMode'
import { parseThemeMode, resolveLightMode } from '../lib/themeMode'

/** localStorage key — unchanged from the SettingsPanel implementation. */
const THEME_KEY = 'capforge-theme'

/** The OS preference System follows. */
const LIGHT_QUERY = '(prefers-color-scheme: light)'

export interface ThemeControl {
  /** What the user picked. */
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  /** The palette `mode` resolves to right now — true is light. */
  lightMode: boolean
}

/**
 * The live OS preference, or `false` (dark) wherever there is no media-query
 * support to ask — an old preload, a test renderer, a stripped environment.
 * Never throws, because the theme applying at launch must not depend on it.
 */
function systemLightQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(LIGHT_QUERY)
}

export function useTheme(): ThemeControl {
  const [mode, storeMode] = useState<ThemeMode>(() =>
    parseThemeMode(localStorage.getItem(THEME_KEY))
  )
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    () => systemLightQuery()?.matches ?? false
  )

  /**
   * Picking System re-reads the preference on the spot — it may have moved
   * while an explicit mode was in force and nothing was subscribed. Done in the
   * setter rather than an effect: it is a consequence of the choice.
   */
  function setMode(next: ThemeMode) {
    if (next === 'system') setSystemPrefersLight(systemLightQuery()?.matches ?? false)
    storeMode(next)
  }

  // Follow the OS only while System is the mode: an explicit choice must not be
  // re-rendered by a preference it ignores.
  useEffect(() => {
    if (mode !== 'system') return
    const query = systemLightQuery()
    if (!query || typeof query.addEventListener !== 'function') return
    const handle = (e: MediaQueryListEvent) => setSystemPrefersLight(e.matches)
    query.addEventListener('change', handle)
    return () => query.removeEventListener('change', handle)
  }, [mode])

  const lightMode = resolveLightMode(mode, systemPrefersLight)

  // Apply the resolved palette on mount and whenever it changes; persist the
  // *choice*, so a System install stays System across a restart.
  useEffect(() => {
    document.documentElement.classList.toggle('light', lightMode)
    localStorage.setItem(THEME_KEY, mode)
  }, [mode, lightMode])

  return { mode, setMode, lightMode }
}
