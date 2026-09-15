/**
 * A video's posts, one per channel (docs/plans/multi-channel-pr3-contract.md):
 * the boundary guard, the draft delta, the send and the soft lock.
 *
 * **The `posts` draft is a delta**, like `localized`: only the channels and
 * fields the user changed, measured against the record they were looking at.
 * The backend merges `posts` per channel and per field, so a whole dict taken
 * before an agent wrote the Instagram caption would put the old caption back.
 * `postsDraftFor` builds the delta, `applyPostsDraft` lays it over a record for
 * display, `composePostsPatch` turns it into the wire value against the
 * **latest** record at send time, and `survivingPosts` drops what an agent
 * wrote over.
 *
 * Nothing here validates — every rule about a post is Python's.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Channel } from './channelTypes'
import type { LocalizedMap } from './publishMediaTypes'
import { parseLocalized } from './publishMediaTypes'
import {
  applyLocalizedDraft,
  composeLocalizedPatch,
  localizedDraft,
  survivingLocalized,
} from './publishLocalized'
import { bool, nonEmptyString, obj, str, strings } from './wireReaders'

/** Where one channel's post went live. Every part is optional until it has. */
export interface PostPublished {
  url: string | null
  /** The YouTube video id; the backend derives it from a YouTube `url`. */
  id: string | null
  /** ISO-8601. */
  at: string | null
}

/** One video's text for one channel. One shape for every platform. */
export interface Post {
  title: string
  description: string
  short_description: string
  tags: string[]
  caption: string
  text: string
  hashtags: string[]
  /** One of `thumbnail.candidates`, or null. */
  cover: string | null
  /** Null means the channel's language. */
  language: string | null
  /** YouTube only. As a draft this is a delta (`lib/publishLocalized.ts`). */
  localized: LocalizedMap
  published: PostPublished
  hidden: boolean
}

export type PostField = keyof Post

/** `record.posts`: channel id → post. */
export type PostsMap = Record<string, Post>

/** The fields of one post the user changed. */
export type PostDraft = Partial<Post>

/** The changed channels; `null` removes a post (never sent by the tabs today). */
export type PostsDraft = Record<string, PostDraft | null>

/** One post as it goes on the wire. */
export type WirePost = Record<string, unknown>

export const EMPTY_PUBLISHED: PostPublished = { url: null, id: null, at: null }

export const EMPTY_POST: Post = {
  title: '',
  description: '',
  short_description: '',
  tags: [],
  caption: '',
  text: '',
  hashtags: [],
  cover: null,
  language: null,
  localized: {},
  published: EMPTY_PUBLISHED,
  hidden: false,
}

const POST_TEXT_FIELDS = ['title', 'description', 'short_description', 'caption', 'text'] as const

// ── The boundary guard ─────────────────────────────────────────────

function parsePublished(value: unknown): PostPublished {
  const row = obj(value)
  if (!row) return EMPTY_PUBLISHED
  return { url: nonEmptyString(row.url), id: nonEmptyString(row.id), at: nonEmptyString(row.at) }
}

/** One post. Anything the backend has not written reads as its empty value. */
export function parsePost(value: unknown): Post {
  const row = obj(value) ?? {}
  const text = Object.fromEntries(POST_TEXT_FIELDS.map((field) => [field, str(row[field])]))
  return {
    ...EMPTY_POST,
    ...text,
    tags: strings(row.tags),
    hashtags: strings(row.hashtags),
    cover: nonEmptyString(row.cover),
    language: nonEmptyString(row.language),
    localized: parseLocalized(row.localized),
    published: parsePublished(row.published),
    hidden: bool(row.hidden),
  }
}

/** `record.posts`. A row that is not an object is dropped; a missing block is no posts. */
export function parsePosts(value: unknown): PostsMap {
  const raw = obj(value)
  if (!raw) return {}
  const out: PostsMap = {}
  for (const [channelId, post] of Object.entries(raw)) {
    if (obj(post)) out[channelId] = parsePost(post)
  }
  return out
}

export function isPublished(post: Pick<Post, 'published'>): boolean {
  return Boolean(post.published.url || post.published.id)
}

// ── Tabs ───────────────────────────────────────────────────────────

/**
 * The tab order: the visible posts in channels.json order, then any visible
 * post whose channel no longer exists (or has not loaded yet), in record order.
 */
