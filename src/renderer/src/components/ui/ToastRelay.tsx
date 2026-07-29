import { useEffect } from 'react'
import { useToast, type ToastType } from '../../hooks/useToast'

interface ToastRelayProps {
  /** Message to surface, or null when there is nothing pending. */
  message: string | null
  type?: ToastType
  /** Called once the message has been handed to the toast system. */
  onShown: () => void
}

/**
 * Relays a message from App-level state into the toast system.
 *
 * `App` renders `ToastProvider` itself, so it sits *above* the context and
 * cannot call `useToast()` in its own scope. Anything App wants to report —
 * e.g. a project restore that failed to reach the backend — is stashed in
 * state and rendered through this component, which lives inside the provider.
 */
export function ToastRelay({ message, type = 'error', onShown }: ToastRelayProps) {
  const { toast } = useToast()

  useEffect(() => {
    if (!message) return
    toast(message, type)
    onShown()
  }, [message, type, toast, onShown])

  return null
}
