/**
 * A folder's Location in Settings → Folders: the folder it sits inside, or the
 * top level (docs/plans/library-finder.md §2.6).
 *
 * The options are `moveTargets` — every folder except this one and its own
 * subfolders, and none its subtree would push past the depth limit — labelled
 * by their full path (`Events › UCK 2026`), so two "Day 1" folders under
 * different events can never be confused in a closed select. The backend still
 * rules on the move; its refusal is shown under the select.
 */

import type { CollectionSummary } from '../../lib/collectionTypes'
import { moveTargets, pathLabel } from '../../lib/collectionTree'
import { BriefFieldRow } from './BriefFields'

/** The select's value for "not inside any folder". */
export const TOP_LEVEL_VALUE = ''

export const LOCATION_HELP =
  'A folder inherits the slots and overrides of every folder above it; its own values win.'

export interface CollectionLocationProps {
  /** The folder being edited. */
  collectionId: string
  parentId: string | null
  /** Every folder, flat, as the list answers it. */
  collections: readonly CollectionSummary[]
  /** Why the last move was refused, shown under the select; null when none. */
  error: string | null
  onMove: (parentId: string | null) => void
}

export function CollectionLocation(props: CollectionLocationProps) {
  const { collectionId, parentId, collections, error } = props
  const targets = moveTargets(collections, collectionId)
  // A parent the list does not know (a stale list) still shows as selected.
  const unlisted = parentId !== null && !targets.some((row) => row.item.id === parentId)

  return (
    <BriefFieldRow label="Location" htmlFor="collection-location" help={LOCATION_HELP}>
      <select
        id="collection-location"
        className="field-input"
        value={parentId ?? TOP_LEVEL_VALUE}
        onChange={(e) => props.onMove(e.target.value === TOP_LEVEL_VALUE ? null : e.target.value)}
      >
        <option value={TOP_LEVEL_VALUE}>Top level</option>
        {targets.map(({ item }) => (
          <option key={item.id} value={item.id}>
            {pathLabel(collections, item.id)}
          </option>
        ))}
        {unlisted && <option value={parentId}>{pathLabel(collections, parentId)}</option>}
      </select>
      {error && (
        <p role="alert" className="text-2xs" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </BriefFieldRow>
  )
}