export function visibleChannelIds(
  posts: PostsMap,
  channels: ReadonlyArray<Pick<Channel, 'id'>> | null
): string[] {
  const visible = Object.keys(posts).filter((id) => !posts[id].hidden)
  const known = (channels ?? []).map((c) => c.id).filter((id) => visible.includes(id))
  return [...known, ...visible.filter((id) => !known.includes(id))]
}

export interface AddableChannels<C extends Pick<Channel, 'id'>> {
  /** Channels whose post is hidden — listed first, as "Show again". */
  showAgain: C[]
  /** Channels the video has no post for. */
  add: C[]
}

/** What the `+` menu offers, in Settings order within each group. */
export function addableChannels<C extends Pick<Channel, 'id'>>(
  posts: PostsMap,
  channels: readonly C[] | null
): AddableChannels<C> {
  const list = channels ?? []
  return {
    showAgain: list.filter((c) => posts[c.id]?.hidden === true),
    add: list.filter((c) => !posts[c.id]),
  }
}

/**
 * The `posts` a "Publish to" or `+` write sends: `{}` creates an empty post (and
 * leaves an existing one alone), while a **hidden** post needs `hidden: false`
 * to come back.
 */
export function addPostsPatch(ids: readonly string[], posts: PostsMap): Record<string, WirePost> {
  return Object.fromEntries(ids.map((id) => [id, posts[id]?.hidden ? { hidden: false } : {}]))
}

/** The active tab: the one last used for this video, else the primary, else the first. */
export function resolveActiveChannel(
  visible: readonly string[],
  lastUsed: string | undefined,
  primaryId: string
): string | null {
  if (lastUsed && visible.includes(lastUsed)) return lastUsed
  if (primaryId && visible.includes(primaryId)) return primaryId
  return visible[0] ?? null
}

// ── The draft ──────────────────────────────────────────────────────

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function applyPostDraft(post: Post, draft: PostDraft): Post {
  const localized = draft.localized
    ? parseLocalized(applyLocalizedDraft(post.localized, draft.localized))
    : post.localized
  return { ...post, ...draft, localized }
}

/** What the tabs show: `posts` with the delta laid over it (`null` removes). */
export function applyPostsDraft(posts: PostsMap, draft: PostsDraft | undefined): PostsMap {
  if (!draft) return posts
  const out: PostsMap = { ...posts }
  for (const [channelId, postDraft] of Object.entries(draft)) {
    if (postDraft === null) delete out[channelId]
    else if (out[channelId]) out[channelId] = applyPostDraft(out[channelId], postDraft)
  }
  return out
}

/** `shown` with one field of one post replaced. A channel with no post is left alone. */
export function withPostField<K extends PostField>(
  shown: PostsMap,
  channelId: string,
  field: K,
  value: Post[K]
): PostsMap {
  const post = shown[channelId]
  return post ? { ...shown, [channelId]: { ...post, [field]: value } } : shown
}

function postDelta(stored: Post, shown: Post): PostDraft {
  const delta: Record<string, unknown> = {}
  for (const field of Object.keys(EMPTY_POST) as PostField[]) {
    if (field === 'localized') {
      const changed = localizedDraft(stored.localized, shown.localized)
      if (Object.keys(changed).length > 0) delta.localized = changed
    } else if (!same(stored[field], shown[field])) {
      delta[field] = shown[field]
    }
  }
  return delta as PostDraft
}

/** The delta from `stored` (the record) to `shown` (what the tabs now show). */
export function postsDraftFor(stored: PostsMap, shown: PostsMap): PostsDraft {
  const draft: PostsDraft = {}
  for (const [channelId, post] of Object.entries(shown)) {
    const base = stored[channelId]
    if (!base) continue
    const delta = postDelta(base, post)
    if (Object.keys(delta).length > 0) draft[channelId] = delta
  }
  return draft
}

// ── The send ───────────────────────────────────────────────────────

/** The parts of the latest record a send is composed against. */
export interface LatestPosts {
  posts: PostsMap
  thumbnail: { candidates: readonly string[] }
}

