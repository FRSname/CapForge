/**
 * The library toolbar's view controls, rendered to static markup: search, the
 * sort menu and its direction, grid/list, and the icon-size slider (grid only).
 * The row rules (no wrapped labels, wraps as a row) are pinned from
 * `LibraryScreen.test.tsx`, where the toolbar is mounted for real.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryViewPrefs } from '../../lib/libraryPrefs'
import {
  DEFAULT_LIBRARY_VIEW_PREFS,
  LIBRARY_TILE_MAX_PX,
  LIBRARY_TILE_MIN_PX,
} from '../../lib/libraryPrefs'
import { ALL_COLLECTIONS } from '../../lib/libraryView'
import { LibraryToolbar } from './LibraryToolbar'

function render(
  view: LibraryViewPrefs | null = DEFAULT_LIBRARY_VIEW_PREFS,
  searchQuery = ''
): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <LibraryToolbar
      filterOptions={[{ value: ALL_COLLECTIONS, label: 'All videos' }]}
      filter={ALL_COLLECTIONS}
      onFilterChange={noop}
      onCreateCollection={() => Promise.resolve({ kind: 'failed' as const })}
      onImport={noop}
      onAddVideo={noop}
      view={view}
      onViewChange={noop}
      searchQuery={searchQuery}
      onSearchChange={noop}
    />
  )
}

describe('LibraryToolbar view controls', () => {
  test('offers search, sort, direction and grid/list', () => {
    const html = render()
    expect(html).toContain('aria-label="Search the library"')
    expect(html).toContain('aria-label="Sort by"')
    expect(html).toContain('aria-label="Sort descending"')
    expect(html).toMatch(/role="radiogroup" aria-label="Layout"/)
    expect(html).toContain('>Grid<')
    expect(html).toContain('>List<')
  })

  test('the sort menu lists every key and shows the current one', () => {
    const html = render({ ...DEFAULT_LIBRARY_VIEW_PREFS, sort: { key: 'name', direction: 'asc' } })
    for (const label of ['Date modified', 'Name', 'Duration', 'Status', 'Date added']) {
      expect(html).toContain(`>${label}</option>`)
    }
    expect(html).toContain('<option value="name" selected="">Name</option>')
    expect(html).toContain('aria-label="Sort ascending"')
  })

  test('the icon-size slider shows in grid, bounded by the range', () => {
    const html = render({ ...DEFAULT_LIBRARY_VIEW_PREFS, tileSize: 300 })
    const slider = html.slice(html.indexOf('<input type="range"'))
    const tag = slider.slice(0, slider.indexOf('>'))
    expect(tag).toContain('aria-label="Icon size"')
    expect(tag).toContain(`min="${LIBRARY_TILE_MIN_PX}"`)
    expect(tag).toContain(`max="${LIBRARY_TILE_MAX_PX}"`)
    expect(tag).toContain('value="300"')
  })

  test('the slider is gone in list', () => {
    const html = render({ ...DEFAULT_LIBRARY_VIEW_PREFS, layout: 'list' })
    expect(html).not.toContain('Icon size')
    expect(html).toMatch(/aria-checked="true"[^>]*>(<[^>]+>)*List</)
  })

  test('the search field shows the query', () => {
    expect(render(DEFAULT_LIBRARY_VIEW_PREFS, 'keynote')).toContain('value="keynote"')
  })

  test('no view (an empty library) hides every view control but keeps the actions', () => {
    const html = render(null)
    expect(html).not.toContain('Search the library')
    expect(html).not.toContain('Sort by')
    expect(html).not.toContain('Layout')
    expect(html).toContain('>Import…<')
    expect(html).toContain('Add video')
  })

  test('inputs set their width inline (field-input would override a utility)', () => {
    const html = render()
    expect(html).toMatch(/<input[^>]*aria-label="Search the library"[^>]*style="width:/)
    expect(html).toMatch(/<select[^>]*aria-label="Sort by"[^>]*style="width:auto/)
  })

  test('the direction button never wraps its label', () => {
    const html = render()
    const at = html.indexOf('aria-label="Sort descending"')
    expect(html.slice(html.lastIndexOf('<button', at), at)).toContain('whitespace-nowrap')
  })
})
