/**
 * Live-sync bridge for the MCP control layer (Milestone A).
 *
 * While the results screen is active, this opens a persistent control channel to
 * the backend. When a local Claude agent edits the transcript, the backend
 * broadcasts `result_updated`; we re-fetch and push the change into the editor.
 *
 * Soft lock: if the user is mid-edit in a text field, we don't clobber their
 * work — the update is queued and surfaced via a banner with an explicit Apply.
 *
 * Lives in its own component (a child of ToastProvider) so it can use useToast,
 * which App.tsx — being the provider's parent — cannot.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, normalizeResult } from '../lib/api'
import type { TranscriptionResult } from '../types/app'
import { useToast } from '../hooks/useToast'

interface AgentLiveSyncProps {
  /** True while the results screen is showing — gates the control connection. */
  active: boolean
  /** Apply an agent transcript edit to the live editor (pushes undo). */
  applyResult: (result: TranscriptionResult) => void
}

function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node || !node.tagName) return false
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable
}

export function AgentLiveSync({ active, applyResult }: AgentLiveSyncProps) {
  const { toast } = useToast()
  const editingRef = useRef(false)
  const [pending, setPending] = useState<TranscriptionResult | null>(null)

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
          toast('Agent updated the transcript while you were editing.', 'info')
        } else {
          applyResult(result)
          toast('Agent updated the transcript.', 'info')
        }
      } catch {
        /* best-effort — a failed fetch just means no live update this time */
      }
    }

    void (async () => {
      try {
        api.setPort(await window.subforge.getBackendPort())
      } catch {
        /* fall back to the default port already set on the singleton */
      }
      if (!cancelled) api.connectControl(() => void handleResultUpdated())
    })()

    return () => {
      cancelled = true
      api.disconnectControl()
      setPending(null)
    }
  }, [active, applyResult, toast])

  const applyPending = useCallback(() => {
    setPending((p) => {
      if (p) applyResult(p)
      return null
    })
  }, [applyResult])

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
