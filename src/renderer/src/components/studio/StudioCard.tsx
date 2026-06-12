import { useState } from 'react'

interface StudioCardProps {
  title: string
  defaultOpen?: boolean
  /**
   * Overrides the displayed open state without touching the internal one —
   * used by the settings search to force matched cards open. When it goes
   * back to undefined the card returns to whatever the user had set.
   */
  forceOpen?: boolean
  /** Extra header content (e.g. dirty-count badge), rendered next to the title. */
  meta?: React.ReactNode
  /** When set, shows a section-reset button in the header. */
  onReset?: () => void
  /**
   * Hides the card without unmounting it, so the user's open/closed state
   * survives a settings search that filters the card away.
   */
  hidden?: boolean
  children: React.ReactNode
}

export function StudioCard({
  title,
  defaultOpen = true,
  forceOpen,
  meta,
  onReset,
  hidden = false,
  children,
}: StudioCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const isOpen = forceOpen === undefined ? open : forceOpen

  return (
    <div
      className="rounded-lg overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)]"
      style={hidden ? { display: 'none' } : undefined}
    >
      {/* Header — reset button is an absolutely-positioned sibling (a button
          can't nest inside the toggle button). */}
      <div className="relative">
        <button
          type="button"
          className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${isOpen ? 'bg-white/[0.02]' : 'bg-transparent'}`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="label-xs">{title}</span>
            {meta}
          </span>
          <svg
            className="shrink-0 transition-transform text-[var(--color-text-3)]"
            style={{
              transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transitionDuration: 'var(--duration-fast)',
            }}
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
          </svg>
        </button>
        {onReset && (
          <button
            type="button"
            className="icon-btn w-5 h-5 text-[11px] absolute right-7 top-1/2 -translate-y-1/2"
            aria-label={`Reset ${title} to defaults`}
            title={`Reset ${title} to defaults`}
            onClick={(e) => {
              e.stopPropagation()
              onReset()
            }}
          >
            ↺
          </button>
        )}
      </div>

      {/* Collapsible body — grid-rows 0fr↔1fr technique (height-agnostic,
          no width/height animation). `visibility: hidden` when collapsed
          removes the body's controls from the tab order and a11y tree;
          its own transition delays the hide until the shrink finishes. */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows var(--duration-normal) var(--ease-out-expo)',
        }}
      >
        <div
          style={{
            overflow: 'hidden',
            minHeight: 0,
            visibility: isOpen ? 'visible' : 'hidden',
            transition: 'visibility var(--duration-normal)',
          }}
        >
          <div className="px-3 pb-3 pt-1.5 flex flex-col gap-2 border-t border-[var(--color-border)]">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
