/**
 * One collection, opened from Settings → Collections: its name, its slots,
 * the channel-brief fields it overrides, a live preview of a member's
 * DESCRIPTION, and delete.
 *
 * The container reads `GET /collections/{cid}` and writes `PATCH` per field
 * (no `If-Match`, like the brief): a keystroke is a local draft, a blur is a
 * write, and the collection the backend answers with is adopted. `overrides`
 * merge per field on the backend, so each write carries only its own field.
 */

import { useEffect, useState } from 'react'
import { useToast } from '../../hooks/useToast'
import type {
  BriefOverrideField,
  BriefOverrides,
  CollectionDetail,
} from '../../lib/collectionTypes'
import { overriddenFields, overridesSummary, paletteSlots, videoCount } from '../../lib/collections'
import type { CollectionPatch } from '../../lib/collectionsApi'
import { deleteCollection, getCollection, patchCollection } from '../../lib/collectionsApi'
import type { Brief } from '../../lib/publishTypes'
import { Button } from '../ui/Button'
import { BriefFieldRow } from './BriefFields'
import { CollectionOverrides } from './CollectionOverrides'
import { CollectionPreview } from './CollectionPreview'
import { SlotRowsEditor } from './SlotFields'

export type DraftOverride = <K extends BriefOverrideField>(field: K, value: Brief[K]) => void
export type CommitOverride = <K extends BriefOverrideField>(
  field: K,
  value: Brief[K] | null
) => void

const SLOTS_HELP =
  'Values for {{name}} placeholders. They add to the channel’s slots and win on a clash.'

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface CollectionEditorProps {
  collectionId: string
  /** A write landed — the list's names and counts may have changed. */
  onChanged: () => void
  onDeleted: () => void
}

export function CollectionEditor({ collectionId, onChanged, onDeleted }: CollectionEditorProps) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<CollectionDetail | null>(null)
  /** Bumped per landed write, so the preview re-renders the package. */
  const [previewKey, setPreviewKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    getCollection(collectionId)
      .then((next) => {
        if (!cancelled) setDetail(next)
      })
      .catch((err) => toast(`Could not open the collection: ${reasonOf(err)}`, 'error'))
    return () => {
      cancelled = true
    }
  }, [collectionId, toast])

  if (!detail) {
    return (
      <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>
        Opening the collection…
      </p>
    )
  }

  function save(patch: CollectionPatch) {
    patchCollection(collectionId, patch)
      .then((next) => {
        setDetail(next)
        setPreviewKey((n) => n + 1)
        onChanged()
      })
      .catch((err) => toast(`Could not save the collection: ${reasonOf(err)}`, 'error'))
  }

  const draftOverride: DraftOverride = (field, value) =>
    setDetail((prev) => prev && { ...prev, overrides: { ...prev.overrides, [field]: value } })

  const commitOverride: CommitOverride = (field, value) => {
    draftOverride(field, value as never)
    save({ overrides: { [field]: value } as Partial<BriefOverrides> })
  }

  return (
    <CollectionEditorView
      detail={detail}
      previewKey={previewKey}
      onDraftName={(name) => setDetail((prev) => prev && { ...prev, name })}
      onCommitName={() => {
        const name = detail.name.trim()
        if (!name) toast('A collection needs a name.', 'error')
        else save({ name })
      }}
      onCommitSlots={(slots) => save({ slots })}
      onDraftOverride={draftOverride}
      onCommitOverride={commitOverride}
      onDelete={() =>
        deleteCollection(collectionId)
          .then(() => {
            toast(`Deleted ${detail.name}`, 'success')
            onDeleted()
          })
          .catch((err) => toast(reasonOf(err), 'error'))
      }
    />
  )
}

export interface CollectionEditorViewProps {
  detail: CollectionDetail
  previewKey: number
  onDraftName: (name: string) => void
  onCommitName: () => void
  onCommitSlots: (slots: Record<string, string>) => void
  onDraftOverride: DraftOverride
  onCommitOverride: CommitOverride
  onDelete: () => void
}

export function CollectionEditorView(props: CollectionEditorViewProps) {
  const { detail } = props
  const palette = paletteSlots(detail.effective_brief.slots, detail.slots)

  return (
    <section
      aria-label={`Collection ${detail.name}`}
      className="flex flex-col gap-5 rounded-lg p-4"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm" style={{ color: 'var(--color-text)' }}>
          {detail.name}
        </span>
        <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {overridesSummary(overriddenFields(detail.overrides).length, detail.name)}
        </span>
      </div>

      <BriefFieldRow label="Name" htmlFor="collection-name">
        <input
          id="collection-name"
          type="text"
          className="field-input"
          value={detail.name}
          onChange={(e) => props.onDraftName(e.target.value)}
          onBlur={props.onCommitName}
        />
      </BriefFieldRow>

      <BriefFieldRow label="Slots" htmlFor="collection-slot-0" help={SLOTS_HELP}>
        <SlotRowsEditor
          key={JSON.stringify(detail.slots)}
          idPrefix="collection"
          slots={detail.slots}
          onCommit={props.onCommitSlots}
        />
      </BriefFieldRow>

      <CollectionOverrides
        overrides={detail.overrides}
        effective={detail.effective_brief}
        slotNames={palette}
        onDraft={props.onDraftOverride}
        onCommit={props.onCommitOverride}
      />

      <BriefFieldRow label="Preview">
        <CollectionPreview collectionId={detail.id} refreshKey={props.previewKey} />
      </BriefFieldRow>

      <DeleteRow name={detail.name} members={detail.members} onDelete={props.onDelete} />
    </section>
  )
}

interface DeleteRowProps {
  name: string
  members: number
  onDelete: () => void
}

/** Refused (and so disabled) while any video belongs to the collection. */
function DeleteRow({ name, members, onDelete }: DeleteRowProps) {
  const [confirming, setConfirming] = useState(false)
  const inUse = members > 0
  return (
    <div className="flex flex-col gap-1.5">
      {confirming && !inUse ? (
        <div className="flex items-center gap-2 text-xs">
          <span style={{ color: 'var(--color-text-2)' }}>{`Delete ${name}?`}</span>
          <Button variant="danger" className="text-xs" onClick={onDelete}>
            Delete
          </Button>
          <Button variant="ghost" className="text-xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="danger"
          className="self-start text-xs"
          disabled={inUse}
          onClick={() => setConfirming(true)}
        >
          Delete collection
        </Button>
      )}
      {inUse && (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {`${videoCount(members)} belong${members === 1 ? 's' : ''} to this collection — set their collection to None in the Publish workspace before deleting it.`}
        </p>
      )}
    </div>
  )
}
