/**
 * Gathers the evidence for the one-shot startup prompts and owns which one is
 * showing.
 *
 * Everything that can be decided without the bridge lives in
 * `lib/startupPrompts.ts`; this hook is the IO around it. A missing bridge (an
 * old preload, or a dev app that was not restarted) or a rejected read means
 * "no prompt": the very first thing a user sees must never be an error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OnboardingKind } from '../lib/onboardingRequests'
import { onOnboardingRequested } from '../lib/onboardingRequests'
import type { ReleaseNotes } from '../lib/releaseNotes'
import { notesSince } from '../lib/releaseNotes'
import type { StartupPrompt } from '../lib/startupPrompts'
import {
  decideStartupPrompt,
  HISTORY_KEYS,
  LAST_SEEN_VERSION_KEY,
  NO_PROMPT,
  visiblePrompt,
} from '../lib/startupPrompts'

export interface StartupPromptsState {
  /** The prompt to render right now. */
  prompt: StartupPrompt
  /** The releases the "What's new" card should list. */
  notes: ReleaseNotes[]
  /** The running app's version, null while unknown or without the bridge. */
  version: string | null
  /** Close the prompt and remember this version as seen. */
  dismiss: () => void
  /** Show a prompt on request (Settings -> General), wherever the user is. */
  show: (kind: OnboardingKind) => void
}

/** Reads the app-state evidence and the version; never throws. */
async function readEvidence(): Promise<{ version: string | null; prompt: StartupPrompt }> {
  const bridge = window.subforge
  // The runtime preload is electron/preload.js; an app that predates these two
  // channels has no getVersion at all (CLAUDE.md, "Dual preload gotcha").
  if (!bridge || typeof bridge.getVersion !== 'function') {
    return { version: null, prompt: NO_PROMPT }
  }
  const [currentVersion, lastSeenVersion, ...history] = await Promise.all([
    bridge.getVersion(),
    bridge.getState<string | null>(LAST_SEEN_VERSION_KEY, null),
    ...HISTORY_KEYS.map((key) => bridge.getState<unknown>(key, null)),
  ])
  const hasHistory = history.some((value) => value !== null && value !== undefined && value !== '')
  return {
    version: currentVersion ?? null,
    prompt: decideStartupPrompt({
      lastSeenVersion: lastSeenVersion ?? null,
      currentVersion: currentVersion ?? null,
      hasHistory,
    }),
  }
}

export function useStartupPrompts(active: boolean): StartupPromptsState {
  const [version, setVersion] = useState<string | null>(null)
  const [pending, setPending] = useState<StartupPrompt>(NO_PROMPT)
  const [forced, setForced] = useState<StartupPrompt | null>(null)
  const versionRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readEvidence()
      .then(({ version: current, prompt }) => {
        if (cancelled) return
        versionRef.current = current
        setVersion(current)
        setPending(prompt)
      })
      .catch((err: unknown) => {
        // Startup is the wrong moment for a toast; the prompt simply does not
        // appear, and the reason is in the console.
        console.warn('[CapForge] Startup prompt check failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const show = useCallback((kind: OnboardingKind) => {
    setForced(kind === 'guide' ? { kind: 'guide' } : { kind: 'whats-new', lastSeen: null })
  }, [])

  useEffect(() => onOnboardingRequested(show), [show])

  const dismiss = useCallback(() => {
    setForced(null)
    setPending(NO_PROMPT)
    const seen = versionRef.current
    if (!seen || typeof window.subforge?.setState !== 'function') return
    void Promise.resolve(window.subforge.setState(LAST_SEEN_VERSION_KEY, seen)).catch(
      (err: unknown) => {
        // Not worth interrupting anyone: the prompt just shows again next start.
        console.warn('[CapForge] Could not remember the seen version:', err)
      }
    )
  }, [])

  const prompt = visiblePrompt(forced, pending, active)
  const notes = useMemo(() => {
    if (!version) return []
    return notesSince(prompt.kind === 'whats-new' ? prompt.lastSeen : null, version)
  }, [prompt, version])

  return { prompt, notes, version, dismiss, show }
}
