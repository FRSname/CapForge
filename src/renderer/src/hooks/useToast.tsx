/**
 * Lightweight toast notification system.
 *
 * Usage:
 *   1. Wrap your app: <ToastProvider>...</ToastProvider>
 *   2. In any component: const { toast } = useToast()
 *   3. Fire: toast('Exported!', 'success')  or  toast(err.message, 'error')
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id:      number
  message: string
  type:    ToastType
  /** Optional action button rendered inline. */
  action?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, action?: ToastItem['action']) => void
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

const DISMISS_MS = 4500

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const toast = useCallback((message: string, type: ToastType = 'info', action?: ToastItem['action']) => {
    const id = nextId.current++
    setItems(prev => [...prev, { id, message, type, action }])
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id))
    }, DISMISS_MS)
  }, [])

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast stack — fixed bottom-right */}
      {items.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
          {items.map(t => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2 px-3.5 py-2.5 rounded-lg shadow-lg border text-sm max-w-[360px] animate-toast-in"
              style={{
                background: t.type === 'error'   ? 'var(--color-error-bg,   #3b1c1c)'
                           : t.type === 'success' ? 'var(--color-success-bg, #1c2e1c)'
                           :                        'var(--color-surface-2)',
                borderColor: t.type === 'error'   ? 'var(--color-error-border,   #5c2a2a)'
                           : t.type === 'success' ? 'var(--color-success-border, #2a4a2a)'
                           :                        'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {/* Icon */}
              <span className="shrink-0 text-xs" style={{
                color: t.type === 'error'   ? '#f87171'
                     : t.type === 'success' ? '#4ade80'
                     :                        'var(--color-accent)',
              }}>
                {t.type === 'error'   && <ErrorIcon />}
                {t.type === 'success' && <CheckIcon />}
                {t.type === 'info'    && <InfoIcon />}
              </span>

              <span className="flex-1 min-w-0 text-xs leading-snug break-words">{t.message}</span>

              {t.action && (
                <button
                  className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
                  style={{ color: 'var(--color-accent)' }}
                  onClick={t.action.onClick}
                >
                  {t.action.label}
                </button>
              )}

              <button
                className="shrink-0 text-xs opacity-40 hover:opacity-80 transition-opacity"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

// ── Icons ──────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 1 0-1.06-1.06L8 6.94 6.03 4.97Z" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-3a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0v-4.5A.75.75 0 0 0 8 5Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  )
}
