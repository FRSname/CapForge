/**
 * The three agent track commands, as a pure transition over the store.
 *
 * These are the only agent writes confirmed by polling rather than by a toast,
 * so what matters as much as the happy path is that every refusal comes back as
 * a message a human (and the agent) can act on — and that a partial batch never
 * half-lands.
 */

import { describe, expect, test } from 'vitest'
import type { AgentCommand } from './api'
import {
  applyTrackCommand,
  commandIdOf,
  isTrackCommand,
  TRACK_COMMAND_OPS,
} from './trackCommands'
import { SOURCE_TRACK_ID, createTrackFromSource, type CaptionTrack } from './tracks'
import { makeSourceTrack } from './trackFixtures.testutil'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'

const source = makeSourceTrack()

const cmd = (op: string, payload: Record<string, unknown>): AgentCommand => ({ op, payload })

function withPolish(): CaptionTrack[] {
  return [source, createTrackFromSource(source, { id: 't1', lang: 'pl' })]
}

describe('isTrackCommand', () => {
  test('covers exactly the three ops', () => {
    expect(TRACK_COMMAND_OPS).toEqual(['create_track', 'set_track_text', 'reflow_track'])
    for (const op of TRACK_COMMAND_OPS) expect(isTrackCommand(op)).toBe(true)
    expect(isTrackCommand('set_settings')).toBe(false)
    expect(isTrackCommand('load_video')).toBe(false)
  })
})

describe('commandIdOf', () => {
  test('reads the id the tool minted, null when absent', () => {
    expect(commandIdOf(cmd('reflow_track', { command_id: 'c-1' }))).toBe('c-1')
    expect(commandIdOf(cmd('reflow_track', {}))).toBeNull()
  })
})

describe('create_track', () => {
  test('appends a skeleton and switches to it', () => {
    const next = applyTrackCommand([source], SOURCE_TRACK_ID, cmd('create_track', { lang: 'pl' }))

    expect(next.tracks).toHaveLength(2)
    expect(next.activeTrackId).toBe(next.tracks[1].id)
    expect(next.tracks[1]).toMatchObject({ lang: 'pl', label: 'Polish', isSource: false })
    expect(next.tracks[1].groups).toHaveLength(source.groups.length)
    expect(next.message).toContain('Polish')
    // Nothing is mounted on a brand-new track, so no remount is asked for.
    expect(next.remountTrackId).toBeUndefined()
  })

  test('honours an agent-supplied id, label and style source', () => {
    const styled: CaptionTrack = {
      ...source,
      id: 't-style',
      isSource: false,
      settings: { ...STUDIO_DEFAULTS, fontSize: 120 },
    }
    const next = applyTrackCommand(
      [source, styled],
      SOURCE_TRACK_ID,
      cmd('create_track', { track_id: 'tpl', lang: 'pl', label: 'Polski', copy_style_from: 't-style' })
    )
    const created = next.tracks[2]
    expect(created.id).toBe('tpl')
    expect(created.label).toBe('Polski')
    expect(created.settings.fontSize).toBe(120)
  })

  test('inherits the source style (and its preset) by default', () => {
    const based: CaptionTrack = { ...source, appliedPreset: 'Bold Yellow' }
    const next = applyTrackCommand([based], SOURCE_TRACK_ID, cmd('create_track', { lang: 'pl' }))
    expect(next.tracks[1].appliedPreset).toBe('Bold Yellow')
    expect(next.tracks[1].settings).toEqual(based.settings)
  })

  test('refuses a missing, unknown or duplicate identity', () => {
    expect(() => applyTrackCommand([source], SOURCE_TRACK_ID, cmd('create_track', {}))).toThrow(
      /lang/
    )
    expect(() =>
      applyTrackCommand([source], SOURCE_TRACK_ID, cmd('create_track', { lang: 'zz' }))
    ).toThrow(/not a language code/)
    expect(() =>
      applyTrackCommand(withPolish(), SOURCE_TRACK_ID, cmd('create_track', { track_id: 't1', lang: 'de' }))
    ).toThrow(/already exists/)
    expect(() =>
      applyTrackCommand(
        [source],
        SOURCE_TRACK_ID,
        cmd('create_track', { lang: 'pl', copy_style_from: 'nope' })
      )
    ).toThrow(/No caption track/)
  })

  test('refuses a transcript that cannot be identified', () => {
    const unidentified = makeSourceTrack()
    const stripped: CaptionTrack = {
      ...unidentified,
      groups: unidentified.groups.map((g) => ({
        ...g,
        words: g.words.map(({ wid: _gone, ...w }) => w),
      })),
    }
    expect(() =>
      applyTrackCommand([stripped], SOURCE_TRACK_ID, cmd('create_track', { lang: 'pl' }))
    ).toThrow(/word id/)
  })
})

