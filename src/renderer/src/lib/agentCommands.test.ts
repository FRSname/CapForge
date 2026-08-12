import { describe, it, expect } from 'vitest'
import {
  applySettingsCommand,
  builtinPresetNames,
  resolvePreset,
  toastMessageForCommand,
} from './agentCommands'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import type { UserPreset } from '../hooks/useUserPresets'
import type { VanillaPreset } from './presets'

/** A minimal user preset — enough for name resolution + a visible style delta. */
function userPreset(name: string, settings: Partial<VanillaPreset> = {}): UserPreset {
  return { name, settings: { fontSize: '77', textColor: '#ABCDEF', ...settings } as VanillaPreset }
}

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

  it('rescales a percentage an agent wrote into a 0-1 fraction field', () => {
    // StudioSettings mixes units: the agent reads bgOpacity as 0-100 and
    // writes shadowOpacity the same way. Unguarded, 90 reaches the backend
    // verbatim and Pydantic rejects it (le=1.0) — the render just fails.
    const next = applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'set_settings',
      payload: { patch: { shadowOpacity: 90 } },
    })
    expect(next?.shadowOpacity).toBe(0.9)
  })

  it('keeps percentage-unit fields on their own scale', () => {
    const next = applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'set_settings',
      payload: { patch: { bgOpacity: 90, posY: 70 } },
    })
    expect(next?.bgOpacity).toBe(90)
    expect(next?.posY).toBe(70)
  })

  it('skips an unknown readingMode instead of sending it to the backend', () => {
    // reading_mode is a Literal['wrap','rsvp'] on VideoRenderConfig: an unknown
    // mode in the mirrored config fails every later render with a 422. Nothing
    // in the patch is usable, so nothing changed — the command reports null.
    expect(
      applySettingsCommand(STUDIO_DEFAULTS, {
        op: 'set_settings',
        payload: { patch: { readingMode: 'turbo', rsvpFocusColor: 'orange' } },
      })
    ).toBeNull()
  })

  it('keeps the user in RSVP when an agent typos readingMode', () => {
    // The destructive version of this bug: resetting to the *default* would flip
    // a user who is mid-RSVP back to wrap and still report success.
    const rsvpUser = { ...STUDIO_DEFAULTS, readingMode: 'rsvp' as const }
    expect(
      applySettingsCommand(rsvpUser, {
        op: 'set_settings',
        payload: { patch: { readingMode: 'turbo' } },
      })
    ).toBeNull()
    // ...while a valid mode change still lands.
    const next = applySettingsCommand(rsvpUser, {
      op: 'set_settings',
      payload: { patch: { readingMode: 'wrap' } },
    })
    expect(next?.readingMode).toBe('wrap')
  })

  it('keeps the current rsvpFocusColor / rsvpReticle on an invalid write', () => {
    const styled = { ...STUDIO_DEFAULTS, rsvpFocusColor: '#00FF00', rsvpReticle: false }
    expect(
      applySettingsCommand(styled, {
        op: 'set_settings',
        payload: { patch: { rsvpFocusColor: 'orange', rsvpReticle: 'maybe' } },
      })
    ).toBeNull()

    const next = applySettingsCommand(styled, {
      op: 'set_settings',
      payload: { patch: { rsvpFocusColor: '#123456', rsvpReticle: true } },
    })
    expect(next?.rsvpFocusColor).toBe('#123456')
    expect(next?.rsvpReticle).toBe(true)
  })

  it('applies the good keys of a patch whose non-numeric value is invalid', () => {
    const rsvpUser = { ...STUDIO_DEFAULTS, readingMode: 'rsvp' as const }
    const next = applySettingsCommand(rsvpUser, {
      op: 'set_settings',
      payload: { patch: { readingMode: 'turbo', rsvpPivotX: 25 } },
    })
    expect(next?.readingMode).toBe('rsvp')
    expect(next?.rsvpPivotX).toBe(25)
  })

  it('applies a valid RSVP patch, honouring each field’s unit', () => {
    const next = applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'set_settings',
      payload: {
        patch: {
          readingMode: 'rsvp',
          rsvpPivotX: 40,
          rsvpFocusColor: '#123456',
          // 75 into a 0-1 fraction field is the shadowOpacity mistake again.
          rsvpContextOpacity: 75,
          // ...while 1 here is a legitimate one-second slide.
          rsvpSlideDuration: 1,
          rsvpReticle: false,
        },
      },
    })
    expect(next?.readingMode).toBe('rsvp')
    expect(next?.rsvpPivotX).toBe(40)
    expect(next?.rsvpFocusColor).toBe('#123456')
    expect(next?.rsvpContextOpacity).toBe(0.75)
    expect(next?.rsvpSlideDuration).toBe(1)
    expect(next?.rsvpReticle).toBe(false)
  })

  it('drops a numeric key whose value is not a number, keeping the current one', () => {
    const next = applySettingsCommand(STUDIO_DEFAULTS, {
      op: 'set_settings',
      payload: { patch: { fontSize: 'big', textColor: '#00FF00' } },
    })
    expect(next?.fontSize).toBe(STUDIO_DEFAULTS.fontSize)
    expect(next?.textColor).toBe('#00FF00')
  })

  it('returns null when the only known key had an unusable value', () => {
    expect(
      applySettingsCommand(STUDIO_DEFAULTS, {
        op: 'set_settings',
        payload: { patch: { fontSize: null } },
      })
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

  it('applies a user preset by name', () => {
    const next = applySettingsCommand(
      STUDIO_DEFAULTS,
      { op: 'apply_preset', payload: { name: 'My Style' } },
      [userPreset('My Style')]
    )
    expect(next?.fontSize).toBe(77)
  })

  it('prefers a user preset over a builtin of the same name', () => {
    const mine = userPreset('TikTok Pop', { fontSize: '13' })
    const next = applySettingsCommand(
      STUDIO_DEFAULTS,
      { op: 'apply_preset', payload: { name: 'TikTok Pop' } },
      [mine]
    )
    expect(next?.fontSize).toBe(13)
  })

  it('still falls back to builtins when the user library has no match', () => {
    const next = applySettingsCommand(
      STUDIO_DEFAULTS,
      { op: 'apply_preset', payload: { name: 'TikTok Pop' } },
      [userPreset('Something Else')]
    )
    expect(next).not.toBeNull()
    expect(next).not.toEqual(STUDIO_DEFAULTS)
  })
})

describe('resolvePreset', () => {
  const presets = [userPreset('My Style'), userPreset('Bold Yellow')]

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(resolvePreset('  my style  ', presets)?.name).toBe('My Style')
  })

  it('returns the canonical saved spelling, not what was asked for', () => {
    // This is what the MCP apply_preset ack compares against.
    expect(resolvePreset('BOLD YELLOW', presets)?.name).toBe('Bold Yellow')
  })

  it('reports which library a match came from', () => {
    expect(resolvePreset('My Style', presets)?.source).toBe('user')
    expect(resolvePreset('TikTok Pop', presets)?.source).toBe('builtin')
  })

  it('returns null for an unknown, empty or nullish name', () => {
    expect(resolvePreset('nope', presets)).toBeNull()
    expect(resolvePreset('   ', presets)).toBeNull()
    expect(resolvePreset(undefined, presets)).toBeNull()
    expect(resolvePreset(null, presets)).toBeNull()
  })

  it('falls back to builtins when no user library is passed', () => {
    expect(resolvePreset('Minimal White')?.source).toBe('builtin')
  })
})

