/**
 * Pure application of agent style commands onto StudioSettings.
 *
 * Word-emphasis (`set_word_overrides`) is handled separately because it mutates
 * group words (ResultsScreen), not settings. This module covers the two
 * settings-affecting ops so they can be unit-tested without React.
 */

import type { AgentCommand } from './api'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { BUILTIN_PRESETS, applyPreset } from './presets'

/**
 * Apply a settings command, returning a NEW StudioSettings — or `null` if the
 * command doesn't affect settings (or is invalid, e.g. an unknown preset).
 *
 * `set_settings` merges only keys that already exist on StudioSettings, so an
 * agent can't inject arbitrary fields and the allow-list stays in sync with the
 * interface automatically.
 */
export function applySettingsCommand(
  settings: StudioSettings,
  cmd: AgentCommand,
): StudioSettings | null {
  if (cmd.op === 'set_settings') {
    const patch = (cmd.payload?.patch ?? {}) as Record<string, unknown>
    const next: StudioSettings = { ...settings }
    let changed = false
    for (const [key, value] of Object.entries(patch)) {
      if (key in settings) {
        ;(next as unknown as Record<string, unknown>)[key] = value
        changed = true
      }
    }
    return changed ? next : null
  }

  if (cmd.op === 'apply_preset') {
    const name = String(cmd.payload?.name ?? '').trim().toLowerCase()
    const preset = BUILTIN_PRESETS.find((p) => p.name.toLowerCase() === name)
    return preset ? applyPreset(settings, preset.settings) : null
  }

  return null
}

/** Builtin preset names, surfaced to the agent via the UI-state mirror. */
export function builtinPresetNames(): string[] {
  return BUILTIN_PRESETS.map((p) => p.name)
}
