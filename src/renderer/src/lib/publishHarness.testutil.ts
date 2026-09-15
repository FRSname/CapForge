/**
 * A `PublishController` over a fixed record, with the drafts it writes kept in
 * memory — what the channel-tab tests need to watch where a write lands.
 *
 * Not a mock of the hook: `setField` stores the draft exactly as
 * `usePublishRecord` does, and `fields` is `mergeDrafts(record, drafts)`, so a
 * test can compose the wire from the drafts the cards produced.
 */

import type { PublishController } from '../hooks/usePublishRecord'
import type { PublishDrafts } from './publishDrafts'
import { mergeDrafts } from './publishDrafts'
import { provenanceOf, revertPatchFor, violationsForField } from './publishFields'
import type { Post } from './publishPosts'
import { EMPTY_POST } from './publishPosts'
import type { PublishRecord, Violation } from './publishTypes'
import { EMPTY_FIELDS } from './publishDrafts'

export function testPost(over: Partial<Post> = {}): Post {
  return { ...EMPTY_POST, ...over }
}

export function testRecord(over: Partial<PublishRecord> = {}): PublishRecord {
  return {
    ...EMPTY_FIELDS,
    id: 'vid_1',
    rev: 3,
    duration: 600,
    status: 'drafted',
    hasProject: true,
    links: [],
    history: [],
    language: 'en',
    languages: ['en'],
    ...over,
  }
}

export interface PublishHarness {
  /** A fresh controller over the record and whatever has been drafted so far. */
  publish: () => PublishController
  drafts: () => PublishDrafts
  /** Every immediate write (`patchNow`), in order. */
  patches: Record<string, unknown>[]
  /** Every field `beginEdit` was called with. */
  edits: string[]
  /** Every message the controller reported (a failed revert, a bad URL). */
  notes: string[]
  /** Root reverts, which a tab passes through untouched. */
  rootReverts: string[]
}

export function publishHarness(
  record: PublishRecord,
  violations: readonly Violation[] = []
): PublishHarness {
  let drafts: PublishDrafts = {}
  const patches: Record<string, unknown>[] = []
  const edits: string[] = []
  const notes: string[] = []
  const rootReverts: string[] = []
  const noop = () => {}

  const publish = (): PublishController => ({
    record,
    fields: mergeDrafts(record, drafts),
    loading: false,
    saving: false,
    dirty: Object.keys(drafts).length > 0,
    violationsFor: (field) => violationsForField(violations, field),
    provenance: (field) => provenanceOf(record, field),
    canRevert: (field) => revertPatchFor(record, field) !== null,
    revert: (field) => rootReverts.push(field),
    setField: (field, value) => {
      drafts = { ...drafts, [field]: value }
    },
    setCollection: noop,
    flushDrafts: () => Promise.resolve(),
    patchNow: (patch) => {
      patches.push(patch)
      return Promise.resolve()
    },
    beginEdit: (field) => edits.push(field),
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
  })

  return { publish, drafts: () => drafts, patches, edits, notes, rootReverts }
}
