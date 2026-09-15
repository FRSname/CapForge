/**
 * The pure halves of `useLibraryActions` — what a failed relink *means* and
 * what a failed multi-file drop reports. The hook itself is not mounted: the vitest
 * environment is plain node, with no renderer to mount it in.
 */

import { describe, expect, test } from 'vitest'
import { RelinkRefusedError } from '../lib/libraryApi'
import { filesImportFailedMessage, locateFailedMessage, locateOutcomeOf } from './useLibraryActions'

describe('locateOutcomeOf', () => {
  test('a different-media refusal asks the card to confirm, silently', () => {
    const err = new RelinkRefusedError({ kind: 'different_media' })
    expect(locateOutcomeOf(err, '/new/b.mp4', 'Talk')).toEqual({
      outcome: { kind: 'confirm', path: '/new/b.mp4' },
      message: null,
    })
  })

  test.each([
    [{ kind: 'media_in_use', videoId: 'v2' } as const, /another video/],
    [{ kind: 'media_not_found' } as const, /could not be found/],
  ])('the %j refusal is toasted, naming the video', (refusal, pattern) => {
    const { outcome, message } = locateOutcomeOf(new RelinkRefusedError(refusal), '/p', 'Talk')
    expect(outcome).toEqual({ kind: 'failed' })
    expect(message).toContain('Talk')
    expect(message).toMatch(pattern)
  })

  test('any other error is toasted with its reason', () => {
    const { outcome, message } = locateOutcomeOf(new Error('backend down'), '/p', 'Talk')
    expect(outcome).toEqual({ kind: 'failed' })
    expect(message).toBe(locateFailedMessage('Talk', 'backend down'))
  })

  test('a forced relink never confirms again — a mismatch there is a failure', () => {
    const err = new RelinkRefusedError({ kind: 'different_media' })
    expect(locateOutcomeOf(err, '/p', 'Talk', { forced: true }).outcome).toEqual({
      kind: 'failed',
    })
  })
})

describe('filesImportFailedMessage', () => {
  test('counts the dropped files and keeps the reason', () => {
    expect(filesImportFailedMessage(3, 'backend down')).toBe(
      'Could not import 3 dropped files: backend down'
    )
    expect(filesImportFailedMessage(1, 'x')).toBe('Could not import 1 dropped file: x')
  })
})
