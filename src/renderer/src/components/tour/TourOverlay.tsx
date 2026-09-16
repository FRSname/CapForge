/**
 * The coach-mark layer: a scrim with a hole in it and a card beside the hole.
 *
 * The root takes no pointer events at all. Only the scrim pieces and the card
 * do, which is what leaves the spotlighted control clickable: the tour walks
 * the real app, so a user can press the thing being pointed at.
 *
 * Mounted after `SettingsDialog`, which shares `--z-modal`, so it paints above
 * the three steps that open a Settings pane.
 */

import { useTourTarget } from '../../hooks/useTourTarget'
import { isVisibleRect, spotlightRect } from '../../lib/tourPlacement'
import type { Rect } from '../../lib/tourPlacement'
import type { Tour } from '../../lib/tourSteps'
import { TourPopover } from './TourPopover'
import { TourScrim } from './TourScrim'

export interface TourOverlayProps {
  /** null draws nothing: no tour is running. */
  tour: Tour | null
  index: number
  onNext: () => void
  onBack: () => void
  onEnd: () => void
  onOpenUrl: (url: string) => void
}

export function TourOverlay({ tour, index, onNext, onBack, onEnd, onOpenUrl }: TourOverlayProps) {
  const step = tour?.steps[index]
  const measured = useTourTarget(step?.target, Boolean(step))

  if (!tour || !step) return null

  const found: Rect | null =
    measured && measured !== 'missing' && isVisibleRect(measured) ? measured : null
  // A step with a target waits for it rather than flashing its card in the
  // middle of the screen and then jumping to the element.
  const waiting = Boolean(step.target) && measured === null

  return (
    <div className="fixed inset-0 z-[var(--z-modal)]" style={{ pointerEvents: 'none' }}>
      <TourScrim rect={found ? spotlightRect(found) : null} />
      {!waiting && (
        <TourPopover
          tourTitle={tour.title}
          step={step}
          stepNumber={index + 1}
          stepCount={tour.steps.length}
          isFirst={index === 0}
          isLast={index === tour.steps.length - 1}
          target={found}
          onNext={onNext}
          onBack={onBack}
          onEnd={onEnd}
          onOpenUrl={onOpenUrl}
        />
      )}
    </div>
  )
}
