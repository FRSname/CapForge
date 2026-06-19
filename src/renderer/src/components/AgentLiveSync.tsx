/**
 * Live-sync bridge for the MCP control layer.
 *
 * Owns the single control channel while the results screen is active and routes
 * agent-driven events:
 *   - result_updated  → re-fetch transcript and apply (soft-locked while editing)
 *   - agent_command   → set_settings / apply_preset (style) and set_word_overrides
 *                       (keyword emphasis), applied live to renderer state.
 *
 * All callbacks/state are held in refs so the control connection stays stable
 * (one socket) rather than reconnecting on every settings change. Lives inside
 * ToastProvider so it can use useToast (App, the provider's parent, cannot).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, normalizeResult, type AgentCommand } from '../lib/api'
import type { EffectClip, TranscriptionResult } from '../types/app'
import type { StudioSettings } from './studio/StudioPanel'
import type { WordOverrideEdit } from '../lib/project'
import { applySettingsCommand } from '../lib/agentCommands'
import { useToast } from '../hooks/useToast'

interface AgentLiveSyncProps {
  active: boolean
  /** Current studio settings — read when applying a style command. */
  settings: StudioSettings
  /** Apply an agent transcript edit to the live editor (pushes undo). */
  applyResult: (result: TranscriptionResult) => void
  /** Apply a new StudioSettings (set_settings / apply_preset). */
  applySettings: (next: StudioSettings) => void
  /** Merge per-word overrides onto group words (emphasis). */
  applyWordOverrides: (edits: WordOverrideEdit[]) => void
  /** Replace the effects timeline (after the agent adds/removes effects). */
  applyEffects: (effects: EffectClip[]) => void
}

function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node || !node.tagName) return false
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable
}

export function AgentLiveSync({
  active,
  settings,
  applyResult,
  applySettings,
  applyWordOverrides,
  applyEffects,
}: AgentLiveSyncProps) {
  const { toast } = useToast()
  const editingRef = useRef(false)
  const [pending, setPending] = useState<TranscriptionResult | null>(null)

  // Hold everything the control handlers need in refs so the connection effect
  // can depend only on `active` and never reconnect mid-session.
  const settingsRef = useRef(settings)
  const applyResultRef = useRef(applyResult)
  const applySettingsRef = useRef(applySettings)
  const applyWordOverridesRef = useRef(applyWordOverrides)
  const applyEffectsRef = useRef(applyEffects)
  const toastRef = useRef(toast)
  settingsRef.current = settings
  applyResultRef.current = applyResult
  applySettingsRef.current = applySettings
  applyWordOverridesRef.current = applyWordOverrides
  applyEffectsRef.current = applyEffects
  toastRef.current = toast

  // Soft lock — track whether a text field currently has focus.
  useEffect(() => {
    if (!active) return
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
  }, [active])

  // Control channel — connect on results screen, disconnect on leave.
  useEffect(() => {
    if (!active) return
    let cancelled = false

    const handleResultUpdated = async () => {
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
        if (cmd.op === 'set_word_overrides') {
          const edits = (cmd.payload?.edits ?? []) as WordOverrideEdit[]
          applyWordOverridesRef.current(edits)
          toastRef.current('Agent restyled words.', 'info')
          return
        }
        const next = applySettingsCommand(settingsRef.current, cmd)
        if (next) {
          applySettingsRef.current(next)
          toastRef.current(
            cmd.op === 'apply_preset' ? 'Agent applied a preset.' : 'Agent updated the style.',
            'info'
          )
        }
      } catch {
        /* ignore malformed command */
      }
    }

    const handleEffectsUpdated = async () => {
      try {
        applyEffectsRef.current(await api.getEffects())
        toastRef.current('Agent updated effects.', 'info')
      } catch {
        /* best-effort */
      }
    }

    void (async () => {
      try {
        api.setPort(await window.subforge.getBackendPort())
      } catch {
        /* fall back to the default port */
      }
      if (!cancelled) {
        api.connectControl({
          onResultUpdated: () => void handleResultUpdated(),
          onCommand: handleCommand,
          onEffectsUpdated: () => void handleEffectsUpdated(),
        })
      }
    })()

    return () => {
      cancelled = true
      api.disconnectControl()
      setPending(null)
    }
  }, [active])

  const applyPending = useCallback(() => {
    setPending((p) => {
      if (p) applyResultRef.current(p)
      return null
    })
  }, [])

  if (!pending) return null

  return (
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
  )
}
