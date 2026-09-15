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
import type { UploadPackage, Violation } from './publishTypes'
import { PACKAGE_SHAPE_MESSAGE, parseUploadPackage, parseViolations } from './publishTypes'
import { obj, str } from './wireReaders'

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

/** Judge a channel's post with the drafted `fields` laid over the stored one. */
export async function validateChannelPost(
  videoId: string,
  channelId: string,
  fields: Record<string, unknown>
): Promise<Violation[]> {
  const body = { video_id: videoId, channel: channelId, fields }
  return parseViolations(await json('POST', '/api/library/validate', body))
}
