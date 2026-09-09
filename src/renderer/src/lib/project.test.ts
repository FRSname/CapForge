import { describe, expect, test } from 'vitest'
import {
  PROJECT_VERSION,
  ProjectFileError,
  ProjectVersionError,
  migrateProjectFile,
  projectFileFromTracks,
  suggestProjectName,
  tracksFromProjectFile,
  type ProjectFile,
} from './project'
import { SOURCE_TRACK_ID, createTrackFromSource, type CaptionTrack } from './tracks'
import { bakeTranslation } from './trackTiming'
import { buildSourceIndex } from './trackStaleness'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { makeSourceTrack, sourceSegment, sourceWords, word } from './trackFixtures.testutil'
import type { TranscriptionResult } from '../types/app'

const source = makeSourceTrack()

const RESULT: TranscriptionResult = {
  segments: source.segments,
  language: 'en',
  duration: 3,
  audioPath: '/videos/clip.mp4',
}

/** A v1 file exactly as the shipped build writes it. */
function v1File(patch: Partial<ProjectFile> = {}): ProjectFile {
  return {
    version: 1,
    suggestedName: 'clip.capforge',
    selectedFilePath: '/videos/clip.mp4',
    outputDir: 'output',
    transcriptionResult: RESULT,
    studioSettings: STUDIO_DEFAULTS,
    customGroupsEdited: false,
    studioGroups: null,
    ...patch,
  }
}

function makePolish(src: CaptionTrack = source): CaptionTrack {
  const track = createTrackFromSource(src, { id: 't1', lang: 'pl' })
  const idx = buildSourceIndex(src)
  const texts = ['jeden dwa trzy', 'cztery piec szesc']
  const groups = track.groups.map((g, i) => bakeTranslation(g, texts[i], idx))
  return { ...track, groups, segments: groups.map((g) => ({ ...g })) }
}

// ── migrateProjectFile ───────────────────────────────────────────

describe('migrateProjectFile', () => {
  test('lifts a v1 file to v2 with an empty track list', () => {
    const migrated = migrateProjectFile(v1File())
    expect(migrated.version).toBe(2)
    expect(PROJECT_VERSION).toBe(2)
    expect(migrated.tracks).toEqual([])
    expect(migrated.activeTrackId).toBeUndefined()
  })

  test('keeps every v1 key with its v1 meaning', () => {
    const file = v1File({ customGroupsEdited: true, studioGroups: source.groups })
    const migrated = migrateProjectFile(file)
    expect(migrated.selectedFilePath).toBe('/videos/clip.mp4')
    expect(migrated.outputDir).toBe('output')
    expect(migrated.suggestedName).toBe('clip.capforge')
    expect(migrated.customGroupsEdited).toBe(true)
    expect(migrated.studioGroups).toEqual(source.groups)
    expect(migrated.transcriptionResult).toEqual(RESULT)
    expect(migrated.studioSettings).toEqual(STUDIO_DEFAULTS)
  })

  test('a file with no version at all is read as v1', () => {
    const { version: _v, ...noVersion } = v1File()
    expect(migrateProjectFile(noVersion).version).toBe(2)
  })

  test('refuses a file from a newer build with a typed error', () => {
    expect(() => migrateProjectFile(v1File({ version: 3 }))).toThrow(ProjectVersionError)
    try {
      migrateProjectFile(v1File({ version: 3 }))
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectVersionError)
      expect((err as ProjectVersionError).version).toBe(3)
      expect((err as Error).message).toMatch(/newer version/i)
    }
  })

  test('rejects anything that is not a project file', () => {
    expect(() => migrateProjectFile(null)).toThrow(ProjectFileError)
    expect(() => migrateProjectFile('{}')).toThrow(ProjectFileError)
    expect(() => migrateProjectFile({ version: 1 })).toThrow(ProjectFileError)
    expect(() => migrateProjectFile({ ...v1File(), transcriptionResult: { segments: 'no' } })).toThrow(
      ProjectFileError
    )
    expect(() => migrateProjectFile({ ...v1File(), studioSettings: 7 })).toThrow(ProjectFileError)
  })

  test('rejects a malformed track rather than silently dropping it', () => {
    const file = { ...v1File({ version: 2 }), tracks: [{ id: 't1' }] }
    expect(() => migrateProjectFile(file)).toThrow(ProjectFileError)
  })

  test('passes a well-formed v2 file through, keeping its tracks', () => {
    const built = projectFileFromTracks({ result: RESULT }, [source, makePolish()], 't1')
    const migrated = migrateProjectFile(JSON.parse(JSON.stringify(built)))
    expect(migrated.tracks).toHaveLength(1)
    expect(migrated.tracks![0].lang).toBe('pl')
    expect(migrated.activeTrackId).toBe('t1')
  })

  test('drops an activeTrackId that names no track in the file', () => {
    const built = projectFileFromTracks({ result: RESULT }, [source, makePolish()], 't1')
    const migrated = migrateProjectFile({ ...built, activeTrackId: 'gone' })
    expect(migrated.activeTrackId).toBeUndefined()
  })

  test('does not mutate the raw object it was given', () => {
    const raw = v1File()
    const before = JSON.stringify(raw)
    migrateProjectFile(raw)
    expect(JSON.stringify(raw)).toBe(before)
  })
})

