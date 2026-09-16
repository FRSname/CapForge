/**
 * A chars/bytes counter next to a field.
 *
 * Display only — the backend is what refuses an over-limit write
 * (`backend/library/validate.py`). This just stops the user finding out at
 * save time.
 */

export type MeterUnit = 'chars' | 'bytes' | 'hashtags'

interface FieldMeterProps {
  used: number
  limit: number
  unit?: MeterUnit
}

export function FieldMeter({ used, limit, unit = 'chars' }: FieldMeterProps) {
  const over = used > limit
  return (
    <span
      className="text-2xs shrink-0 tabular-nums"
      style={{
        fontFamily: 'var(--cf-font-mono)',
        color: over ? 'var(--color-danger)' : 'var(--color-text-3)',
      }}
      title={over ? `${used - limit} ${unit} over the limit` : `${limit - used} ${unit} left`}
    >
      {used}/{limit} {unit}
    </span>
  )
}
