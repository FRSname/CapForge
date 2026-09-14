import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  api,
  formatValidationDetail,
  normalizeResult,
  StaleRecordError,
  ValidationRefusedError,
  type TranscriptionResult,
} from './api'

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
    api.resetBridge()
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

    test('startTranscription forwards an explicit model', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.startTranscription({ audio_path: '/a.mp4', model: 'tiny' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({
        audio_path: '/a.mp4',
        model: 'tiny',
      })
    })

    test('startTranscription omits model entirely when unset', async () => {
      // The backend reads a missing `model` as "auto"; sending null/'' instead
      // would fail Pydantic's ModelSize validation.
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.startTranscription({ audio_path: '/a.mp4' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).not.toHaveProperty('model')
    })

    test('startTranscription forwards release_model_after when set', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await api.startTranscription({ audio_path: '/a.mp4', release_model_after: true })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({
        audio_path: '/a.mp4',
        release_model_after: true,
      })
    })

    test('warm POSTs the chosen model to /api/warm', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'warm', model: 'small', device: 'cpu' }))

      await api.warm('small')

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/warm')
      expect(init.method).toBe('POST')
      expect(init.body).toBe('{"model":"small"}')
    })

    test('warm omits model entirely when none is chosen', async () => {
      // A missing `model` means "auto" server-side; sending null/'' would fail
      // the same ModelSize validation startTranscription avoids.
      fetchMock.mockResolvedValue(jsonResponse({ status: 'warm' }))

      await api.warm()

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/warm')
      expect(init.body).toBe('{}')
    })

    test('warm resolves a busy backend without throwing', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'busy' }))

      await expect(api.warm('small')).resolves.toEqual({ status: 'busy' })
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

  describe('library routes', () => {
    const ROW = {
      id: 'c'.repeat(32),
      title: '',
      sourcePath: '/media/Talk.mp4',
      duration: 12,
      language: 'en',
      status: 'transcribed',
      collection_id: null,
      scratch: false,
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-01T10:00:00Z',
      missing_media: false,
      hasProject: false,
      poster: false,
    }

    test('listLibrary sends the local token and parses the envelope', async () => {
      api.setLocalToken('tok')
      fetchMock.mockResolvedValue(jsonResponse({ videos: [ROW] }))

      const videos = await api.listLibrary()

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/library')
      expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe('tok')
      expect(videos).toEqual([ROW])
    })

    test('listLibrary rejects a malformed row instead of handing it to the UI', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ videos: [{ ...ROW, status: 'nope' }] }))

      await expect(api.listLibrary()).rejects.toThrow(/Library entry 0/)
    })

    test('createLibraryRecord posts the source path and keeps the revision', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ...ROW, rev: 5 }))

      const record = await api.createLibraryRecord('/media/Talk.mp4')

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/library')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ source_path: '/media/Talk.mp4' }))
      expect(record.rev).toBe(5)
    })

    test('putLibraryProject PUTs the snapshot into the record', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ rev: 6 }))

      expect(await api.putLibraryProject('vid 1', { version: 2 })).toEqual({ rev: 6 })

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/library/vid%201/project')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe('{"version":2}')
    })

    test('deleteLibraryRecord names the mode and returns the folder to trash', async () => {
      api.setLocalToken('tok')
      fetchMock.mockResolvedValue(jsonResponse({ status: 'ok', mode: 'detach', folder: '/l/x' }))

      const result = await api.deleteLibraryRecord('vid1', 'detach')

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://127.0.0.1:53421/api/library/vid1?mode=detach')
      expect(init.method).toBe('DELETE')
      expect((init.headers as Record<string, string>)['X-CapForge-Local-Token']).toBe('tok')
      expect(result.folder).toBe('/l/x')
    })

    test('importLibraryProject and migrateStudioWorkspaces hit their own routes', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(ROW))
      fetchMock.mockResolvedValueOnce(jsonResponse({ imported: ['a'], skipped: [] }))

      await api.importLibraryProject('/p/x.capforge')
      const migration = await api.migrateStudioWorkspaces()

      expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
        'http://127.0.0.1:53421/api/library/import-project'
      )
      expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBe(
        JSON.stringify({ path: '/p/x.capforge' })
      )
      expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
        'http://127.0.0.1:53421/api/library/migrate-studio'
      )
      expect(migration.imported).toEqual(['a'])
    })

    test('a failed library fetch rejects with the backend message, never silently', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: 'library root is not writable' }, { ok: false, status: 500 })
      )

      await expect(api.listLibrary()).rejects.toThrow('library root is not writable')
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

