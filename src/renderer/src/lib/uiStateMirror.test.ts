/**
 * The `PUT /api/ui-state` body — plan §E, asserted key by key.
 *
 * This is the seam between the renderer (Phase 2) and the backend/MCP tools
 * (Phases 4–5): both sides are written against this shape, so a silent rename
 * here would only surface as an agent that cannot see a track.
 */

import { describe, expect, test } from 'vitest'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { createTrackFromSource, displayGroupsFor } from './tracks'
import { classifyTrack } from './trackStaleness'
import { bakeTranslation } from './trackTiming'
import { buildSourceIndex, recordedWids } from './trackStaleness'
import { makeSourceTrack } from './trackFixtures.testutil'
import {
  IDLE_AGENT_ECHO,
  buildTrackEntries,
  buildUiStateBody,
  buildUiStateCore,
  mergeUiStateBody,
  nameSuffixFor,
  renderEditedFlag,
} from './uiStateMirror'

const BODY_KEYS = [
  'screen',
  'settings',
  'groups',
  'presets',
  'presetsDetail',
  'appliedPreset',
  'render',
  'activeTrackId',
  'agent',
  'tracks',
]

const TRACK_KEYS = [
  'id',
  'label',
  'lang',
  'isSource',
  'groupCount',
  'staleCount',
  'untranslatedCount',
  'reflowNeeded',
  'appliedPreset',
  'groups',
  'render',
]

function fixture() {
  const source = makeSourceTrack()
  const polish = createTrackFromSource(source, { id: 'tpl', lang: 'pl' })
  return { source, polish }
}

function core(track = fixture().source, screen = 'results') {
  return buildUiStateCore({
    screen,
    activeTrack: track,
    activeDisplayGroups: displayGroupsFor(track),
    builtinPresets: ['Bold Yellow'],
    userPresetNames: ['My Look'],
    agent: IDLE_AGENT_ECHO,
  })
}

describe('buildUiStateCore', () => {
  test('the seven legacy keys still describe the active track', () => {
    const { source } = fixture()
    const c = core(source)

    expect(c.screen).toBe('results')
    expect(c.settings).toBe(source.settings)
    expect(c.groups).toEqual(displayGroupsFor(source))
    expect(c.presets).toEqual(['Bold Yellow'])
    expect(c.presetsDetail).toEqual({ builtin: ['Bold Yellow'], user: ['My Look'] })
    expect(c.appliedPreset).toBeNull()
    expect(c.render.config).toBeTruthy()
  })

  test('the two additive scalars ride alongside', () => {
    const c = core()
    expect(c.activeTrackId).toBe('src')
    expect(c.agent).toEqual({
      lastCommandId: null,
      lastCommandStatus: null,
      lastCommandError: null,
    })
  })

  test('the source track sends no output_name_suffix at all', () => {
    expect(core().render.output_name_suffix).toBeUndefined()
  })

  test('a translated active track suffixes the output name', () => {
    const { polish } = fixture()
    expect(nameSuffixFor(polish)).toBe('.pl')
    expect(core(polish).render.output_name_suffix).toBe('.pl')
  })

  test('a segments-only edit still ships custom_groups', () => {
    const { source } = fixture()
    const edited = { ...source, segmentsEdited: true }
    expect(renderEditedFlag(edited)).toBe(true)
    expect(core(edited).render.custom_groups).toBeDefined()
    expect(core(source).render.custom_groups).toBeUndefined()
  })
})

