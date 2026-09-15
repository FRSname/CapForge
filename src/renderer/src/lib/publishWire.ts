/**
 * The one place a Publish write is turned into its wire body, for both of the
 * writer's paths (`hooks/usePublishWriter.ts`).
 *
 * Every rule a write has to honour is applied here, in order:
 *  - `thumbnail.candidates` comes from the latest record (`lib/publishThumbnail.ts`);
 *  - a root `localized` names only the languages that changed (`lib/publishLocalized.ts`);
 *  - the root `thumbnail.cover` is never sent — covers are per channel;
 *  - a `posts` draft names only the channels and fields that changed
 *    (`lib/publishPosts.ts`).
 *
 * Together with the channel tabs' routing (`lib/channelPublishView.ts`) that is
 * what keeps the panel from ever sending a projected root field and the same
 * field under `posts` (`ambiguous_post_field`).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { PublishRecord } from './publishTypes'
import { withManagedCandidates } from './publishThumbnail'
import { withLocalizedDraft, withLocalizedRestore } from './publishLocalized'
import { withPostsDraft, withoutRootCover } from './publishPosts'

/** The debounced send: the drafts, composed against the record as it is now. */
export function draftWire(
  drafts: Record<string, unknown>,
  latest: PublishRecord
): Record<string, unknown> {
  const composed = withLocalizedDraft(withManagedCandidates(drafts, latest), latest)
  return withPostsDraft(withoutRootCover(composed), latest)
}

/**
 * An immediate write (Revert, add/hide a channel, mark published). Its `posts`
 * is sent as written — `{id: {}}` creates a post — and a `localized` is a whole
 * earlier value (Revert's history `prev`).
 */
export function immediateWire(
  patch: Record<string, unknown>,
  latest: PublishRecord
): Record<string, unknown> {
  return withoutRootCover(withLocalizedRestore(withManagedCandidates(patch, latest), latest))
}
