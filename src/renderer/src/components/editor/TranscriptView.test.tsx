/**
 * Static-markup tests (node env, react-dom/server) for the Transcript tab.
 *
 * Clicks are out of reach in this harness, so these pin what is drawn: one row
 * per segment with its timestamp and speaker, the chapter gutter, the insert
 * buttons only when the session has a record, and the empty transcript.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { Segment } from '../../types/app'
import type { Chapter } from '../../lib/publishTypes'
import { PublishRecordContext } from '../../hooks/usePublishRecordContext'
import type { PublishRecordContextValue } from '../../hooks/usePublishRecordContext'
import { TranscriptView } from './TranscriptView'

const SEGMENTS: Segment[] = [
  { id: 's0', start: 0, end: 4, text: 'Welcome to the show.', words: [], speaker: 'SPEAKER_00' },
  { id: 's1', start: 4, end: 9, text: 'Today we render captions.', words: [] },
  { id: 's2', start: 65, end: 70, text: 'Now the pipeline.', words: [], speaker: 'SPEAKER_01' },
]

const noop = () => {}

function render(segments: Segment[], context?: PublishRecordContextValue, currentTime = 0): string {
  const view = <TranscriptView segments={segments} currentTime={currentTime} onSeek={noop} />
  return renderToStaticMarkup(
    context ? (
      <PublishRecordContext.Provider value={context}>{view}</PublishRecordContext.Provider>
    ) : (
      view
    )
  )
}

function withRecord(chapters: Chapter[]): PublishRecordContextValue {
  return { chapters, insertChapterAt: noop, hasRecord: true }
}

describe('TranscriptView', () => {
  test('one row per segment with its timestamp, speaker label and text', () => {
    const html = render(SEGMENTS)

    expect(html.match(/data-segment-row/g)).toHaveLength(3)
    expect(html).toContain('00:00')
    expect(html).toContain('01:05')
    expect(html).toContain('Welcome to the show.')
    expect(html).toContain('Now the pipeline.')
    expect(html).toContain('SPEAKER_00')
    expect(html).toContain('SPEAKER_01')
    // The second segment has no speaker: exactly two labels.
    expect(html.match(/data-speaker/g)).toHaveLength(2)
  })

  test('the row under the playhead is the one marked current', () => {
    const html = render(SEGMENTS, undefined, 5)

    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    const current = html.indexOf('aria-current="true"')
    expect(current).toBeGreaterThan(html.indexOf('Welcome to the show.'))
    expect(current).toBeLessThan(html.indexOf('Today we render captions.'))
  })

  test('without a provider: no chapters and no insert buttons', () => {
    const html = render(SEGMENTS)

    expect(html).not.toContain('Insert chapter here')
    expect(html).not.toContain('data-chapter-marker')
  })

  test('with a record: an insert button per row', () => {
    const html = render(SEGMENTS, withRecord([]))

    expect(html.match(/aria-label="Insert chapter here"/g)).toHaveLength(3)
  })

  test('chapter markers sit above the segment they start in, late ones at the end', () => {
    const html = render(
      SEGMENTS,
      withRecord([
        { start_s: 0, title: 'Intro' },
        { start_s: 60, title: 'Pipeline' },
        { start_s: 600, title: 'Outro' },
      ])
    )

    expect(html.match(/data-chapter-marker/g)).toHaveLength(3)
    const intro = html.indexOf('Intro')
    const pipeline = html.indexOf('Pipeline')
    const outro = html.indexOf('Outro')
    expect(intro).toBeLessThan(html.indexOf('Welcome to the show.'))
    expect(pipeline).toBeGreaterThan(html.indexOf('Today we render captions.'))
    expect(pipeline).toBeLessThan(html.indexOf('Now the pipeline.'))
    expect(outro).toBeGreaterThan(html.indexOf('Now the pipeline.'))
    expect(html).toContain('10:00')
  })

  test('an untitled chapter still gets a readable marker', () => {
    const html = render(SEGMENTS, withRecord([{ start_s: 4, title: '' }]))

    expect(html).toContain('Untitled chapter')
  })

  test('an empty transcript says so, and still lists the chapters', () => {
    const html = render([], withRecord([{ start_s: 0, title: 'Intro' }]))

    expect(html).toContain('No transcript yet')
    expect(html).not.toContain('data-segment-row')
    expect(html).toContain('Intro')
  })
})
