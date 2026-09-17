/**
 * `confirm()` as an in-app dialog.
 *
 * Usage:
 *   1. Wrap the app: <ConfirmProvider>…</ConfirmProvider> (main.tsx does it)
 *   2. In any component or hook: const confirm = useConfirm()
 *   3. Ask: if (!(await confirm({ title: 'Delete this preset?', danger: true }))) return
 *
 * Reading the hook without a provider is deliberately harmless — the renderer's
 * tests mount components on their own — but *calling* it then throws, because a
 * confirm that silently resolves either way would be a data-loss bug.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { queueRequest } from '../lib/confirmQueue'
import type { Pending } from '../lib/confirmQueue'

export interface ConfirmOptions {
  title: string
  /** May contain newlines; they are preserved. */
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive actions confirm in red. */
  danger?: boolean
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(() => {
  throw new Error('useConfirm needs a ConfirmProvider above it')
})

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending<ConfirmOptions> | null>(null)
  // The ref, not the state, is what `queueRequest` reads: a request may arrive
  // before React has re-rendered the previous one, and settling the superseded
  // promise inside a state updater would run that side effect twice under
  // StrictMode.
  const pendingRef = useRef<Pending<ConfirmOptions> | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const queued = queueRequest(pendingRef.current, { options, resolve })
        // The question it replaced was never answered, so it is a cancel.
        queued.superseded?.resolve(false)
        pendingRef.current = queued.pending
        setPending(queued.pending)
      }),
    []
  )

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    current?.resolve(confirmed)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.options.title ?? ''}
        body={pending?.options.body}
        confirmLabel={pending?.options.confirmLabel}
        cancelLabel={pending?.options.cancelLabel}
        danger={pending?.options.danger}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}
