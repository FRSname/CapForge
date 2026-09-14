/**
 * §9.1's rule, pinned: the record is the primary owner of durable state and the
 * local file is the fallback — so the target only ever flips to `'local'` when
 * there is no record, and the fallback copy is stamped with the record it
 * belongs to without mutating the live snapshot.
 */

import { describe, expect, test } from 'vitest'
import {
  LIBRARY_FALLBACK_MESSAGE,
  openRecordPlan,
  planSnapshotWrite,
  recordCreateFailedMessage,
  withFallbackStamp,
} from './librarySession'

describe('planSnapshotWrite', () => {
  test('writes to the record whenever one is active', () => {
    expect(planSnapshotWrite({ activeVideoId: 'vid_1', rev: 3 })).toBe('record')
    expect(planSnapshotWrite({ activeVideoId: 'vid_1', rev: null })).toBe('record')
  })

  test('falls back to the local file without a record', () => {
    expect(planSnapshotWrite({ activeVideoId: null, rev: null })).toBe('local')
    expect(planSnapshotWrite({ activeVideoId: '   ', rev: 2 })).toBe('local')
  })
})

describe('withFallbackStamp', () => {
  test('stamps a copy and leaves the live snapshot alone', () => {
    const snapshot = { version: 2, transcriptionResult: { segments: [] } }

    const stamped = withFallbackStamp(snapshot, 'vid_1', 4)

    expect(stamped).toEqual({ ...snapshot, recordId: 'vid_1', rev: 4 })
    expect(stamped).not.toBe(snapshot)
    expect(snapshot).not.toHaveProperty('recordId')
  })

  test('records "no revision yet" as null rather than dropping the key', () => {
    expect(withFallbackStamp({}, 'vid_1', null)).toEqual({ recordId: 'vid_1', rev: null })
  })

  test('a non-object snapshot still produces a usable stamp', () => {
    expect(withFallbackStamp(null, 'vid_1', 1)).toEqual({ recordId: 'vid_1', rev: 1 })
  })
})

describe('openRecordPlan', () => {
  test('restores a record that has a stored session', () => {
    expect(openRecordPlan({ hasProject: true })).toBe('restore')
  })

  test('sends a record with no session to the file screen', () => {
    expect(openRecordPlan({ hasProject: false })).toBe('choose-file')
  })
})

describe('messages', () => {
  test('name the reason and say what happens next', () => {
    expect(recordCreateFailedMessage('backend not running')).toContain('backend not running')
    expect(recordCreateFailedMessage('x')).toMatch(/local copy/)
    expect(LIBRARY_FALLBACK_MESSAGE).toMatch(/local copy/)
  })
})
