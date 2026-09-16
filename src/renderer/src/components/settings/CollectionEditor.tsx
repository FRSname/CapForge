/**
 * One collection — a "folder" in the UI — opened from Settings → Folders: its
 * name, its Location (the folder it sits inside), its slots, the channel-brief
 * fields it overrides, a live preview of a member's DESCRIPTION, and delete.
 *
 * The container reads `GET /collections/{cid}` and writes `PATCH` per field
 * (no `If-Match`, like the brief): a keystroke is a local draft, a blur is a
 * write, and the collection the backend answers with is adopted. `overrides`
 * merge per field on the backend, so each write carries only its own field.
 * A refused move or delete (`CollectionRefusedError`) is shown inline, under
 * the control that caused it; any other failure is toasted.
 */

import { useEffect, useState } from 'react'
import { useToast } from '../../hooks/useToast'
import type {
  BriefOverrideField,
  BriefOverrides,
  CollectionDetail,
  CollectionSummary,
} from '../../lib/collectionTypes'
import { ancestorsOf } from '../../lib/collectionTree'
import {
  deleteBlocker,
  overriddenFields,
  overridesSummary,
  paletteSlots,
} from '../../lib/collections'
import type { CollectionPatch } from '../../lib/collectionsApi'
import {
  CollectionRefusedError,
  deleteCollection,
  getCollection,
  patchCollection,
} from '../../lib/collectionsApi'
import type { Brief } from '../../lib/publishTypes'
import { Button } from '../ui/Button'
import { BriefFieldRow } from './BriefFields'
import { CollectionLocation } from './CollectionLocation'
import { CollectionOverrides } from './CollectionOverrides'
import { CollectionPreview } from './CollectionPreview'
import { SlotRowsEditor } from './SlotFields'

/** Re-exported: Settings → Folders and the library's folder menu share one copy. */
export { deleteBlocker }

export type DraftOverride = <K extends BriefOverrideField>(field: K, value: Brief[K]) => void
export type CommitOverride = <K extends BriefOverrideField>(
  field: K,
  value: Brief[K] | null
) => void

/** Which control a refusal is shown under. */
export type RefusalPlace = 'location' | 'delete'

export interface EditorRefusal {
  place: RefusalPlace
  message: string
}

const SLOTS_HELP =
  'Values for {{name}} placeholders. They add to the slots this folder inherits and win on a clash.'

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface CollectionEditorProps {
  collectionId: string
  /** Every folder, flat: the Location options, the ancestors and the subfolder count. */
  collections: readonly CollectionSummary[]
  /** A write landed — the list's names, counts and tree may have changed. */
  onChanged: () => void
  onDeleted: () => void
}

