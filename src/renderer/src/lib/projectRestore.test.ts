/**
 * `planProjectRestore` — the pure half of opening a project.
 *
 * The point of the split is that two entry points (a library card, the agent's
 * open path) must install the SAME store, so the plan is asserted to be exactly
 * what `tracksFromProjectFile(migrateProjectFile(raw))` produces, plus the
 * snake_case body the backend needs.
 */

import { describe, expect, test } from 'vitest'
import {
  backendUpdateFailedMessage,
  planProjectRestore,
  restoreErrorMessage,
} from './projectRestore'
import {
  ProjectFileError,
  ProjectVersionError,
  migrateProjectFile,
  projectFileFromTracks,
  tracksFromProjectFile,
} from './project'
import { makeSourceTrack, makeTranslatedTrack } from './trackFixtures.testutil'
import type { TranscriptionResult } from '../types/app'

const source = makeSourceTrack()
const polish = makeTranslatedTrack(source, ['jeden dwa trzy', 'cztery piec szesc'])

const RESULT: TranscriptionResult = {
  segments: source.segments,
  language: 'en',
  duration: 3,
  audioPath: '/videos/clip.mp4',
}

/** A v2 file exactly as `handleSave` writes it, round-tripped through JSON. */
function v2Raw(result: TranscriptionResult = RESULT): unknown {
  return JSON.parse(JSON.stringify(projectFileFromTracks({ result }, [source, polish], 't1')))
}

describe('planProjectRestore', () => {
  test('plans the same track store tracksFromProjectFile builds', () => {
    const raw = v2Raw()
    const plan = planProjectRestore(raw)
    const expected = tracksFromProjectFile(migrateProjectFile(raw))

    expect(plan.tracks).toEqual(expected.tracks)
    expect(plan.activeTrackId).toEqual(expected.activeTrackId)
    expect(plan.activeTrackId).toBe('t1')
    expect(plan.file.version).toBe(2)
  })

  test('builds the snake_case backend body, alignment flag defaulted to false', () => {
    const plan = planProjectRestore(v2Raw())
    expect(plan.backendResult).toEqual({
      segments: plan.file.transcriptionResult.segments,
      language: 'en',
      duration: 3,
      audio_path: '/videos/clip.mp4',
      alignment_degraded: false,
    })
  })

  test('carries a degraded alignment flag through', () => {
    const plan = planProjectRestore(v2Raw({ ...RESULT, alignmentDegraded: true }))
    expect(plan.backendResult.alignment_degraded).toBe(true)
  })

  test('rethrows the trust boundary error for garbage input', () => {
    expect(() => planProjectRestore('not a project')).toThrow(ProjectFileError)
    expect(() => planProjectRestore({ transcriptionResult: {} })).toThrow(ProjectFileError)
  })

  test('rethrows the version error for a file from a newer build', () => {
    expect(() => planProjectRestore({ ...(v2Raw() as object), version: 99 })).toThrow(
      ProjectVersionError
    )
  })
})

describe('restore messages', () => {
  test('an Error keeps its own message', () => {
    expect(restoreErrorMessage(new ProjectFileError('This project file is damaged: nope.'))).toBe(
      'This project file is damaged: nope.'
    )
  })

  test('a non-Error falls back to the generic line', () => {
    expect(restoreErrorMessage('boom')).toBe('This project file could not be opened.')
    expect(restoreErrorMessage(null)).toBe('This project file could not be opened.')
  })

  test('a failed backend update names the cause and the consequence', () => {
    expect(backendUpdateFailedMessage(new Error('offline'))).toBe(
      'Project loaded, but the backend could not be updated: offline. Rendering may fail.'
    )
    expect(backendUpdateFailedMessage(503)).toMatch(
      /could not be updated: 503\. Rendering may fail\./
    )
  })
})