describe('set_track_text', () => {
  test('bakes the text into the group span and asks for a remount', () => {
    const tracks = withPolish()
    const next = applyTrackCommand(
      tracks,
      SOURCE_TRACK_ID,
      cmd('set_track_text', {
        track_id: 't1',
        entries: [{ group_id: 't1:0', text: 'szybki brazowy lis' }],
      })
    )
    const polish = next.tracks[1]

    expect(polish.groups[0].text).toBe('szybki brazowy lis')
    expect(polish.groups[0].words).toHaveLength(3)
    expect(polish.groups[0].start).toBe(tracks[1].groups[0].start)
    expect(polish.groups[0].end).toBe(tracks[1].groups[0].end)
    // Derived timings, not measured ones.
    expect(polish.groups[0].words.every((w) => w.timingDerived)).toBe(true)
    // The text view edits the same units — it must not still show the blank.
    expect(polish.segments[0].text).toBe('szybki brazowy lis')
    expect(next.remountTrackId).toBe('t1')
    expect(next.activeTrackId).toBe(SOURCE_TRACK_ID)
  })

  test('an unknown group id changes nothing and names the offender', () => {
    const tracks = withPolish()
    expect(() =>
      applyTrackCommand(
        tracks,
        SOURCE_TRACK_ID,
        cmd('set_track_text', {
          track_id: 't1',
          entries: [
            { group_id: 't1:0', text: 'dobrze' },
            { group_id: 't1:99', text: 'zle' },
          ],
        })
      )
    ).toThrow(/"t1:99"/)
    // All or nothing: the valid entry did not land either.
    expect(tracks[1].groups[0].text).toBe('')
  })

  test('refuses the source track and an empty batch', () => {
    const tracks = withPolish()
    expect(() =>
      applyTrackCommand(
        tracks,
        SOURCE_TRACK_ID,
        cmd('set_track_text', { track_id: SOURCE_TRACK_ID, entries: [{ group_id: 'x', text: 'y' }] })
      )
    ).toThrow(/update_words/)
    expect(() =>
      applyTrackCommand(tracks, SOURCE_TRACK_ID, cmd('set_track_text', { track_id: 't1' }))
    ).toThrow(/at least one entry/)
  })
})

describe('reflow_track', () => {
  test('rebuilds the skeleton from the source’s current grouping', () => {
    const tracks = withPolish()
    const written = applyTrackCommand(
      tracks,
      SOURCE_TRACK_ID,
      cmd('set_track_text', {
        track_id: 't1',
        entries: [{ group_id: 't1:0', text: 'szybki brazowy lis' }],
      })
    ).tracks

    // The source is re-chunked 3 → 2 words per group.
    const regrouped = makeSourceTrack(undefined, 2)
    const next = applyTrackCommand(
      [regrouped, written[1]],
      SOURCE_TRACK_ID,
      cmd('reflow_track', { track_id: 't1' })
    )
    const polish = next.tracks[1]

    expect(polish.groups).toHaveLength(regrouped.groups.length)
    // No new group matches the old wid list exactly, so the translation comes
    // back as context rather than being silently mis-attached.
    expect(polish.groups.every((g) => g.text === '')).toBe(true)
    expect(polish.groups[0].previousText).toBe('szybki brazowy lis')
    expect(polish.groups.every((g) => !tracks[1].groups.some((old) => old.id === g.id))).toBe(true)
    expect(next.remountTrackId).toBe('t1')
  })

  test('refuses the source track and an unknown id', () => {
    const tracks = withPolish()
    expect(() =>
      applyTrackCommand(tracks, SOURCE_TRACK_ID, cmd('reflow_track', { track_id: SOURCE_TRACK_ID }))
    ).toThrow(/cannot be re-flowed/)
    expect(() =>
      applyTrackCommand(tracks, SOURCE_TRACK_ID, cmd('reflow_track', { track_id: 'nope' }))
    ).toThrow(/No caption track/)
  })
})

describe('with no transcript open', () => {
  test('every command refuses rather than inventing a source', () => {
    const empty: CaptionTrack[] = [{ ...source, segments: [], groups: [] }]
    for (const op of TRACK_COMMAND_OPS) {
      expect(() =>
        applyTrackCommand(empty, SOURCE_TRACK_ID, cmd(op, { lang: 'pl', track_id: 't1' }))
      ).toThrow(/no caption groups/)
    }
  })

  test('an op this module does not own is refused loudly', () => {
    expect(() => applyTrackCommand([source], SOURCE_TRACK_ID, cmd('nope', {}))).toThrow(
      /Unknown track command/
    )
  })
})
