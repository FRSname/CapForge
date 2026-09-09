/**
 * Small stateful bits of a GroupEditor row.
 *
 * They live here rather than inside `GroupEditor.tsx` for two reasons: each one
 * needs its own `useState`/derived styling and is rendered inside
 * `groups.map(...)`, where hooks cannot be called; and `GroupEditor.tsx` is at
 * the file-size ceiling.
 */

import { useState } from 'react'
import type { TrackGroupState } from '../../lib/tracks'

interface EndTimeButtonProps {
  label: string
  isDirty: boolean
  title: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}

/**
 * The group's end time, as a button that opens the inline editor.
 *
 * Hover colour is derived declaratively each render (not an imperative
 * `.style.color` write) so an external change to `isDirty` while hovered — e.g.
 * the group's end being dragged on the timeline — can't be silently clobbered
 * by a stale mouseleave value.
 */
export function EndTimeButton({ label, isDirty, title, onClick }: EndTimeButtonProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      className="transition-colors"
      style={{ color: hovered || isDirty ? 'var(--color-accent)' : 'var(--color-text-2)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  )
}

/** Copy for the two states worth marking; `clean` deliberately has none. */
const CHIP_COPY: Record<Exclude<TrackGroupState, 'clean'>, { label: string; title: string }> = {
  stale: {
    label: 'source changed',
    title:
      'The source words this caption was written from have changed — re-translate it (the agent’s set_track_text) or leave it if it still reads right.',
  },
  untranslated: {
    label: 'no text',
    title: 'This caption has no text yet, so nothing is drawn for its span.',
  },
}

/**
 * Per-group translation marker on a translated track. Renders nothing for
 * `clean`, for the source track (no state passed) or for a group the last
 * classification did not cover.
 */
export function TrackStateChip({ state }: { state?: TrackGroupState }) {
  if (!state || state === 'clean') return null
  const copy = CHIP_COPY[state]
  return (
    <span
      className="shrink-0 rounded px-1 text-2xs"
      style={{
        color: state === 'stale' ? 'var(--color-brand)' : 'var(--color-text-3)',
        background: 'var(--color-surface-3)',
      }}
      title={copy.title}
    >
      {copy.label}
    </span>
  )
}
