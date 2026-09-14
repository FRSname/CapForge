/**
 * The draft bookkeeping behind the Publish panel — the four decisions
 * `usePublishRecord` would otherwise make inline, kept pure so they can be
 * tested without a DOM (the vitest environment is plain node, so a hook's own
 * body never runs in a test).
 *
 * A "draft" is a field the user has changed but the backend has not confirmed.
 * The panel always renders `record` with the drafts laid over it, so a draft
 * that survives a round trip is a field that was typed in again while the
 * `PATCH` was in flight.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { PublishAuthored, PublishRecord } from './publishTypes'
import type { PublishFieldId } from './publishFields'

/** The drafts map: every authored field, optional. */
export type PublishDrafts = Partial<PublishAuthored>

/** Nothing loaded — what a card reads before (or without) a record. */
export const EMPTY_FIELDS: PublishAuthored = {
  title_options: [],
  title: '',
  description: '',
  chapters: [],
  tags: [],
  keywords: [],
  hashtags: [],
  speakers: {},
  summary_md: '',
  publish: { youtube: null, pushes: [] },
}

/** What the cards render: the record, with the unsaved drafts on top. */
export function mergeDrafts(record: PublishRecord | null, drafts: PublishDrafts): PublishAuthored {
  return { ...(record ?? EMPTY_FIELDS), ...drafts }
}

/**
 * The drafts still outstanding once a `PATCH` carrying `sent` has landed.
 *
 * A field is dropped only when the value that was sent is still the value the
 * draft holds — typing again mid-flight keeps the field dirty, so the next
 * debounce sends the newer text instead of silently discarding it.
 */
export function remainingDrafts(drafts: PublishDrafts, sent: PublishDrafts): PublishDrafts {
  const keep: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(drafts)) {
    const settled = field in sent && sent[field as PublishFieldId] === value
    if (!settled) keep[field] = value
  }
  return keep as PublishDrafts
}

/** The drafts without one field — used by Revert and by Apply. */
export function withoutDraft(drafts: PublishDrafts, field: PublishFieldId): PublishDrafts {
  const next = { ...drafts }
  delete next[field]
  return next
}

/**
 * The field the soft lock protects: the one under the cursor, and only while
 * it actually holds unsaved text. Focus alone is not a lock — an agent write
 * into a field the user merely clicked into should still land.
 */
export function lockedField(
  editing: PublishFieldId | null,
  drafts: PublishDrafts
): PublishFieldId | null {
  return editing && editing in drafts ? editing : null
}
