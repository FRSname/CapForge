/**
 * One field's label row: what it is, who last wrote it, its Revert, and an
 * optional meter. Every editable row in the Publish panel wears one, which is
 * what makes provenance a property of the panel rather than of seven cards.
 *
 * A card with a single field passes `hideLabel`, because its `StudioCard`
 * title already says the word (TITLE / TITLE down the whole panel otherwise).
 * When that leaves the row with nothing to draw it renders no row at all,
 * rather than an empty `mb-1` gap above the input.
 */

import type { ReactNode } from 'react'
import { fieldLabel } from '../../lib/publishFields'
import type { PublishFieldId } from '../../lib/publishFields'
import type { PublishController } from '../../hooks/usePublishRecord'
import { ProvenanceChip } from './ProvenanceChip'

interface FieldHeaderProps {
  publish: PublishController
  field: PublishFieldId
  /** Overrides the inventory label (a card with two rows for one field). */
  label?: string
  /** The card title is already this field's label — don't say it twice. */
  hideLabel?: boolean
  /** A `FieldMeter`, or anything else that belongs on the right. */
  meter?: ReactNode
}

export function FieldHeader({ publish, field, label, hideLabel, meter }: FieldHeaderProps) {
  const provenance = publish.provenance(field)
  const onRevert = publish.canRevert(field) ? () => publish.revert(field) : undefined
  // `ProvenanceChip` draws nothing for a field nobody has written.
  const chip =
    provenance || onRevert ? <ProvenanceChip provenance={provenance} onRevert={onRevert} /> : null

  if (hideLabel && !meter && !chip) return null

  return (
    <div
      className={`flex items-center gap-2 mb-1 ${hideLabel ? 'justify-end' : 'justify-between'}`}
    >
      {!hideLabel && <span className="label-xs truncate">{label ?? fieldLabel(field)}</span>}
      <span className="flex items-center gap-2 shrink-0">
        {meter}
        {chip}
      </span>
    </div>
  )
}
