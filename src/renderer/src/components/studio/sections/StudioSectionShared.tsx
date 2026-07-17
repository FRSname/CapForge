/**
 * Shared plumbing for the StudioPanel section cards (Typography / Colors /
 * Layout / Background / Animation). Kept separate from StudioPanel.tsx so
 * each section file only needs a type-only import of `StudioSettings` —
 * avoids a runtime circular import between StudioPanel.tsx and the section
 * components it renders.
 */

import type { StudioSettings } from '../StudioPanel'
import type { CardId, SearchFilter } from '../../../lib/settingsSearch'

/** Props threaded from StudioPanel into every extracted section card. */
export interface StudioSectionProps {
  s: StudioSettings
  defaults: StudioSettings
  filter: SearchFilter | null
  set: <K extends keyof StudioSettings>(key: K, val: StudioSettings[K]) => void
  /** Multi-field update in one settings-change call (e.g. font name + path together). */
  setMany: (patch: Partial<StudioSettings>) => void
  cardProps: (id: CardId) => StudioCardProps
}

/** Return shape of StudioPanel's cardProps() — forwarded to <StudioCard {...} />. */
export interface StudioCardProps {
  hidden: boolean
  forceOpen: boolean | undefined
  meta: React.ReactNode | undefined
  onReset: (() => void) | undefined
}

/** Hides its row when a search filter is active and the label doesn't match. */
export function Row({
  label,
  filter,
  children,
}: {
  label: string
  filter: SearchFilter | null
  children: React.ReactNode
}) {
  if (filter && !filter.matchedLabels.has(label)) return null
  return <>{children}</>
}

/** Brand-orange dot + "n changed" badge shown in a dirty card's header. */
export function DirtyMeta({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
      <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {count} changed
      </span>
    </span>
  )
}
