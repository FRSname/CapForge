import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, normalizeResult, type TranscriptionResult } from './api'

/** Minimal fetch Response stand-in — only the members api.ts actually reads. */
function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {}
): Response {
  const { ok = true, status = ok ? 200 : 500, statusText = '' } = init
  return {
    ok,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('CapForgeAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Reset the singleton's mutable state so tests don't leak into each other.
    api.setPort(53421)
    api.setLocalToken('')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('URL building', () => {
    test('GET requests hit the base URL configured via setPort', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.getResult()

      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:53421/api/result')
    })

    test('setPort updates the base URL used by subsequent requests', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      api.setPort(60000)
      await api.getSystemInfo()

      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:60000/api/system-info')
    })

    test('getHyperframesStatus appends ?probe=1 only when probe is requested', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ cli_version: null, compat_ok: null, compat_reasons: [] })
      )

      await api.getHyperframesStatus()
      await api.getHyperframesStatus(true)

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:53421/api/hyperframes/status')
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'http://127.0.0.1:53421/api/hyperframes/status?probe=1'
      )
    })

    test('audioUrl builds a percent-encoded serve-audio URL', () => {
      const url = api.audioUrl('/Users/me/my video.mp4')

      expect(url).toBe(
        'http://127.0.0.1:53421/api/serve-audio?path=%2FUsers%2Fme%2Fmy%20video.mp4&token='
      )
    })

    test('getVideoInfo builds a percent-encoded video-info URL', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ width: null, height: null, fps: null }))

      await api.getVideoInfo('/a/b c.mp4')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:53421/api/video-info?path=%2Fa%2Fb%20c.mp4&token='
      )
    })
  })

  describe('token handling', () => {
    test('attaches the local token header to POST requests once set', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))
      api.setLocalToken('secret-token')

      await api.exportResult({ foo: 'bar' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(
        'secret-token'
      )
    })

    test('omits the local token header from POST requests when no token is set', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.exportResult({ foo: 'bar' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBeUndefined()
    })

    test('attaches the local token header to PUT requests once set', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))
      api.setLocalToken('secret-token')

      await api.updateResult({ segments: [], language: 'en', duration: 0, audio_path: '' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe(
        'secret-token'
      )
    })

    test('GET requests never carry the local token header (no init object at all)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))
      api.setLocalToken('secret-token')

      await api.getResult()

      expect(fetchMock.mock.calls[0][1]).toBeUndefined()
    })

    test('getSystemFonts scopes the local token header to its gated route', async () => {
      vi.stubGlobal('window', {
        subforge: {
          getBackendPort: vi.fn().mockResolvedValue(52690),
          getLocalToken: vi.fn().mockResolvedValue('launch-token'),
        },
      })
      fetchMock.mockResolvedValue(jsonResponse({ fonts: ['Arial', 'Verdana'] }))

      await expect(api.getSystemFonts()).resolves.toEqual(['Arial', 'Verdana'])

      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:52690/api/fonts/system', {
        headers: { 'X-CapForge-Local-Token': 'launch-token' },
      })
    })

    test('propagates the local token as an encoded query param on getVideoInfo', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ width: null, height: null, fps: null }))
      api.setLocalToken('tok en')

      await api.getVideoInfo('/a/b.mp4')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:53421/api/video-info?path=%2Fa%2Fb.mp4&token=tok%20en'
      )
    })

    test('propagates the local token as an encoded query param on audioUrl', () => {
      api.setLocalToken('tok en')

      const url = api.audioUrl('/a/b.mp4')

      expect(url).toContain('token=tok%20en')
    })

    test('setLocalToken("") clears a previously-set token from subsequent requests', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))
      api.setLocalToken('secret-token')
      api.setLocalToken('')

      await api.exportResult({})

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBeUndefined()
    })
  })

  describe('post() error paths', () => {
    test('throws combining title + hint from a structured detail', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { detail: { title: 'Render failed', hint: 'Check the output path', raw: 'stderr...' } },
          { ok: false, status: 500 }
        )
      )

      await expect(api.exportResult({})).rejects.toMatchObject({
        message: 'Render failed — Check the output path',
        title: 'Render failed',
        hint: 'Check the output path',
        raw: 'stderr...',
      })
    })

    test('falls back to the bare title when hint is absent', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: { title: 'Render failed' } }, { ok: false, status: 500 })
      )

      await expect(api.exportResult({})).rejects.toMatchObject({
        message: 'Render failed',
        hint: '',
      })
    })

    test('uses a plain string detail as the error message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: 'Bad request' }, { ok: false, status: 400 })
      )

      await expect(api.exportResult({})).rejects.toMatchObject({ message: 'Bad request' })
    })

    test('falls back to statusText when the error body has no usable detail', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({}, { ok: false, status: 503, statusText: 'Service Unavailable' })
      )

      await expect(api.exportResult({})).rejects.toMatchObject({ message: 'Service Unavailable' })
    })

    test('falls back to statusText when the error body cannot be parsed as JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      })

      await expect(api.exportResult({})).rejects.toMatchObject({
        message: 'Internal Server Error',
      })
    })

    test('resolves with the parsed JSON body on success', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, id: '123' }))

      await expect(api.exportResult({})).resolves.toEqual({ ok: true, id: '123' })
    })

    test('sends the request body as JSON', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.renderVideo({ quality: 'high' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ quality: 'high' }))
    })
  })

  describe('response envelope handling', () => {
    test('getLanguages tolerates a raw array response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(['en', 'fr']))

      await expect(api.getLanguages()).resolves.toEqual(['en', 'fr'])
    })

    test('getLanguages unwraps a { languages: {...} } envelope into its keys', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ languages: { en: 'English', fr: 'French' } }))

      await expect(api.getLanguages()).resolves.toEqual(['en', 'fr'])
    })

    test('getLanguages tolerates a plain dict without the languages wrapper', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ en: 'English' }))

      await expect(api.getLanguages()).resolves.toEqual(['en'])
    })

    test('getLanguages warns and returns [] for an unexpected shape', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fetchMock.mockResolvedValue(jsonResponse(null))

      await expect(api.getLanguages()).resolves.toEqual([])

      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    test('listCaptionStyles unwraps the styles array', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ styles: [{ name: 'classic', title: 'Classic' }] }))

      await expect(api.listCaptionStyles()).resolves.toEqual([
        { name: 'classic', title: 'Classic' },
      ])
    })

    test('listCaptionStyles falls back to [] when styles is missing from the envelope', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await expect(api.listCaptionStyles()).resolves.toEqual([])
    })
  })

  describe('remaining REST wrapper methods', () => {
    test('cancelJob POSTs to /api/cancel with an empty body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.cancelJob()

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/cancel')
      expect(init.method).toBe('POST')
      expect(init.body).toBe('{}')
    })

    test('renderCancel POSTs to /api/render-cancel', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.renderCancel()

      expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:53421/api/render-cancel')
    })

    test('startTranscription POSTs the transcribe params as the body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.startTranscription({ audio_path: '/a.mp4', language: 'en' })

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/transcribe')
      expect(init.body).toBe(JSON.stringify({ audio_path: '/a.mp4', language: 'en' }))
    })

    test('updateResult PUTs to /api/result', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.updateResult({ segments: [], language: 'en', duration: 0, audio_path: '' })

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/result')
      expect(init.method).toBe('PUT')
    })

    test('realignSegments POSTs segments + language to /api/realign', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ segments: [] }))

      await api.realignSegments([{ start: 0, end: 1, text: 'hi', words: [] }], 'en')

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/realign')
      expect(init.body).toBe(
        JSON.stringify({ segments: [{ start: 0, end: 1, text: 'hi', words: [] }], language: 'en' })
      )
    })

    test('putUiState PUTs to /api/ui-state', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.putUiState({ zoom: 2 })

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/ui-state')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify({ zoom: 2 }))
    })

    test('exportHyperframes POSTs to /api/export-hyperframes', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.exportHyperframes({ quality: 'high' })

      expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:53421/api/export-hyperframes')
    })

    test('approveRender POSTs { id, approved } to /api/render-approval', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.approveRender('req-1', true)

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/render-approval')
      expect(init.body).toBe(JSON.stringify({ id: 'req-1', approved: true }))
    })

    test('getCoauthor GETs /api/coauthor', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ coauthor: false, path: null }))

      await expect(api.getCoauthor()).resolves.toEqual({ coauthor: false, path: null })
      expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:53421/api/coauthor')
    })

    test('setCoauthor POSTs { enable } to /api/coauthor', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ coauthor: true, path: '/proj' }))

      await api.setCoauthor(true)

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/coauthor')
      expect(init.body).toBe(JSON.stringify({ enable: true }))
    })

    test('syncCaptions POSTs to /api/coauthor/sync-captions with an empty body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ transcript: 't', source: 'live', captions: null }))

      await api.syncCaptions()

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/coauthor/sync-captions')
      expect(init.body).toBe('{}')
    })

    test('getSystemInfo, getModels, and getStatus each GET their own endpoint', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.getSystemInfo()
      await api.getModels()
      await api.getStatus()

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:53421/api/system-info')
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:53421/api/models')
      expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:53421/api/status')
    })
  })

  describe('normalizeResult', () => {
    test('mints a uuid for a segment with no id', () => {
      const raw = {
        segments: [{ start: 0, end: 1, text: 'hi', words: [] }],
        language: 'en',
        duration: 5,
        audio_path: '/a.mp4',
      } as unknown as TranscriptionResult

      const result = normalizeResult(raw)

      expect(result.segments[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    test('preserves an existing segment id rather than minting a new one', () => {
      const raw: TranscriptionResult = {
        segments: [{ id: 'seg-1', start: 0, end: 1, text: 'hi', words: [] }],
        language: 'en',
        duration: 5,
        audio_path: '/a.mp4',
      }

      const result = normalizeResult(raw)

      expect(result.segments[0].id).toBe('seg-1')
    })

    test('maps snake_case audio_path to camelCase audioPath', () => {
      const raw: TranscriptionResult = {
        segments: [],
        language: 'en',
        duration: 12.5,
        audio_path: '/videos/clip.mp4',
      }

      const result = normalizeResult(raw)

      expect(result.audioPath).toBe('/videos/clip.mp4')
      expect(result.duration).toBe(12.5)
      expect(result.language).toBe('en')
    })

    test('preserves degraded alignment state for the persistent UI notice', () => {
      const raw: TranscriptionResult = {
        segments: [{ id: 'wire-segment', start: 0, end: 1, text: 'Labas', words: [] }],
        language: 'lt',
        duration: 1,
        audio_path: 'audio.wav',
        alignment_degraded: true,
      }

      expect(normalizeResult(raw).alignmentDegraded).toBe(true)
    })

    test('defaults older results without the flag to precise alignment', () => {
      const raw: TranscriptionResult = {
        segments: [{ id: 'wire-segment', start: 0, end: 1, text: 'Labas', words: [] }],
        language: 'lt',
        duration: 1,
        audio_path: 'audio.wav',
      }

      expect(normalizeResult(raw).alignmentDegraded).toBe(false)
    })
  })
})
