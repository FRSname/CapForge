/**
 * CapForge API client — TypeScript port of renderer/js/api.js.
 * Communicates with the Python FastAPI backend over REST + WebSocket.
 */

import type { TranscriptionResult as AppTranscriptionResult } from '../types/app'
import type { LibraryChangedEvent, LibraryRecord, LibraryVideo } from './libraryTypes'
import { parseLibraryChangedEvent, parseLibraryList, parseLibraryRecord } from './libraryTypes'
import type { Brief, Moment, PublishRecord, UploadPackage, Violation } from './publishTypes'
import { channelsBody } from './importChannels'
import {
  parseBrief,
  parseMoments,
  parsePublishRecord,
  parseUploadPackage,
  parseViolations,
} from './publishTypes'

/** `DELETE /api/library/{id}?mode=` — hide the record, or hand back its folder. */
export type LibraryDeleteMode = 'remove' | 'detach'

/** `POST /api/library/migrate-studio` — what the first-launch pass did. */
export interface LibraryMigrationResult {
  imported: string[]
  skipped: Array<{ folder: string; reason: string }>
}

export interface ApiError extends Error {
  title?: string
  hint?: string
  raw?: string
}

/** One entry of FastAPI's 422 `detail` array. */
interface ValidationIssue {
  loc?: unknown[]
  msg?: string
}

/** How many field errors to name before summarising the rest. */
const MAX_REPORTED_ISSUES = 3

/** The record moved under us — someone else (the agent) wrote it first. */
const HTTP_CONFLICT = 409
/** The backend's hard validators refused the write. */
const HTTP_UNPROCESSABLE = 422

/**
 * A `PATCH` lost the `If-Match` race: the agent wrote the record between our
 * read and our write. `current` is the record as it is **now** when the backend
 * sent one back, null when its body carried nothing usable — either way the
 * caller must reconcile rather than retry blindly.
 */
export class StaleRecordError extends Error {
  readonly current: PublishRecord | null
  constructor(message: string, current: PublishRecord | null) {
    super(message)
    this.name = 'StaleRecordError'
    this.current = current
  }
}

/**
 * The backend refused the write because it broke a **hard** rule
 * (`backend/library/validate.py` — the one implementation). The findings are
 * rendered under the fields they name; the user's draft is kept.
 */
export class ValidationRefusedError extends Error {
  readonly violations: Violation[]
  constructor(message: string, violations: Violation[]) {
    super(message)
    this.name = 'ValidationRefusedError'
    this.violations = violations
  }
}

/** `POST /api/library/validate` — unsaved panel text validates too. */
export interface ValidateFieldsRequest {
  fields?: Record<string, unknown>
  duration?: number
  video_id?: string
}

/**
 * The `current` record a `409` body carries, or null when it carried nothing
 * usable. A malformed copy is not worth failing the collision over — the caller
 * refetches either way; it just loses the free one.
 */
function recordOrNull(value: unknown): PublishRecord | null {
  try {
    return parsePublishRecord(value)
  } catch {
    return null
  }
}

/** A record was written somewhere else (agent, promote, import) — `by` is the actor. */
export interface RecordUpdatedEvent {
  videoId: string
  rev: number
  by: string
}

/**
 * Turn FastAPI's 422 `detail` array into something a user can act on.
 *
 * `[{loc: ["body","config","max_width"], msg: "Input should be a valid number"}]`
 * becomes `config.max_width: Input should be a valid number`. The leading
 * "body"/"query" segment is dropped — it names the request part, not a field.
 */
export function formatValidationDetail(detail: unknown[]): string {
  const issues = detail.filter(
    (item): item is ValidationIssue => typeof item === 'object' && item !== null
  )
  if (issues.length === 0) return ''

  const described = issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = Array.isArray(issue.loc)
      ? issue.loc
          .filter((part) => part !== 'body' && part !== 'query' && part !== 'path')
          .join('.')
      : ''
    const msg = issue.msg ?? 'is invalid'
    return path ? `${path}: ${msg}` : msg
  })

  const remaining = issues.length - described.length
  return remaining > 0
    ? `${described.join('; ')} (+${remaining} more)`
    : described.join('; ')
}

export interface TranscribeParams {
  audio_path: string
  language?: string
  /** Whisper model name; omit for the backend's hardware-recommended default. */
  model?: string
  enable_diarization?: boolean
  hf_token?: string
  output_dir?: string
  export_formats?: string[]
  /**
   * Free the Whisper + alignment models once the job finishes. Costs a cold
   * start on the next run; hands the memory back while the user edits.
   */
  release_model_after?: boolean
}

/**
 * `POST /api/warm` response. `status: 'busy'` means a job already holds the
 * backend — the warm was skipped, which is not an error.
 */
