/**
 * Static-markup tests (node env, react-dom/server) for the per-group
 * translation-state chip GroupEditor renders next to the `↺` end marker.
 *
 * Only presence/absence is asserted — this harness has no jsdom, so the row's
 * drag/merge/split interactions are out of reach (see the file header on the
 * component for what those do).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GroupEditor } from './GroupEditor'
import type { Segment } from '../../types/app'
import type { TrackGroupState } from '../../lib/tracks'

const GROUP: Segment = {
  id: 'g0',
  start: 0,
  end: 1.4,
  text: 'czerwony samochód',
  words: [
    { word: 'czerwony', start: 0, end: 0.7 },
    { word: 'samochód', start: 0.7, end: 1.4 },
  ],
}

const noop = () => {}

function render(groupStates?: ReadonlyMap<string, TrackGroupState>): string {
  return renderToStaticMarkup(
    <GroupEditor
      groups={[GROUP]}
      currentTime={0}
      onSeek={noop}
      onChange={noop}
      onPositionChange={noop}
      defaults={{ textColor: '#FFFFFF', activeColor: '#D4952A' }}
      positionDefaults={{ posX: 50, posY: 80 }}
      groupStates={groupStates}
    />
  )
}

describe('GroupEditor — track state chip', () => {
  test('a stale group renders the "source changed" chip', () => {
    // Arrange / Act
    const html = render(new Map([['g0', 'stale' as TrackGroupState]]))

    // Assert
    expect(html).toContain('source changed')
    expect(html).not.toContain('no text')
  })

  test('an untranslated group renders the "no text" chip', () => {
    // Arrange / Act
    const html = render(new Map([['g0', 'untranslated' as TrackGroupState]]))

    // Assert
    expect(html).toContain('no text')
    expect(html).not.toContain('source changed')
  })

  test('a clean group renders no chip at all', () => {
    // Arrange / Act
    const html = render(new Map([['g0', 'clean' as TrackGroupState]]))

    // Assert
    expect(html).not.toContain('source changed')
    expect(html).not.toContain('no text')
  })

  test('the source track (no groupStates prop) renders no chip', () => {
    // Arrange / Act
    const html = render()

    // Assert
    expect(html).not.toContain('source changed')
    expect(html).not.toContain('no text')
  })
})
