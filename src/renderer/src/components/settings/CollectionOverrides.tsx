/**
 * A collection's channel-brief overrides: every brief field (except slots,
 * which merge instead), each with an "Inherit from channel" toggle.
 *
 * Inheriting shows what the channel currently says; switching the toggle off
 * starts the override from that value and opens the same editor Settings →
 * Channel uses (`BriefFields.tsx`). A list or block override **replaces** the
 * channel's value — it is never appended to it.
 */

import type { BriefOverrideField, BriefOverrides } from '../../lib/collectionTypes'
import { BRIEF_OVERRIDE_FIELDS } from '../../lib/collectionTypes'
import { briefValueSummary } from '../../lib/collections'
import type { Brief } from '../../lib/publishTypes'
import { Toggle } from '../ui/Toggle'
import { BRIEF_FIELD_SPECS, BriefFieldControl, BriefFieldRow } from './BriefFields'
import type { CommitOverride, DraftOverride } from './CollectionEditor'

interface CollectionOverridesProps {
  overrides: BriefOverrides
  /** The effective brief — for an inherited field, that is the channel's value. */
  effective: Brief
  slotNames: readonly string[]
  onDraft: DraftOverride
  onCommit: CommitOverride
}

export function CollectionOverrides(props: CollectionOverridesProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="label-xs">Channel brief overrides</span>
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          Each field follows the channel until its toggle is switched off. An overriding list
          replaces the channel’s list rather than adding to it.
        </p>
      </div>
      {BRIEF_OVERRIDE_FIELDS.map((field) => (
        <OverrideRow key={field} field={field} {...props} />
      ))}
    </div>
  )
}

interface OverrideRowProps<K extends BriefOverrideField> extends CollectionOverridesProps {
  field: K
}

function OverrideRow<K extends BriefOverrideField>({
  field,
  overrides,
  effective,
  slotNames,
  onDraft,
  onCommit,
}: OverrideRowProps<K>) {
  const spec = BRIEF_FIELD_SPECS[field]
  const value = overrides[field] as Brief[K] | null
  const inherited = effective[field] as Brief[K]
  const id = `collection-${field}`

  return (
    <div role="group" aria-label={`${spec.label} override`}>
      <BriefFieldRow
        label={spec.label}
        htmlFor={value === null ? undefined : id}
        help={value === null ? undefined : spec.help}
        aside={
          <Toggle
            checked={value === null}
            onChange={(inherit) => onCommit(field, inherit ? null : inherited)}
            label="Inherit from channel"
          />
        }
      >
        {value === null ? (
          <p className="truncate text-2xs" style={{ color: 'var(--color-text-3)' }}>
            {`Channel: ${briefValueSummary(inherited)}`}
          </p>
        ) : (
          <BriefFieldControl
            field={field}
            id={id}
            value={value}
            slotNames={slotNames}
            onDraft={(next) => onDraft(field, next)}
            onCommit={(next) => onCommit(field, next)}
          />
        )}
      </BriefFieldRow>
    </div>
  )
}
