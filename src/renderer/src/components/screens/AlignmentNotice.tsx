interface AlignmentNoticeProps {
  visible: boolean
}

/** Persistent warning shown whenever any word timings are approximate. */
export function AlignmentNotice({ visible }: AlignmentNoticeProps) {
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b px-3 py-2 text-xs"
      style={{
        color: 'var(--color-warning)',
        borderColor: 'color-mix(in srgb, var(--color-warning) 35%, transparent)',
        background: 'color-mix(in srgb, var(--color-warning) 10%, var(--color-surface))',
      }}
    >
      <span className="font-medium">Approximate word timings.</span> Forced alignment was
      unavailable, so timeline and karaoke timing may be less precise.
    </div>
  )
}
