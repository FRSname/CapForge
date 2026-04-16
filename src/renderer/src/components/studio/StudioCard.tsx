import { useState } from 'react'

interface StudioCardProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function StudioCard({ title, defaultOpen = true, children }: StudioCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors"
        style={{ background: open ? 'rgba(255 255 255 / 0.02)' : 'transparent' }}
        onClick={() => setOpen(o => !o)}
      >
        <span className="label-xs">{title}</span>
        <svg
          className="shrink-0 transition-transform duration-200"
          style={{
            color: 'var(--color-text-3)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
          width="11" height="11" viewBox="0 0 16 16" fill="currentColor"
        >
          <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
        </svg>
      </button>

      {/* Body — overflow-y:clip keeps max-height animation without clipping x */}
      <div
        className="transition-all"
        style={{
          overflowY: 'clip',
          overflowX: 'visible',
          maxHeight: open ? '1200px' : '0px',
          opacity:   open ? 1 : 0,
          transitionDuration: '220ms',
          transitionTimingFunction: 'var(--ease-out-expo)',
        }}
      >
        <div
          className="px-3 pb-3 pt-1.5 flex flex-col gap-2"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