export function CollectionEditor(props: CollectionEditorProps) {
  const { collectionId, collections, onChanged, onDeleted } = props
  const { toast } = useToast()
  const [detail, setDetail] = useState<CollectionDetail | null>(null)
  /** Bumped per landed write, so the preview re-renders the package. */
  const [previewKey, setPreviewKey] = useState(0)
  const [refusal, setRefusal] = useState<EditorRefusal | null>(null)

  useEffect(() => {
    let cancelled = false
    getCollection(collectionId)
      .then((next) => {
        if (!cancelled) setDetail(next)
      })
      .catch((err) => toast(`Could not open the folder: ${reasonOf(err)}`, 'error'))
    return () => {
      cancelled = true
    }
  }, [collectionId, toast])

  if (!detail) {
    return (
      <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>
        Opening the folder…
      </p>
    )
  }

  /** A refusal goes under its control; anything else is a toast. */
  function fail(place: RefusalPlace, prefix: string, err: unknown) {
    if (err instanceof CollectionRefusedError) setRefusal({ place, message: err.message })
    else toast(`${prefix}${reasonOf(err)}`, 'error')
  }

  function save(patch: CollectionPatch) {
    setRefusal(null)
    patchCollection(collectionId, patch)
      .then((next) => {
        setDetail(next)
        setPreviewKey((n) => n + 1)
        onChanged()
      })
      .catch((err) => fail('location', 'Could not save the folder: ', err))
  }

  const draftOverride: DraftOverride = (field, value) =>
    setDetail((prev) => prev && { ...prev, overrides: { ...prev.overrides, [field]: value } })

  const commitOverride: CommitOverride = (field, value) => {
    draftOverride(field, value as never)
    save({ overrides: { [field]: value } as Partial<BriefOverrides> })
  }

  function remove() {
    setRefusal(null)
    deleteCollection(collectionId)
      .then(() => {
        toast(`Deleted ${detail?.name ?? collectionId}`, 'success')
        onDeleted()
      })
      .catch((err) => fail('delete', '', err))
  }

  return (
    <CollectionEditorView
      detail={detail}
      collections={collections}
      previewKey={previewKey}
      refusal={refusal}
      onDraftName={(name) => setDetail((prev) => prev && { ...prev, name })}
      onCommitName={() => {
        const name = detail.name.trim()
        if (!name) toast('A folder needs a name.', 'error')
        else save({ name })
      }}
      onMove={(parentId) => save({ parent_id: parentId })}
      onCommitSlots={(slots) => save({ slots })}
      onDraftOverride={draftOverride}
      onCommitOverride={commitOverride}
      onDelete={remove}
    />
  )
}

export interface CollectionEditorViewProps {
  detail: CollectionDetail
  /** Every folder, flat. */
  collections: readonly CollectionSummary[]
  previewKey: number
  /** The last refused move or delete, and which control it belongs under. */
  refusal: EditorRefusal | null
  onDraftName: (name: string) => void
  onCommitName: () => void
  onMove: (parentId: string | null) => void
  onCommitSlots: (slots: Record<string, string>) => void
  onDraftOverride: DraftOverride
  onCommitOverride: CommitOverride
  onDelete: () => void
}

export function CollectionEditorView(props: CollectionEditorViewProps) {
  const { detail, collections, refusal } = props
  const palette = paletteSlots(detail.effective_brief.slots, detail.slots)
  const subfolders = collections.filter((c) => c.parent_id === detail.id).length

  return (
    <section
      aria-label={`Folder ${detail.name}`}
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

      <CollectionLocation
        collectionId={detail.id}
        parentId={detail.parent_id}
        collections={collections}
        error={refusal?.place === 'location' ? refusal.message : null}
        onMove={props.onMove}
      />

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
        ancestors={ancestorsOf(collections, detail.id)}
        slotNames={palette}
        onDraft={props.onDraftOverride}
        onCommit={props.onCommitOverride}
      />

      <BriefFieldRow label="Preview">
        <CollectionPreview collectionId={detail.id} refreshKey={props.previewKey} />
      </BriefFieldRow>

      <DeleteRow
        name={detail.name}
        members={detail.members}
        subfolders={subfolders}
        error={refusal?.place === 'delete' ? refusal.message : null}
        onDelete={props.onDelete}
      />
    </section>
  )
}

interface DeleteRowProps {
  name: string
  members: number
  /** Direct subfolders. */
  subfolders: number
  /** The backend's refusal, when the list was stale and delete was allowed. */
  error: string | null
  onDelete: () => void
}

/** Refused (and so disabled) while any video or subfolder is in the folder. */
function DeleteRow({ name, members, subfolders, error, onDelete }: DeleteRowProps) {
  const [confirming, setConfirming] = useState(false)
  const blocker = deleteBlocker(members, subfolders)
  return (
    <div className="flex flex-col gap-1.5">
      {confirming && blocker === null ? (
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
          disabled={blocker !== null}
          onClick={() => setConfirming(true)}
        >
          Delete folder
        </Button>
      )}
      {blocker && (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {blocker}
        </p>
      )}
      {error && (
        <p role="alert" className="text-2xs" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
