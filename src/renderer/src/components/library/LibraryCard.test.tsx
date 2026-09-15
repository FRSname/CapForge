/**
 * The card's `…` menu — rendered to static markup (the vitest environment is
 * node). The poster block's tests live in `LibraryPoster.test.tsx`.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { LibraryCardMenu } from './LibraryCard'

const video: LibraryVideo = {
  id: 'vid_1',
  title: 'Shipping v3',
  sourcePath: '/media/Talk.mp4',
  duration: 61.5,
  language: 'en',
  status: 'captioned',
  collection_id: null,
  scratch: false,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-02T10:00:00Z',
  missing_media: false,
  hasProject: true,
  poster: true,
  cover: null,
}

describe('LibraryCardMenu', () => {
  const noop = () => {}
  function menu(overrides: Partial<React.ComponentProps<typeof LibraryCardMenu>> = {}): string {
    return renderToStaticMarkup(
      <LibraryCardMenu
        video={video}
        confirmingDelete={false}
        pendingLinkPath={null}
        onRemove={noop}
        onAskDelete={noop}
        onDelete={noop}
        onCancelDelete={noop}
        onLocate={noop}
        onLink={noop}
        onCancelLink={noop}
        moving={false}
        collections={[
          {
            id: 'uck26',
            name: 'UCK 26',
            slots: {},
            overrides: {} as never,
            createdAt: '',
            updatedAt: '',
            members: 0,
          },
        ]}
        onAskMove={noop}
        onBackFromMove={noop}
        onPickCollection={noop}
        onCreateCollection={() => Promise.resolve({ kind: 'failed' as const })}
        {...overrides}
      />
    )
  }

  test('offers Move to collection… beside the other record actions', () => {
    const html = menu()
    expect(html).toContain('Move to collection…')
    expect(html).toContain('Remove from library')
    expect(html).not.toContain('role="menuitemradio"')
  })

  test('moving swaps the actions for the collection sub-list', () => {
    const html = menu({ moving: true })
    expect(html).toContain('>UCK 26<')
    expect(html).toContain('>None<')
    expect(html).toContain('New collection…')
    expect(html).not.toContain('Remove from library')
  })

  test('offers Locate… only when the media is missing', () => {
    expect(menu()).not.toContain('Locate…')
    expect(menu({ video: { ...video, missing_media: true } })).toContain('Locate…')
  })

  test('a different-media answer confirms inline, naming the file', () => {
    const html = menu({
      video: { ...video, missing_media: true },
      pendingLinkPath: '/Volumes/New/Other take.mov',
    })
    expect(html).toContain('Different file — link anyway?')
    expect(html).toContain('>Link<')
    expect(html).toContain('>Cancel<')
    expect(html).toContain('Other take.mov')
    // The confirm replaces the Locate item rather than sitting beside it.
    expect(html).not.toContain('Locate…')
  })

  test('the delete confirm still renders', () => {
    const html = menu({ confirmingDelete: true })
    expect(html).toContain('Delete?')
    expect(html).not.toContain('Delete record…')
  })
})
