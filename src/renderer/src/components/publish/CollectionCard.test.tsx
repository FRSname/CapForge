/**
 * The Publish workspace's Collection card, rendered to static markup.
 *
 * What matters: the select offers None and every collection (and keeps an
 * orphan id visible rather than showing "None" for it), the card says how much
 * of the channel brief the collection overrides, the backend's
 * `unknown_collection` refusal lands under the select, and the way to manage
 * collections is always there.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublishController } from '../../hooks/usePublishRecord'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { EMPTY_OVERRIDES } from '../../lib/collectionTypes'
import { EMPTY_FIELDS } from '../../lib/publishDrafts'
import type { PublishRecord, Violation } from '../../lib/publishTypes'
import { CollectionCard, CollectionCardView } from './CollectionCard'

const noop = () => {}

const COLLECTIONS: CollectionSummary[] = [
  {
    id: 'uck26',
    name: 'UCK 26',
    slots: {},
    overrides: { ...EMPTY_OVERRIDES, footer: 'F', default_hashtags: ['#uck'], voice: 'warm' },
    createdAt: '',
    updatedAt: '',
    members: 3,
  },
  {
    id: 'solo',
    name: 'Solo',
    slots: {},
    overrides: { ...EMPTY_OVERRIDES },
    createdAt: '',
    updatedAt: '',
    members: 0,
  },
]

function controller(collectionId: string | null, violations: Violation[] = []): PublishController {
  const record: PublishRecord = {
    ...EMPTY_FIELDS,
    id: 'vid_1',
    rev: 1,
    duration: 60,
    status: 'drafted',
    hasProject: true,
    links: [],
    history: [],
    collection_id: collectionId,
  }
  return {
    record,
    fields: record,
    loading: false,
    saving: false,
    dirty: false,
    violationsFor: (field) => violations.filter((v) => v.field === field),
    provenance: () => null,
    canRevert: () => false,
    revert: noop,
    setField: noop,
    setCollection: noop,
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

function render(collectionId: string | null, violations: Violation[] = []): string {
  return renderToStaticMarkup(
    <CollectionCardView
      publish={controller(collectionId, violations)}
      collections={COLLECTIONS}
      onRefresh={noop}
      onManage={noop}
    />
  )
}

describe('CollectionCardView', () => {
  test('offers None and every collection, with the current one selected', () => {
    const html = render('uck26')

    expect(html).toContain('aria-label="Collection"')
    expect(html).toContain('>None<')
    expect(html).toMatch(/<option value="uck26" selected="">UCK 26<\/option>/)
    expect(html).toContain('>Solo<')
  })

  test('says how many channel fields the collection overrides', () => {
    expect(render('uck26')).toContain('Uses 3 overrides from UCK 26')
    expect(render('solo')).toContain('Solo inherits the channel brief')
  })

  test('with no collection it says the channel brief applies', () => {
    const html = render(null)
    expect(html).toMatch(/<option value="" selected="">None<\/option>/)
    expect(html).toContain('channel brief')
  })

  test('keeps an orphan id visible instead of pretending it is None', () => {
    const html = render('old-event')
    expect(html).toMatch(
      /<option value="old-event" selected="">old-event \(no such collection\)<\/option>/
    )
  })

  test('renders the backend refusal under the select', () => {
    const html = render('nope', [
      {
        field: 'collection_id',
        rule: 'unknown_collection',
        message: 'No collection named nope',
        severity: 'hard',
      },
    ])
    expect(html).toContain('No collection named nope')
  })

  test('links to Settings → Collections', () => {
    expect(render(null)).toContain('Manage collections…')
  })
})

describe('CollectionCard', () => {
  test('renders before the collections load', () => {
    const html = renderToStaticMarkup(<CollectionCard publish={controller(null)} />)
    expect(html).toContain('Manage collections…')
  })
})
