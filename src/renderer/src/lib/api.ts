/**
 * CapForge API client — TypeScript port of renderer/js/api.js.
 * Communicates with the Python FastAPI backend over REST + WebSocket.
 */

import type { TranscriptionResult as AppTranscriptionResult } from '../types/app'

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

/** Backend HyperFrames CLI preflight (`GET /api/hyperframes/status`, snake_case wire). */
export interface HyperframesStatus {
  cli_version: string | null
  compat_ok: boolean | null
  compat_reasons: string[]
}

/**
 * `POST /api/export-hyperframes` response. `warning` (Phase 3.5 of
 * docs/plans/caption-style-visibility-feedback.md) is set only in co-author mode
 * when a selected registry/custom caption style was installed but the agent's
 * index.html doesn't reference it — the render/project succeeds but the style is
 * silently absent. `null`/absent otherwise.
 */
export interface HyperframesExportResponse {
  status?: string
  project?: string | null
  file?: string | null
  warning?: string | null
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

/** Wire shape for /api/realign — the backend Segment model has no frontend `id`. */
export interface RealignSegmentPayload {
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

export interface CoauthorStatus {
  coauthor: boolean
  path: string | null
}

/**
 * Map a backend result (snake_case, segments may lack ids) to the app shape.
 * Backend segments carry no stable id, so we mint one per fetch.
 */
export function normalizeResult(raw: TranscriptionResult): AppTranscriptionResult {
  return {
    segments: raw.segments.map((s) => ({
      id: s.id ?? crypto.randomUUID(),
      start: s.start,
      end: s.end,
      text: s.text,
      words: s.words,
      speaker: s.speaker,
    })),
    language: raw.language,
    duration: raw.duration,
    audioPath: raw.audio_path,
  }
}

/** A style/emphasis command relayed from the agent over the control channel. */
export interface AgentCommand {
  op: string
  payload?: Record<string, unknown>
}

/** An agent-triggered final render awaiting the user's approval. */
export interface RenderApprovalRequest {
  id: string
  quality?: string
  video_format?: string
}

/**
 * Live snapshot re-pushed to the backend after the control socket reconnects.
 * A backend crash/restart loses in-memory `current_result` + UI state; this
 * lets the renderer restore them so the agent stays in sync. Both are optional —
 * only what the app currently holds is sent.
 */
export interface ResyncSnapshot {
  result?: TranscriptionResult
  uiState?: unknown
}

/** Handlers for agent-driven control-channel events. */
export interface ControlHandlers {
  onResultUpdated?: () => void
  onCommand?: (cmd: AgentCommand) => void
  /** Agent asked to render the final video — prompt the user to approve/cancel. */
  onRenderApprovalRequest?: (req: RenderApprovalRequest) => void
  /** A pending request was resolved elsewhere (timeout/another window) — dismiss. */
  onRenderApprovalResolved?: (id: string) => void
}

class CapForgeAPI {
  private base: string
  private wsBase: string
  private ws: WebSocket | null = null
  private _onProgress: ((update: ProgressUpdate) => void) | null = null
  private _wsReconnectDelay = 1000
  private _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  // Control channel — persistent listener for agent-driven events (transcript
  // edits + style/emphasis commands) while on the results screen.
  private controlWs: WebSocket | null = null
  private _controlHandlers: ControlHandlers | null = null
  private _controlReconnectDelay = 1000
  private _controlReconnectTimer: ReturnType<typeof setTimeout> | null = null
  // Resync-after-reconnect: a snapshot provider the app registers so that when
  // the control socket reopens (e.g. the backend crashed/restarted) we re-push
  // the live result + UI state the backend lost. Guarded by a "has connected
  // before" flag so the very first connect doesn't trigger a redundant push.
  private _resyncProvider: (() => ResyncSnapshot | null) | null = null
  private _controlHasConnected = false

  // Per-launch token that gates the local media endpoints (serve-audio,
  // video-info). Sent as a query param because <audio>/<video> src loads and
  // WaveSurfer cannot attach request headers. Set via setLocalToken() right
  // after the port is learned over IPC.
  private localToken = ''

  constructor(port = 53421) {
    this.base = `http://127.0.0.1:${port}`
    this.wsBase = `ws://127.0.0.1:${port}`
  }

  setPort(port: number) {
    this.base = `http://127.0.0.1:${port}`
    this.wsBase = `ws://127.0.0.1:${port}`
  }

