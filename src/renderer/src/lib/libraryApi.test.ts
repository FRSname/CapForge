/**
 * The folder-import REST client, against a mocked `fetch`. What matters: every
 * call goes through api.ts's authenticated transport (the local token rides
 * along), bodies are parsed at the boundary, and a relink refusal surfaces as
 * a typed error the card can act on — wherever FastAPI put the reason.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './api'
import {
  RelinkRefusedError,
  getLibraryWatch,
  importLibraryFolder,
  importLibraryPaths,
  relinkLibraryRecord,
  setLibraryWatch,
} from './libraryApi'

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

const RECORD = {
  id: 'v1',
  title: '',
  sourcePath: '/new/Talk.mp4',
  status: 'imported',
  rev: 4,
}

describe('libraryApi', () => {
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

  test('importLibraryFolder POSTs path + recursive with the local token, parsed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ created: ['a'], existing: [], relinked: [], failed: [], truncated: false })
    )

    const out = await importLibraryFolder('/Volumes/Rec')

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/import-folder`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ path: '/Volumes/Rec', recursive: true })
    expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(TOKEN)
    expect(out.created).toEqual(['a'])
  })

  test('importLibraryFolder surfaces the 422 detail as the error message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Not a folder: /x' }, 422))
    await expect(importLibraryFolder('/x')).rejects.toThrow('Not a folder: /x')
  })

  test('importLibraryFolder rejects a malformed 200 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }))
    await expect(importLibraryFolder('/x')).rejects.toThrow(/unexpected shape/)
  })

  test('importLibraryPaths POSTs the paths with the token, parsed as a folder import', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        created: ['a'],
        existing: ['b'],
        relinked: [],
        failed: [{ path: '/r/c.txt', reason: 'not_media' }],
        truncated: false,
      })
    )

    const out = await importLibraryPaths(['/r/a.mp4', '/r/b.mov', '/r/c.txt'])

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/import-paths`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      paths: ['/r/a.mp4', '/r/b.mov', '/r/c.txt'],
    })
    expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(TOKEN)
    expect(out.existing).toEqual(['b'])
    expect(out.failed).toEqual([{ path: '/r/c.txt', reason: 'not_media' }])
  })

  test('importLibraryPaths rejects a malformed 200 body and surfaces a 422', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ created: 'a' }))
    await expect(importLibraryPaths(['/a.mp4'])).rejects.toThrow(/unexpected shape/)

    fetchMock.mockResolvedValue(
      jsonResponse(
        { detail: [{ loc: ['body', 'paths'], msg: 'List should have at most 500 items' }] },
        422
      )
    )
    await expect(importLibraryPaths(['/a.mp4'])).rejects.toThrow(
      'paths: List should have at most 500 items'
    )
  })

  test('relinkLibraryRecord POSTs path + force and returns the record', async () => {
    fetchMock.mockResolvedValue(jsonResponse(RECORD))

    const record = await relinkLibraryRecord('v 1', '/new/Talk.mp4', true)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/v%201/relink`)
    expect(JSON.parse(String(init.body))).toEqual({ path: '/new/Talk.mp4', force: true })
    expect(record.rev).toBe(4)
  })

  test.each([
    [409, { detail: { reason: 'different_media' } }, { kind: 'different_media' }],
    [409, { reason: 'media_in_use', video_id: 'v2' }, { kind: 'media_in_use', videoId: 'v2' }],
    [422, { detail: { reason: 'media_not_found' } }, { kind: 'media_not_found' }],
  ])('a %s refusal throws RelinkRefusedError', async (status, body, refusal) => {
    fetchMock.mockResolvedValue(jsonResponse(body, status))

    const err = await relinkLibraryRecord('v1', '/p').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(RelinkRefusedError)
    expect((err as RelinkRefusedError).refusal).toEqual(refusal)
  })

  test('any other failure is a plain error with the backend message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'No such record' }, 404))

    const err = await relinkLibraryRecord('v1', '/p').catch((e: unknown) => e)

    expect(err).not.toBeInstanceOf(RelinkRefusedError)
    expect((err as Error).message).toBe('No such record')
  })

  test('getLibraryWatch GETs the status with the token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ folder: null, available: false, lastScanAt: null, importedCount: 0 })
    )

    const status = await getLibraryWatch()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE}/api/library/watch`)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(TOKEN)
    expect(status.folder).toBeNull()
  })

  test('setLibraryWatch PUTs the folder (null stops) and reports the 422 message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ folder: '/a', available: true, lastScanAt: null, importedCount: 0 })
    )
    await setLibraryWatch('/a')
    expect(lastCall().init.method).toBe('PUT')
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ folder: '/a' })

    fetchMock.mockResolvedValue(
      jsonResponse({ folder: null, available: false, lastScanAt: null, importedCount: 0 })
    )
    await setLibraryWatch(null)
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ folder: null })

    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'That folder is inside the CapForge library.' }, 422)
    )
    await expect(setLibraryWatch('/lib')).rejects.toThrow(
      'That folder is inside the CapForge library.'
    )
  })

  test('awaits the Electron bridge before the first request', async () => {
    const order: string[] = []
    vi.stubGlobal('window', {
      subforge: {
        getBackendPort: () => {
          order.push('port')
          return Promise.resolve(60000)
        },
        getLocalToken: () => Promise.resolve('bridged'),
      },
    })
    fetchMock.mockImplementation((url: string) => {
      order.push(url)
      return Promise.resolve(
        jsonResponse({ folder: null, available: false, lastScanAt: null, importedCount: 0 })
      )
    })

    await getLibraryWatch()

    expect(order).toEqual(['port', 'http://127.0.0.1:60000/api/library/watch'])
  })
})