function composePostDraft(
  draft: PostDraft,
  current: Post,
  candidates: readonly string[]
): WirePost {
  const wire: WirePost = {}
  for (const [field, value] of Object.entries(draft)) {
    if (field === 'localized') {
      const composed = composeLocalizedPatch(value as LocalizedMap, current)
      if (Object.keys(composed).length > 0) wire.localized = composed
      continue
    }
    // A cover whose frame was deleted since the pick cannot be the cover.
    const next =
      field === 'cover' && value !== null && !candidates.includes(value as string) ? null : value
    if (!same(next, current[field as PostField])) wire[field] = next
  }
  return wire
}

/**
 * The `posts` a `PATCH` carries: each drafted field that still differs from
 * the **latest** record, per channel. A channel the latest record no longer
 * has is not recreated from a draft; channels the draft does not name are
 * never sent, so the backend keeps them — whoever wrote them.
 */
export function composePostsPatch(
  draft: PostsDraft,
  latest: LatestPosts
): Record<string, WirePost | null> {
  const out: Record<string, WirePost | null> = {}
  for (const [channelId, postDraft] of Object.entries(draft)) {
    const current = latest.posts[channelId]
    if (postDraft === null) {
      if (current) out[channelId] = null
      continue
    }
    if (!current) continue
    const wire = composePostDraft(postDraft, current, latest.thumbnail.candidates)
    if (Object.keys(wire).length > 0) out[channelId] = wire
  }
  return out
}

/** `patch` ready for the wire when its `posts` is a draft delta (the debounced send). */
export function withPostsDraft(
  patch: Record<string, unknown>,
  latest: LatestPosts
): Record<string, unknown> {
  if (!('posts' in patch)) return patch
  const { posts, ...rest } = patch
  const composed = composePostsPatch((obj(posts) ?? {}) as PostsDraft, latest)
  return Object.keys(composed).length > 0 ? { ...rest, posts: composed } : rest
}

/**
 * `patch` without the root `thumbnail.cover`: that is the primary channel's
 * post, and the tabs write covers under `posts.<id>.cover` only. The backend
 * inherits an omitted cover, so the frames' ideas still save.
 */
export function withoutRootCover(patch: Record<string, unknown>): Record<string, unknown> {
  const thumbnail = obj(patch.thumbnail)
  if (!thumbnail || !('cover' in thumbnail)) return patch
  const { cover: _cover, ...rest } = thumbnail
  return { ...patch, thumbnail: rest }
}

// ── The soft lock ──────────────────────────────────────────────────

function survivingPost(
  draft: PostDraft,
  local: Post | undefined,
  remote: Post,
  locked: boolean
): PostDraft {
  const kept: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(draft)) {
    if (field === 'localized') {
      const languages = locked
        ? (value as LocalizedMap)
        : survivingLocalized(value as LocalizedMap, local?.localized ?? {}, remote.localized)
      if (languages) kept.localized = languages
      continue
    }
    const untouched = same(local?.[field as PostField], remote[field as PostField])
    if (locked || untouched) kept[field] = value
  }
  return kept as PostDraft
}

/**
 * The post drafts that outlive an agent write, per channel and field: a field
 * the agent left alone stays the user's, one it wrote over is the agent's now,
 * and a post the agent removed takes its drafts with it. `locked` (the cursor
 * is in a post field that holds unsaved text) keeps every drafted field, the
 * `localized` precedent — the banner then offers Apply or Keep mine. Null when
 * nothing is left.
 */
export function survivingPosts(
  draft: PostsDraft,
  local: PostsMap,
  remote: PostsMap,
  locked: boolean
): PostsDraft | null {
  const keep: PostsDraft = {}
  for (const [channelId, postDraft] of Object.entries(draft)) {
    const remotePost = remote[channelId]
    if (!remotePost) continue
    if (postDraft === null) {
      if (locked || same(local[channelId], remotePost)) keep[channelId] = null
      continue
    }
    const kept = survivingPost(postDraft, local[channelId], remotePost, locked)
    if (Object.keys(kept).length > 0) keep[channelId] = kept
  }
  return Object.keys(keep).length > 0 ? keep : null
}

/** One channel's drafted fields as the wire has them — what `POST /validate` judges. */
export function postDraftFields(latest: LatestPosts, shown: PostsMap, channelId: string): WirePost {
  return composePostsPatch(postsDraftFor(latest.posts, shown), latest)[channelId] ?? {}
}
