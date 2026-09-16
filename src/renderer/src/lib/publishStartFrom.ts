/**
 * "Start from…" (docs/plans/multi-channel-pr4-contract.md §Part A): what an
 * empty channel tab can be filled from, and what a chosen source becomes.
 *
 * The sources are the video's **other** visible posts that have a body, plus
 * the legacy Shorts caption at the record root — PR 2 deliberately left it
 * there and no tab claims it, so a TikTok or Instagram tab is the only place it
 * can still be picked up.
 *
 * Adapting the *text* is the backend's job (`POST …/posts/{id}/draft?from=`);
 * this module only decides what may be offered, labels it, and turns the
 * answer into the post draft the tab writes. Nothing here validates: the draft
 * lands as an ordinary edit, and `POST /validate` judges it once it does.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { ChannelTab } from './channelPublishView'
import type { Channel, Platform, PlatformSpec } from './channelTypes'
import { platformLabel } from './channels'
import { bodyFieldFor } from './platformSpecs'
import type { Shorts } from './publishMediaTypes'
import type { Post, PostDraft, PostField, PostsMap } from './publishPosts'
import { visibleChannelIds } from './publishPosts'
import type { PostDraftFields } from './postsApi'

/** The option id standing for the record's own `shorts.caption`. */
export const SHORTS_SOURCE_ID = 'shorts'

/** What that option is called — it belongs to the video, not to a channel. */
export const SHORTS_SOURCE_NAME = 'Shorts caption'

/** The platforms whose caption the legacy Shorts caption can seed. */
const SHORTS_TARGETS: readonly Platform[] = ['tiktok', 'instagram']

export interface StartFromOption {
  /** A source channel's id, or `SHORTS_SOURCE_ID`. */
  id: string
  name: string
  /** Null for the Shorts caption, and for a post whose channel is not in Settings. */
  platform: Platform | null
  kind: 'post' | 'shorts'
}

/** The parts of the record the options are read from. */
export interface StartFromRecord {
  posts: PostsMap
  shorts: Shorts
}

export function startFromFailedMessage(name: string, reason: string): string {
  return `Could not start from ${name}: ${reason}`
}

/**
 * A post's body. A channel Settings no longer has has no platform to name its
 * body field, so whichever field it was written in counts — an orphan tab's
 * text is still text worth starting from.
 */
function postBody(post: Post, platform: Platform | null): string {
  if (platform) return post[bodyFieldFor(platform)]
  return post.description || post.caption || post.text
}

/**
 * What this tab may be started from: every other visible post that has a body,
 * in the tab order, then the legacy Shorts caption when this tab is one of the
 * platforms that can use it.
 */
export function startFromOptions(
  record: StartFromRecord,
  tab: Pick<ChannelTab, 'id' | 'platform'>,
  channels: readonly Channel[] | null
): StartFromOption[] {
  const options: StartFromOption[] = []
  for (const id of visibleChannelIds(record.posts, channels)) {
    if (id === tab.id) continue
    const channel = channels?.find((c) => c.id === id) ?? null
    const platform = channel?.platform ?? null
    if (postBody(record.posts[id], platform).trim() === '') continue
    options.push({ id, name: channel?.name ?? id, platform, kind: 'post' })
  }
  if (offersShorts(record.shorts, tab.platform)) {
    options.push({ id: SHORTS_SOURCE_ID, name: SHORTS_SOURCE_NAME, platform: null, kind: 'shorts' })
  }
  return options
}

/** The record's own Shorts caption, offered only to a platform that pastes one. */
function offersShorts(shorts: Shorts, target: Platform | null): boolean {
  if (!target || !SHORTS_TARGETS.includes(target)) return false
  return shorts.caption.trim() !== ''
}

/** "Filip IG (Instagram)", or just the name when there is no platform to add. */
export function startFromLabel(
  option: StartFromOption,
  platforms: readonly PlatformSpec[] | null
): string {
  return option.platform
    ? `${option.name} (${platformLabel(option.platform, platforms)})`
    : option.name
}

/** The local Shorts caption as draft fields — it is only ever offered to a caption platform. */
export function shortsDraftFields(caption: string): PostDraftFields {
  return { caption }
}

/**
 * The post draft a chosen option becomes: only the target platform's own
 * writable fields, and only the ones that actually carry something. An empty
 * body or an empty hashtag list is not written, so picking a source can never
 * blank a field the user has already typed in.
 */
export function startFromPatch(fields: PostDraftFields, platform: Platform): PostDraft {
  const patch: PostDraft = {}
  const body = bodyFieldFor(platform)
  if (fields[body]) patch[body] = fields[body]
  if (platform === 'youtube' && fields.short_description) {
    patch.short_description = fields.short_description
  }
  if (fields.hashtags && fields.hashtags.length > 0) patch.hashtags = [...fields.hashtags]
  return patch
}

/**
 * Write a start-from draft through a tab's post writer, field by field, so it
 * lands as an ordinary debounced draft the user can edit or undo. Spelled out
 * rather than looped, because each field's value type is its own.
 */
export function writeStartFromDraft(
  patch: PostDraft,
  setPostField: <K extends PostField>(field: K, value: Post[K]) => void
): void {
  if (patch.description !== undefined) setPostField('description', patch.description)
  if (patch.short_description !== undefined) {
    setPostField('short_description', patch.short_description)
  }
  if (patch.caption !== undefined) setPostField('caption', patch.caption)
  if (patch.text !== undefined) setPostField('text', patch.text)
  if (patch.hashtags !== undefined) setPostField('hashtags', patch.hashtags)
}
