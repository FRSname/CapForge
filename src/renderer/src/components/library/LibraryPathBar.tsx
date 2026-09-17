/**
 * The library's heading as a path (docs/plans/library-finder.md §4.2):
 * `Library › Events › UCK26`. Every crumb but the last navigates and takes
 * drops (videos and folders move there); the last is the current location's
 * name, styled as the screen's heading. All videos is its own single crumb.
 */

import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import type { Crumb, LibraryLocation } from '../../lib/libraryLocation'
import { locationKey } from '../../lib/libraryLocation'
import { DROP_TARGET_STYLE } from './folderItemUi'

export interface LibraryPathBarProps {
  crumbs: readonly Crumb[]
  /** "3 videos", "loading…", "1 of 4 videos". */
  countLabel: string
  drag: LibraryDrag
  onNavigate: (location: LibraryLocation) => void
}

const CRUMB_TEXT = {
  fontFamily: 'var(--cf-font-display)',
  fontStyle: 'italic',
} as const

export function LibraryPathBar({ crumbs, countLabel, drag, onNavigate }: LibraryPathBarProps) {
  const ancestors = crumbs.slice(0, -1)
  const current = crumbs[crumbs.length - 1]
  return (
    <nav aria-label="Path" className="flex min-w-0 shrink items-baseline gap-3">
      <ol className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {ancestors.map((crumb) => (
          <AncestorCrumb
            key={locationKey(crumb.location)}
            crumb={crumb}
            drag={drag}
            onNavigate={onNavigate}
          />
        ))}
        {current && (
          <li className="min-w-0">
            <h1
              aria-current="location"
              className="truncate text-3xl leading-none"
              style={{ ...CRUMB_TEXT, color: 'var(--color-text)' }}
            >
              {current.label}
            </h1>
          </li>
        )}
      </ol>
      <span
        className="whitespace-nowrap text-xs-plus uppercase tracking-widest"
        style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
      >
        {countLabel}
      </span>
    </nav>
  )
}

interface AncestorCrumbProps {
  crumb: Crumb
  drag: LibraryDrag
  onNavigate: (location: LibraryLocation) => void
}

function AncestorCrumb({ crumb, drag, onNavigate }: AncestorCrumbProps) {
  const target = drag.target(crumb.targetId, `crumb:${locationKey(crumb.location)}`)
  return (
    <li className="flex min-w-0 items-baseline gap-1.5">
      <button
        type="button"
        className="truncate rounded border border-transparent px-1 text-xl leading-none hover:underline"
        style={{
          ...CRUMB_TEXT,
          color: 'var(--color-text-2)',
          ...(target.over ? DROP_TARGET_STYLE : {}),
        }}
        {...target.props}
        onClick={() => onNavigate(crumb.location)}
      >
        {crumb.label}
      </button>
      <span aria-hidden="true" style={{ color: 'var(--color-text-3)' }}>
        ›
      </span>
    </li>
  )
}