// ── tracksFromProjectFile ────────────────────────────────────────

describe('tracksFromProjectFile', () => {
  test('a v1 file yields exactly one source track, active', () => {
    const { tracks, activeTrackId } = tracksFromProjectFile(migrateProjectFile(v1File()))
    expect(tracks).toHaveLength(1)
    expect(activeTrackId).toBe(SOURCE_TRACK_ID)
    expect(tracks[0].isSource).toBe(true)
    expect(tracks[0].groupsEdited).toBe(false)
    expect(tracks[0].groups.map((g) => g.text)).toEqual(['the quick brown', 'fox jumps over'])
  })

  test('mints word ids for a project saved before they existed', () => {
    const anonymous = sourceWords().map(({ wid: _drop, ...w }) => w)
    const file = migrateProjectFile(
      v1File({
        transcriptionResult: { ...RESULT, segments: [sourceSegment(anonymous)] },
        customGroupsEdited: true,
        studioGroups: [
          {
            id: 'g0',
            start: 0,
            end: 1.5,
            text: 'the quick brown',
            words: anonymous.slice(0, 3),
          },
        ],
      })
    )
    const { tracks } = tracksFromProjectFile(file)
    const segmentIds = tracks[0].segments[0].words.map((w) => w.wid)
    expect(segmentIds.every(Boolean)).toBe(true)
    // adoptWordIds: the restored group must share the segments' ids, or the
    // first reconcile would throw the manual grouping away.
    expect(tracks[0].groups[0].words.map((w) => w.wid)).toEqual(segmentIds.slice(0, 3))
  })

  test('retrofits the endEdited claim onto a legacy hand-placed end', () => {
    const file = migrateProjectFile(
      v1File({
        customGroupsEdited: true,
        studioGroups: [{ ...source.groups[0], end: 2.4 }, source.groups[1]],
      })
    )
    const { tracks } = tracksFromProjectFile(file)
    expect(tracks[0].groups[0].endEdited).toBe(true)
    expect(tracks[0].groups[1].endEdited).toBeUndefined()
  })

  test('groups saved only for a position override do not flip groupsEdited', () => {
    const file = migrateProjectFile(
      v1File({
        customGroupsEdited: false,
        studioGroups: [
          { ...source.groups[0], positionOverride: { position_y: 0.2 } },
          source.groups[1],
        ],
      })
    )
    const { tracks } = tracksFromProjectFile(file)
    expect(tracks[0].groupsEdited).toBe(false)
    expect(tracks[0].groups[0].positionOverride).toEqual({ position_y: 0.2 })
  })

  test('merges settings over the defaults and sanitizes them', () => {
    const partial = { ...STUDIO_DEFAULTS, shadowOpacity: 90 } as Record<string, unknown>
    delete partial.maxWidth
    const file = migrateProjectFile(
      v1File({ studioSettings: partial as unknown as typeof STUDIO_DEFAULTS })
    )
    const { tracks } = tracksFromProjectFile(file)
    expect(tracks[0].settings.maxWidth).toBe(STUDIO_DEFAULTS.maxWidth)
    expect(tracks[0].settings.shadowOpacity).toBe(0.9)
  })

  test('restores translated tracks with their own groups and style', () => {
    const polish = makePolish()
    const built = projectFileFromTracks({ result: RESULT }, [source, polish], 't1')
    const { tracks, activeTrackId } = tracksFromProjectFile(migrateProjectFile(built))
    expect(tracks).toHaveLength(2)
    expect(activeTrackId).toBe('t1')
    expect(tracks[1].isSource).toBe(false)
    expect(tracks[1].groupsEdited).toBe(true)
    expect(tracks[1].groups.map((g) => g.text)).toEqual(polish.groups.map((g) => g.text))
    expect(tracks[1].groups[0].sourceWords).toEqual(polish.groups[0].sourceWords)
    expect(tracks[1].sourceSnapshot).toEqual(polish.sourceSnapshot)
  })

  test('falls back to the source track when activeTrackId is absent', () => {
    const built = projectFileFromTracks({ result: RESULT }, [source, makePolish()], 't1')
    const { activeTrackId } = tracksFromProjectFile({ ...built, activeTrackId: undefined })
    expect(activeTrackId).toBe(SOURCE_TRACK_ID)
  })
})

// ── projectFileFromTracks ────────────────────────────────────────

