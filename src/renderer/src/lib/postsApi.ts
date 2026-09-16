/**
 * REST client for one channel's post (docs/plans/multi-channel-pr2-contract.md):
 * its package and its validation.
 *
 * A sibling of `api.ts` rather than more methods on it, because that file is
 * past its size ceiling — the `collectionsApi.ts` pattern. Every call goes
 * through `api.sendWithLocalToken`, so the bridge and the local token are
 * handled in exactly one place, and every body is parsed at the boundary.
 */

import { api } from './api'
import type { Platform } from './channelTypes'
import { isPlatform } from './channelTypes'
import type { UploadPackage, Violation } from './publishTypes'
import { PACKAGE_SHAPE_MESSAGE, parseUploadPackage, parseViolations } from './publishTypes'
import { obj, str, strings } from './wireReaders'

/** `GET …/package?channel=` — one channel's pasteable text and what it violates. */
export interface ChannelPackage extends UploadPackage {
  channel: string
}

type Method = 'GET' | 'POST'

/** The package route answers the channel beside the usual package body. */
export function parseChannelPackage(value: unknown): ChannelPackage {
  const row = obj(value)
  if (!row) throw new Error(PACKAGE_SHAPE_MESSAGE)
  return { ...parseUploadPackage(row), channel: str(row.channel) }
}

/** A refused response's body; a body that is not JSON falls back to the status text. */
function refusedBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({ detail: res.statusText }))
}

async function json(method: Method, path: string, body?: unknown): Promise<unknown> {
  const res = await api.sendWithLocalToken(method, path, body)
  if (!res.ok) throw api.apiError(res, await refusedBody(res))
  return res.json()
}

/**
 * The channel's package. A YouTube channel gets the upload package layout;
 * any other channel gets its pasted post. `lang` renders a stored localized
 * language (YouTube only).
 */
export async function getChannelPackage(
  videoId: string,
  channelId: string,
  lang?: string
): Promise<ChannelPackage> {
  const langQuery = lang ? `&lang=${encodeURIComponent(lang)}` : ''
  const path = `/api/library/${encodeURIComponent(videoId)}/package?channel=${encodeURIComponent(channelId)}${langQuery}`
  return parseChannelPackage(await json('GET', path))
}

/**
 * `POST …/posts/{channel}/draft?from=` — one tab's text adapted for another,
 * rendered and **never stored**: no write, no `rev` bump, no history. What
 * comes back is a draft the user has not accepted yet, which is why it carries
 * no findings; `POST /validate` judges it once it lands.
 */
export interface PostDraftFields {
  description?: string
  short_description?: string
  caption?: string
  text?: string
  hashtags?: string[]
}

export interface PostDraftAnswer {
  channel: string
  from: string
  /** Null for a platform this renderer does not know — the fields still read. */
  platform: Platform | null
  fields: PostDraftFields
}

export const POST_DRAFT_SHAPE_MESSAGE =
  'The drafted post came back in an unexpected shape — the backend may be out of date.'

/** The body fields the draft route may answer with, whatever the target platform. */
const DRAFT_TEXT_FIELDS = ['description', 'short_description', 'caption', 'text'] as const

/**
 * The draft answer. `fields` is the whole point, so a body without it throws
 * rather than writing an empty caption over the tab; a field the backend did
 * **not** send stays absent, so it is never written at all.
 */
export function parsePostDraft(value: unknown): PostDraftAnswer {
  const row = obj(value)
  const sent = obj(row?.fields)
  if (!row || !sent) throw new Error(POST_DRAFT_SHAPE_MESSAGE)
  const fields: PostDraftFields = {}
  for (const field of DRAFT_TEXT_FIELDS) {
    if (typeof sent[field] === 'string') fields[field] = sent[field]
  }
  if (Array.isArray(sent.hashtags)) fields.hashtags = strings(sent.hashtags)
  return {
    channel: str(row.channel),
    from: str(row.from),
    platform: isPlatform(row.platform) ? row.platform : null,
    fields,
  }
}

/** Render `channelId`'s post from `fromChannelId`'s. Nothing is written. */
export async function draftPostFrom(
  videoId: string,
  channelId: string,
  fromChannelId: string
): Promise<PostDraftAnswer> {
  const path =
    `/api/library/${encodeURIComponent(videoId)}/posts/${encodeURIComponent(channelId)}` +
    `/draft?from=${encodeURIComponent(fromChannelId)}`
  return parsePostDraft(await json('POST', path))
}

/** Judge a channel's post with the drafted `fields` laid over the stored one. */
export async function validateChannelPost(
  videoId: string,
  channelId: string,
  fields: Record<string, unknown>
): Promise<Violation[]> {
  const body = { video_id: videoId, channel: channelId, fields }
  return parseViolations(await json('POST', '/api/library/validate', body))
}
