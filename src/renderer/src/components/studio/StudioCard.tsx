import { useState, useRef } from 'react'

interface StudioCardProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function StudioCard({ title, defaultOpen = true, children }: StudioCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyRef = useRef<HTMLDivElement>(null)

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {title}
        </span>
        <svg
          className={`text-[var(--color-text-subtle)] transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
        >
          <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
        </svg>
      </button>

      {/* Body — CSS-driven collapse, overflow-y:clip so max-height anim works without clipping x */}
      <div
        ref={bodyRef}
        className="transition-all duration-250 ease-out"
        style={{
          overflowY: 'clip',
          overflowX: 'visible',
          maxHeight: open ? '2000px' : '0px',
          opacity: open ? 1 : 0,
        }}
      >
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2">
          {children}
        </div>
      </div>
    </div>
  )
}