describe('projectFileFromTracks', () => {
  test('the v1 keys describe the source track', () => {
    const edited: CaptionTrack = { ...source, groupsEdited: true }
    const file = projectFileFromTracks({ result: RESULT }, [edited], SOURCE_TRACK_ID)
    expect(file.version).toBe(2)
    expect(file.transcriptionResult.segments).toBe(edited.segments)
    expect(file.studioSettings).toBe(edited.settings)
    expect(file.customGroupsEdited).toBe(true)
    expect(file.studioGroups).toBe(edited.groups)
    expect(file.selectedFilePath).toBe('/videos/clip.mp4')
    expect(file.suggestedName).toBe(suggestProjectName('/videos/clip.mp4'))
    expect(file.outputDir).toBe('output')
  })

  test('an untouched source saves no groups snapshot (v1 behaviour)', () => {
    const file = projectFileFromTracks({ result: RESULT }, [source], SOURCE_TRACK_ID)
    expect(file.studioGroups).toBeNull()
    expect(file.customGroupsEdited).toBe(false)
  })

  test('a segments-only edit still counts as edited, exactly like gather()', () => {
    const file = projectFileFromTracks(
      { result: RESULT },
      [{ ...source, segmentsEdited: true }],
      SOURCE_TRACK_ID
    )
    expect(file.customGroupsEdited).toBe(true)
    expect(file.studioGroups).not.toBeNull()
  })

  test('position overrides alone still save the groups', () => {
    const withOverride: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], positionOverride: { position_x: 0.3 } }, source.groups[1]],
    }
    const file = projectFileFromTracks({ result: RESULT }, [withOverride], SOURCE_TRACK_ID)
    expect(file.customGroupsEdited).toBe(false)
    expect(file.studioGroups).not.toBeNull()
  })

  test('only translated tracks go in `tracks`', () => {
    const file = projectFileFromTracks({ result: RESULT }, [source, makePolish()], 't1')
    expect(file.tracks).toHaveLength(1)
    expect(file.tracks![0].id).toBe('t1')
    expect(file.activeTrackId).toBe('t1')
  })

  test('refuses a track list with no source track', () => {
    expect(() => projectFileFromTracks({ result: RESULT }, [makePolish()], 't1')).toThrow(
      ProjectFileError
    )
  })
})

// ── round trip ───────────────────────────────────────────────────

describe('project v2 round trip', () => {
  test('tracks → file → JSON → file → tracks is lossless', () => {
    const edited: CaptionTrack = { ...source, groupsEdited: true }
    const polish = makePolish(edited)
    const before = [edited, polish]

    const file = projectFileFromTracks({ result: RESULT }, before, 't1')
    const reloaded = migrateProjectFile(JSON.parse(JSON.stringify(file)))
    const { tracks, activeTrackId } = tracksFromProjectFile(reloaded)

    expect(activeTrackId).toBe('t1')
    expect(tracks).toHaveLength(2)
    tracks.forEach((t, i) => {
      expect(t.id).toBe(before[i].id)
      expect(t.label).toBe(before[i].label)
      expect(t.lang).toBe(before[i].lang)
      expect(t.isSource).toBe(before[i].isSource)
      expect(t.segments).toEqual(before[i].segments)
      expect(t.groups).toEqual(before[i].groups)
      expect(t.settings).toEqual(before[i].settings)
      expect(t.appliedPreset).toBe(before[i].appliedPreset)
      expect(t.groupsEdited).toBe(before[i].groupsEdited)
      expect(t.sourceSnapshot).toEqual(before[i].sourceSnapshot)
    })
  })

  test('a v1 file opened and re-saved gains version 2 and nothing else', () => {
    const { tracks, activeTrackId } = tracksFromProjectFile(migrateProjectFile(v1File()))
    const file = projectFileFromTracks({ result: RESULT }, tracks, activeTrackId)
    expect(file.version).toBe(2)
    expect(file.tracks).toEqual([])
    expect(file.studioGroups).toBeNull()
  })

  test('a placeholder group survives the round trip with its recorded source', () => {
    const half = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    const file = projectFileFromTracks({ result: RESULT }, [source, half], 't1')
    const { tracks } = tracksFromProjectFile(migrateProjectFile(JSON.parse(JSON.stringify(file))))
    expect(tracks[1].groups[0].words).toEqual([])
    expect(tracks[1].groups[0].sourceWords).toEqual(half.groups[0].sourceWords)
  })
})

// ── suggestProjectName (pre-existing) ────────────────────────────

describe('suggestProjectName', () => {
  test('strips folder and extension', () => {
    expect(suggestProjectName('/videos/my clip.mp4')).toBe('my clip.capforge')
    expect(suggestProjectName('C:\\videos\\clip.mov')).toBe('clip.capforge')
  })

  test('falls back when there is no path', () => {
    expect(suggestProjectName(null)).toBe('project.capforge')
  })
})

// ── guard: the fixture is what the round trip assumes ────────────

test('the source fixture carries word ids on every word', () => {
  expect(source.segments[0].words.every((w) => w.wid)).toBe(true)
  expect(word('x', 0, 1).wid).toBeUndefined()
})
