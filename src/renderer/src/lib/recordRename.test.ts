/**
 * Renaming a video in place: read the rev, PATCH `{title}` with it, retry once
 * on a 409, keep a 422 under the input, and never send an empty or unchanged
 * name.
 */

import { describe, expect, test, vi } from 'vitest'
import { StaleRecordError, ValidationRefusedError } from './api'
import { BLANK_TITLE_MESSAGE, runRenameRecord, titleProblem } from './recordRename'

const VIDEO = { id: 'v1', title: 'Keynote', sourcePath: '/m/Keynote-raw.mp4' }

function deps() {
  const calls: string[] = []
  let rev = 3
  return {
    calls,
    read: vi.fn((id: string) => {
      calls.push(`read ${id}`)
      return Promise.resolve({ rev: rev++, title: 'Keynote' })
    }),
    write: vi.fn((id: string, patch: { title: string }, ifMatch: number) => {
      calls.push(`write ${id} ${JSON.stringify(patch)} @${ifMatch}`)
      return Promise.resolve({})
    }),
    refresh: vi.fn(() => {
      calls.push('refresh')
      return Promise.resolve()
    }),
    notify: vi.fn(),
  }
}

function stale(): StaleRecordError {
  return new StaleRecordError('Record changed', null)
}

describe('runRenameRecord', () => {
  test('reads the rev, PATCHes the trimmed title with If-Match, then refreshes', async () => {
    const d = deps()
    expect(await runRenameRecord(VIDEO, '  Opening keynote ', d)).toEqual({ kind: 'renamed' })
    expect(d.calls).toEqual(['read v1', 'write v1 {"title":"Opening keynote"} @3', 'refresh'])
    expect(d.notify).not.toHaveBeenCalled()
  })

  test('a 409 re-reads and retries once, with the new rev', async () => {
    const d = deps()
    d.write.mockImplementationOnce((id, patch, ifMatch) => {
      d.calls.push(`write ${id} ${JSON.stringify(patch)} @${ifMatch}`)
      return Promise.reject(stale())
    })

    expect(await runRenameRecord(VIDEO, 'Opening', d)).toEqual({ kind: 'renamed' })

    expect(d.calls).toEqual([
      'read v1',
      'write v1 {"title":"Opening"} @3',
      'read v1',
      'write v1 {"title":"Opening"} @4',
      'refresh',
    ])
  })

  test('a second 409 is toasted, not looped on', async () => {
    const d = deps()
    d.write.mockImplementation(() => Promise.reject(stale()))

    expect(await runRenameRecord(VIDEO, 'Opening', d)).toEqual({ kind: 'failed' })

    expect(d.write).toHaveBeenCalledTimes(2)
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.notify).toHaveBeenCalledWith(
      'Could not rename Keynote: the record kept changing while it was being saved — try again.'
    )
  })

  test('a 422 stays under the input with the rule’s message, and is not toasted', async () => {
    const d = deps()
    d.write.mockImplementation(() =>
      Promise.reject(
        new ValidationRefusedError('1 violation', [
          {
            field: 'title',
            rule: 'title_max_chars',
            message: 'Title is 120 characters; YouTube allows 100',
            severity: 'hard',
          },
        ])
      )
    )

    expect(await runRenameRecord(VIDEO, 'x'.repeat(120), d)).toEqual({
      kind: 'invalid',
      message: 'Title is 120 characters; YouTube allows 100',
    })
    expect(d.write).toHaveBeenCalledTimes(1)
    expect(d.notify).not.toHaveBeenCalled()
    expect(d.refresh).not.toHaveBeenCalled()
  })

  test('any other failure is toasted, naming the video', async () => {
    const d = deps()
    d.read.mockImplementation(() => Promise.reject(new Error('Failed to fetch')))
    expect(await runRenameRecord(VIDEO, 'Opening', d)).toEqual({ kind: 'failed' })
    expect(d.notify).toHaveBeenCalledWith('Could not rename Keynote: Failed to fetch')
  })

  test('an empty name is refused inline and never sent', async () => {
    const d = deps()
    expect(await runRenameRecord(VIDEO, '   ', d)).toEqual({
      kind: 'invalid',
      message: BLANK_TITLE_MESSAGE,
    })
    expect(d.calls).toEqual([])
  })

  test('an unchanged name closes without a request', async () => {
    const d = deps()
    expect(await runRenameRecord(VIDEO, ' Keynote ', d)).toEqual({ kind: 'renamed' })
    expect(d.calls).toEqual([])
  })

  test('an untitled video compares against the name it shows (its file stem)', async () => {
    const d = deps()
    const untitled = { ...VIDEO, title: '' }
    expect(await runRenameRecord(untitled, 'Keynote-raw', d)).toEqual({ kind: 'renamed' })
    expect(d.calls).toEqual([])
  })

  test('a record that already carries the name is not written again', async () => {
    const d = deps()
    d.read.mockImplementation(() => Promise.resolve({ rev: 9, title: 'Opening' }))
    expect(await runRenameRecord(VIDEO, 'Opening', d)).toEqual({ kind: 'renamed' })
    expect(d.write).not.toHaveBeenCalled()
    expect(d.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('titleProblem', () => {
  test('blank is a problem, anything else is not', () => {
    expect(titleProblem('')).toBe(BLANK_TITLE_MESSAGE)
    expect(titleProblem(' \t')).toBe(BLANK_TITLE_MESSAGE)
    expect(titleProblem('A')).toBeNull()
  })
})
