/**
 * The frames REST client against a mocked `fetch`: every route rides api.ts's
 * authenticated transport (an upload as the raw image), each answer is parsed
 * at the boundary, and a refusal surfaces with the backend's sentence.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './api'
import {
  FRAMES_SHAPE_MESSAGE,
  deleteFrame,
  frameAssetPath,
  grabFrames,
  parseFramesResult,
  uploadFrame,
} from './framesApi'

const BASE = 'http://127.0.0.1:53421'
const TOKEN = 'local-token'
const ID = 'a'.repeat(32)
const FRAME = `${'b'.repeat(32)}.jpg`

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Unprocessable Entity',
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('framesApi', () => {
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

  function call(i = 0): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[i]
    return { url, init }
  }

  test('grabFrames POSTs the times with the token and parses frames, failures and rev', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        frames: [{ time_s: 12.5, name: FRAME }],
        failed: [{ time_s: 99, reason: 'past the end' }],
        rev: 7,
      })
    )

    const result = await grabFrames(ID, [12.5, 99])

    const { url, init } = call()
    expect(url).toBe(`${BASE}/api/library/${ID}/frames`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(TOKEN)
    expect(JSON.parse(String(init.body))).toEqual({ times: [12.5, 99] })
    expect(result).toEqual({
      frames: [{ time_s: 12.5, name: FRAME }],
      failed: [{ time_s: 99, reason: 'past the end' }],
      rev: 7,
    })
  })

  test('grabFrames surfaces a 422 sentence as the error message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'At most 24 frames per video.' }, 422))
    await expect(grabFrames(ID, [1])).rejects.toThrow('At most 24 frames per video.')
  })

  test('deleteFrame DELETEs the named frame and answers the new rev', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rev: 9 }))

    expect(await deleteFrame(ID, FRAME)).toBe(9)
    const { url, init } = call()
    expect(url).toBe(`${BASE}/api/library/${ID}/frames/${FRAME}`)
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(TOKEN)
  })

  test('deleteFrame reports a 404 rather than pretending it worked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'No such frame' }, 404))
    await expect(deleteFrame(ID, FRAME)).rejects.toThrow('No such frame')
  })

  test('uploadFrame POSTs the raw image with its type and the token, answering name and rev', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ frame: { name: FRAME }, rev: 4 }))
    const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

    expect(await uploadFrame(ID, image)).toEqual({ name: FRAME, rev: 4 })
    const { url, init } = call()
    expect(url).toBe(`${BASE}/api/library/${ID}/frames/upload`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-CapForge-Local-Token']).toBe(TOKEN)
    expect(headers['Content-Type']).toBe('image/png')
    expect(init.body).toBe(image)
  })

  test('uploadFrame sends an untyped blob as octet-stream', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ frame: { name: FRAME }, rev: 4 }))

    await uploadFrame(ID, new Blob([new Uint8Array([1])]))

    expect((call().init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/octet-stream'
    )
  })

  test('uploadFrame surfaces a 422 sentence as the error message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'GIF images cannot be used.' }, 422))
    await expect(uploadFrame(ID, new Blob([]))).rejects.toThrow('GIF images cannot be used.')
  })

  test.each([
    { rev: 4 },
    { frame: {}, rev: 4 },
    { frame: { name: '../x' }, rev: 4 },
    { frame: { name: FRAME } },
  ])('uploadFrame rejects the unexpected body %j', async (body) => {
    fetchMock.mockResolvedValue(jsonResponse(body))
    await expect(uploadFrame(ID, new Blob([]))).rejects.toThrow(FRAMES_SHAPE_MESSAGE)
  })

  test('frameAssetPath is the asset route path of a frame', () => {
    expect(frameAssetPath(FRAME)).toBe(`thumbnails/${FRAME}`)
  })
})

describe('parseFramesResult', () => {
  test('drops unusable rows but requires a rev', () => {
    expect(
      parseFramesResult({
        frames: [{ time_s: 1, name: FRAME }, { time_s: 2 }, 'x'],
        failed: [{ time_s: 3 }, { reason: 'no time' }],
        rev: 2,
      })
    ).toEqual({
      frames: [{ time_s: 1, name: FRAME }],
      failed: [{ time_s: 3, reason: '' }],
      rev: 2,
    })
    expect(() => parseFramesResult({ frames: [] })).toThrow(FRAMES_SHAPE_MESSAGE)
    expect(() => parseFramesResult(null)).toThrow(FRAMES_SHAPE_MESSAGE)
  })
})
