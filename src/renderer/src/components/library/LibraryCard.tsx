/**
 * One library record, as a card.
 *
 * The poster block (`LibraryPoster`) takes the video's own ratio, so a 9:16
 * recording is a tall card in its grid column rather than a letterboxed 16:9
 * one; it carries the duration badge and the missing-media chip.
 *
 * The `…` menu is local state and the destructive item confirms **inline**:
 * no native dialog, because the renderer's tests have no DOM and a
 * `window.confirm` would be untestable as well as ugly. A record whose media
 * is missing also gets "Locate…"; if the picked file is different media, the
 * same inline pattern asks before linking it anyway. "Move to collection…"
 * swaps the actions for `MoveToCollectionMenu`.
 */

import { useState } from 'react'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { CollectionSummary } from '../../lib/collectionTypes'
import type { LocateOutcome } from '../../lib/libraryImport'
import { pathBaseName } from '../../lib/libraryImport'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { displayTitle, statusPips } from '../../lib/libraryView'
import { InlineConfirm, MenuItem } from './LibraryMenuParts'
import { LibraryPoster } from './LibraryPoster'
import { MoveToCollectionMenu } from './MoveToCollectionMenu'

/** The status rail, in ladder order — also used by the Continue hero. */
const PIP_LABELS = ['Transcribed', 'Captioned', 'Drafted', 'Published'] as const

export interface StatusRailProps {
  video: LibraryVideo
}

