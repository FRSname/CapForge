/**
 * The collections REST client against a mocked `fetch`: every call rides
 * api.ts's authenticated transport, bodies are parsed at the boundary, and the
 * two 409 refusals surface as a typed error wherever FastAPI put the reason.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './api'
import {
  CollectionRefusedError,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  patchCollection,
} from './collectionsApi'

function jsonResponse(body: unknown, status = 200, statusText = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

const BASE = 'http://127.0.0.1:53421'
const TOKEN = 'local-token'

const COLLECTION = { id: 'uck26', name: 'UCK 26', slots: {}, overrides: {}, members: 0 }
const DETAIL = { ...COLLECTION, effective_brief: { channel: 'CapForge' } }

describe('collectionsApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    api.setPort(53421)
    api.setLocalToken(TOKEN)
    api.resetBridge()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    return { url, init }
  }

  function header(init: RequestInit, name: string): string | undefined {
    return (init.headers as Record<string, string>)[name]
  }

  test('listCollections GETs with the token and parses the envelope', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ collections: [COLLECTION], orphans: [{ id: 'old', members: 2 }] })
    )

    const list = await listCollections()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/collections`)
    expect(init.method).toBe('GET')
    expect(header(init, 'X-CapForge-Local-Token')).toBe(TOKEN)
    expect(list.collections[0].name).toBe('UCK 26')
    expect(list.orphans).toEqual([{ id: 'old', members: 2 }])
  })

  test('getCollection encodes the id and reads the effective brief', async () => {
    fetchMock.mockResolvedValue(jsonResponse(DETAIL))

    const detail = await getCollection('a b')

    expect(lastCall().url).toBe(`${BASE}/api/library/collections/a%20b`)
    expect(detail.effective_brief.channel).toBe('CapForge')
  })

  test('createCollection POSTs the body and returns the collection', async () => {
    fetchMock.mockResolvedValue(jsonResponse(COLLECTION, 201))

    const created = await createCollection({ name: 'UCK 26' })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/collections`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'UCK 26' })
    expect(created.id).toBe('uck26')
  })

  test.each([{ reason: 'collection_exists' }, { detail: { reason: 'collection_exists' } }])(
    'createCollection maps a 409 %j to CollectionRefusedError',
    async (body) => {
      fetchMock.mockResolvedValue(jsonResponse(body, 409))

      const err = await createCollection({ id: 'uck26', name: 'x' }).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(CollectionRefusedError)
      expect((err as CollectionRefusedError).refusal).toEqual({ kind: 'collection_exists' })
    }
  )

  test('createCollection surfaces a 422 detail as the message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Slot name "footer" is built in' }, 422))
    await expect(createCollection({ name: 'x', slots: { footer: 'a' } })).rejects.toThrow(
      'Slot name "footer" is built in'
    )
  })

  test('patchCollection PATCHes the partial body, nulls included', async () => {
    fetchMock.mockResolvedValue(jsonResponse(DETAIL))

    await patchCollection('uck26', { overrides: { footer: null } })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/collections/uck26`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ overrides: { footer: null } })
    expect(header(init, 'X-CapForge-Local-Token')).toBe(TOKEN)
  })

  test('patchCollection rejects a detail without an effective brief', async () => {
    fetchMock.mockResolvedValue(jsonResponse(COLLECTION))
    await expect(patchCollection('uck26', { name: 'n' })).rejects.toThrow(/effective brief/)
  })

  test('deleteCollection sends DELETE and reads nothing from a 204', async () => {
    const json = vi.fn(() => Promise.reject(new Error('no body')))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: '',
      json,
    } as unknown as Response)

    await expect(deleteCollection('uck26')).resolves.toBeUndefined()

    expect(lastCall().init.method).toBe('DELETE')
    expect(json).not.toHaveBeenCalled()
  })

  test('deleteCollection maps "in use" to a typed refusal with the member count', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: { reason: 'collection_in_use', members: 5 } }, 409)
    )

    const err = await deleteCollection('uck26').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(CollectionRefusedError)
    expect((err as CollectionRefusedError).refusal).toEqual({
      kind: 'collection_in_use',
      members: 5,
    })
    expect((err as Error).message).toContain('5 videos')
  })

  test('a 404 is a plain error with the backend message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'No such collection' }, 404))

    const err = await deleteCollection('gone').catch((e: unknown) => e)

    expect(err).not.toBeInstanceOf(CollectionRefusedError)
    expect((err as Error).message).toBe('No such collection')
  })
})
