/**
 * The channels REST client against a mocked `fetch`: every call rides api.ts's
 * authenticated transport, bodies are parsed at the boundary, and the three
 * refusals surface as a typed error wherever FastAPI put the reason.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './api'
import {
  ChannelRefusedError,
  createChannel,
  deleteChannel,
  getChannel,
  listChannels,
  listPlatforms,
  patchChannel,
  setPrimaryChannel,
} from './channelsApi'

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

const CHANNEL = { id: 'uck', platform: 'youtube', name: 'UCK', primary: true }
const IG = { id: 'filip-ig', platform: 'instagram', name: 'Filip IG', primary: false }

describe('channelsApi', () => {
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

  test('listChannels GETs with the token and parses the envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ primary_id: 'uck', channels: [CHANNEL, IG] }))

    const list = await listChannels()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/channels`)
    expect(init.method).toBe('GET')
    expect(header(init, 'X-CapForge-Local-Token')).toBe(TOKEN)
    expect(list.primary_id).toBe('uck')
    expect(list.channels.map((c) => c.platform)).toEqual(['youtube', 'instagram'])
  })

  test('getChannel encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(CHANNEL))

    const channel = await getChannel('a b')

    expect(lastCall().url).toBe(`${BASE}/api/library/channels/a%20b`)
    expect(channel.name).toBe('UCK')
  })

  test('createChannel POSTs the body and returns the channel', async () => {
    fetchMock.mockResolvedValue(jsonResponse(IG, 201))

    const created = await createChannel({ platform: 'instagram', name: 'Filip IG' })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/channels`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ platform: 'instagram', name: 'Filip IG' })
    expect(created.id).toBe('filip-ig')
  })

  test.each([
    { reason: 'channel_exists', detail: 'taken' },
    { detail: { reason: 'channel_exists' } },
  ])('createChannel maps a 409 %j to ChannelRefusedError', async (body) => {
    fetchMock.mockResolvedValue(jsonResponse(body, 409))

    const err = await createChannel({ id: 'uck', platform: 'youtube', name: 'x' }).catch(
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(ChannelRefusedError)
    expect((err as ChannelRefusedError).refusal).toEqual({ kind: 'channel_exists' })
  })

  test('patchChannel PATCHes only the partial body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(CHANNEL))

    await patchChannel('uck', { context: { about: 'Talks' } })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/channels/uck`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ context: { about: 'Talks' } })
    expect(header(init, 'X-CapForge-Local-Token')).toBe(TOKEN)
  })

  test('a Pydantic 422 is a plain error with the formatted detail', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { detail: [{ loc: ['body', 'name'], msg: 'String should have at most 120 characters' }] },
        422
      )
    )

    const err = await patchChannel('uck', { name: 'x' }).catch((e: unknown) => e)

    expect(err).not.toBeInstanceOf(ChannelRefusedError)
    expect((err as Error).message).toBe('name: String should have at most 120 characters')
  })

  test('deleteChannel sends DELETE and reads nothing from a 204', async () => {
    const json = vi.fn(() => Promise.reject(new Error('no body')))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: '',
      json,
    } as unknown as Response)

    await expect(deleteChannel('filip-ig')).resolves.toBeUndefined()

    expect(lastCall().init.method).toBe('DELETE')
    expect(json).not.toHaveBeenCalled()
  })

  test('deleting the primary is a typed refusal with a human message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ reason: 'channel_is_primary', detail: 'primary' }, 409)
    )

    const err = await deleteChannel('uck').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ChannelRefusedError)
    expect((err as ChannelRefusedError).refusal).toEqual({ kind: 'channel_is_primary' })
    expect((err as Error).message).toMatch(/primary/)
  })

  test('setPrimaryChannel POSTs to /primary and answers the list', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ primary_id: 'second', channels: [CHANNEL, { ...CHANNEL, id: 'second' }] })
    )

    const list = await setPrimaryChannel('second')

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/channels/second/primary`)
    expect(init.method).toBe('POST')
    expect(list.channels.map((c) => c.primary)).toEqual([false, true])
  })

  test('setPrimaryChannel maps primary_not_youtube (422) to a typed refusal', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ reason: 'primary_not_youtube', detail: 'not youtube' }, 422)
    )

    const err = await setPrimaryChannel('filip-ig').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ChannelRefusedError)
    expect((err as ChannelRefusedError).refusal).toEqual({ kind: 'primary_not_youtube' })
  })

  test('listPlatforms GETs the served table', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ platforms: [{ id: 'tiktok', label: 'TikTok', fields: ['caption'] }] })
    )

    const specs = await listPlatforms()

    expect(lastCall().url).toBe(`${BASE}/api/library/platforms`)
    expect(specs[0]).toEqual({ id: 'tiktok', label: 'TikTok', fields: ['caption'], limits: [] })
  })

  test('a 404 is a plain error with the backend message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'No such channel' }, 404))

    const err = await getChannel('gone').catch((e: unknown) => e)

    expect(err).not.toBeInstanceOf(ChannelRefusedError)
    expect((err as Error).message).toBe('No such channel')
  })
})