  setLocalToken(token: string) {
    this.localToken = token
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

  /** GET a specifically auth-gated local route without changing generic GET semantics. */
  private async getWithLocalToken<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.localToken) headers['X-CapForge-Local-Token'] = this.localToken
    const res = await fetch(`${this.base}${path}`, { headers })
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    // A subset of POST routes (e.g. /api/export, /api/render-video,
    // /api/export-hyperframes) are auth-gated because they write to a
    // client-supplied output_dir, so send the per-launch local token on every
    // POST. Unlike media <src> loads, a fetch() can set a header — cleaner
    // than a query param. Harmless on POSTs that ignore it.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.localToken) headers['X-CapForge-Local-Token'] = this.localToken
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    // PUT /api/result is auth-gated (it sets the media-allowlist anchor), so
    // send the per-launch local token. Unlike media <src> loads, a fetch() can
    // set a header — cleaner than a query param. Harmless on PUTs that ignore it.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.localToken) headers['X-CapForge-Local-Token'] = this.localToken
    const res = await fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  private async del<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { method: 'DELETE' })
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  getSystemInfo() {
    return this.get('/api/system-info')
  }
  getLanguages(): Promise<string[]> {
    return this.get<unknown>('/api/languages').then((r) => {
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
  getModels() {
    return this.get<string[]>('/api/models')
  }
  async getSystemFonts(): Promise<string[]> {
    // Font pickers can mount before SettingsPanel/useTranscription initialize
    // the API client (for example when opening an existing project). Resolve
    // the current backend connection here so this authenticated request does
    // not race renderer startup.
    const [port, token] = await Promise.all([
      window.subforge.getBackendPort(),
      window.subforge.getLocalToken(),
    ])
    this.setPort(port)
    this.setLocalToken(token)
    return this.getWithLocalToken<{ fonts: string[] }>('/api/fonts/system').then(
      (response) => response.fonts ?? []
    )
  }
  getStatus() {
    return this.get('/api/status')
  }
  getResult() {
    return this.get<TranscriptionResult>('/api/result')
  }
  cancelJob() {
    return this.post('/api/cancel', {})
  }

  /** Cancel the in-flight HyperFrames render (kills the CLI process tree) without
   * signalling the transcriber. No-op server-side when nothing is rendering. */
  renderCancel() {
    return this.post('/api/render-cancel', {})
  }

  startTranscription(params: TranscribeParams) {
    return this.post('/api/transcribe', params)
  }

  updateResult(result: TranscriptionResult) {
    return this.put('/api/result', result)
  }

  /** Re-run WhisperX forced alignment on edited segments (audio stays server-side). */
  realignSegments(segments: RealignSegmentPayload[], language?: string) {
    return this.post<{ segments: RealignSegmentPayload[] }>('/api/realign', { segments, language })
  }

  /** Mirror the renderer's UI state (settings + groups) so the agent can read it. */
  putUiState(state: unknown) {
    return this.put('/api/ui-state', state)
  }

  exportResult(params: unknown) {
    return this.post('/api/export', params)
  }

  renderVideo(params: unknown) {
    return this.post('/api/render-video', params)
  }

  /** Generate (and optionally render) a HyperFrames composition from the current result. */
  exportHyperframes(params: unknown) {
    return this.post<HyperframesExportResponse>('/api/export-hyperframes', params)
  }

  /**
   * Preflight the HyperFrames CLI the backend would drive. `compat_ok` is
   * tri-state: `true` (compatible), `false` (too old — `compat_reasons[0]` is the
   * remediation message), or `null` (probe failed / unknown — render still runs).
   * Pass `probe` to force a fresh probe (e.g. right after a re-provision).
   */
  getHyperframesStatus(probe = false) {
    const query = probe ? '?probe=1' : ''
    return this.get<HyperframesStatus>(`/api/hyperframes/status${query}`)
  }

  /** Approve or cancel an agent-triggered final render (the human-in-the-loop gate). */
  approveRender(id: string, approved: boolean) {
    return this.post('/api/render-approval', { id, approved })
  }

  /** Caption styles for the HyperFrames render path: 'classic' + registry styles. */
  listCaptionStyles(): Promise<Array<{ name: string; title: string }>> {
    return this.get<{ styles: Array<{ name: string; title: string }> }>('/api/caption-styles').then(
      (r) => r.styles ?? []
    )
  }

  // ── Co-author mode (agent owns the HyperFrames project) ────────────
  getCoauthor(): Promise<CoauthorStatus> {
    return this.get<CoauthorStatus>('/api/coauthor')
  }
  setCoauthor(enable: boolean): Promise<CoauthorStatus> {
    return this.post<CoauthorStatus>('/api/coauthor', { enable })
  }
  syncCaptions(): Promise<{ transcript: string; source: string; captions: string | null }> {
    return this.post('/api/coauthor/sync-captions', {})
  }

  getVideoInfo(filePath: string) {
    const token = encodeURIComponent(this.localToken)
    return this.get<VideoInfo>(
      `/api/video-info?path=${encodeURIComponent(filePath)}&token=${token}`
    )
  }

  audioUrl(filePath: string) {
    const token = encodeURIComponent(this.localToken)
    return `${this.base}/api/serve-audio?path=${encodeURIComponent(filePath)}&token=${token}`
  }

  // ── WebSocket progress stream ──────────────────────────────────────

  connectProgress(onProgress: (update: ProgressUpdate) => void) {
    this._onProgress = onProgress
    this._wsReconnectDelay = this._wsReconnectDelay ?? 1000
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer)
      this._wsReconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
    }

    this.ws = new WebSocket(`${this.wsBase}/ws/progress`)

    this.ws.onopen = () => {
      this._wsReconnectDelay = 1000
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string)
        // Control events (e.g. { type: 'result_updated' }) ride the same socket
        // but are not progress updates — ignore them here.
        if (raw && raw.type) return
        // Backend sends { status, progress, message, detail } (Pydantic model).
        // Map to the ProgressUpdate shape the frontend expects.
        const data: ProgressUpdate = {
          step: raw.step ?? raw.status ?? 'loading_model',
          pct: raw.pct ?? raw.progress ?? 0,
          message: raw.message ?? '',
          sub_message: raw.sub_message ?? raw.detail ?? undefined,
        }
        this._onProgress?.(data)
      } catch {
        /* ignore malformed */
      }
    }

