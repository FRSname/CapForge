/**
 * Live-sync bridge for the MCP control layer.
 *
 * Owns the single control channel for the whole session and routes agent-driven
 * events:
 *   - result_updated  → re-fetch transcript and apply (soft-locked while editing)
 *   - agent_command   → set_settings / apply_preset (style), set_word_overrides
 *                       (keyword emphasis), load_video (import + transcribe),
 *                       applied live to renderer state.
 *
 * The socket is connected on EVERY screen, not just results. `load_video` has to
 * reach the app while it sits on the drop screen with nothing loaded — that is the
 * entry point of the whole batch flow — so a results-only connection would drop it
 * silently. Handlers that only make sense with a loaded project are individually
 * screen-guarded instead (see `resultsActive`).
 *
 * All callbacks/state are held in refs so the control connection stays stable
 * (one socket) rather than reconnecting on every settings change. Lives inside
 * ToastProvider so it can use useToast (App, the provider's parent, cannot).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, normalizeResult, type AgentCommand, type RenderApprovalRequest } from '../lib/api'
import type { TranscriptionResult } from '../types/app'
import type { StudioSettings } from './studio/StudioPanel'
import type { WordOverrideEdit } from '../lib/project'
import type { UserPreset } from '../hooks/useUserPresets'
import { applySettingsCommand, resolvePreset, toastMessageForCommand } from '../lib/agentCommands'
import { useToast } from '../hooks/useToast'

interface AgentLiveSyncProps {
  /** True while the results screen is up — gates transcript/style handlers. */
  resultsActive: boolean
  /** Current studio settings — read when applying a style command. */
  settings: StudioSettings
  /** User preset library — `apply_preset` resolves against this first. */
  userPresets: UserPreset[]
  /** Apply an agent transcript edit to the live editor (pushes undo). */
  applyResult: (result: TranscriptionResult) => void
  /** Apply a new StudioSettings (set_settings / apply_preset). */
  applySettings: (next: StudioSettings) => void
  /** Merge per-word overrides onto group words (emphasis). */
  applyWordOverrides: (edits: WordOverrideEdit[]) => void
  /**
   * Record the canonical name of a preset the agent just applied. Sticky —
   * App keeps it until another preset replaces it or the session resets, so
   * `apply_preset` → `set_style` tweak → `render` still reports the basis preset.
   */
  onPresetApplied: (name: string) => void
  /** Load a video and start transcription (op: load_video). Returns a failure reason. */
  loadVideo: (path: string) => string | null
}

function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node || !node.tagName) return false
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable
}

