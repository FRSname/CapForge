/**
 * One field's label row: what it is, who last wrote it, its Revert, and an
 * optional meter. Every editable row in the Publish panel wears one, which is
 * what makes provenance a property of the panel rather than of seven cards.
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
  /** A `FieldMeter`, or anything else that belongs on the right. */
  meter?: ReactNode
}

export function FieldHeader({ publish, field, label, meter }: FieldHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <span className="label-xs truncate">{label ?? fieldLabel(field)}</span>
      <span className="flex items-center gap-2 shrink-0">
        {meter}
        <ProvenanceChip
          provenance={publish.provenance(field)}
          onRevert={publish.canRevert(field) ? () => publish.revert(field) : undefined}
        />
      </span>
    </div>
  )
}
