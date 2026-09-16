/**
 * Settings → Folders (docs/plans/library-collections.md,
 * docs/plans/library-finder.md §2.6): events and series that share
 * boilerplate. A folder is a collection — the code, the wire and the agent say
 * "collection", a person reads "folder". It overrides fields of the channel
 * brief and adds template slots, inherits both from the folders above it, and
 * every member video's package is rendered from that effective brief at read
 * time, so changing it here changes all of them.
 *
 * This file is the list: the tree indented with each folder's video count
 * (subfolders included), orphan ids to adopt, and create by name at the top
 * level. The selected folder opens in `CollectionEditor`, where its Location
 * moves it. Every failure is toasted; the backend decides ids and slot names.
 */

import { useCallback, useState } from 'react'
import { useCollections } from '../../hooks/useCollections'
import { useToast } from '../../hooks/useToast'
import type { CollectionOrphan, NestedCollection } from '../../lib/collectionTypes'
import { buildTree, flattenTree } from '../../lib/collectionTree'
import { slugPreview, videoCount } from '../../lib/collections'
import type { CollectionCreate } from '../../lib/collectionsApi'
import { createCollection } from '../../lib/collectionsApi'
import { Button } from '../ui/Button'
import { CollectionEditor } from './CollectionEditor'

/** Left padding per level of nesting, in rem, on top of the row's own. */
const INDENT_REM_PER_LEVEL = 1
/** The row's own left padding, in rem (Tailwind `px-2`). */
const ROW_PADDING_REM = 0.5

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function CollectionsSettings() {
  const { toast } = useToast()
  const notify = useCallback((message: string) => toast(message, 'error'), [toast])
  const { collections, orphans, refresh } = useCollections({ notify })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function create(input: CollectionCreate) {
    createCollection(input)
      .then((created) => {
        toast(`Created ${created.name}`, 'success')
        setSelectedId(created.id)
        void refresh()
      })
      .catch((err) => notify(`Could not create the folder: ${reasonOf(err)}`))
  }

  return (
    <div className="flex flex-col gap-5">
      <CollectionsSettingsView
        collections={collections ?? []}
        orphans={orphans}
        loading={collections === null}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={(name) => create({ name })}
        // Adopting keeps the exact id the records already carry.
        onAdopt={(id) => create({ id, name: id })}
      />
      {selectedId && (
        <CollectionEditor
          key={selectedId}
          collectionId={selectedId}
          collections={collections ?? []}
          onChanged={() => void refresh()}
          onDeleted={() => {
            setSelectedId(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

export interface CollectionsSettingsViewProps {
  collections: readonly NestedCollection[]
  orphans: readonly CollectionOrphan[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onAdopt: (id: string) => void
}

export function CollectionsSettingsView(props: CollectionsSettingsViewProps) {
  const { collections, orphans, loading, selectedId, onSelect } = props
  const rows = flattenTree(buildTree(collections))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        A folder is an event or a series whose videos share boilerplate. It can override any field
        of the channel brief and add template slots, and a folder inside another inherits both; a
        video joins one from its Publish workspace.
      </p>

      <ul className="flex flex-col gap-0.5" aria-label="Folders">
        {rows.map(({ item: c, depth }) => (
          <li key={c.id} aria-level={depth}>
            <button
              type="button"
              aria-current={c.id === selectedId ? 'true' : undefined}
              className="flex w-full items-center gap-2 rounded py-1.5 pr-2 text-left text-xs hover:bg-[var(--color-surface-2)]"
              style={{
                paddingLeft: `${ROW_PADDING_REM + (depth - 1) * INDENT_REM_PER_LEVEL}rem`,
                background: c.id === selectedId ? 'var(--color-surface-2)' : 'transparent',
                color: 'var(--color-text)',
              }}
              onClick={() => onSelect(c.id)}
            >
              <span className="truncate">{c.name}</span>
              <span
                className="truncate text-2xs"
                style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
              >
                {c.id}
              </span>
              <span className="ml-auto shrink-0 text-2xs" style={{ color: 'var(--color-text-3)' }}>
                {videoCount(c.total_members)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {collections.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>
          {loading ? 'Reading folders…' : 'No folders yet.'}
        </p>
      )}

      {orphans.map((orphan) => (
        <OrphanRow key={orphan.id} orphan={orphan} onAdopt={props.onAdopt} />
      ))}

      <CreateCollectionRow onCreate={props.onCreate} />
    </div>
  )
}

function OrphanRow({
  orphan,
  onAdopt,
}: {
  orphan: CollectionOrphan
  onAdopt: (id: string) => void
}) {
  return (
    <div
      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
      style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-2)' }}
    >
      <span className="truncate">
        {`${videoCount(orphan.members)} use `}
        <code style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text)' }}>
          {orphan.id}
        </code>
        {' — no folder has that id'}
      </span>
      <Button
        variant="ghost"
        className="ml-auto shrink-0 text-xs"
        aria-label={`Create folder ${orphan.id}`}
        onClick={() => onAdopt(orphan.id)}
      >
        Create folder
      </Button>
    </div>
  )
}

function CreateCollectionRow({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const slug = slugPreview(trimmed)

  function submit() {
    if (!trimmed) return
    onCreate(trimmed)
    setName('')
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          className="field-input"
          aria-label="New folder name"
          placeholder="New folder — e.g. UCK 26"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <Button variant="primary" className="shrink-0 text-xs" disabled={!trimmed} onClick={submit}>
          Create
        </Button>
      </div>
      {slug && (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {`Its id will likely be ${slug} — the backend decides, and adds -2 on a clash. Set its Location to put it inside another folder.`}
        </p>
      )}
    </div>
  )
}
