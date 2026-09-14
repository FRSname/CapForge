/**
 * The findings for one field, rendered under it.
 *
 * The list comes from Python — `POST /api/library/validate` for unsaved text
 * and the `422` body when a write is refused. The renderer never decides what
 * is a violation, only where to draw one.
 */

import type { Violation } from '../../lib/publishTypes'

interface FieldViolationsProps {
  violations: Violation[]
}

export function FieldViolations({ violations }: FieldViolationsProps) {
  if (violations.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 mt-1" aria-label="Findings">
      {violations.map((v) => (
        <li
          key={`${v.rule}:${v.message}`}
          className="text-2xs"
          style={{
            color: v.severity === 'hard' ? 'var(--color-danger)' : 'var(--color-amber-2)',
          }}
        >
          {v.message}
        </li>
      ))}
    </ul>
  )
}