export function AgentLiveSync({
  resultsActive,
  settings,
  userPresets,
  applyResult,
  applySettings,
  applyWordOverrides,
  onPresetApplied,
  loadVideo,
}: AgentLiveSyncProps) {
  const { toast } = useToast()
  const editingRef = useRef(false)
  const [pending, setPending] = useState<TranscriptionResult | null>(null)
  // An agent-triggered final render awaiting the user's approve/cancel.
  const [renderReq, setRenderReq] = useState<RenderApprovalRequest | null>(null)

  // Hold everything the control handlers need in refs so the connection effect
  // can have an empty dep list and never reconnect mid-session.
  const resultsActiveRef = useRef(resultsActive)
  const settingsRef = useRef(settings)
  const userPresetsRef = useRef(userPresets)
  const applyResultRef = useRef(applyResult)
  const applySettingsRef = useRef(applySettings)
  const applyWordOverridesRef = useRef(applyWordOverrides)
  const onPresetAppliedRef = useRef(onPresetApplied)
  const loadVideoRef = useRef(loadVideo)
  const toastRef = useRef(toast)
  resultsActiveRef.current = resultsActive
  settingsRef.current = settings
  userPresetsRef.current = userPresets
  applyResultRef.current = applyResult
  applySettingsRef.current = applySettings
  applyWordOverridesRef.current = applyWordOverrides
  onPresetAppliedRef.current = onPresetApplied
  loadVideoRef.current = loadVideo
  toastRef.current = toast

  // Soft lock — track whether a text field currently has focus.
  useEffect(() => {
    if (!resultsActive) return
    const onFocusIn = (e: FocusEvent) => {
      editingRef.current = isEditableTarget(e.target)
    }
    const onFocusOut = () => {
      editingRef.current = false
    }
    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('focusout', onFocusOut)
    return () => {
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('focusout', onFocusOut)
      editingRef.current = false
    }
  }, [resultsActive])

  // Control channel — one socket for the whole session, every screen.
  useEffect(() => {
    let cancelled = false

    const handleResultUpdated = async () => {
      // Only meaningful with a project open — off the results screen there is
      // no editor to apply the transcript to.
      if (!resultsActiveRef.current) return
      try {
        const result = normalizeResult(await api.getResult())
        if (cancelled) return
        if (editingRef.current) {
          setPending(result)
          toastRef.current('Agent updated the transcript while you were editing.', 'info')
        } else {
          applyResultRef.current(result)
          toastRef.current('Agent updated the transcript.', 'info')
        }
      } catch {
        /* best-effort */
      }
    }

    const handleCommand = (cmd: AgentCommand) => {
      try {
        // Works on every screen — this is how a batch run starts a video.
        if (cmd.op === 'load_video') {
          const path = String(cmd.payload?.path ?? '')
          const failure = loadVideoRef.current(path)
          toastRef.current(
            failure ?? 'Agent loaded a video — transcribing…',
            failure ? 'error' : 'info'
          )
          return
        }

        // Everything below edits a loaded project; ignore it off the results
        // screen rather than mutating state the user can't see.
        if (!resultsActiveRef.current) return

        if (cmd.op === 'set_word_overrides') {
          const edits = (cmd.payload?.edits ?? []) as WordOverrideEdit[]
          applyWordOverridesRef.current(edits)
          toastRef.current('Agent restyled words.', 'info')
          return
        }

        const next = applySettingsCommand(settingsRef.current, cmd, userPresetsRef.current)
        if (next) {
          // Resolve again for the canonical spelling — the agent may have sent
          // a differently-cased name, and `appliedPreset` is what the MCP tool
          // compares against to confirm the apply landed.
          const resolved =
            cmd.op === 'apply_preset'
              ? resolvePreset(cmd.payload?.name, userPresetsRef.current)
              : null
          applySettingsRef.current(next)
          if (resolved) onPresetAppliedRef.current(resolved.name)
          const { message, type } = toastMessageForCommand(cmd, resolved?.name)
          toastRef.current(message, type)
        }
      } catch {
        /* ignore malformed command */
      }
    }

    void (async () => {
      try {
        api.setPort(await window.subforge.getBackendPort())
        api.setLocalToken(await window.subforge.getLocalToken())
      } catch {
        /* fall back to the default port */
      }
      if (!cancelled) {
        api.connectControl({
          onResultUpdated: () => void handleResultUpdated(),
          onCommand: handleCommand,
          onRenderApprovalRequest: (req) => setRenderReq(req),
          // Resolved elsewhere (timeout / another window) — drop the prompt.
          onRenderApprovalResolved: (id) => setRenderReq((r) => (r && r.id === id ? null : r)),
        })
      }
    })()

    return () => {
      cancelled = true
      api.disconnectControl()
      setPending(null)
      setRenderReq(null)
    }
    // Empty deps: one socket for the session. Everything the handlers read
    // lives in refs, so this must never re-run and churn the connection.
  }, [])

  const applyPending = useCallback(() => {
    setPending((p) => {
      if (p) applyResultRef.current(p)
      return null
    })
  }, [])

  // Approve/cancel the agent's pending render; the backend is blocked until we reply.
  const respondRender = useCallback((approved: boolean) => {
    setRenderReq((req) => {
      if (req) void api.approveRender(req.id, approved)
      return null
    })
  }, [])

  if (!pending && !renderReq) return null

  return (
    <>
      {renderReq && (
        <div
          className="app-no-drag fixed inset-0 z-[var(--z-modal)] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="render-approval-title"
        >
          <div
            className="mx-4 w-full max-w-sm rounded-xl border p-5 shadow-2xl"
            style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}
          >
            <h2
              id="render-approval-title"
              className="text-sm font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              Render the final video?
            </h2>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
              The agent is ready to render the full video
              {renderReq.quality ? ` at ${renderReq.quality} quality` : ''}
              {renderReq.video_format ? ` (${renderReq.video_format.toUpperCase()})` : ''}. This
              takes a while. Approve to start, or cancel to keep iterating with previews.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs"
                style={{ color: 'var(--color-text-3)' }}
                onClick={() => respondRender(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs font-medium"
                style={{ background: 'var(--color-accent)', color: '#fff' }}
                onClick={() => respondRender(true)}
              >
                Render
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div
          className="app-no-drag fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex items-center gap-3 rounded-lg border px-4 py-2 shadow-lg"
          style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}
          role="status"
        >
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>
            Agent updated the transcript.
          </span>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
            onClick={applyPending}
          >
            Apply
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs"
            style={{ color: 'var(--color-text-3)' }}
            onClick={() => setPending(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  )
}