describe('formatValidationDetail', () => {
  test('names the rejected field instead of a bare status phrase', () => {
    // The exact 422 an older project produced: undefined/100 → NaN → null.
    const detail = [
      {
        type: 'float_type',
        loc: ['body', 'config', 'max_width'],
        msg: 'Input should be a valid number',
        input: null,
      },
    ]

    expect(formatValidationDetail(detail)).toBe(
      'config.max_width: Input should be a valid number'
    )
  })

  test('joins several issues and summarises the overflow', () => {
    const detail = Array.from({ length: 5 }, (_, i) => ({
      loc: ['body', 'config', `field_${i}`],
      msg: 'bad',
    }))

    expect(formatValidationDetail(detail)).toBe(
      'config.field_0: bad; config.field_1: bad; config.field_2: bad (+2 more)'
    )
  })

  test('falls back gracefully on shapes it does not recognise', () => {
    expect(formatValidationDetail([])).toBe('')
    expect(formatValidationDetail(['not an object'])).toBe('')
    expect(formatValidationDetail([{ msg: 'no loc at all' }])).toBe('no loc at all')
  })
})

/**
 * The Publish workspace's half of the client: the gated library-record routes,
 * the two structured refusals a `PATCH` can answer with, and the
 * `record_updated` dispatch that reaches subscribers without AgentLiveSync
 * knowing anything about it.
 */
describe('publish routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  /** The minimum a record body needs to survive `parsePublishRecord`. */
  function recordBody(over: Record<string, unknown> = {}) {
    return { id: 'vid_1', rev: 3, title: 'Talk', ...over }
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    api.setPort(53421)
    api.setLocalToken('tok')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('getLibraryRecord sends the local token and parses the dossier', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordBody({ chapters: [{ start_s: 0, title: 'A' }] })))

    const record = await api.getLibraryRecord('vid 1')

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:53421/api/library/vid%201', {
      headers: { 'X-CapForge-Local-Token': 'tok' },
    })
    expect(record.rev).toBe(3)
    expect(record.chapters).toEqual([{ start_s: 0, title: 'A' }])
  })

  test('patchLibraryRecord PATCHes with If-Match set to the revision it read', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordBody({ rev: 4, title: 'New' })))

    const record = await api.patchLibraryRecord('vid_1', { title: 'New' }, 3)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:53421/api/library/vid_1')
    expect(init.method).toBe('PATCH')
    expect(init.headers['If-Match']).toBe('3')
    expect(init.headers['X-CapForge-Local-Token']).toBe('tok')
    expect(JSON.parse(init.body)).toEqual({ title: 'New' })
    expect(record.title).toBe('New')
  })

  test('a 409 throws StaleRecordError carrying the current record', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { detail: 'Record moved', current: recordBody({ rev: 9, title: 'Claude wrote this' }) },
        { ok: false, status: 409 }
      )
    )

    const err = await api.patchLibraryRecord('vid_1', { title: 'Mine' }, 3).catch((e) => e)

    expect(err).toBeInstanceOf(StaleRecordError)
    expect(err.message).toBe('Record moved')
    expect(err.current?.rev).toBe(9)
    expect(err.current?.title).toBe('Claude wrote this')
  })

  test('a 409 whose current is unusable still reports the collision', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Record moved', current: { no: 'id' } }, { ok: false, status: 409 })
    )

    const err = await api.patchLibraryRecord('vid_1', { title: 'Mine' }, 3).catch((e) => e)

    expect(err).toBeInstanceOf(StaleRecordError)
    expect(err.current).toBeNull()
  })

  test('a 422 throws ValidationRefusedError carrying the findings', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          detail: 'Refused',
          violations: [
            { field: 'title', rule: 'TITLE_MAX_CHARS', message: 'Too long', severity: 'hard' },
          ],
        },
        { ok: false, status: 422 }
      )
    )

    const err = await api.patchLibraryRecord('vid_1', { title: 'x'.repeat(200) }, 3).catch((e) => e)

    expect(err).toBeInstanceOf(ValidationRefusedError)
    expect(err.violations).toHaveLength(1)
    expect(err.violations[0].field).toBe('title')
  })

  test('an unstructured failure still surfaces the generic message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Record not found' }, { ok: false, status: 404 })
    )

    const err = await api.patchLibraryRecord('gone', { title: 'x' }, 1).catch((e) => e)

    expect(err).not.toBeInstanceOf(StaleRecordError)
    expect(err).not.toBeInstanceOf(ValidationRefusedError)
    expect(err.message).toBe('Record not found')
  })

  test('the brief round-trips through its own routes, without If-Match', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ channel: 'CapForge', house_rules: {} }))

    await api.getBrief()
    const brief = await api.patchBrief({ channel: 'CapForge' })

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:53421/api/library/brief')
    expect(fetchMock.mock.calls[1][1].headers['If-Match']).toBeUndefined()
    expect(brief.channel).toBe('CapForge')
    // A brief with no stored rules still answers with the documented defaults.
    expect(brief.house_rules.hook_first_150).toBe(true)
    expect(brief.house_rules.description_chars).toBeNull()
  })

  test('validateFields posts the unsaved text and returns the findings', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ violations: [{ field: 'description', rule: 'r', message: 'm' }] })
    )

    const violations = await api.validateFields({ fields: { title: 'x' }, duration: 60 })

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:53421/api/library/validate')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      fields: { title: 'x' },
      duration: 60,
    })
    // An unlabelled severity is read as the strict one.
    expect(violations[0].severity).toBe('hard')
  })

  test('getUploadPackage asks for a platform and keeps the violations riding along', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ platform: 'youtube', text: 'TITLE OPTIONS', violations: [] })
    )

    const pkg = await api.getUploadPackage('vid_1')

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:53421/api/library/vid_1/package?platform=youtube'
    )
    expect(pkg.text).toBe('TITLE OPTIONS')
  })

  test('getLibraryMoments returns the usable matches only', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        matches: [
          { text: 'So then', start: 12.5, end: 13, word_id: 'w1', gap: 1.2 },
          { text: 'no start at all' },
        ],
      })
    )

    const moments = await api.getLibraryMoments('vid_1', 'pause')

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:53421/api/library/vid_1/moments?kind=pause'
    )
    expect(moments).toHaveLength(1)
    expect(moments[0].gap).toBe(1.2)
  })
})

