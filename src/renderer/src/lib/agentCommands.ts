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
import type { UserPreset } from '../hooks/useUserPresets'
import { BUILTIN_PRESETS, applyPreset, type VanillaPreset } from './presets'
import { isNumericSetting, sanitizeSettingValue } from './settingsSanitize'

/** A preset matched by name, carrying its canonical (as-saved) spelling. */
export interface ResolvedPreset {
  name: string
  settings: VanillaPreset
  source: 'user' | 'builtin'
}

/**
 * Match a preset name against the user library first, then the built-ins.
 *
 * User-first is deliberate: a user preset may share a name with a built-in
 * (PresetPicker shows both), and the user's own definition should win.
 * Matching is case-insensitive and trimmed so an agent doesn't have to
 * reproduce exact capitalisation, but the returned `name` is the canonical
 * spelling — that is what the UI-state mirror publishes as `appliedPreset`
 * and what the MCP `apply_preset` tool compares against to confirm the apply.
 */
export function resolvePreset(
  rawName: unknown,
  userPresets: readonly UserPreset[] = []
): ResolvedPreset | null {
  const name = String(rawName ?? '')
    .trim()
    .toLowerCase()
  if (!name) return null

  const user = userPresets.find((p) => p.name.trim().toLowerCase() === name)
  if (user) return { name: user.name, settings: user.settings, source: 'user' }

  const builtin = BUILTIN_PRESETS.find((p) => p.name.trim().toLowerCase() === name)
  if (builtin) return { name: builtin.name, settings: builtin.settings, source: 'builtin' }

  return null
}

/**
 * Apply a settings command, returning a NEW StudioSettings — or `null` if the
 * command doesn't affect settings (or is invalid, e.g. an unknown preset).
 *
 * `set_settings` merges only keys that already exist on StudioSettings, so an
 * agent can't inject arbitrary fields and the allow-list stays in sync with the
 * interface automatically. Numeric keys additionally go through
 * `sanitizeSettingValue` — an agent writing a value the backend's schema
 * rejects (most often a 0–100 percentage into a 0–1 fraction field like
 * `shadowOpacity`) would otherwise poison the mirrored render config and every
 * later render with it.
 *
 * `userPresets` is optional so existing callers/tests that only care about
 * built-ins keep working; pass the live library to make user presets reachable.
 */
export function applySettingsCommand(
  settings: StudioSettings,
  cmd: AgentCommand,
  userPresets: readonly UserPreset[] = []
): StudioSettings | null {
  if (cmd.op === 'set_settings') {
    const patch = (cmd.payload?.patch ?? {}) as Record<string, unknown>
    const next: StudioSettings = { ...settings }
    let changed = false
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in settings)) continue
      if (isNumericSetting(key)) {
        // Unusable as a number (null, "abc", NaN) — drop the key so the current
        // valid value survives instead of writing something unrenderable.
        const clean = sanitizeSettingValue(key, value)
        if (clean == null) continue
        ;(next as unknown as Record<string, unknown>)[key] = clean
      } else {
        ;(next as unknown as Record<string, unknown>)[key] = value
      }
      changed = true
    }
    return changed ? next : null
  }

  if (cmd.op === 'apply_preset') {
    const preset = resolvePreset(cmd.payload?.name, userPresets)
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
export function toastMessageForCommand(
  cmd: AgentCommand,
  appliedPresetName?: string
): CommandToast {
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
    return {
      message: appliedPresetName
        ? `Agent applied the "${appliedPresetName}" preset.`
        : 'Agent applied a preset.',
      type: 'info',
    }
  }

  return { message: 'Agent updated the style.', type: 'info' }
}
