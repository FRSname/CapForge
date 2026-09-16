/**
 * Which one-shot prompt a start deserves. Pure: the evidence is gathered by
 * `useStartupPrompts`, the ruling is made here.
 */

import { describe, expect, test } from 'vitest'
import {
  decideStartupPrompt,
  HISTORY_KEYS,
  LAST_SEEN_VERSION_KEY,
  NO_PROMPT,
  visiblePrompt,
} from './startupPrompts'
import type { StartupEvidence, StartupPrompt } from './startupPrompts'

function evidence(over: Partial<StartupEvidence> = {}): StartupEvidence {
  return { lastSeenVersion: null, currentVersion: '2.6.0', hasHistory: false, ...over }
}

describe('decideStartupPrompt', () => {
  test('no version (an old preload with no bridge) prompts nothing', () => {
    expect(decideStartupPrompt(evidence({ currentVersion: null }))).toEqual({ kind: 'none' })
    expect(decideStartupPrompt(evidence({ currentVersion: null, hasHistory: true }))).toEqual({
      kind: 'none',
    })
  })

  test('already seen this version: nothing', () => {
    expect(decideStartupPrompt(evidence({ lastSeenVersion: '2.6.0' }))).toEqual({ kind: 'none' })
  })

  test('a fresh install gets the guide', () => {
    expect(decideStartupPrompt(evidence())).toEqual({ kind: 'guide' })
  })

  test('an existing user with no last seen version gets the current release', () => {
    expect(decideStartupPrompt(evidence({ hasHistory: true }))).toEqual({
      kind: 'whats-new',
      lastSeen: null,
    })
  })

  test('an update gets What is new since the version last seen', () => {
    expect(decideStartupPrompt(evidence({ lastSeenVersion: '2.5.0', hasHistory: true }))).toEqual({
      kind: 'whats-new',
      lastSeen: '2.5.0',
    })
  })

  test('an update is shown even without other evidence of use', () => {
    expect(decideStartupPrompt(evidence({ lastSeenVersion: '2.5.0' }))).toEqual({
      kind: 'whats-new',
      lastSeen: '2.5.0',
    })
  })

  test('a downgrade says nothing', () => {
    expect(decideStartupPrompt(evidence({ lastSeenVersion: '3.0.0', hasHistory: true }))).toEqual({
      kind: 'none',
    })
  })

  test('the keys it reads are the app-state ones', () => {
    expect(LAST_SEEN_VERSION_KEY).toBe('lastSeenVersion')
    expect(HISTORY_KEYS).toEqual(['lastInputPath', 'lastProjectPath', 'lastOutputDir'])
  })
})

describe('visiblePrompt', () => {
  const pending: StartupPrompt = { kind: 'whats-new', lastSeen: '2.5.0' }
  const forced: StartupPrompt = { kind: 'guide' }

  test('the automatic prompt waits for the library screen', () => {
    expect(visiblePrompt(null, pending, false)).toEqual(NO_PROMPT)
    expect(visiblePrompt(null, pending, true)).toEqual(pending)
  })

  test('a prompt asked for by hand ignores the screen', () => {
    expect(visiblePrompt(forced, NO_PROMPT, false)).toEqual(forced)
  })

  test('an explicit request wins over a pending one', () => {
    expect(visiblePrompt(forced, pending, true)).toEqual(forced)
  })

  test('nothing pending, nothing asked for: nothing', () => {
    expect(visiblePrompt(null, NO_PROMPT, true)).toEqual(NO_PROMPT)
  })
})