describe('record_updated dispatch', () => {
  /** The socket `connectControl` opened, so a message can be pushed into it. */
  function openControlSocket() {
    let socket: { onmessage?: (e: { data: string }) => void } = {}
    vi.stubGlobal(
      'WebSocket',
      class {
        onopen: (() => void) | null = null
        onclose: (() => void) | null = null
        onerror: (() => void) | null = null
        onmessage: ((e: { data: string }) => void) | null = null
        close() {}
        constructor() {
          socket = this as unknown as typeof socket
        }
      }
    )
    api.connectControl({})
    return socket
  }

  afterEach(() => {
    api.disconnectControl()
    vi.unstubAllGlobals()
  })

  test('a record_updated frame reaches every subscriber, camelCased', () => {
    const socket = openControlSocket()
    const seen: unknown[] = []
    const off = api.onRecordUpdated((e) => seen.push(e))

    socket.onmessage?.({
      data: JSON.stringify({ type: 'record_updated', video_id: 'vid_1', rev: 7, by: 'agent' }),
    })

    expect(seen).toEqual([{ videoId: 'vid_1', rev: 7, by: 'agent' }])
    off()
  })

  test('unsubscribing stops the dispatch', () => {
    const socket = openControlSocket()
    const seen: unknown[] = []
    const off = api.onRecordUpdated((e) => seen.push(e))

    off()
    socket.onmessage?.({
      data: JSON.stringify({ type: 'record_updated', video_id: 'vid_1', rev: 7, by: 'agent' }),
    })

    expect(seen).toEqual([])
  })
})


describe('bridge readiness (the empty-library-after-launch race)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    api.setPort(53421)
    api.setLocalToken('')
    api.resetBridge()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('a library call made before AgentLiveSync configured the client still resolves port + token', async () => {
    const getBackendPort = vi.fn().mockResolvedValue(52690)
    const getLocalToken = vi.fn().mockResolvedValue('launch-token')
    vi.stubGlobal('window', { subforge: { getBackendPort, getLocalToken } })
    fetchMock.mockResolvedValue(jsonResponse({ videos: [] }))

    await api.listLibrary()
    await api.listLibrary()

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:52690/api/library', {
      headers: { 'X-CapForge-Local-Token': 'launch-token' },
    })
    // Resolved once, not per request.
    expect(getBackendPort).toHaveBeenCalledTimes(1)
    expect(getLocalToken).toHaveBeenCalledTimes(1)
  })

  test('an IPC failure rejects the request and is retried on the next call', async () => {
    const getBackendPort = vi
      .fn()
      .mockRejectedValueOnce(new Error('bridge down'))
      .mockResolvedValue(52690)
    vi.stubGlobal('window', {
      subforge: { getBackendPort, getLocalToken: vi.fn().mockResolvedValue('t') },
    })
    fetchMock.mockResolvedValue(jsonResponse({ videos: [] }))

    await expect(api.listLibrary()).rejects.toThrow('bridge down')
    await expect(api.listLibrary()).resolves.toEqual([])
    expect(getBackendPort).toHaveBeenCalledTimes(2)
  })

  test('without the Electron bridge (node tests) requests go straight through', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ videos: [] }))
    await expect(api.listLibrary()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:53421/api/library', { headers: {} })
  })
})
