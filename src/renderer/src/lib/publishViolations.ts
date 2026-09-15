/**
 * Where a backend finding is drawn.
 *
 * The backend names a `field` — `title`, a row (`chapters[0]`) or a sub-field
 * (`thumbnail.cover`, `shorts.clip_suggestions[2]`). A card asks for a field and
 * gets all of those under it, then splits the list between its controls with
 * `partitionViolations`, so a finding is drawn once and never dropped.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Violation } from './publishTypes'

/**
 * The findings a card draws under `field`: the field itself, any row of it
 * (`chapters[0]`) and any sub-field of it (`thumbnail.cover`). A bare prefix is
 * not a child: `title` never picks up `title_options`.
 */
export function violationsForField(violations: readonly Violation[], field: string): Violation[] {
  return violations.filter(
    (v) => v.field === field || v.field.startsWith(`${field}[`) || v.field.startsWith(`${field}.`)
  )
}

export interface PartitionedViolations {
  /** One list per group, in the order the groups were given. */
  placed: Violation[][]
  /** Everything no group claimed — still drawn, so a finding is never lost. */
  unplaced: Violation[]
}

/**
 * Split `violations` between controls. Each group is a list of fields (matched
 * as `violationsForField` does); a finding goes to the **first** group that
 * claims it and nowhere else.
 */
export function partitionViolations(
  violations: readonly Violation[],
  groups: ReadonlyArray<ReadonlyArray<string>>
): PartitionedViolations {
  const placed: Violation[][] = groups.map(() => [])
  const unplaced: Violation[] = []
  for (const violation of violations) {
    const index = groups.findIndex((fields) =>
      fields.some((field) => violationsForField([violation], field).length > 0)
    )
    if (index === -1) unplaced.push(violation)
    else placed[index].push(violation)
  }
  return { placed, unplaced }
}
