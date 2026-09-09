/**
 * The "your source was re-chunked" banner, shown above the editor on a
 * translated track whose `reflowNeeded` is set.
 *
 * `reflowNeeded` means the *source's grouping* changed — a `wordsPerGroup`
 * change, a manual merge/split, an inserted word — so this track's captions no
 * longer line up with anything. Re-flowing rebuilds the skeleton from the
 * source's current groups, carrying every translation whose source words still
 * form exactly one group and leaving the rest blank with the old text attached
 * as context (`reflowTrack`, `lib/tracks.ts`).
 *
 * Staleness is the other, unrelated marker: the source *text* changed under a
 * caption. There is deliberately no button for it — CapForge does not translate
 * (an explicit non-goal), so the line just says who can.
 */

interface ReflowBannerProps {
  /** Captions whose recorded source text has changed since they were written. */
  staleCount: number
  /** Rebuild the skeleton from the source's current grouping. */
  onReflow: () => void
}

export function ReflowBanner({ staleCount, onReflow }: ReflowBannerProps) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-2xs"
      role="status"
      style={{ background: 'var(--color-surface-2)', fontFamily: 'var(--cf-font-ui)' }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: 'var(--color-brand)' }}
        aria-hidden="true"
      />
      <span style={{ color: 'var(--color-text-2)' }}>
        The source grouping changed — these captions no longer line up with it.
      </span>
      <button
        type="button"
        className="rounded border border-[var(--color-border-2)] px-2 py-0.5 transition-colors hover:bg-[var(--color-surface-3)]"
        style={{ color: 'var(--color-text)' }}
        title="Rebuild this track's captions from the source's current groups. Translations whose source words still form one group are carried over; the rest come back blank with the old text attached."
        onClick={onReflow}
      >
        Re-flow from source
      </button>
      {staleCount > 0 && (
        <span style={{ color: 'var(--color-text-3)' }}>
          Ask the agent to re-translate {staleCount} stale{' '}
          {staleCount === 1 ? 'group' : 'groups'}.
        </span>
      )}
    </div>
  )
}
