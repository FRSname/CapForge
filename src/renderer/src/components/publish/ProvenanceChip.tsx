/**
 * Who last wrote a field, and how long ago — the review surface for tier-1
 * auto-applied agent writes (vision §3.5). A dot, a relative time, and the one
 * click that takes the write back.
 */

import { relativeTime } from '../../lib/publishFields'
import type { Provenance } from '../../lib/publishFields'

/** The agent's colour is the brand orange it glows everywhere else. */
const AGENT_ACTOR = 'agent'
const DOT_SIZE_PX = 6

interface ProvenanceChipProps {
  provenance: Provenance | null
  /** Present only when the field has a previous value to go back to. */
  onRevert?: () => void
  /** Injectable clock, so the relative time is assertable in a test. */
  now?: number
}

function dotColor(provenance: Provenance | null): string {
  if (!provenance) return 'var(--color-text-3)'
  return provenance.by === AGENT_ACTOR ? 'var(--color-brand)' : 'var(--color-accent)'
}

export function ProvenanceChip({ provenance, onRevert, now }: ProvenanceChipProps) {
  const when = provenance ? relativeTime(provenance.at, now) : ''
  const title = provenance
    ? `Last written by ${provenance.by || 'someone'}${when ? ` ${when}` : ''}`
    : 'Nobody has written this field yet'

  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span
        aria-hidden="true"
        style={{
          width: DOT_SIZE_PX,
          height: DOT_SIZE_PX,
          borderRadius: '50%',
          background: dotColor(provenance),
        }}
      />
      <span className="text-2xs" style={{ color: 'var(--color-text-3)' }} title={title}>
        {provenance ? `edited ${when || 'recently'}` : 'not written'}
      </span>
      {onRevert && (
        <button
          type="button"
          className="icon-btn w-4 h-4 text-[10px]"
          aria-label="Revert this field"
          title="Revert to the previous value"
          onClick={onRevert}
        >
          ↺
        </button>
      )}
    </span>
  )
}
