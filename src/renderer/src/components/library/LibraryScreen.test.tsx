/**
 * Render tests via react-dom/server static markup — the vitest environment is
 * plain node (no jsdom), so we assert on the HTML the screen produces.
 *
 * What matters: the status a record is at is legible from the card (the rail is
 * cumulative), a record whose media is gone says so, the newest resumable
 * record is promoted out of the grid exactly once, and the two toolbar actions
 * are always reachable.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { LibraryScreen, droppedNotMediaMessage } from './LibraryScreen'

const LIT = 'background:var(--color-brand)'

function video(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: 'a'.repeat(32),
    title: '',
    sourcePath: '/media/Talk.mp4',
    duration: 125,
    language: 'en',
    status: 'imported',
    collection_id: null,
    scratch: false,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    missing_media: false,
    hasProject: false,
    poster: false,
    ...overrides,
  }
}

function render(props: Partial<React.ComponentProps<typeof LibraryScreen>> = {}): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <LibraryScreen
      videos={[]}
      loading={false}
      onOpen={noop}
      onAddVideo={noop}
      onImportProjects={noop}
      onFileDropped={noop}
      onDropRejected={noop}
      onRemove={noop}
      onDelete={noop}
      {...props}
    />
  )
}

/** How many pips the rail lit across the whole markup. */
function litPips(html: string): number {
  return html.split(LIT).length - 1
}

describe('LibraryScreen', () => {
  test('an empty library shows the drop affordance, not a grid', () => {
    // Arrange / Act
    const html = render()

    // Assert
    expect(html).toContain('Your library is empty')
    expect(html).toContain('Drop your file here')
    expect(html).toContain('0 videos')
    expect(html).not.toContain('All videos')
  })

  test('the toolbar always offers Add video and Import project files', () => {
    // Arrange / Act
    const html = render({ videos: [video()] })

    // Assert
    expect(html).toContain('Add video')
    expect(html).toContain('Import project files…')
  })

  test('shows a card per record with the cumulative status rail', () => {
    // Arrange — three records, none resumable, so none is promoted to the hero.
    const videos = [
      video({ id: 'a'.repeat(32), title: 'Imported one', status: 'imported' }),
      video({ id: 'b'.repeat(32), title: 'Captioned one', status: 'captioned' }),
      video({ id: 'c'.repeat(32), title: 'Published one', status: 'published' }),
    ]

    // Act
    const html = render({ videos })

    // Assert
    expect(html).toContain('3 videos')
    expect(html).toContain('Imported one')
    expect(html).toContain('Captioned one')
    expect(html).toContain('Published one')
    // 0 (imported) + 2 (captioned) + 4 (published)
    expect(litPips(html)).toBe(6)
    expect(html).toContain('Status: captioned')
    expect(html).toContain('Open Published one')
    expect(html).toContain('Actions for Published one')
    // Duration + language ride along on the card.
    expect(html).toContain('2:05')
    expect(html).toContain('>en<')
  })

  test('promotes the newest resumable record into the Continue hero, once', () => {
    // Arrange
    const videos = [
      video({ id: 'a'.repeat(32), title: 'Older session', updatedAt: '2026-09-01T10:00:00Z', hasProject: true }),
      video({ id: 'b'.repeat(32), title: 'Newest session', updatedAt: '2026-09-12T10:00:00Z', hasProject: true }),
    ]

    // Act
    const html = render({ videos })

    // Assert
    expect(html).toContain('Continue Newest session')
    expect(html).toContain('All videos')
    expect(html).toContain('Open Older session')
    // The hero is the same record promoted, not a second copy of it.
    expect(html).not.toContain('Open Newest session')
    expect(html.split('Newest session').length - 1).toBe(2) // aria-label + heading
  })

  test('a record whose media is gone says so, and is never the hero', () => {
    // Arrange
    const videos = [
      video({ id: 'a'.repeat(32), title: 'Gone', missing_media: true, hasProject: true }),
    ]

    // Act
    const html = render({ videos })

    // Assert
    expect(html).toContain('Media missing')
    expect(html).toContain('Open Gone')
    expect(html).not.toContain('Continue Gone')
  })

  test('a record with no duration shows the placeholder instead of NaN', () => {
    // Arrange / Act
    const html = render({ videos: [video({ duration: null })] })

    // Assert
    expect(html).toContain('--:--')
    expect(html).not.toContain('NaN')
  })

  test('the loading count replaces the total while the list is in flight', () => {
    expect(render({ loading: true })).toContain('loading…')
  })

  test('the rejected-drop message names the file', () => {
    expect(droppedNotMediaMessage('notes.pdf')).toContain('notes.pdf')
  })
})
