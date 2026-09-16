/**
 * The per-channel package and validation against a mocked `fetch`: both ride
 * api.ts's authenticated transport, and both bodies are parsed at the boundary.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './api'
import { getChannelPackage, validateChannelPost } from './postsApi'

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

describe('postsApi', () => {
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

  test('getChannelPackage asks for the channel and keeps the findings riding along', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        channel: 'filip-ig',
        platform: 'instagram',
        text: 'Hook\n\n#ai',
        description: null,
        violations: [{ field: 'posts.filip-ig.caption', rule: 'instagram_max_chars', message: 'too long' }],
      })
    )

    const pkg = await getChannelPackage('vid_1', 'filip-ig')

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/vid_1/package?channel=filip-ig`)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(TOKEN)
    expect(pkg.channel).toBe('filip-ig')
    expect(pkg.text).toBe('Hook\n\n#ai')
    expect(pkg.description).toBeNull()
    expect(pkg.violations[0].severity).toBe('hard')
  })

  test('a language rides along for a YouTube channel', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ channel: 'uck', platform: 'youtube', text: 'TYTUŁ', violations: [] })
    )

    await getChannelPackage('vid 1', 'uck', 'pt-BR')

    expect(lastCall().url).toBe(`${BASE}/api/library/vid%201/package?channel=uck&lang=pt-BR`)
  })

  test('a refused package surfaces the backend’s reason, never an empty package', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ reason: 'no_post', detail: 'Video vid_1 has no post for channel uck' }, 404)
    )

    await expect(getChannelPackage('vid_1', 'uck')).rejects.toThrow(
      'Video vid_1 has no post for channel uck'
    )
  })

  test('validateChannelPost sends the draft fields for that channel and parses the findings', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        violations: [
          { field: 'posts.filip-ig.hashtags', rule: 'instagram_max_hashtags', message: 'too many', severity: 'style' },
        ],
      })
    )

    const found = await validateChannelPost('vid_1', 'filip-ig', { caption: 'Hi' })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/validate`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      video_id: 'vid_1',
      channel: 'filip-ig',
      fields: { caption: 'Hi' },
    })
    expect(found).toEqual([
      {
        field: 'posts.filip-ig.hashtags',
        rule: 'instagram_max_hashtags',
        message: 'too many',
        severity: 'style',
      },
    ])
  })
})
