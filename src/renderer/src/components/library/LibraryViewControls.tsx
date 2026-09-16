/**
 * The library toolbar's view controls (docs/plans/library-finder.md §3.2):
 * search, the sort menu and its direction, grid/list, and the icon-size slider
 * (grid only).
 *
 * Rendered as a fragment so each control is its own item in the toolbar's
 * wrapping row. Widths are set **inline**, for the reason `LibraryToolbar`'s
 * header explains: `.field-input` is unlayered CSS with `width: 100%`, which
 * beats any Tailwind width utility.
 */

import type { LibraryLayout, LibraryViewPrefs } from '../../lib/libraryPrefs'
import { LIBRARY_TILE_MAX_PX, LIBRARY_TILE_MIN_PX, clampTileSize } from '../../lib/libraryPrefs'
import type { LibrarySortKey } from '../../lib/librarySort'
import {
  LIBRARY_SORT_KEYS,
  SORT_KEY_LABELS,
  defaultSortDirection,
  isLibrarySortKey,
} from '../../lib/librarySort'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'

const SEARCH_WIDTH = '11rem'
const SORT_MIN_WIDTH = '8rem'
const SLIDER_WIDTH = '5.5rem'
/** One pixel per step: the slider is a continuous size. */
const TILE_STEP_PX = 1

const LAYOUT_OPTIONS: ReadonlyArray<{ value: LibraryLayout; label: React.ReactNode }> = [
  { value: 'grid', label: <span className="whitespace-nowrap px-2.5">Grid</span> },
  { value: 'list', label: <span className="whitespace-nowrap px-2.5">List</span> },
]

export interface LibraryViewControlsProps {
  view: LibraryViewPrefs
  onViewChange: (next: LibraryViewPrefs) => void
  searchQuery: string
  onSearchChange: (query: string) => void
}

export function LibraryViewControls({
  view,
  onViewChange,
  searchQuery,
  onSearchChange,
}: LibraryViewControlsProps) {
  const { sort } = view
  return (
    <>
      <input
        type="search"
        className="field-input placeholder-subtle shrink-0 text-xs"
        aria-label="Search the library"
        style={{ width: SEARCH_WIDTH }}
        placeholder="Search"
        title="Titles, descriptions, tags and transcripts. Esc clears."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || searchQuery === '') return
          e.stopPropagation()
          onSearchChange('')
        }}
      />
      <select
        className="field-input shrink-0 text-xs"
        aria-label="Sort by"
        style={{ width: 'auto', minWidth: SORT_MIN_WIDTH }}
        value={sort.key}
        onChange={(e) => {
          if (!isLibrarySortKey(e.target.value)) return
          const key: LibrarySortKey = e.target.value
          onViewChange({ ...view, sort: { key, direction: defaultSortDirection(key) } })
        }}
      >
        {LIBRARY_SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {SORT_KEY_LABELS[key]}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        className="shrink-0 whitespace-nowrap px-2 text-xs"
        aria-label={sort.direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
        title="Reverse the order"
        onClick={() =>
          onViewChange({
            ...view,
            sort: { ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' },
          })
        }
      >
        {sort.direction === 'asc' ? '↑' : '↓'}
      </Button>
      <SegmentedControl
        options={LAYOUT_OPTIONS}
        value={view.layout}
        onChange={(layout) => onViewChange({ ...view, layout })}
        ariaLabel="Layout"
        className="shrink-0"
      />
      {view.layout === 'grid' && (
        <input
          type="range"
          className="shrink-0"
          aria-label="Icon size"
          title="Icon size"
          style={{ width: SLIDER_WIDTH }}
          min={LIBRARY_TILE_MIN_PX}
          max={LIBRARY_TILE_MAX_PX}
          step={TILE_STEP_PX}
          value={view.tileSize}
          onChange={(e) => onViewChange({ ...view, tileSize: clampTileSize(Number(e.target.value)) })}
        />
      )}
    </>
  )
}
