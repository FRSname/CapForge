/**
 * User-saved style presets, loaded from the Electron main process over IPC.
 *
 * Lifted out of PresetPicker so App owns the list: the UI-state mirror
 * (App.tsx) publishes the names to the MCP agent, and the agent-command
 * handler resolves `apply_preset` against them. PresetPicker still drives
 * refresh after save/delete/import — it just no longer owns the state.
 *
 * There is deliberately no new IPC channel here: `presets:list` / `presets:load`
 * already exist in both preloads. Adding one would mean editing
 * electron/preload.js AND src/preload/index.ts (a known drift trap).
 */

import { useCallback, useEffect, useState } from 'react'
import type { VanillaPreset } from '../lib/presets'

export interface UserPreset {
  name: string
  settings: VanillaPreset
}

export interface UseUserPresets {
  userPresets: UserPreset[]
  /** Re-read the preset library from disk. Call after save/delete/import. */
  refresh: () => Promise<void>
}

export function useUserPresets(): UseUserPresets {
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])

  const refresh = useCallback(async () => {
    // Guard keeps non-Electron contexts (unit tests, `dev:react`) working.
    if (!window.subforge?.listPresets) return
    try {
      const names = await window.subforge.listPresets()
      const loaded: UserPreset[] = []
      for (const n of names) {
        try {
          const s = await window.subforge.loadPreset(n)
          if (s) loaded.push({ name: n, settings: s as VanillaPreset })
        } catch {
          /* skip broken entry */
        }
      }
      setUserPresets(loaded)
    } catch {
      // Preset API unavailable — leave userPresets empty.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { userPresets, refresh }
}
