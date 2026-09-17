/**
 * The Continue hero, rendered to static markup (the vitest environment is
 * node). It stays a single-click button; while its record's session is being
 * restored it says so and refuses a second click.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { ContinueHero } from './ContinueHero'

const video: LibraryVideo = {
  id: 'h'.repeat(32),
  title: 'Keynote',
  sourcePath: '/media/Keynote.mp4',
  duration: 125,
  language: 'en',
  status: 'captioned',
  collection_id: null,
  scratch: false,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-02T10:00:00Z',
  missing_media: false,
  hasProject: true,
  poster: false,
  cover: null,
}

function hero(opening?: boolean): string {
  return renderToStaticMarkup(<ContinueHero video={video} onOpen={() => {}} opening={opening} />)
}

describe('ContinueHero', () => {
  test('is a live Continue button by default', () => {
    const html = hero()
    expect(html).toContain('aria-label="Continue Keynote"')
    expect(html).toContain('>Continue<')
    expect(html).toContain('aria-busy="false"')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('Opening…')
  })

  test('says Opening… and goes inert while the session is restored', () => {
    const html = hero(true)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Opening…')
    expect(html).toContain('data-spinner')
    expect(html).not.toContain('>Continue<')
    // The name is unchanged: the label is what assistive tech announces.
    expect(html).toContain('aria-label="Continue Keynote"')
  })
})