export function StatusRail({ video }: StatusRailProps) {
  const pips = statusPips(video.status)
  const lit = [pips.transcribed, pips.captioned, pips.drafted, pips.published]
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Status: ${video.status}`}
      title={PIP_LABELS.filter((_, i) => lit[i]).join(' · ') || 'Imported'}
    >
      {PIP_LABELS.map((label, i) => (
        <span
          key={label}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: lit[i] ? 'var(--color-brand)' : 'var(--color-border-3)',
            opacity: lit[i] ? 1 : 0.6,
          }}
        />
      ))}
    </div>
  )
}

/** The language chip — TrackTabs' badge style, reused verbatim. */
export function LanguageChip({ lang }: { lang: string | null }) {
  if (!lang) return null
  return (
    <span
      className="rounded px-1 text-2xs uppercase tabular-nums"
      style={{ color: 'var(--color-text-3)', background: 'var(--color-surface-3)' }}
      title={`Caption language: ${lang}`}
    >
      {lang}
    </span>
  )
}

/** The collection a record belongs to, by name — nothing for a record in none. */
export function CollectionChip({ name }: { name: string | null | undefined }) {
  if (!name) return null
  return (
    <span
      className="max-w-[96px] truncate rounded px-1 text-2xs"
      style={{ color: 'var(--color-brand)', background: 'var(--color-surface-3)' }}
      title={`Collection: ${name}`}
    >
      {name}
    </span>
  )
}

/** ISO → a short local date; empty when the backend sent nothing usable. */
function formatUpdated(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export interface LibraryCardProps {
  video: LibraryVideo
  /** The name of the record's collection (or its bare id when none is defined). */
  collectionName?: string | null
  /** Every collection, for "Move to collection…". */
  collections: readonly CollectionSummary[]
  onOpen: (video: LibraryVideo) => void
  /** Hide the record, keeping every file it holds. */
  onRemove: (video: LibraryVideo) => void
  /** Un-index it and move its folder to the Trash. */
  onDelete: (video: LibraryVideo) => void
  /** Pick a file for missing media and relink. Never rejects; failures are toasted. */
  onLocate: (video: LibraryVideo) => Promise<LocateOutcome>
  /** Link a different file anyway, after the inline confirm. */
  onForceLocate: (video: LibraryVideo, path: string) => void
  /** Put the record in a collection (null: in none). Failures are toasted. */
  onMoveToCollection: (video: LibraryVideo, collectionId: string | null) => void
  /** Create a collection by name; the card then moves the record into it. */
  onCreateCollection: (name: string) => Promise<CreateCollectionResult>
}

export function LibraryCard({
  video,
  collectionName,
  collections,
  onOpen,
  onRemove,
  onDelete,
  onLocate,
  onForceLocate,
  onMoveToCollection,
  onCreateCollection,
}: LibraryCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [pendingLinkPath, setPendingLinkPath] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const title = displayTitle(video)

  function closeMenu() {
    setMenuOpen(false)
    setConfirmingDelete(false)
    setPendingLinkPath(null)
    setMoving(false)
  }

  function handleLocate() {
    closeMenu()
    void onLocate(video).then((outcome) => {
      if (outcome.kind !== 'confirm') return
      // Reopen on the confirm: the picker took the focus away from the card.
      setPendingLinkPath(outcome.path)
      setMenuOpen(true)
    })
  }

  function handlePickCollection(collectionId: string | null) {
    closeMenu()
    if (collectionId !== video.collection_id) onMoveToCollection(video, collectionId)
  }

  return (
    <div className="group relative flex flex-col gap-2.5">
      <button
        type="button"
        className="flex flex-col gap-2.5 rounded-xl p-2 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        title={video.sourcePath}
        aria-label={`Open ${title}`}
        onClick={() => onOpen(video)}
      >
        <LibraryPoster video={video} />
        <div className="flex flex-col gap-1.5 px-0.5 pb-0.5">
          <span
            className="truncate text-sm"
            style={{ color: 'var(--color-text)', fontFamily: 'var(--cf-font-ui)' }}
          >
            {title}
          </span>
          <div className="flex items-center gap-2">
            <StatusRail video={video} />
            <LanguageChip lang={video.language} />
            <CollectionChip name={collectionName} />
            <span className="ml-auto text-2xs" style={{ color: 'var(--color-text-3)' }}>
              {formatUpdated(video.updatedAt)}
            </span>
          </div>
        </div>
      </button>

      <button
        type="button"
        aria-label={`Actions for ${title}`}
        title="Record actions"
        className="absolute right-3 top-3 rounded px-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        style={{ color: 'var(--color-text-2)', background: 'var(--color-base)' }}
        onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
      >
        ⋯
      </button>

      {menuOpen && (
        <LibraryCardMenu
          video={video}
          confirmingDelete={confirmingDelete}
          pendingLinkPath={pendingLinkPath}
          moving={moving}
          collections={collections}
          onRemove={() => {
            closeMenu()
            onRemove(video)
          }}
          onAskDelete={() => setConfirmingDelete(true)}
          onDelete={() => {
            closeMenu()
            onDelete(video)
          }}
          onCancelDelete={() => setConfirmingDelete(false)}
          onLocate={handleLocate}
          onLink={() => {
            const path = pendingLinkPath
            closeMenu()
            if (path) onForceLocate(video, path)
          }}
          onCancelLink={closeMenu}
          onAskMove={() => setMoving(true)}
          onBackFromMove={() => setMoving(false)}
          onPickCollection={handlePickCollection}
          onCreateCollection={onCreateCollection}
        />
      )}
    </div>
  )
}

export interface LibraryCardMenuProps {
  video: LibraryVideo
  /** "Delete record…" was clicked; the inline Delete/Cancel shows instead. */
  confirmingDelete: boolean
  /** A different-media file awaiting "link anyway?"; null when none. */
  pendingLinkPath: string | null
  /** "Move to collection…" was clicked; the sub-list shows instead of the actions. */
  moving: boolean
  collections: readonly CollectionSummary[]
  onRemove: () => void
  onAskDelete: () => void
  onDelete: () => void
  onCancelDelete: () => void
  onLocate: () => void
  onLink: () => void
  onCancelLink: () => void
  onAskMove: () => void
  onBackFromMove: () => void
  onPickCollection: (collectionId: string | null) => void
  onCreateCollection: (name: string) => Promise<CreateCollectionResult>
}

/** The card's `…` menu — presentational, so every state renders to static markup. */
export function LibraryCardMenu(props: LibraryCardMenuProps) {
  const { video, confirmingDelete, pendingLinkPath } = props
  return (
    <div
      role="menu"
      className="absolute right-3 top-9 z-10 flex w-52 flex-col rounded-lg p-1 text-xs"
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border-2)',
        boxShadow: 'var(--shadow-2)',
      }}
    >
      {props.moving ? (
        <MoveToCollectionMenu
          collections={props.collections}
          currentId={video.collection_id}
          onPick={props.onPickCollection}
          onCreate={props.onCreateCollection}
          onBack={props.onBackFromMove}
        />
      ) : (
        <>
          {video.missing_media &&
            (pendingLinkPath ? (
              <InlineConfirm
                prompt="Different file — link anyway?"
                title={`${pathBaseName(pendingLinkPath)} is not the media this video was made from`}
                confirmLabel="Link"
                confirmColor="var(--color-brand)"
                onConfirm={props.onLink}
                onCancel={props.onCancelLink}
              />
            ) : (
              <MenuItem
                label="Locate…"
                title={`Find the moved file: ${video.sourcePath}`}
                onClick={props.onLocate}
              />
            ))}
          <MenuItem label="Move to collection…" onClick={props.onAskMove} />
          <MenuItem label="Remove from library" onClick={props.onRemove} />
          {confirmingDelete ? (
            <InlineConfirm
              prompt="Delete?"
              confirmLabel="Delete"
              confirmColor="var(--color-danger)"
              onConfirm={props.onDelete}
              onCancel={props.onCancelDelete}
            />
          ) : (
            <MenuItem
              label="Delete record…"
              color="var(--color-danger)"
              onClick={props.onAskDelete}
            />
          )}
        </>
      )}
    </div>
  )
}
