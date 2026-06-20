import { describe, expect, test } from 'vitest'
import type { ProjectFile } from './project'
import type { EffectClip } from '../types/app'

/**
 * The .capforge file is JSON written verbatim by the main process
 * (electron/main.js `project:save`). These tests lock the persistence contract
 * for placed effects: they survive a save→load round-trip, and projects saved
 * before effects existed still load (back-compat — App restores `effects ?? []`).
 */

const logo: EffectClip = {
  id: 'fx-1',
  type: 'logo',
  start: 3.2,
  duration: 2,
  trackIndex: 1,
  anchorX: 0.82,
  anchorY: 0.2,
  variables: { src: '/abs/logo.png', width: 200 },
  createdBy: 'user',
}

function baseProject(effects?: EffectClip[]): ProjectFile {
  return {
    version: 1,
    selectedFilePath: '/clip.mp4',
    outputDir: '/out',
    transcriptionResult: { segments: [], language: 'en', audioPath: '/clip.mp4', duration: 1 },
    studioSettings: {} as ProjectFile['studioSettings'],
    customGroupsEdited: false,
    studioGroups: null,
    ...(effects ? { effects } : {}),
  }
}

describe('project file — effects persistence', () => {
  test('placed effects survive a JSON save→load round-trip', () => {
    const saved = JSON.stringify(baseProject([logo]))
    const loaded = JSON.parse(saved) as ProjectFile
    expect(loaded.effects).toEqual([logo])
  })

  test('pre-effects projects load with no effects field (back-compat)', () => {
    const loaded = JSON.parse(JSON.stringify(baseProject())) as ProjectFile
    expect(loaded.effects).toBeUndefined()
    // App restore uses `file.effects ?? []`, so this becomes an empty timeline.
    expect(loaded.effects ?? []).toEqual([])
  })

  test('an empty effects timeline round-trips as an empty array', () => {
    const loaded = JSON.parse(JSON.stringify(baseProject([]))) as ProjectFile
    expect(loaded.effects).toEqual([])
  })
})
