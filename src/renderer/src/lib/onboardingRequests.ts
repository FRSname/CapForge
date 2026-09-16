/**
 * "Show the startup guide / What's new again", from anywhere in the renderer.
 *
 * The same listener-set shape as `settingsNavigation.ts`, and for the same
 * reason: `StartupPrompts` is mounted once at the App root, App.tsx is at its
 * size ceiling, and Settings → General should not have to thread a callback
 * back up. No `window`, no DOM events, testable in the node environment.
 */

export type OnboardingKind = 'guide' | 'whats-new'

type Listener = (kind: OnboardingKind) => void

const listeners = new Set<Listener>()

/**
 * Ask for a prompt to be shown. Returns false when nothing is listening
 * (`StartupPrompts` is not mounted), so the caller can report that instead of
 * appearing to do nothing.
 */
export function requestOnboarding(kind: OnboardingKind): boolean {
  if (listeners.size === 0) return false
  for (const listener of [...listeners]) listener(kind)
  return true
}

/** Subscribe; the returned function unsubscribes. */
export function onOnboardingRequested(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
