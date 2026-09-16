/**
 * A collection's channel-brief overrides: every brief field (except slots,
 * which merge instead), each with an "Inherit" toggle.
 *
 * Inheriting shows the value the folder gets now and where it comes from: the
 * deepest folder above that sets it ("From Events › UCK 2026"), else the
 * channel. Switching the toggle off starts the override from that value and
 * opens the same editor Settings → Channels uses (`BriefFields.tsx`). A list or
 * block override **replaces** the inherited value — it is never appended to it.
 */

import type { BriefOverrideField, BriefOverrides, Collection } from '../../lib/collectionTypes'
import { BRIEF_OVERRIDE_FIELDS } from '../../lib/collectionTypes'
import { briefValueSummary, inheritedFrom } from '../../lib/collections'
import type { Brief } from '../../lib/publishTypes'
import { Toggle } from '../ui/Toggle'
import { BRIEF_FIELD_SPECS, BriefFieldControl, BriefFieldRow } from './BriefFields'
import type { CommitOverride, DraftOverride } from './CollectionEditor'

interface CollectionOverridesProps {
  overrides: BriefOverrides
  /** The effective brief — for an inherited field, the value from above. */
  effective: Brief
  /** The folders above this one, top level first; empty at the top level. */
  ancestors: ReadonlyArray<Pick<Collection, 'name' | 'overrides'>>
  slotNames: readonly string[]
  onDraft: DraftOverride
  onCommit: CommitOverride
}

const TOP_LEVEL_HELP =
  'Each field follows the channel until its toggle is switched off. An overriding list replaces the channel’s list rather than adding to it.'

const NESTED_HELP =
  'Each field follows the folders above, then the channel, until its toggle is switched off. An overriding list replaces the inherited list rather than adding to it.'

export function CollectionOverrides(props: CollectionOverridesProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="label-xs">Channel brief overrides</span>
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {props.ancestors.length === 0 ? TOP_LEVEL_HELP : NESTED_HELP}
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
  ancestors,
  slotNames,
  onDraft,
  onCommit,
}: OverrideRowProps<K>) {
  const spec = BRIEF_FIELD_SPECS[field]
  const value = overrides[field] as Brief[K] | null
  const inherited = effective[field] as Brief[K]
  const id = `collection-${field}`
  const source = inheritedFrom(ancestors, field)
  const summary = briefValueSummary(inherited)

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
            label={ancestors.length === 0 ? 'Inherit from channel' : 'Inherit'}
          />
        }
      >
        {value === null ? (
          <p className="truncate text-2xs" style={{ color: 'var(--color-text-3)' }}>
            {source === null ? `Channel: ${summary}` : `From ${source}: ${summary}`}
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
