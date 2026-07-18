interface VolumeControlProps {
  volume: number
  onVolumeChange: (volume: number) => void
}

export function VolumeControl({ volume, onVolumeChange }: VolumeControlProps) {
  const percentage = Math.round(volume * 100)
  const isMuted = volume === 0

  return (
    <label className="ml-auto flex shrink-0 items-center gap-2" title={`Volume: ${percentage}%`}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <path d="M2.5 6.25h2.25L8.5 3.5v9L4.75 9.75H2.5z" />
        {isMuted ? (
          <>
            <path d="m11 6 3 4" />
            <path d="m14 6-3 4" />
          </>
        ) : (
          <>
            <path d="M10.75 6a3 3 0 0 1 0 4" />
            {volume >= 0.5 && <path d="M12.5 4.5a5 5 0 0 1 0 7" />}
          </>
        )}
      </svg>

      <span className="sr-only">Volume</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
        aria-valuetext={`${percentage}%`}
        className="h-[3px] w-28"
      />
      <span
        className="w-8 text-right text-2xs tabular-nums"
        style={{ color: 'var(--color-text-muted)' }}
        aria-hidden="true"
      >
        {percentage}%
      </span>
    </label>
  )
}
