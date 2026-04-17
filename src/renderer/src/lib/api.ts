/**
 * CapForge API client — TypeScript port of renderer/js/api.js.
 * Communicates with the Python FastAPI backend over REST + WebSocket.
 */

export interface ApiError extends Error {
  title?: string
  hint?: string
  raw?: string
}

export interface TranscribeParams {
  audio_path: string
  language?: string
  enable_diarization?: boolean
  hf_token?: string
  output_dir?: string
  export_formats?: string[]
}

export interface ProgressUpdate {
  step: 'loading_model' | 'transcribing' | 'aligning' | 'diarizing' | 'exporting' | 'done' | 'error'
  pct: number
  message: string
  sub_message?: string
}

export interface WordResult {
  word: string
  start: number
  end: number
  score?: number
  speaker?: string
}

export interface SegmentResult {
  id: string
  start: number
  end: number
  text: string
  words: WordResult[]
  speaker?: string
}

export interface TranscriptionResult {
  segments: SegmentResult[]
  language: string
  duration: number
  audio_path: string
}

export interface VideoInfo {
  width: number | null
  height: number | null
  fps: number | null
}

class CapForgeAPI {
  private base: string
  private wsBase: string
  private ws: WebSocket | null = null
  private _onProgress: ((update: ProgressUpdate) => void) | null = null
  private _wsReconnectDelay = 1000
  private _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(port = 53421) {
    this.base = `http://127.0.0.1:${port}`
    this.wsBase = `ws://127.0.0.1:${port}`
  }

  setPort(port: number) {
    this.base = `http://127.0.0.1:${port}`
    this.wsBase = `ws://127.0.0.1:${port}`
  }

  private async handleError(res: Response): Promise<ApiError> {
    const fallback = { detail: res.statusText }
    const body = await res.json().catch(() => fallback)
    const detail = body.detail
    const err = new Error() as ApiError
    if (detail && typeof detail === 'object' && detail.title) {
      err.title = detail.title
      err.hint = detail.hint ?? ''
      err.raw = detail.raw ?? ''
      err.message = detail.hint ? `${detail.title} — ${detail.hint}` : detail.title
    } else {
      err.message = typeof detail === 'string' ? detail : res.statusText
    }
    return err
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`)
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  getSystemInfo() { return this.get('/api/system-info') }
  getLanguages(): Promise<string[]> {
    return this.get<unknown>('/api/languages').then(r => {
      // Backend returns { languages: { code: name, ... } }; also tolerate array or plain dict
      if (Array.isArray(r)) return r as string[]
      if (r && typeof r === 'object') {
        const inner = (r as { languages?: unknown }).languages ?? r
        if (Array.isArray(inner)) return inner as string[]
        if (inner && typeof inner === 'object') return Object.keys(inner)
      }
      console.warn('[api.getLanguages] unexpected response shape:', r)
      return []
    })
  }
  getModels()     { return this.get<string[]>('/api/models') }
  getStatus()     { return this.get('/api/status') }
  getResult()     { return this.get<TranscriptionResult>('/api/result') }
  cancelJob()     { return this.post('/api/cancel', {}) }

  startTranscription(params: TranscribeParams) {
    return this.post('/api/transcribe', params)
  }

  updateResult(result: TranscriptionResult) {
    return this.put('/api/result', result)
  }

  exportResult(params: unknown) {
    return this.post('/api/export', params)
  }

  renderVideo(params: unknown) {
    return this.post('/api/render-video', params)
  }

  getVideoInfo(filePath: string) {
    return this.get<VideoInfo>(`/api/video-info?path=${encodeURIComponent(filePath)}`)
  }

  audioUrl(filePath: string) {
    return `${this.base}/api/serve-audio?path=${encodeURIComponent(filePath)}`
  }

  // ── WebSocket progress stream ──────────────────────────────────────

  connectProgress(onProgress: (update: ProgressUpdate) => void) {
    this._onProgress = onProgress
    this._wsReconnectDelay = this._wsReconnectDelay ?? 1000
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
    }

    this.ws = new WebSocket(`${this.wsBase}/ws/progress`)

    this.ws.onopen = () => { this._wsReconnectDelay = 1000 }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string)
        // Backend sends { status, progress, message, detail } (Pydantic model).
        // Map to the ProgressUpdate shape the frontend expects.
        const data: ProgressUpdate = {
          step:        raw.step    ?? raw.status ?? 'loading_model',
          pct:         raw.pct     ?? raw.progress ?? 0,
          message:     raw.message ?? '',
          sub_message: raw.sub_message ?? raw.detail ?? undefined,
        }
        this._onProgress?.(data)
      } catch { /* ignore malformed */ }
    }

    this.ws.onclose = () => {
      if (!this._onProgress) return
      const delay = this._wsReconnectDelay
      this._wsReconnectDelay = Math.min(delay * 2, 30_000)
      this._wsReconnectTimer = setTimeout(() => {
        if (this._onProgress) this.connectProgress(this._onProgress)
      }, delay)
    }

    this.ws.onerror = () => { /* triggers onclose → reconnect */ }
  }

  disconnectProgress() {
    this._onProgress = null
    this._wsReconnectDelay = 1000
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }
}

// Singleton — initialized lazily once the port is known
export const api = new CapForgeAPI()
