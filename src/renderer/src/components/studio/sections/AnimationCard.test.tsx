/**
 * Static-markup tests (node env, react-dom/server) for the Animation card's
 * word-style picker. The "Progressive Color" style has no settings of its
 * own: it paints unspoken words in the Text colour and spoken ones in the
 * Active colour, so the card surfaces those two existing colours under the
 * names the effect gives them instead of sending the user to the Colors card.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimationCard } from './AnimationCard'
import { STUDIO_DEFAULTS } from '../StudioPanel'

const cardProps = () => ({
  hidden: false,
  forceOpen: true,
  meta: undefined,
  onReset: undefined,
})

function render(wordStyle: string): string {
  return renderToStaticMarkup(
    <AnimationCard
      s={{ ...STUDIO_DEFAULTS, wordStyle }}
      defaults={{ ...STUDIO_DEFAULTS }}
      filter={null}
      set={() => {}}
      setMany={() => {}}
      cardProps={cardProps}
    />
  )
}

describe('AnimationCard — Progressive Color word style', () => {
  test('the word-style picker offers it', () => {
    expect(render('highlight')).toContain('<option value="progressive">Progressive Color</option>')
  })

  test('selecting it shows the two colours the effect moves between', () => {
    const markup = render('progressive')
    expect(markup).toContain('Progressive Options')
    expect(markup).toContain('Unspoken')
    expect(markup).toContain('Spoken')
  })

  test('the two colour rows stay hidden for every other word style', () => {
    const markup = render('karaoke')
    expect(markup).not.toContain('Progressive Options')
    expect(markup).not.toContain('Unspoken')
  })
})
