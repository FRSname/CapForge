/**
 * Which folder (a collection, on the wire) this video belongs to — the event
 * or series whose brief overrides and slots its package is rendered with. The
 * picker lists the folder tree by path (`Events › UCK26`), so two "Day 1"
 * folders under different events are never confused.
 *
 * Written at once through the immediate writer (`setCollection` →
 * `patchNow`), not the debounce: a select is a decision, not a draft. A `422
 * unknown_collection` (the collection was deleted meanwhile) comes back
 * through the writer's violations and renders under the select, like every
 * other field's findings.
 */

import { useCallback } from 'react'
import type { PublishController } from '../../hooks/usePublishRecord'
import { useCollections } from '../../hooks/useCollections'
import { useToast } from '../../hooks/useToast'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { buildTree, flattenTree, pathLabel } from '../../lib/collectionTree'
import { overriddenFields, overridesSummary } from '../../lib/collections'
import { compareFolderNames } from '../../lib/libraryLocation'
import { requestSettingsCategory } from '../../lib/settingsNavigation'
import { StudioCard } from '../studio/StudioCard'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'

/** Said when Settings could not be opened for us. */
export const MANAGE_COLLECTIONS_FALLBACK = 'Open Settings (⌘,) → Folders to manage folders.'

const NO_FOLDER_TEXT = 'No folder — the channel brief applies as it is.'
const ORPHAN_TEXT =
  'No folder has this id, so the channel brief applies. Create it in Settings → Folders to adopt it.'

interface CollectionCardProps {
  publish: PublishController
}

export function CollectionCard({ publish }: CollectionCardProps) {
  const { toast } = useToast()
  const notify = useCallback((message: string) => toast(message, 'error'), [toast])
  const { collections, refresh } = useCollections({ notify })

  function manage() {
    if (!requestSettingsCategory('collections')) toast(MANAGE_COLLECTIONS_FALLBACK, 'info')
  }

  return (
    <CollectionCardView
      publish={publish}
      collections={collections}
      onRefresh={() => void refresh()}
      onManage={manage}
    />
  )
}

export interface CollectionCardViewProps {
  publish: PublishController
  /** Null until the list has loaded — an id is not called unknown before then. */
  collections: readonly CollectionSummary[] | null
  /** The select got focus: Settings may have changed the list since. */
  onRefresh: () => void
  onManage: () => void
}

function summaryText(
  current: string | null,
  collection: CollectionSummary | undefined,
  loaded: boolean
): string {
  if (current === null) return NO_FOLDER_TEXT
  if (collection) {
    return overridesSummary(overriddenFields(collection.overrides).length, collection.name)
  }
  return loaded ? ORPHAN_TEXT : ''
}

export function CollectionCardView({
  publish,
  collections,
  onRefresh,
  onManage,
}: CollectionCardViewProps) {
  const current = publish.fields.collection_id
  const list = collections ?? []
  const collection = list.find((c) => c.id === current)
  const loaded = collections !== null
  const rows = flattenTree(buildTree(list, compareFolderNames))

  return (
    <StudioCard title="Folder" defaultOpen={current !== null}>
      <FieldHeader publish={publish} field="collection_id" hideLabel />
      <select
        className="field-input"
        aria-label="Folder"
        value={current ?? ''}
        onFocus={onRefresh}
        onChange={(e) => publish.setCollection(e.target.value || null)}
      >
        <option value="">None</option>
        {rows.map(({ item }) => (
          <option key={item.id} value={item.id}>
            {pathLabel(list, item.id)}
          </option>
        ))}
        {current !== null && !collection && (
          <option value={current}>{loaded ? `${current} (no such folder)` : current}</option>
        )}
      </select>
      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {summaryText(current, collection, loaded)}
      </p>
      <FieldViolations violations={publish.violationsFor('collection_id')} />
      <button
        type="button"
        className="self-start text-2xs hover:underline"
        style={{ color: 'var(--color-brand)' }}
        onClick={onManage}
      >
        Manage folders…
      </button>
    </StudioCard>
  )
}