export interface WarmResponse {
  status: 'warm' | 'busy'
  model?: string
  device?: string
  loaded_ms?: number
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
  alignment_degraded?: boolean
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
    alignmentDegraded: raw.alignment_degraded ?? false,
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
  // `record_updated` listeners (the Publish workspace). Kept off ControlHandlers
  // so the control socket's owner (AgentLiveSync) is untouched by publish work.
  private _recordUpdatedSubs = new Set<(event: RecordUpdatedEvent) => void>()
  // `library_changed` listeners (the library list): the watcher's imports.
  private _libraryChangedSubs = new Set<(event: LibraryChangedEvent) => void>()

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

  private bridgeReady: Promise<void> | null = null

  /**
   * Resolve the backend port + local token from Electron once, before the
   * first authenticated request. Every transport helper awaits this, so a
   * hook that fetches on mount (the library list, the publish record) no
   * longer races the async hand-over that used to live only in AgentLiveSync
   * — that race showed as an empty library after a fresh launch. Absent
   * `window.subforge` (node tests) it resolves at once; an IPC failure
   * rejects the request and clears the memo so the next call retries.
   */
  ensureBridge(): Promise<void> {
    if (typeof window === 'undefined' || !window.subforge) return Promise.resolve()
    if (!this.bridgeReady) {
      this.bridgeReady = Promise.all([
        window.subforge.getBackendPort(),
        window.subforge.getLocalToken(),
      ])
        .then(([port, token]) => {
          this.setPort(port)
          this.setLocalToken(token)
        })
        .catch((err: unknown) => {
          this.bridgeReady = null
          throw err
        })
    }
    return this.bridgeReady
  }

  /** Forget the resolved bridge (tests; a fresh launch never needs it). */
  resetBridge(): void {
    this.bridgeReady = null
  }

  private async handleError(res: Response): Promise<ApiError> {
    const fallback = { detail: res.statusText }
    const body = await res.json().catch(() => fallback)
    return this.errorFromBody(res, body)
  }

  /**
   * The formatting half of `handleError`, split out because a response body can
   * only be read once: the `PATCH` path has to inspect the parsed body itself
   * (409/422 carry structured data) before falling back to a generic message.
   */
  private errorFromBody(res: Response, body: { detail?: unknown }): ApiError {
    const detail = body?.detail
    const err = new Error() as ApiError
    const structured =
      detail && typeof detail === 'object' && !Array.isArray(detail)
        ? (detail as { title?: string; hint?: string; raw?: string })
        : null
    if (structured?.title) {
      err.title = structured.title
      err.hint = structured.hint ?? ''
      err.raw = structured.raw ?? ''
      err.message = structured.hint ? `${structured.title} — ${structured.hint}` : structured.title
    } else if (Array.isArray(detail)) {
      // FastAPI validation failure (422). Without this the user only ever sees
      // the bare status phrase "Unprocessable Entity", which says nothing about
      // which field the backend rejected.
      err.message = formatValidationDetail(detail) || res.statusText
    } else {
      err.message = typeof detail === 'string' ? detail : res.statusText
    }
    return err
  }

  /** Format a refused response's parsed body the way every transport here does. */
  apiError(res: Response, body: unknown): ApiError {
    const shaped = body && typeof body === 'object' ? (body as { detail?: unknown }) : {}
    return this.errorFromBody(res, shaped)
  }

