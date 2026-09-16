/**
 * The card beside a coach mark: what this part of the app is for, and the way
 * on to the next one.
 *
 * It measures itself (a `ResizeObserver` on its own box) and asks
 * `lib/tourPlacement.ts` where to sit, so a step near an edge flips to the
 * other side instead of hanging off the window. With no target it is simply
 * centred.
 *
 * There is no focus trap: Settings is open behind it on three of the steps
 * and has one of its own, and two traps fight. Focus moves to Next on every
 * step instead, so Enter walks the tour.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Rect, Size } from '../../lib/tourPlacement'
import { placePopover } from '../../lib/tourPlacement'
import type { Placement, TourStep } from '../../lib/tourSteps'
import { TutorialPlayer } from '../onboarding/TutorialPlayer'
import { Button } from '../ui/Button'

/** The card's width, and the height assumed for the very first placement. */
const POPOVER_WIDTH_PX = 340
const POPOVER_FALLBACK_HEIGHT_PX = 240

/** The dots for the steps you are not on. */
const INACTIVE_DOT_OPACITY = 0.4

/** Marks the primary button, so focus can find it without a forwarded ref. */
const NEXT_SELECTOR = '[data-tour-next]'

export interface TourPopoverProps {
  tourTitle: string
  step: TourStep
  /** 1-based, counting every step including the ones that were skipped. */
  stepNumber: number
  stepCount: number
  isFirst: boolean
  isLast: boolean
  /** The measured target; null centres the card. */
  target: Rect | null
  onNext: () => void
  onBack: () => void
  onEnd: () => void
  onOpenUrl: (url: string) => void
}

/** The viewport, or a sane stand-in where there is no window (tests, SSR). */
function viewportSize(): Size {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Tracks the card's own box, so the placement uses its real height. */
function useMeasuredSize(ref: React.RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({
    width: POPOVER_WIDTH_PX,
    height: POPOVER_FALLBACK_HEIGHT_PX,
  })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect()
      setSize((previous) =>
        previous.width === box.width && previous.height === box.height
          ? previous
          : { width: box.width, height: box.height }
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** The side tried first when a step does not say. */
const DEFAULT_PLACEMENT: Placement = 'bottom'

/** Where the card goes: beside the target, or in the middle of the window. */
function cardPosition(target: Rect | null, size: Size, preferred: Placement): CSSProperties {
  if (!target) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }
  const placed = placePopover(target, size, viewportSize(), preferred)
  return { top: placed.top, left: placed.left }
}

export function TourPopover(props: TourPopoverProps) {
  const { step, isFirst, isLast, target } = props
  const cardRef = useRef<HTMLDivElement>(null)
  const [showTutorial, setShowTutorial] = useState(false)
  const size = useMeasuredSize(cardRef)

  // Enter walks the tour: the primary button takes focus on every step. Found
  // by attribute rather than held in a ref, because `ui/Button` is a plain
  // function component and does not forward one.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLButtonElement>(NEXT_SELECTOR)?.focus()
  }, [step.id])

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={step.title}
      className="pop-in fixed flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xl"
      style={{
        width: `${POPOVER_WIDTH_PX}px`,
        maxWidth: '90vw',
        pointerEvents: 'auto',
        ...cardPosition(target, size, step.placement ?? DEFAULT_PLACEMENT),
      }}
    >
      <p
        className="text-2xs uppercase tracking-widest"
        style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
      >
        {props.tourTitle}
      </p>

      <h2
        className="text-lg"
        style={{ fontFamily: 'var(--cf-font-display)', color: 'var(--color-text)' }}
      >
        {step.title}
      </h2>

      {step.paragraphs.map((paragraph) => (
        <p
          key={paragraph}
          className="text-xs leading-relaxed"
          style={{ color: 'var(--color-text-2)' }}
        >
          {paragraph}
        </p>
      ))}

      {step.tutorial && (
        <TutorialPlayer
          expanded={showTutorial}
          onToggle={() => setShowTutorial((shown) => !shown)}
          onOpenUrl={props.onOpenUrl}
        />
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3">
          {!isLast && (
            <button
              type="button"
              className="text-2xs underline underline-offset-2 hover:opacity-80"
              style={{ color: 'var(--color-text-3)' }}
              onClick={props.onEnd}
            >
              Skip tour
            </button>
          )}
          <DotRail count={props.stepCount} current={props.stepNumber - 1} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-xs" disabled={isFirst} onClick={props.onBack}>
            Back
          </Button>
          <Button
            data-tour-next=""
            variant="primary"
            className="text-xs"
            onClick={isLast ? props.onEnd : props.onNext}
          >
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface DotRailProps {
  count: number
  current: number
}

/**
 * Where in the tour the user is. Not buttons: jumping to a step would skip
 * the `before` actions that put the app on the right screen for it.
 */
function DotRail({ count, current }: DotRailProps) {
  return (
    <div
      role="group"
      className="flex items-center gap-1.5"
      aria-label={`Step ${current + 1} of ${count}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: i === current ? 'var(--color-brand)' : 'var(--color-text-3)',
            opacity: i === current ? 1 : INACTIVE_DOT_OPACITY,
          }}
        />
      ))}
    </div>
  )
}
