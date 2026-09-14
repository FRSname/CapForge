/**
 * The poster block — rendered to static markup (the vitest environment is
 * node), so this checks what is drawn, not the fetch.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { Poster } from './LibraryCard'

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
}

describe('Poster', () => {
  test('draws the grabbed frame over the block when a URL is given', () => {
    const html = renderToStaticMarkup(<Poster video={video} posterUrl="blob:capforge/abc" />)
    expect(html).toContain('<img src="blob:capforge/abc"')
    expect(html).toContain('object-cover')
    // The duration badge stays on top of the picture.
    expect(html).toContain('1:02')
  })

  test('falls back to the placeholder with no URL, and still flags missing media', () => {
    const html = renderToStaticMarkup(
      <Poster video={{ ...video, missing_media: true }} posterUrl={null} />
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('Media missing')
  })
})
