import { describe, expect, test } from 'vitest'
import { NO_CLIPBOARD_MESSAGE, writeClipboard } from './clipboard'

describe('writeClipboard', () => {
  test('writes the text and reports ok', async () => {
    const written: string[] = []
    const clipboard = { writeText: async (t: string) => void written.push(t) }
    const outcome = await writeClipboard('hello', 'the title', clipboard)
    expect(outcome).toEqual({ ok: true })
    expect(written).toEqual(['hello'])
  })

  test('no clipboard at all is a named failure, not a throw', async () => {
    const outcome = await writeClipboard('hello', 'the title', undefined)
    expect(outcome).toEqual({ ok: false, message: NO_CLIPBOARD_MESSAGE })
  })

  test('a rejected write reports the error message', async () => {
    const clipboard = {
      writeText: async () => Promise.reject(new Error('Document is not focused')),
    }
    const outcome = await writeClipboard('hello', 'the title', clipboard)
    expect(outcome).toEqual({ ok: false, message: 'Document is not focused' })
  })

  test('a rejection with no message names what was being copied', async () => {
    const clipboard = { writeText: async () => Promise.reject(new Error('')) }
    const outcome = await writeClipboard('hello', 'the title', clipboard)
    expect(outcome).toEqual({ ok: false, message: 'Could not copy the title' })
  })
})
