/**
 * Light/dark theme, persisted in localStorage and applied as the `.light`
 * class on <html> (all colours are CSS custom properties — see globals.css).
 *
 * This lived in the always-mounted SettingsPanel. The Settings *dialog* mounts
 * its panes lazily, so the theme has to be owned by the always-mounted shell
 * instead: a hook that the shell calls and passes down to the General pane.
 * A pane that only mounts when selected must never own the theme, or the app
 * would launch un-themed until the user opened Settings.
 */

import { useEffect, useState } from 'react'

/** localStorage key — unchanged from the SettingsPanel implementation. */
const THEME_KEY = 'capforge-theme'

export interface ThemeControl {
  lightMode: boolean
  setLightMode: (light: boolean) => void
}

export function useTheme(): ThemeControl {
  const [lightMode, setLightMode] = useState(() => {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light') return true
    if (stored === 'dark') return false
    // First launch: follow the OS preference
    return window.matchMedia('(prefers-color-scheme: light)').matches
  })

  // Apply theme class on mount and whenever lightMode changes
  useEffect(() => {
    document.documentElement.classList.toggle('light', lightMode)
    localStorage.setItem(THEME_KEY, lightMode ? 'light' : 'dark')
  }, [lightMode])

  return { lightMode, setLightMode }
}
