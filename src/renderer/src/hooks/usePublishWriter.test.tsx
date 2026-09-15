/**
 * The Publish writer against a mocked `fetch` — the load-bearing rule of the
 * Thumbnail editor: **`thumbnail.candidates` on the wire always comes from the
 * latest record at send time**, never from the draft. The backend refuses a
 * `PATCH` whose list differs from the stored one (`candidates_managed`).
 *
 * The vitest environment is plain node, so the hook is run once through
 * `react-dom/server` and its callbacks are captured; they only read refs and
 * props, so they work after the render returns. The test plays React's part
 * by writing `stateRef.current` the way the owning hook's render would.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { api } from '../lib/api'
import { EMPTY_FIELDS } from '../lib/publishDrafts'
import type { PublishDrafts } from '../lib/publishDrafts'
import type { LocalizedMap, PublishRecord, Thumbnail } from '../lib/publishTypes'
import { EMPTY_LOCALIZED } from '../lib/publishMediaTypes'
import { PUBLISH_PATCH_DEBOUNCE_MS, usePublishWriter } from './usePublishWriter'
import type { PublishWriter, PublishWriterInput } from './usePublishWriter'

const A = `${'a'.repeat(32)}.jpg`
const B = `${'b'.repeat(32)}.jpg`
const C = `${'c'.repeat(32)}.jpg`

const ID = 'f'.repeat(32)

function record(rev: number, candidates: string[], cover: string | null = null): PublishRecord {
  return {
    ...EMPTY_FIELDS,
    id: ID,
    rev,
    duration: 600,
    status: 'captioned',
    hasProject: true,
    links: [],
    history: [],
    language: 'en',
    languages: ['en'],
    thumbnail: { ideas: [], candidates, cover },
  }
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } as unknown as Response
}

interface Harness {
  writer: PublishWriter
  state: PublishWriterInput['stateRef']
  saved: Array<{ next: PublishRecord; sent: PublishDrafts }>
  notices: string[]
}

function harness(initial: PublishRecord, drafts: PublishDrafts): Harness {
  const state = { current: { record: initial as PublishRecord | null, drafts } }
  const saved: Harness['saved'] = []
  const notices: string[] = []
  const input: PublishWriterInput = {
    stateRef: state,
    notifyRef: { current: (message) => notices.push(message) },
    onSaved: (next, sent) => {
      saved.push({ next, sent })
      state.current = { ...state.current, record: next }
    },
    // What the owning hook's re-render does with a record that arrived.
    onRecord: (next) => {
      state.current = { ...state.current, record: next }
    },
    onViolations: () => {},
    onSaving: () => {},
  }
  let writer: PublishWriter | null = null
  function Probe() {
    writer = usePublishWriter(input)
    return null
  }
  renderToStaticMarkup(<Probe />)
  if (!writer) throw new Error('the writer was not captured')
  return { writer, state, saved, notices }
}

describe('usePublishWriter — thumbnail send composition', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    api.setPort(53421)
    api.setLocalToken('t')
    api.resetBridge()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function sent(call: number): { body: Record<string, unknown>; ifMatch: string } {
    const [, init] = fetchMock.mock.calls[call] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    return { body: JSON.parse(String(init.body)), ifMatch: headers['If-Match'] }
  }

  test('candidates changed between the edit and the send: the send carries the latest list', async () => {
    vi.useFakeTimers()
    // The user picked B as the cover while the record had [A, B]…
    const draft: Thumbnail = { ideas: [], candidates: [A, B], cover: B }
    const h = harness(record(4, [A, B]), { thumbnail: draft })
    fetchMock.mockResolvedValue(response(record(6, [A, B, C], B)))
    h.writer.schedule()

    // …then a frame was grabbed before the debounce fired.
    h.state.current = { ...h.state.current, record: record(5, [A, B, C]) }
    await vi.advanceTimersByTimeAsync(PUBLISH_PATCH_DEBOUNCE_MS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { body, ifMatch } = sent(0)
    expect(body.thumbnail).toEqual({ ideas: [], candidates: [A, B, C], cover: B })
    expect(ifMatch).toBe('5')
    // What settles the draft is the draft object itself, so it is dropped on success.
    expect(h.saved[0].sent.thumbnail).toBe(draft)
  })

  test('a 409 re-send composes candidates from the record the conflict handed back', async () => {
    vi.useFakeTimers()
    const draft: Thumbnail = { ideas: [], candidates: [A], cover: A }
    const h = harness(record(4, [A]), { thumbnail: draft, title: 'Mine' })
    fetchMock
      .mockResolvedValueOnce(response({ detail: 'stale', current: record(7, [A, C]) }, 409))
      .mockResolvedValueOnce(response(record(8, [A, C], A)))

    await h.writer.flushNow()
    expect(sent(0).body.thumbnail).toEqual({ ideas: [], candidates: [A], cover: A })
    expect(h.notices).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(PUBLISH_PATCH_DEBOUNCE_MS)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const resend = sent(1)
    expect(resend.ifMatch).toBe('7')
    expect(resend.body.thumbnail).toEqual({ ideas: [], candidates: [A, C], cover: A })
    expect(resend.body.title).toBe('Mine')
  })

  test('a Revert (patchNow with a history prev) sends the current frames, not the old list', async () => {
    const h = harness(record(9, [A, B, C]), {})
    fetchMock.mockResolvedValue(response(record(10, [A, B, C])))

    await h.writer.patchNow({ thumbnail: { ideas: [], candidates: [A], cover: A } })

    expect(sent(0).body.thumbnail).toEqual({ ideas: [], candidates: [A, B, C], cover: A })
  })

  test('flushNow cancels the pending debounce and resolves once the write has landed', async () => {
    vi.useFakeTimers()
    const h = harness(record(4, [A]), { title: 'Typed' })
    fetchMock.mockResolvedValue(response(record(5, [A])))
    h.writer.schedule()

    await h.writer.flushNow()
    expect(h.saved).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(PUBLISH_PATCH_DEBOUNCE_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('flushNow with nothing outstanding sends nothing', async () => {
    const h = harness(record(4, [A]), {})
    await h.writer.flushNow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('usePublishWriter — localized send composition', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const pl = { ...EMPTY_LOCALIZED, title: 'Tytuł' }
  const de = { ...EMPTY_LOCALIZED, title: 'Titel' }

  function withLocalized(rev: number, localized: LocalizedMap): PublishRecord {
    return { ...record(rev, []), localized }
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    api.setPort(53421)
    api.setLocalToken('t')
    api.resetBridge()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function body(call: number): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[call] as [string, RequestInit]
    return JSON.parse(String(init.body))
  }

  test('an agent wrote `de` between the edit and the send: only `pl` goes out', async () => {
    vi.useFakeTimers()
    const draft: LocalizedMap = { pl: { ...pl, title: 'Mój' } }
    const h = harness(withLocalized(4, { pl }), { localized: draft })
    fetchMock.mockResolvedValue(response(withLocalized(6, { pl: draft.pl, de })))
    h.writer.schedule()

    h.state.current = { ...h.state.current, record: withLocalized(5, { pl, de }) }
    await vi.advanceTimersByTimeAsync(PUBLISH_PATCH_DEBOUNCE_MS)

    const sent = body(0).localized as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(['pl'])
    expect(sent.pl).toMatchObject({ title: 'Mój', description: null })
    expect(h.saved[0].sent.localized).toBe(draft)
  })

  test('a removal goes out as null; a language already matching is not re-sent', async () => {
    const h = harness(withLocalized(4, { pl, de }), { localized: { pl: null, de }, title: 'T' })
    fetchMock.mockResolvedValue(response(withLocalized(5, { de })))

    await h.writer.flushNow()

    expect(body(0)).toEqual({ localized: { pl: null }, title: 'T' })
  })

  test('a Revert restores the whole prev as a per-language delta', async () => {
    const h = harness(withLocalized(9, { pl, de }), {})
    fetchMock.mockResolvedValue(response(withLocalized(10, { pl })))

    await h.writer.patchNow({ localized: { pl } })

    expect(body(0)).toEqual({ localized: { de: null } })
  })
})
