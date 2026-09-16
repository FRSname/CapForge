/**
 * "Welcome to CapForge": the stepped walkthrough shown on a fresh install and
 * reopenable from Settings -> General.
 *
 * Cards, not coach marks. The copy is `lib/startupGuide.ts`; this component is
 * only the frame: a step counter, a dot rail, Back/Next, Skip, and the one
 * optional action a step may carry (which closes the dialog, because Settings
 * opens on top of it).
 */

import { useEffect, useState } from 'react'
import type { AppSettingsCategoryId } from '../../lib/appSettingsIndex'
import type { GuideAction, GuideStep } from '../../lib/startupGuide'
import { GUIDE_STEPS } from '../../lib/startupGuide'
import { Button } from '../ui/Button'
import { ModalShell } from '../ui/ModalShell'
import { TutorialPlayer } from './TutorialPlayer'

const FIRST_STEP = 0

/** The dots for the steps you are not on. */
const INACTIVE_DOT_OPACITY = 0.4

export interface StartupGuideDialogProps {
  open: boolean
  onClose: () => void
  onOpenSettings: (category: AppSettingsCategoryId) => void
  onOpenUrl: (url: string) => void
}

/** True while focus is in something that consumes the arrow keys itself. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

/** Left/right arrows step the guide while it is open, except while typing. */
function useStepKeyboard(open: boolean, last: number, setIndex: SetIndex) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      setIndex((current) =>
        e.key === 'ArrowRight' ? Math.min(current + 1, last) : Math.max(current - 1, FIRST_STEP)
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, last, setIndex])
}

type SetIndex = (update: (current: number) => number) => void

export function StartupGuideDialog({
  open,
  onClose,
  onOpenSettings,
  onOpenUrl,
}: StartupGuideDialogProps) {
  const [index, setIndex] = useState(FIRST_STEP)
  const [showTutorial, setShowTutorial] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const last = GUIDE_STEPS.length - 1
  const step = GUIDE_STEPS[Math.min(index, last)]

  // Every opening starts at the beginning, however it was closed last time,
  // and with the video collapsed so nothing loads until it is asked for.
  // Adjusted during render rather than in an effect (the React-documented way
  // to reset state when a prop changes), so there is no second paint.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setIndex(FIRST_STEP)
      setShowTutorial(false)
    }
  }

  useStepKeyboard(open, last, setIndex)

  function runAction(action: GuideAction) {
    // Both actions leave the dialog: Settings would open behind it, and a link
    // opens in the browser.
    onClose()
    if (action.kind === 'settings') onOpenSettings(action.category)
    else onOpenUrl(action.url)
  }

  return (
    <ModalShell open={open} onClose={onClose} label="Welcome to CapForge">
      <GuideHeader index={index} />

      <StepBody step={step} onAction={runAction} />

      <GuideFooter index={index} last={last} onSelect={setIndex} onClose={onClose} />

      <TutorialPlayer
        expanded={showTutorial}
        onToggle={() => setShowTutorial((shown) => !shown)}
        onOpenUrl={onOpenUrl}
      />
    </ModalShell>
  )
}

/** The dialog's name and the step counter. */
function GuideHeader({ index }: { index: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        Welcome to CapForge
      </h2>
      <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        Step {index + 1} of {GUIDE_STEPS.length}
      </span>
    </div>
  )
}

interface GuideFooterProps {
  index: number
  last: number
  onSelect: (index: number) => void
  onClose: () => void
}

/** Skip, the dot rail and Back/Next. */
function GuideFooter({ index, last, onSelect, onClose }: GuideFooterProps) {
  const onLast = index >= last
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <div className="flex items-center gap-3">
        {!onLast && (
          <button
            type="button"
            className="text-2xs underline underline-offset-2 hover:opacity-80"
            style={{ color: 'var(--color-text-3)' }}
            onClick={onClose}
          >
            Skip
          </button>
        )}
        <DotRail count={last + 1} current={index} onSelect={onSelect} />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className="text-xs"
          disabled={index === FIRST_STEP}
          onClick={() => onSelect(Math.max(index - 1, FIRST_STEP))}
        >
          Back
        </Button>
        <Button
          variant="primary"
          className="text-xs"
          onClick={() => (onLast ? onClose() : onSelect(Math.min(index + 1, last)))}
        >
          {onLast ? 'Get started' : 'Next'}
        </Button>
      </div>
    </div>
  )
}

interface StepBodyProps {
  step: GuideStep
  onAction: (action: GuideAction) => void
}

function StepBody({ step, onAction }: StepBodyProps) {
  const action = step.action
  return (
    <section aria-label={step.title} className="flex flex-col gap-3">
      <h3
        className="text-lg"
        style={{ fontFamily: 'var(--cf-font-display)', color: 'var(--color-text)' }}
      >
        {step.title}
      </h3>
      {step.paragraphs.map((paragraph) => (
        <p
          key={paragraph}
          className="text-xs leading-relaxed"
          style={{ color: 'var(--color-text-2)' }}
        >
          {paragraph}
        </p>
      ))}
      {action && (
        <div>
          <Button variant="ghost" className="text-xs" onClick={() => onAction(action)}>
            {action.label}
          </Button>
        </div>
      )}
    </section>
  )
}

interface DotRailProps {
  count: number
  current: number
  onSelect: (index: number) => void
}

function DotRail({ count, current, onSelect }: DotRailProps) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Step ${i + 1}`}
          aria-current={i === current ? 'step' : undefined}
          className="h-1.5 w-1.5 rounded-full transition-opacity hover:opacity-100"
          style={{
            background: i === current ? 'var(--color-brand)' : 'var(--color-text-3)',
            opacity: i === current ? 1 : INACTIVE_DOT_OPACITY,
          }}
          onClick={() => onSelect(i)}
        />
      ))}
    </div>
  )
}