describe('buildTrackEntries', () => {
  test('the source entry is compact and carries no translation fields', () => {
    const { source } = fixture()
    const [entry] = buildTrackEntries([source], source, [null])

    expect(Object.keys(entry).sort()).toEqual([...TRACK_KEYS].sort())
    expect(entry).toMatchObject({
      id: 'src',
      label: 'Original',
      lang: 'en',
      isSource: true,
      staleCount: 0,
      untranslatedCount: 0,
      reflowNeeded: false,
      appliedPreset: null,
    })
    expect(entry.groupCount).toBe(source.groups.length)
    expect(Object.keys(entry.groups[0]).sort()).toEqual(['end', 'id', 'start', 'text'])
    expect(entry.render.output_name_suffix).toBeUndefined()
  })

  test('a translated entry carries sentence/state/sourceText/previousText per group', () => {
    const { source, polish } = fixture()
    const [, entry] = buildTrackEntries(
      [source, polish],
      source,
      [null, classifyTrack(polish, source)]
    )

    expect(entry).toMatchObject({ id: 'tpl', lang: 'pl', isSource: false })
    // Every group is still a placeholder.
    expect(entry.untranslatedCount).toBe(polish.groups.length)
    expect(entry.staleCount).toBe(0)
    expect(entry.reflowNeeded).toBe(false)
    expect(entry.groups[0]).toEqual({
      id: 'tpl:0',
      start: 0,
      end: 1.5,
      text: '',
      // The agent's unit of translation: both captions of the fixture's one
      // source sentence carry index 0, so it translates them together.
      sentence: 0,
      state: 'untranslated',
      sourceText: 'the quick brown',
      previousText: null,
    })
    expect(entry.groups.map((g) => g.sentence)).toEqual([0, 0])
  })

  test('a translated track never lets the backend re-chunk the source', () => {
    const { source, polish } = fixture()
    const [, entry] = buildTrackEntries(
      [source, polish],
      source,
      [null, classifyTrack(polish, source)]
    )
    // output_name_suffix is a BODY key, a sibling of config — never inside it.
    expect(entry.render.output_name_suffix).toBe('.pl')
    expect(entry.render.config).not.toHaveProperty('output_name_suffix')
    // All-placeholder → an explicit empty custom_groups, not an absent key.
    expect(entry.render.custom_groups).toEqual([])
  })

  test('mirrored groups never carry words, even once translated', () => {
    const { source, polish } = fixture()
    const index = buildSourceIndex(source)
    const translated = {
      ...polish,
      groups: polish.groups.map((g, i) =>
        i === 0
          ? bakeTranslation(g, 'szybki brązowy lis', index, {
              allRecorded: recordedWids(polish),
              isFirstGroup: true,
            })
          : g
      ),
    }
    const [, entry] = buildTrackEntries(
      [source, translated],
      source,
      [null, classifyTrack(translated, source)]
    )

    expect(entry.groups[0].text).toBe('szybki brązowy lis')
    expect(entry.groups[0].state).toBe('clean')
    expect(entry.groups[0]).not.toHaveProperty('words')
    // The words live in the render payload only.
    expect(entry.render.custom_groups?.[0].words).toHaveLength(3)
  })
})

describe('the merged body', () => {
  test('has exactly §E’s keys', () => {
    const { source, polish } = fixture()
    const body = mergeUiStateBody(
      core(source),
      buildTrackEntries([source, polish], source, [null, classifyTrack(polish, source)])
    )
    expect(Object.keys(body).sort()).toEqual([...BODY_KEYS].sort())
    expect(body.tracks).toHaveLength(2)
  })

  test('buildUiStateBody composes the same thing in one call', () => {
    const { source, polish } = fixture()
    const tracks = [source, polish]
    const classifications = [null, classifyTrack(polish, source)]
    const oneShot = buildUiStateBody({
      screen: 'results',
      activeTrack: source,
      activeDisplayGroups: displayGroupsFor(source),
      builtinPresets: ['Bold Yellow'],
      userPresetNames: ['My Look'],
      agent: IDLE_AGENT_ECHO,
      tracks,
      sourceTrack: source,
      classifications,
    })
    const split = mergeUiStateBody(
      core(source),
      buildTrackEntries(tracks, source, classifications)
    )
    expect(oneShot).toEqual(split)
  })

  test('a single-track project mirrors one entry and the default settings', () => {
    const source = makeSourceTrack(undefined, 3, { settings: { ...STUDIO_DEFAULTS } })
    const body = mergeUiStateBody(core(source), buildTrackEntries([source], source, [null]))
    expect(body.tracks).toHaveLength(1)
    expect(body.tracks[0].isSource).toBe(true)
    expect(body.settings).toBe(source.settings)
  })
})