    this.ws.onclose = () => {
      if (!this._onProgress) return
      const delay = this._wsReconnectDelay
      this._wsReconnectDelay = Math.min(delay * 2, 30_000)
      this._wsReconnectTimer = setTimeout(() => {
        if (this._onProgress) this.connectProgress(this._onProgress)
      }, delay)
    }

    this.ws.onerror = () => {
      /* triggers onclose → reconnect */
    }
  }

  disconnectProgress() {
    this._onProgress = null
    this._wsReconnectDelay = 1000
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer)
      this._wsReconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }

  // ── Control channel (agent-driven events) ──────────────────────────

  /**
   * Persistent listener for control events (transcript edits + style/emphasis
   * commands). Used on the results screen. Separate socket from progress so the
   * two lifecycles don't fight.
   */
  connectControl(handlers: ControlHandlers) {
    this._controlHandlers = handlers
    if (this._controlReconnectTimer) {
      clearTimeout(this._controlReconnectTimer)
      this._controlReconnectTimer = null
    }
    if (this.controlWs) {
      this.controlWs.onclose = null
      this.controlWs.close()
    }

    this.controlWs = new WebSocket(`${this.wsBase}/ws/progress`)

    this.controlWs.onopen = () => {
      this._controlReconnectDelay = 1000
      // A reopen (not the first connect) means the backend may have restarted and
      // dropped the live result/UI state — re-push the app's snapshot to restore it.
      if (this._controlHasConnected) void this.resyncAfterReconnect()
      this._controlHasConnected = true
    }

    this.controlWs.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string)
        if (!raw || !raw.type) return
        if (raw.type === 'result_updated') this._controlHandlers?.onResultUpdated?.()
        else if (raw.type === 'agent_command') {
          this._controlHandlers?.onCommand?.({ op: raw.op, payload: raw.payload })
        } else if (raw.type === 'render_approval_request') {
          this._controlHandlers?.onRenderApprovalRequest?.({
            id: raw.id,
            quality: raw.quality,
            video_format: raw.video_format,
          })
        } else if (raw.type === 'render_approval_resolved') {
          this._controlHandlers?.onRenderApprovalResolved?.(raw.id)
        }
      } catch {
        /* ignore malformed */
      }
    }

    this.controlWs.onclose = () => {
      const handlers = this._controlHandlers
      if (!handlers) return
      const delay = this._controlReconnectDelay
      this._controlReconnectDelay = Math.min(delay * 2, 30_000)
      this._controlReconnectTimer = setTimeout(() => {
        if (this._controlHandlers) this.connectControl(this._controlHandlers)
      }, delay)
    }

    this.controlWs.onerror = () => {
      /* triggers onclose → reconnect */
    }
  }

  disconnectControl() {
    this._controlHandlers = null
    this._controlReconnectDelay = 1000
    this._controlHasConnected = false
    if (this._controlReconnectTimer) {
      clearTimeout(this._controlReconnectTimer)
      this._controlReconnectTimer = null
    }
    if (this.controlWs) {
      this.controlWs.onclose = null
      this.controlWs.close()
      this.controlWs = null
    }
  }

  /**
   * Register a provider that returns the app's current result + UI state. Called
   * on control-socket reopen to restore state a restarted backend would have lost.
   * Pass `null` to clear it.
   */
  registerResync(provider: (() => ResyncSnapshot | null) | null) {
    this._resyncProvider = provider
  }

  /**
   * Re-push the live result + UI state to the backend. Best-effort: a failed PUT
   * (backend still coming up) is swallowed — the next reconnect retries. Safe to
   * call with no registered provider (no-op).
   */
  async resyncAfterReconnect(): Promise<void> {
    const snapshot = this._resyncProvider?.()
    if (!snapshot) return
    try {
      if (snapshot.result) await this.updateResult(snapshot.result)
      if (snapshot.uiState !== undefined) await this.putUiState(snapshot.uiState)
    } catch {
      /* backend not ready yet — the next reconnect will retry */
    }
  }
}

// Singleton — initialized lazily once the port is known
export const api = new CapForgeAPI()
