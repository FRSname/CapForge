/**
 * Static-markup tests (node env, react-dom/server) for the Layout card's
 * Words/Grp row, which is the *only* control whose meaning depends on which
 * caption track is active: it chunks the transcript on the source track and
 * re-chunks each translated sentence on a translated one. It was hidden on
 * translated tracks until QA asked for it back — the row must exist on both,
 * with the sentence that says which of the two it is doing.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayoutCard } from './LayoutCard'
import { STUDIO_DEFAULTS } from '../StudioPanel'

const cardProps = () => ({
  hidden: false,
  forceOpen: undefined,
  meta: undefined,
  onReset: undefined,
})

function render(activeTrackIsSource: boolean): string {
  return renderToStaticMarkup(
    <LayoutCard
      s={{ ...STUDIO_DEFAULTS }}
      defaults={{ ...STUDIO_DEFAULTS }}
      filter={null}
      set={() => {}}
      setMany={() => {}}
      cardProps={cardProps}
      activeTrackIsSource={activeTrackIsSource}
    />
  )
}

describe('LayoutCard — Words/Grp', () => {
  test('the row is rendered on the source track', () => {
    expect(render(true)).toContain('Words/Grp')
  })

  test('the row is rendered on a translated track too', () => {
    expect(render(false)).toContain('Words/Grp')
  })

  test('a translated track explains that it re-chunks whole sentences', () => {
    const markup = render(false)
    expect(markup).toContain('Re-chunks each translated sentence')
    expect(markup).toContain('never merges across a sentence boundary')
  })

  test('the source track keeps the transcript-chunking wording', () => {
    expect(render(true)).toContain('Split the transcript into captions')
  })
})
