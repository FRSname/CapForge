/**
 * Pure application of agent style commands onto StudioSettings.
 *
 * Word-emphasis (`set_word_overrides`) is handled separately because it mutates
 * group words (ResultsScreen), not settings. This module covers the two
 * settings-affecting ops so they can be unit-tested without React.
 */

import type { AgentCommand } from './api'
import type { StudioSettings } from '../components/studio/StudioPanel'
import type { ToastType } from '../hooks/useToast'
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
  cmd: AgentCommand
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
    const name = String(cmd.payload?.name ?? '')
      .trim()
      .toLowerCase()
    const preset = BUILTIN_PRESETS.find((p) => p.name.toLowerCase() === name)
    return preset ? applyPreset(settings, preset.settings) : null
  }

  return null
}

/** Builtin preset names, surfaced to the agent via the UI-state mirror. */
export function builtinPresetNames(): string[] {
  return BUILTIN_PRESETS.map((p) => p.name)
}

export interface CommandToast {
  message: string
  type: ToastType
}

/**
 * Pick the toast to show after a settings-affecting agent command has been
 * applied (i.e. `applySettingsCommand` returned a non-null result). Extracted
 * from AgentLiveSync so the message selection is unit-testable without React.
 *
 * A registry HyperFrames caption style (`captionStyle` !== 'classic') is
 * invisible in the live Canvas preview — it only renders via HyperFrames
 * Studio/render — so that case gets a specific toast instead of the generic
 * "style updated" one. An empty-string `captionStyle` is treated as absent
 * (falls back to the generic message).
 */
export function toastMessageForCommand(cmd: AgentCommand): CommandToast {
  if (cmd.op === 'set_settings') {
    const patch = (cmd.payload?.patch ?? {}) as Record<string, unknown>
    const patchedStyle = patch.captionStyle
    if (typeof patchedStyle === 'string' && patchedStyle.length > 0 && patchedStyle !== 'classic') {
      return {
        message: `Caption style set to ${patchedStyle} — visible in HyperFrames Studio or render.`,
        type: 'info',
      }
    }
    return { message: 'Agent updated the style.', type: 'info' }
  }

  if (cmd.op === 'apply_preset') {
    return { message: 'Agent applied a preset.', type: 'info' }
  }

  return { message: 'Agent updated the style.', type: 'info' }
}
