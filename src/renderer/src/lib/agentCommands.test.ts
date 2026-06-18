import { describe, it, expect } from 'vitest'
import { applySettingsCommand, builtinPresetNames } from './agentCommands'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'

describe('applySettingsCommand', () => {
  it('merges known keys for set_settings', () => {
    const next = applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'set_settings',
      payload: { patch: { fontSize: 99 } },
    })
    expect(next?.fontSize).toBe(99)
  })

  it('ignores unknown keys but applies known ones in the same patch', () => {
    const next = applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'set_settings',
      payload: { patch: { bogusKey: 1, fontSize: 50 } },
    })
    expect(next?.fontSize).toBe(50)
    expect((next as unknown as Record<string, unknown>).bogusKey).toBeUndefined()
  })

  it('returns null when the patch has no known keys', () => {
    expect(
      applySettingsCommand(STUDIO_DEFAULTS, { op: 'set_settings', payload: { patch: { nope: 1 } } })
    ).toBeNull()
  })

  it('does not mutate the input settings', () => {
    const before = STUDIO_DEFAULTS.fontSize
    applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'set_settings',
      payload: { patch: { fontSize: 123 } },
    })
    expect(STUDIO_DEFAULTS.fontSize).toBe(before)
  })

  it('applies a builtin preset by name (case-insensitive)', () => {
    const next = applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'apply_preset',
      payload: { name: 'tiktok pop' },
    })
    expect(next).not.toBeNull()
    expect(next).not.toEqual(STUDIO_DEFAULTS)
  })

  it('returns null for an unknown preset', () => {
    expect(
      applySettingsCommand(STUDIO_DEFAULTS, {
        op: 'apply_preset',
        payload: { name: 'no-such-preset' },
      })
    ).toBeNull()
  })

  it('returns null for a non-settings op', () => {
    expect(
      applySettingsCommand(STUDIO_DEFAULTS, { op: 'set_word_overrides', payload: {} })
    ).toBeNull()
  })
})

describe('builtinPresetNames', () => {
  it('lists the built-in presets', () => {
    const names = builtinPresetNames()
    expect(names).toContain('TikTok Pop')
    expect(names.length).toBeGreaterThan(3)
  })
})
