/**
 * App's project composition — the pure half of the track store.
 *
 * `App` no longer gathers a project out of the editor: it composes the file
 * from the store with these three helpers plus `projectFileFromTracks`. What is
 * pinned here is that the composition still writes the v1 keys exactly as the
 * shipped `gather()` did (so a single-track project is byte-compatible), and
 * that opening what it wrote reproduces the same store.
 *
 * The hook itself owns nothing but `useState`/`useMemo` wiring; the vitest node
 * environment cannot exercise that, so the logic lives in these helpers.
 */

import { describe, expect, test } from 'vitest'
import {
  migrateProjectFile,
  projectFileFromTracks,
  tracksFromProjectFile,
} from '../lib/project'
import { SOURCE_TRACK_ID, createTrackFromSource } from '../lib/tracks'
import { buildStudioGroups } from '../lib/groups'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { sourceSegment, sourceWords } from '../lib/trackFixtures.testutil'
import type { TranscriptionResult } from '../types/app'
import { emptySourceTrack, projectMetaFor, sourceTrackFromResult } from './useTrackStore'

/** A transcription straight off the backend: no word ids yet. */
function freshResult(): TranscriptionResult {
  const words = sourceWords().map(({ wid: _minted, ...w }) => w)
  return {
    segments: [sourceSegment(words)],
    language: 'en',
    duration: 3,
    audioPath: '/videos/clip.mp4',
  }
}

/** What App does on Save. */
function saveFile(result: TranscriptionResult, tracks: Parameters<typeof projectFileFromTracks>[1], activeId = SOURCE_TRACK_ID) {
  return projectFileFromTracks(projectMetaFor(result), tracks, activeId)
}

describe('emptySourceTrack', () => {
  test('is a single source track with the default style and nothing in it', () => {
    const track = emptySourceTrack()
    expect(track.id).toBe(SOURCE_TRACK_ID)
    expect(track.isSource).toBe(true)
    expect(track.segments).toEqual([])
    expect(track.groups).toEqual([])
    expect(track.groupsEdited).toBe(false)
    expect(track.segmentsEdited).toBe(false)
    expect(track.appliedPreset).toBeNull()
    expect(track.settings).toEqual(STUDIO_DEFAULTS)
  })
})

describe('sourceTrackFromResult', () => {
  test('mints word ids and chunks the groups the editor would have built', () => {
    const result = freshResult()
    const track = sourceTrackFromResult(result, emptySourceTrack())

    expect(track.segments[0].words.every((w) => typeof w.wid === 'string')).toBe(true)
    expect(track.groups).toEqual(
      buildStudioGroups(track.segments, STUDIO_DEFAULTS.wordsPerGroup)
    )
    expect(track.groupsEdited).toBe(false)
    expect(track.segmentsEdited).toBe(false)
  })

  test('carries the style forward and takes the language from the transcript', () => {
    const previous = {
      ...emptySourceTrack({ ...STUDIO_DEFAULTS, fontSize: 96 }),
      appliedPreset: 'Bold Yellow',
      // Stale state from the previous video — must not survive.
      groupsEdited: true,
      segmentsEdited: true,
    }
    const track = sourceTrackFromResult({ ...freshResult(), language: 'de' }, previous)

    expect(track.settings.fontSize).toBe(96)
    expect(track.appliedPreset).toBe('Bold Yellow')
    expect(track.lang).toBe('de')
    expect(track.groupsEdited).toBe(false)
    expect(track.segmentsEdited).toBe(false)
  })
})

describe('the file App saves', () => {
  test('writes the v1 keys exactly as the shipped gather() did', () => {
    const result = freshResult()
    const track = sourceTrackFromResult(result, emptySourceTrack())
    const file = saveFile(result, [track])

    expect(file.version).toBe(2)
    expect(file.suggestedName).toBe('clip.capforge')
    expect(file.selectedFilePath).toBe('/videos/clip.mp4')
    expect(file.outputDir).toBe('output')
    expect(file.transcriptionResult).toEqual({ ...result, segments: track.segments })
    expect(file.studioSettings).toBe(track.settings)
    // Untouched groups: no snapshot, exactly like before.
    expect(file.customGroupsEdited).toBe(false)
    expect(file.studioGroups).toBeNull()
    // A single-track project stores no translated tracks at all.
    expect(file.tracks).toEqual([])
    expect(file.activeTrackId).toBe(SOURCE_TRACK_ID)
  })

  test('stores the groups once boundaries or segments were edited', () => {
    const result = freshResult()
    const track = sourceTrackFromResult(result, emptySourceTrack())

    expect(saveFile(result, [{ ...track, groupsEdited: true }]).studioGroups).toEqual(track.groups)
    expect(saveFile(result, [{ ...track, segmentsEdited: true }]).studioGroups).toEqual(
      track.groups
    )
  })

  test('stores the groups for a position override without claiming an edit', () => {
    const result = freshResult()
    const track = sourceTrackFromResult(result, emptySourceTrack())
    const groups = track.groups.map((g, i) =>
      i === 0 ? { ...g, positionOverride: { position_x: 0.25 } } : g
    )
    const file = saveFile(result, [{ ...track, groups }])

    expect(file.customGroupsEdited).toBe(false)
    expect(file.studioGroups).toEqual(groups)
  })

  test('carries the alignment flag App keeps on `result`', () => {
    const result = { ...freshResult(), alignmentDegraded: true }
    const track = sourceTrackFromResult(result, emptySourceTrack())
    expect(saveFile(result, [track]).transcriptionResult.alignmentDegraded).toBe(true)
  })
})

describe('save → open → save through App’s composition', () => {
  test('a single-track project round-trips unchanged', () => {
    const result = freshResult()
    const track = sourceTrackFromResult(result, emptySourceTrack())
    const first = saveFile(result, [track])

    const reopened = tracksFromProjectFile(
      migrateProjectFile(JSON.parse(JSON.stringify(first)))
    )
    expect(reopened.activeTrackId).toBe(SOURCE_TRACK_ID)
    expect(reopened.tracks).toHaveLength(1)
    expect(reopened.tracks[0].segments).toEqual(track.segments)
    expect(reopened.tracks[0].groups).toEqual(track.groups)

    const second = saveFile(result, reopened.tracks, reopened.activeTrackId)
    expect(second).toEqual(first)
  })

  test('a translated track round-trips and reopens on its own tab', () => {
    const result = freshResult()
    const track = sourceTrackFromResult(result, emptySourceTrack())
    const polish = createTrackFromSource(track, { id: 't1', lang: 'pl' })
    const first = saveFile(result, [track, polish], 't1')

    const reopened = tracksFromProjectFile(
      migrateProjectFile(JSON.parse(JSON.stringify(first)))
    )
    expect(reopened.activeTrackId).toBe('t1')
    expect(reopened.tracks.map((t) => t.id)).toEqual([SOURCE_TRACK_ID, 't1'])
    expect(saveFile(result, reopened.tracks, reopened.activeTrackId)).toEqual(first)
  })
})
