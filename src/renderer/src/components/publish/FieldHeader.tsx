/**
 * One field's label row: what it is, who last wrote it, its Revert, and an
 * optional meter. Every editable row in the Publish panel wears one, which is
 * what makes provenance a property of the panel rather than of seven cards.
 *
 * A card with a single field passes `hideLabel`, because its `StudioCard`
 * title already says the word (TITLE / TITLE down the whole panel otherwise).
 * When that leaves the row with nothing to draw it renders no row at all,
 * rather than an empty `mb-1` gap above the input.
 *
 * `copy` puts a copy button at the end of the row: the box's text, as shown,
 * for pasting one field at a time into an upload form. It draws even when the
 * label is hidden, because a copy control is a reason for the row to exist.
 */

import type { ReactNode } from 'react'
import { fieldLabel } from '../../lib/publishFields'
import type { PublishFieldId } from '../../lib/publishFields'
import type { PublishController } from '../../hooks/usePublishRecord'
import { CopyButton } from '../ui/CopyButton'
import type { CopyTarget } from '../ui/CopyButton'
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
  /** What the row's copy button copies; none means no button. */
  copy?: CopyTarget
}

export function FieldHeader({ publish, field, label, hideLabel, meter, copy }: FieldHeaderProps) {
  const provenance = publish.provenance(field)
  const onRevert = publish.canRevert(field) ? () => publish.revert(field) : undefined
  // `ProvenanceChip` draws nothing for a field nobody has written.
  const chip =
    provenance || onRevert ? <ProvenanceChip provenance={provenance} onRevert={onRevert} /> : null

  if (hideLabel && !meter && !chip && !copy) return null

  return (
    <div
      className={`flex items-center gap-2 mb-1 ${hideLabel ? 'justify-end' : 'justify-between'}`}
    >
      {!hideLabel && <span className="label-xs truncate">{label ?? fieldLabel(field)}</span>}
      <span className="flex items-center gap-2 shrink-0">
        {meter}
        {chip}
        {copy && <CopyButton text={copy.text} what={copy.what} />}
      </span>
    </div>
  )
}
