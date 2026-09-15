/**
 * The poster block — rendered to static markup (the vitest environment is
 * node), so this checks what is drawn, not the fetch or the image's onLoad.
 *
 * What matters: the box takes the video's ratio once it is known (a 9:16
 * recording is a tall card, not a letterboxed 16:9 one), stays 16:9 while it
 * is not, and the duration badge and missing-media chip stay inside the box.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { Poster } from './LibraryPoster'

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

const PORTRAIT = 9 / 16

/**
 * The box's opening tag — the first `<div>`. React 19's static renderer puts a
 * `<link rel="preload" as="image">` for the frame ahead of it.
 */
function box(html: string): string {
  const start = html.indexOf('<div')
  return html.slice(start, html.indexOf('>', start) + 1)
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

  test('is 16:9 while the ratio is unknown', () => {
    const html = renderToStaticMarkup(<Poster video={video} posterUrl="blob:x" />)
    expect(box(html)).toContain('aspect-ratio:16 / 9')
  })

  test('takes the video ratio when it is known', () => {
    const html = renderToStaticMarkup(<Poster video={video} posterUrl="blob:x" aspect={PORTRAIT} />)
    expect(box(html)).toContain('aspect-ratio:0.5625')
    expect(box(html)).toContain('w-full')
    expect(box(html)).not.toContain('16 / 9')
  })

  test('with no poster the box is 16:9 whatever ratio is passed', () => {
    const html = renderToStaticMarkup(<Poster video={video} posterUrl={null} aspect={PORTRAIT} />)
    expect(box(html)).toContain('aspect-ratio:16 / 9')
  })

  test.each([Number.NaN, 0, -1])('an unusable ratio (%s) falls back to 16:9', (aspect) => {
    const html = renderToStaticMarkup(<Poster video={video} posterUrl="blob:x" aspect={aspect} />)
    expect(box(html)).toContain('aspect-ratio:16 / 9')
  })

  test('a fixed-height box takes its width from the ratio', () => {
    const html = renderToStaticMarkup(
      <Poster
        video={video}
        posterUrl="blob:x"
        aspect={PORTRAIT}
        fixedHeight={{ heightPx: 180, maxWidthPx: 320 }}
      />
    )
    expect(box(html)).toContain('height:180px')
    expect(box(html)).toContain('width:101px')
    expect(box(html)).not.toContain('aspect-ratio')
    expect(box(html)).not.toContain('w-full')
  })

  test('a fixed-height box of an unknown ratio is 16:9, held to the max width', () => {
    const html = renderToStaticMarkup(
      <Poster video={video} posterUrl={null} fixedHeight={{ heightPx: 180, maxWidthPx: 300 }} />
    )
    expect(box(html)).toContain('width:300px')
  })

  test('the overlays are positioned inside the box, whatever its shape', () => {
    const html = renderToStaticMarkup(
      <Poster video={{ ...video, missing_media: true }} posterUrl="blob:x" aspect={PORTRAIT} />
    )
    expect(box(html)).toContain('relative')
    expect(html).toMatch(/<span class="absolute left-2 top-2[^"]*"[^>]*>Media missing</)
    expect(html).toMatch(/<span class="absolute bottom-2 right-2[^"]*"[^>]*>1:02</)
  })
})
