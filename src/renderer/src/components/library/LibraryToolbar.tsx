/**
 * The library masthead's actions: the collection filter and "New collection…"
 * (only while the library has videos), the view controls (`LibraryViewControls`:
 * search, sort, grid/list, icon size — also only while it has videos), then
 * Import… and Add video.
 *
 * Layout rules, because this row used to break: no button label ever wraps
 * (`whitespace-nowrap`), and when the row runs out of room it wraps as a row
 * (`flex-wrap`). The filter's width is set **inline**: `.field-input` in
 * `globals.css` is unlayered CSS with `width: 100%`, which beats any Tailwind
 * width utility, so a `w-44` on the select never applied and the select grew
 * to fill the toolbar, squeezing every button onto two lines.
 */

import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { ImportPickMode } from '../../lib/libraryImport'
import type { LibraryViewPrefs } from '../../lib/libraryPrefs'
import type { CollectionFilter, CollectionFilterOption } from '../../lib/libraryView'
import { Button } from '../ui/Button'
import { ImportButton } from './ImportButton'
import { LibraryViewControls } from './LibraryViewControls'
import { NewCollectionPopover } from './NewCollectionForm'

/** The filter sizes to its longest option, within these bounds. */
const FILTER_MIN_WIDTH = '9rem'
const FILTER_MAX_WIDTH = '14rem'

export interface LibraryToolbarProps {
  /** The filter's options; null hides the filter and "New collection…". */
  filterOptions: CollectionFilterOption[] | null
  filter: CollectionFilter
  onFilterChange: (value: CollectionFilter) => void
  onCreateCollection: (name: string) => Promise<CreateCollectionResult>
  /** Import… — open the picker in this mode and import what is picked. */
  onImport: (mode: ImportPickMode) => void
  onAddVideo: () => void
  /** The layout, icon size and sort; null hides the view controls (an empty library). */
  view: LibraryViewPrefs | null
  onViewChange: (next: LibraryViewPrefs) => void
  searchQuery: string
  onSearchChange: (query: string) => void
}

export function LibraryToolbar({
  filterOptions,
  filter,
  onFilterChange,
  onCreateCollection,
  onImport,
  onAddVideo,
  view,
  onViewChange,
  searchQuery,
  onSearchChange,
}: LibraryToolbarProps) {
  return (
    <div className="app-no-drag flex min-w-0 flex-wrap items-center justify-end gap-2">
      {filterOptions && (
        <>
          <CollectionFilterSelect
            options={filterOptions}
            value={filter}
            onChange={onFilterChange}
          />
          <NewCollectionPopover
            onCreate={onCreateCollection}
            // Show what was just made: the (empty) new collection.
            onCreated={(collection) => onFilterChange(collection.id)}
          />
        </>
      )}
      {view && (
        <LibraryViewControls
          view={view}
          onViewChange={onViewChange}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
        />
      )}
      <ImportButton onImport={onImport} align="end" />
      <Button variant="primary" className="whitespace-nowrap text-xs" onClick={onAddVideo}>
        Add video
      </Button>
    </div>
  )
}

interface CollectionFilterSelectProps {
  options: CollectionFilterOption[]
  value: CollectionFilter
  onChange: (value: CollectionFilter) => void
}

function CollectionFilterSelect({ options, value, onChange }: CollectionFilterSelectProps) {
  return (
    <select
      className="field-input shrink-0 truncate text-xs"
      aria-label="Filter by collection"
      style={{ width: 'auto', minWidth: FILTER_MIN_WIDTH, maxWidth: FILTER_MAX_WIDTH }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
