/**
 * The library masthead's actions: the collection filter and "New collection…"
 * (only while the library has videos), then the two imports and Add video.
 *
 * Layout rules, because this row used to break: no button label ever wraps
 * (`whitespace-nowrap`), and when the row runs out of room it wraps as a row
 * (`flex-wrap`). The filter's width is set **inline**: `.field-input` in
 * `globals.css` is unlayered CSS with `width: 100%`, which beats any Tailwind
 * width utility, so a `w-44` on the select never applied and the select grew
 * to fill the toolbar, squeezing every button onto two lines.
 */

import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { CollectionFilter, CollectionFilterOption } from '../../lib/libraryView'
import { Button } from '../ui/Button'
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
  onImportFolder: () => void
  onImportProjects: () => void
  onAddVideo: () => void
}

export function LibraryToolbar({
  filterOptions,
  filter,
  onFilterChange,
  onCreateCollection,
  onImportFolder,
  onImportProjects,
  onAddVideo,
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
      <Button variant="ghost" className="whitespace-nowrap text-xs" onClick={onImportFolder}>
        Import folder…
      </Button>
      <Button variant="ghost" className="whitespace-nowrap text-xs" onClick={onImportProjects}>
        Import project files…
      </Button>
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
