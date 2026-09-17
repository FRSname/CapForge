/**
 * The one thing App.tsx mounts for onboarding: `<StartupPrompts screen={…} />`.
 *
 * It owns both halves of it: the coach-mark tours (`useTour`, drawn by
 * `TourOverlay`) and the "What's new" card. A fresh install gets the
 * getting-around tour instead of a dialog; the editor tour starts by itself
 * the first time a video is open; and Settings -> General -> About can ask for
 * any of the three by name.
 *
 * A tour belongs to a screen, so a request made from the wrong one is a toast
 * rather than a tour that ends the moment it starts.
 */

import { useCallback, useEffect } from 'react'
import { useFirstVideoTour } from '../../hooks/useFirstVideoTour'
import { useStartupPrompts } from '../../hooks/useStartupPrompts'
import { useToast } from '../../hooks/useToast'
import { useTour } from '../../hooks/useTour'
import type { OnboardingKind } from '../../lib/onboardingRequests'
import { onOnboardingRequested } from '../../lib/onboardingRequests'
import { requestSettingsClose } from '../../lib/settingsNavigation'
import type { TourId } from '../../lib/tourSteps'
import { TOURS } from '../../lib/tourSteps'
import type { Screen } from '../../types/app'
import { TourOverlay } from '../tour/TourOverlay'
import { WhatsNewDialog } from './WhatsNewDialog'

/** Shown when the running build predates the openExternal bridge. */
const NO_BRIDGE_MESSAGE = 'Restart CapForge to open links in your browser.'

/** Asked for from the wrong screen: where to go first. */
const WRONG_SCREEN_MESSAGE: Record<TourId, string> = {
  'getting-around': 'Go to the library first, then start the startup guide.',
  'first-video': 'Open a video first, then start the editor guide.',
}

/** Which tour each reopenable onboarding request means. */
const REQUESTED_TOUR: Partial<Record<OnboardingKind, TourId>> = {
  guide: 'getting-around',
  'first-video': 'first-video',
}

export interface StartupPromptsProps {
  /** Where the app is: an automatic prompt only appears on the library. */
  screen: Screen
}

export function StartupPrompts({ screen }: StartupPromptsProps) {
  const { toast } = useToast()
  const { prompt, notes, dismiss } = useStartupPrompts(screen === 'library')
  const { active, seen, start, next, back, end } = useTour({ screen })

  const openUrl = useCallback(
    (url: string) => {
      // The bridge is new, and the preload of a running dev app may predate it
      // (CLAUDE.md, "Dual preload gotcha").
      if (typeof window.subforge?.openExternal !== 'function') {
        toast(NO_BRIDGE_MESSAGE, 'error')
        return
      }
      void window.subforge
        .openExternal(url)
        .then((result) => {
          if (!result?.ok) toast(result?.error ?? 'Could not open the link.', 'error')
        })
        .catch((err: unknown) => {
          toast(err instanceof Error ? err.message : 'Could not open the link.', 'error')
        })
    },
    [toast]
  )

  // A fresh install is due the guide, which is a tour now rather than a card.
  // Dismissing it in the same breath writes `lastSeenVersion`, so the next
  // start is quiet whether or not the tour was finished.
  const guideDue = prompt.kind === 'guide'
  useEffect(() => {
    if (!guideDue) return
    start('getting-around')
    dismiss()
  }, [guideDue, start, dismiss])

  useFirstVideoTour({ screen, seen, start })

  // Settings -> General -> About. "What's new" is a card and is handled by
  // `useStartupPrompts`; the two tours are handled here, because only this
  // component knows which screen the app is on. The request comes from
  // inside Settings, which would otherwise stay open under the tour and hide
  // (and block) the control being pointed at, so Settings is closed first.
  // Nothing listening is fine: the tour still starts.
  useEffect(
    () =>
      onOnboardingRequested((kind) => {
        const id = REQUESTED_TOUR[kind]
        if (!id) return
        if (TOURS[id].screen !== screen) {
          toast(WRONG_SCREEN_MESSAGE[id], 'info')
          return
        }
        requestSettingsClose()
        start(id)
      }),
    [screen, start, toast]
  )

  return (
    <>
      <WhatsNewDialog
        open={prompt.kind === 'whats-new'}
        notes={notes}
        onClose={dismiss}
        onOpenUrl={openUrl}
      />
      <TourOverlay
        tour={active?.tour ?? null}
        index={active?.index ?? 0}
        onNext={next}
        onBack={back}
        onEnd={end}
        onOpenUrl={openUrl}
      />
    </>
  )
}
