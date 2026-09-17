/**
 * The field label row, rendered to static markup (node env).
 *
 * What matters: a single-field card can hide the label so the card title is
 * the only one the user reads, the meter and the provenance chip survive that,
 * and a row with nothing left in it disappears rather than leaving an empty
 * `mb-1` gap between the card header and the input.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublishController } from '../../hooks/usePublishRecord'
import type { Provenance } from '../../lib/publishFields'
import { EMPTY_FIELDS } from '../../lib/publishDrafts'
import type { PublishRecord } from '../../lib/publishTypes'
import { FieldHeader } from './FieldHeader'

const noop = () => {}

const MINUTES = 60 * 1000
const THREE_MINUTES_AGO = new Date(Date.now() - 3 * MINUTES).toISOString()

function controller(provenance: Provenance | null = null, canRevert = false): PublishController {
  const record: PublishRecord = {
    ...EMPTY_FIELDS,
    id: 'vid_1',
    rev: 1,
    duration: 60,
    status: 'drafted',
    hasProject: true,
    links: [],
    history: [],
    language: 'en',
    languages: ['en'],
  }
  return {
    record,
    fields: record,
    loading: false,
    saving: false,
    dirty: false,
    violationsFor: () => [],
    provenance: () => provenance,
    canRevert: () => canRevert,
    revert: noop,
    setField: noop,
    setCollection: noop,
    flushDrafts: () => Promise.resolve(),
    patchNow: () => Promise.resolve(),
    beginEdit: noop,
    endEdit: noop,
    pendingAgentUpdate: null,
    applyAgentUpdate: noop,
    keepMine: noop,
    markPublished: noop,
    suggestChapters: noop,
    insertChapterAt: noop,
    removeChapterAt: noop,
    renameChapter: noop,
    speakerIds: [],
  }
}

const METER = <span>18/5000 bytes</span>

describe('FieldHeader', () => {
  test('renders the inventory label by default', () => {
    const markup = renderToStaticMarkup(<FieldHeader publish={controller()} field="description" />)
    expect(markup).toContain('>Description<')
  })

  test('hideLabel omits the label but keeps the meter', () => {
    const markup = renderToStaticMarkup(
      <FieldHeader publish={controller()} field="description" hideLabel meter={METER} />
    )
    expect(markup).not.toContain('>Description<')
    expect(markup).toContain('18/5000 bytes')
  })

  test('hideLabel keeps the provenance chip, which is the point of the row', () => {
    const markup = renderToStaticMarkup(
      <FieldHeader
        publish={controller({ by: 'agent', at: THREE_MINUTES_AGO })}
        field="description"
        hideLabel
      />
    )
    expect(markup).toContain('edited ')
    expect(markup).toContain('Last written by')
  })

  test('hideLabel with no meter and no provenance renders nothing at all', () => {
    const markup = renderToStaticMarkup(
      <FieldHeader publish={controller()} field="description" hideLabel />
    )
    expect(markup).toBe('')
  })
})
