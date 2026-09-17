/**
 * The library masthead's actions: the view controls (`LibraryViewControls`:
 * search, sort, grid/list, icon size — only while the library has videos),
 * then Add to library… (the import picker) and Transcribe…. Where the library
 * is looking is the sidebar's and the path bar's job; "New folder" lives at the
 * foot of the sidebar.
 *
 * Layout rules, because this row used to break: no button label ever wraps
 * (`whitespace-nowrap`), and when the row runs out of room it wraps as a row
 * (`flex-wrap`).
 */

import type { ImportPickMode } from '../../lib/libraryImport'
import type { LibraryViewPrefs } from '../../lib/libraryPrefs'
import { Button } from '../ui/Button'
import { ImportButton } from './ImportButton'
import { LibraryViewControls } from './LibraryViewControls'

export interface LibraryToolbarProps {
  /** Add to library… — open the import picker in this mode and import what is picked. */
  onImport: (mode: ImportPickMode) => void
  onAddVideo: () => void
  /** The layout, icon size and sort; null hides the view controls (an empty library). */
  view: LibraryViewPrefs | null
  onViewChange: (next: LibraryViewPrefs) => void
  searchQuery: string
  onSearchChange: (query: string) => void
}

export function LibraryToolbar({
  onImport,
  onAddVideo,
  view,
  onViewChange,
  searchQuery,
  onSearchChange,
}: LibraryToolbarProps) {
  return (
    <div className="app-no-drag flex min-w-0 flex-wrap items-center justify-end gap-2">
      {view && (
        <LibraryViewControls
          view={view}
          onViewChange={onViewChange}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
        />
      )}
      {/* The coach-mark tour points at the pair, not at either button. */}
      <span data-tour="library-add-video" className="flex items-center gap-2">
        <ImportButton onImport={onImport} align="end" />
        <Button
          variant="primary"
          className="whitespace-nowrap text-xs"
          title="Pick one file and transcribe it now"
          onClick={onAddVideo}
        >
          Transcribe…
        </Button>
      </span>
    </div>
  )
}

export interface SidebarToggleProps {
  collapsed: boolean
  onToggle: () => void
}

/** Shows or hides the folder sidebar; the first control of the masthead row. */
export function SidebarToggle({ collapsed, onToggle }: SidebarToggleProps) {
  return (
    <Button
      variant="ghost"
      className="app-no-drag shrink-0 self-center whitespace-nowrap px-2 text-xs"
      aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      aria-pressed={!collapsed}
      title={collapsed ? 'Show the folders' : 'Hide the folders'}
      onClick={onToggle}
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
        <path d="M6 2.5v11" stroke="currentColor" />
      </svg>
    </Button>
  )
}
