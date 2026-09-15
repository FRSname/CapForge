/**
 * What a member video's DESCRIPTION looks like with this collection applied.
 *
 * The package is rendered by the backend at read time (`GET
 * /api/library/{id}/package`), from the record plus the effective brief — so
 * this is not a renderer-side approximation of the template, it *is* the text
 * the user would paste: the package's `description` field. The renderer never
 * digs it out of the full package text; a backend too old to send it gets an
 * "update" note instead of a guess. Its `package.description` findings
 * (unknown slots, the assembled body over 5000 bytes, angle brackets) are
 * drawn under it.
 */

import { useEffect, useState } from 'react'
import { useToast } from '../../hooks/useToast'
import { api } from '../../lib/api'
import { packageDescriptionViolations } from '../../lib/collections'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { displayTitle, filterByCollection } from '../../lib/libraryView'
import type { UploadPackage } from '../../lib/publishTypes'
import { FieldViolations } from '../publish/FieldViolations'
import { Button } from '../ui/Button'

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface CollectionPreviewProps {
  collectionId: string
  /** Bumped by the editor after each saved change. */
  refreshKey: number
}

export function CollectionPreview({ collectionId, refreshKey }: CollectionPreviewProps) {
  const { toast } = useToast()
  const [members, setMembers] = useState<LibraryVideo[] | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  /** The package and the request it answered, so a stale answer is never shown as current. */
  const [result, setResult] = useState<{ key: string; pkg: UploadPackage } | null>(null)

  const selectedId =
    pickedId && members?.some((v) => v.id === pickedId) ? pickedId : (members?.[0]?.id ?? null)
  const requestKey = `${selectedId}:${refreshKey}:${reloads}`

  useEffect(() => {
    let cancelled = false
    api
      .listLibrary()
      .then((videos) => {
        if (!cancelled) setMembers(filterByCollection(videos, collectionId))
      })
      .catch((err) => toast(`Could not list this collection’s videos: ${reasonOf(err)}`, 'error'))
    return () => {
      cancelled = true
    }
  }, [collectionId, refreshKey, toast])

  useEffect(() => {
    if (!selectedId) return undefined
    let cancelled = false
    api
      .getUploadPackage(selectedId)
      .then((pkg) => {
        if (!cancelled) setResult({ key: requestKey, pkg })
      })
      .catch((err) => toast(`Could not render the preview: ${reasonOf(err)}`, 'error'))
    return () => {
      cancelled = true
    }
  }, [selectedId, requestKey, toast])

  const pkg = selectedId ? (result?.pkg ?? null) : null
  return (
    <CollectionPreviewView
      members={members}
      selectedId={selectedId}
      pkg={pkg}
      loading={selectedId !== null && result?.key !== requestKey}
      onSelect={setPickedId}
      onRefresh={() => setReloads((n) => n + 1)}
    />
  )
}

export interface CollectionPreviewViewProps {
  /** Null while the library list is being read. */
  members: readonly LibraryVideo[] | null
  selectedId: string | null
  /** The selected member's package; null until one has arrived. */
  pkg: UploadPackage | null
  loading: boolean
  onSelect: (id: string) => void
  onRefresh: () => void
}

export function CollectionPreviewView(props: CollectionPreviewViewProps) {
  const { members, selectedId, pkg, loading } = props
  const muted = { color: 'var(--color-text-3)' }

  if (members === null) {
    return (
      <p className="text-xs" style={muted}>
        Finding this collection’s videos…
      </p>
    )
  }
  if (members.length === 0) {
    return (
      <p className="text-xs" style={muted}>
        No video belongs to this collection yet — pick it on a video’s Collection card in the
        Publish workspace to preview its package here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          className="field-input"
          aria-label="Preview video"
          value={selectedId ?? ''}
          onChange={(e) => props.onSelect(e.target.value)}
        >
          {members.map((video) => (
            <option key={video.id} value={video.id}>
              {displayTitle(video)}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          className="shrink-0 text-xs"
          loading={loading}
          onClick={props.onRefresh}
        >
          Refresh
        </Button>
      </div>
      <PreviewBody pkg={pkg} loading={loading} />
      {pkg && <FieldViolations violations={packageDescriptionViolations(pkg.violations)} />}
    </div>
  )
}

export const BACKEND_TOO_OLD_MESSAGE = 'Update CapForge’s backend to preview the description.'

/** The description itself, or why there is none to show. */
function PreviewBody({ pkg, loading }: { pkg: UploadPackage | null; loading: boolean }) {
  const muted = { color: 'var(--color-text-3)' }
  if (!pkg) {
    return (
      <p className="text-xs" style={muted}>
        {loading ? 'Rendering the package…' : 'No package to preview.'}
      </p>
    )
  }
  if (pkg.description === null) {
    return (
      <p className="text-xs" style={muted}>
        {BACKEND_TOO_OLD_MESSAGE}
      </p>
    )
  }
  return (
    <pre
      aria-label="Package description"
      className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded p-2 text-2xs"
      style={{
        fontFamily: 'var(--cf-font-mono)',
        color: 'var(--color-text-2)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
      }}
    >
      {pkg.description || 'This package has no DESCRIPTION yet.'}
    </pre>
  )
}