  /**
   * The raw authenticated request for sibling client modules (`libraryApi.ts`)
   * that must read a refused body themselves. Awaits the bridge and attaches
   * the local token like every other transport; the caller checks `res.ok`.
   */
  async sendWithLocalToken(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<Response> {
    await this.ensureBridge()
    const headers: Record<string, string> = {}
    if (this.localToken) headers['X-CapForge-Local-Token'] = this.localToken
    if (body === undefined) return fetch(`${this.base}${path}`, { method, headers })
    if (body instanceof Blob) {
      // Raw bytes (an uploaded image) go as they are, typed by the blob.
      headers['Content-Type'] = body.type || 'application/octet-stream'
      return fetch(`${this.base}${path}`, { method, headers, body })
    }
    headers['Content-Type'] = 'application/json'
    return fetch(`${this.base}${path}`, { method, headers, body: JSON.stringify(body) })
  }

  private async get<T>(path: string): Promise<T> {
    await this.ensureBridge()
    const res = await fetch(`${this.base}${path}`)
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  /** GET with the local token attached — the one place that header is built for a GET. */
  private async fetchWithLocalToken(path: string): Promise<Response> {
    await this.ensureBridge()
    const headers: Record<string, string> = {}
    if (this.localToken) headers['X-CapForge-Local-Token'] = this.localToken
    return fetch(`${this.base}${path}`, { headers })
  }

  /** GET a specifically auth-gated local route without changing generic GET semantics. */
  private async getWithLocalToken<T>(path: string): Promise<T> {
    const res = await this.fetchWithLocalToken(path)
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    await this.ensureBridge()
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
    await this.ensureBridge()
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

  /**
   * PATCH an auth-gated library route. `ifMatch` is the record revision the
   * caller read — the backend refuses the write with a `409` when the record
   * has moved on, which is what makes an agent/user collision *render* instead
   * of silently overwriting (vision §9.7).
   *
   * The two structured refusals are detected **by status, before** the generic
   * formatter, because their bodies carry data the panel has to show: a `409`'s
   * `current` record and a `422`'s `violations`.
   */
  private async patch<T>(path: string, body: unknown, ifMatch?: number): Promise<T> {
    await this.ensureBridge()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.localToken) headers['X-CapForge-Local-Token'] = this.localToken
    if (ifMatch !== undefined) headers['If-Match'] = String(ifMatch)
    const res = await fetch(`${this.base}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
    if (res.ok) return res.json() as Promise<T>

    const raw = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = typeof raw?.detail === 'string' ? raw.detail : res.statusText
    if (res.status === HTTP_CONFLICT && raw && 'current' in raw) {
      throw new StaleRecordError(detail, recordOrNull(raw.current))
    }
    if (res.status === HTTP_UNPROCESSABLE && Array.isArray(raw?.violations)) {
      throw new ValidationRefusedError(detail, parseViolations(raw.violations))
    }
    throw this.errorFromBody(res, raw)
  }

  private async del<T>(path: string): Promise<T> {
    await this.ensureBridge()
    const res = await fetch(`${this.base}${path}`, { method: 'DELETE' })
    if (!res.ok) throw await this.handleError(res)
    return res.json() as Promise<T>
  }

  /** DELETE an auth-gated local route (the library ones) — same shape as `del`. */
  private async delWithLocalToken<T>(path: string): Promise<T> {
    await this.ensureBridge()
    const headers: Record<string, string> = {}
    if (this.localToken) headers['X-CapForge-Local-Token'] = this.localToken
    const res = await fetch(`${this.base}${path}`, { method: 'DELETE', headers })
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
    // Font pickers can mount before TranscriptionSettings/useTranscription initialize
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

  /**
   * Pre-load the Whisper model so the first transcription skips the cold start.
   * Fire-and-forget: a failure (or `status: 'busy'`) just means the old
   * load-on-demand path. Omitting `model` lets the backend pick its
   * hardware-recommended default, matching `startTranscription`.
   */
  warm(model?: string): Promise<WarmResponse> {
    return this.post<WarmResponse>('/api/warm', { model: model || undefined })
  }

  updateResult(result: TranscriptionResult) {
    return this.put('/api/result', result)
  }

  /** Re-run WhisperX forced alignment on edited segments (audio stays server-side). */
  realignSegments(segments: RealignSegmentPayload[], language?: string) {
    return this.post<{ segments: RealignSegmentPayload[]; alignment_degraded: boolean }>(
      '/api/realign',
      { segments, language }
    )
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

  /**
   * v3 library — the stored v2 project JSON of one record (`404` when the
   * record has no session snapshot yet). The library routes accept either the
   * agent token or the per-launch local token; the renderer has the latter.
   * Returned untyped on purpose: `planProjectRestore` is the trust boundary
   * every `.capforge` payload goes through, whatever opened it.
   */
  getLibraryProject(id: string): Promise<unknown> {
    return this.getWithLocalToken<unknown>(`/api/library/${encodeURIComponent(id)}/project`)
  }

  /**
   * The library home screen's list. Parsed at the boundary
   * (`lib/libraryTypes.ts`) rather than cast: everything on a card is addressed
   * by `id`/`sourcePath`, so a malformed row must fail loudly here.
   */
  listLibrary(): Promise<LibraryVideo[]> {
    return this.getWithLocalToken<unknown>('/api/library').then(parseLibraryList)
  }

  /**
   * Create-or-return the record for a media file (`201` new, `200` known) —
   * the create-on-drop path taken by Start, `load_video` and a project restore.
   */
  /** `channels` gives the new record a post per channel; an empty choice sends no key. */
  createLibraryRecord(sourcePath: string, channels?: readonly string[]): Promise<LibraryRecord> {
    return this.post<unknown>('/api/library', {
      source_path: sourcePath,
      ...channelsBody(channels),
    }).then(parseLibraryRecord)
  }

  /**
   * Store the live session snapshot in its record. This is the **primary**
   * durable write; `autosave.json` is only the fallback when it fails.
   */
  putLibraryProject(id: string, project: unknown): Promise<{ rev: number }> {
    return this.put<{ rev: number }>(`/api/library/${encodeURIComponent(id)}/project`, project)
  }

  /**
   * `remove` hides the record but keeps every file; `detach` un-indexes it and
   * returns the folder for Electron to trash — the backend never deletes user
   * files itself.
   */
  deleteLibraryRecord(
    id: string,
    mode: LibraryDeleteMode
  ): Promise<{ status: string; mode: LibraryDeleteMode; folder?: string }> {
    return this.delWithLocalToken(
      `/api/library/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`
    )
  }

  /** Adopt a `.capforge` file on disk as a record (Import project files…). */
  importLibraryProject(path: string, channels?: readonly string[]): Promise<LibraryRecord> {
    return this.post<unknown>('/api/library/import-project', {
      path,
      ...channelsBody(channels),
    }).then(parseLibraryRecord)
  }

  /** First-launch migration of pre-v3 studio workspaces into records. */
  migrateStudioWorkspaces(): Promise<LibraryMigrationResult> {
    return this.post<LibraryMigrationResult>('/api/library/migrate-studio', {})
  }

  // ── Publish workspace (the dossier, the brief, the validators) ────
  /**
   * The record view of one library entry — the whole dossier the Publish panel
   * edits. Parsed at the boundary (`lib/publishTypes.ts`) like the list is.
   */
  getLibraryRecord(id: string): Promise<PublishRecord> {
    return this.getWithLocalToken<unknown>(`/api/library/${encodeURIComponent(id)}`).then(
      parsePublishRecord
    )
  }

  /**
   * Write authored fields, guarded by the revision the panel last read.
   * Throws `StaleRecordError` (409) when the agent got there first and
   * `ValidationRefusedError` (422) when a hard rule refused the write.
   */
  patchLibraryRecord(
    id: string,
    patch: Record<string, unknown>,
    rev: number
  ): Promise<PublishRecord> {
    return this.patch<unknown>(`/api/library/${encodeURIComponent(id)}`, patch, rev).then(
      parsePublishRecord
    )
  }

  /** The channel brief — a view of the primary channel (Settings → Channels). No If-Match. */
  getBrief(): Promise<Brief> {
    return this.getWithLocalToken<unknown>('/api/library/brief').then(parseBrief)
  }

  patchBrief(patch: Record<string, unknown>): Promise<Brief> {
    return this.patch<unknown>('/api/library/brief', patch).then(parseBrief)
  }

  /**
   * Run the validators over **unsaved** panel text. The rules themselves live
   * in Python once (`backend/library/validate.py`); the renderer only meters,
   * snaps and formats.
   */
  validateFields(request: ValidateFieldsRequest): Promise<Violation[]> {
    return this.post<unknown>('/api/library/validate', request).then(parseViolations)
  }

  /**
   * The rendered upload package — returned even when it violates something.
   * `lang` renders a stored localized language (404 for one with no entry);
   * `platform` picks the YouTube package or a LinkedIn / X / Instagram post.
   */
  getUploadPackage(id: string, lang?: string): Promise<UploadPackage> {
    const langQuery = lang ? `?lang=${encodeURIComponent(lang)}` : ''
    return this.getWithLocalToken<unknown>(
      `/api/library/${encodeURIComponent(id)}/package${langQuery}`
    ).then(parseUploadPackage)
  }

  /** Chapter candidates from the stored transcript (`pause` / `speaker_change`). */
  getLibraryMoments(id: string, kind: string): Promise<Moment[]> {
    return this.getWithLocalToken<unknown>(
      `/api/library/${encodeURIComponent(id)}/moments?kind=${encodeURIComponent(kind)}`
    ).then(parseMoments)
  }

  /**
   * Subscribe to `record_updated` pushes (the control channel's fifth event).
   * A set of subscribers rather than another `ControlHandlers` slot on purpose:
   * `AgentLiveSync` owns the handler object and must not grow a publish concern.
   * Returns the unsubscribe.
   */
  onRecordUpdated(cb: (event: RecordUpdatedEvent) => void): () => void {
    this._recordUpdatedSubs.add(cb)
    return () => {
      this._recordUpdatedSubs.delete(cb)
    }
  }

  /** Subscribe to `library_changed` pushes (the watch folder imported). Returns the unsubscribe. */
  onLibraryChanged(cb: (event: LibraryChangedEvent) => void): () => void {
    this._libraryChangedSubs.add(cb)
    return () => {
      this._libraryChangedSubs.delete(cb)
    }
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
        } else if (raw.type === 'record_updated') {
          // A dossier write landed (agent, promote, import) — tell every
          // subscriber which record moved and to which revision.
          const event: RecordUpdatedEvent = {
            videoId: String(raw.video_id ?? ''),
            rev: Number(raw.rev ?? 0),
            by: String(raw.by ?? ''),
          }
          for (const sub of this._recordUpdatedSubs) sub(event)
        } else if (raw.type === 'library_changed') {
          const event = parseLibraryChangedEvent(raw)
          for (const sub of this._libraryChangedSubs) sub(event)
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