describe('toastMessageForCommand', () => {
  it('returns the caption-style toast for a non-classic captionStyle patch', () => {
    const toast = toastMessageForCommand({
      op: 'set_settings',
      payload: { patch: { captionStyle: 'caption-kinetic-slam' } },
    })
    expect(toast.message).toBe(
      'Caption style set to caption-kinetic-slam — visible in HyperFrames Studio or render.'
    )
    expect(toast.type).toBe('info')
  })

  it('returns the generic style toast when captionStyle is classic', () => {
    const toast = toastMessageForCommand({
      op: 'set_settings',
      payload: { patch: { captionStyle: 'classic' } },
    })
    expect(toast.message).toBe('Agent updated the style.')
  })

  it('returns the generic style toast when the patch has no captionStyle', () => {
    const toast = toastMessageForCommand({
      op: 'set_settings',
      payload: { patch: { fontSize: 42 } },
    })
    expect(toast.message).toBe('Agent updated the style.')
  })

  it('treats an empty-string captionStyle as absent', () => {
    const toast = toastMessageForCommand({
      op: 'set_settings',
      payload: { patch: { captionStyle: '' } },
    })
    expect(toast.message).toBe('Agent updated the style.')
  })

  it('returns the preset toast for apply_preset even if the preset sets captionStyle', () => {
    const toast = toastMessageForCommand({
      op: 'apply_preset',
      payload: { name: 'tiktok pop', patch: { captionStyle: 'caption-kinetic-slam' } },
    })
    expect(toast.message).toBe('Agent applied a preset.')
  })

  it('names the preset when the resolved name is known', () => {
    const toast = toastMessageForCommand(
      { op: 'apply_preset', payload: { name: 'my style' } },
      'My Style'
    )
    expect(toast.message).toBe('Agent applied the "My Style" preset.')
  })
})

describe('builtinPresetNames', () => {
  it('lists the built-in presets', () => {
    const names = builtinPresetNames()
    expect(names).toContain('TikTok Pop')
    expect(names.length).toBeGreaterThan(3)
  })
})
