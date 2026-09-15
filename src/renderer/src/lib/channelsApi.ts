/**
 * REST client for channels (docs/plans/multi-channel-pr1-contract.md).
 *
 * A sibling of `api.ts` rather than more methods on it, because that file is
 * past its size ceiling — the `collectionsApi.ts` pattern. Every call goes
 * through `api.sendWithLocalToken`, so the bridge and the local token are
 * handled in exactly one place. The three refusals the UI can phrase
 * (`channel_exists`, `channel_is_primary`, `primary_not_youtube`) throw
 * `ChannelRefusedError`; anything else is the usual `ApiError` with the
 * backend's message.
 */

import { api } from './api'
import type {
  Channel,
  ChannelCreate,
  ChannelPatch,
  ChannelsList,
  PlatformSpec,
} from './channelTypes'
import { parseChannel, parseChannelsList, parsePlatformSpecs } from './channelTypes'
import type { ChannelRefusal } from './channels'
import { channelRefusal, channelRefusalMessage } from './channels'

export type { ChannelCreate, ChannelPatch } from './channelTypes'

export class ChannelRefusedError extends Error {
  readonly refusal: ChannelRefusal
  constructor(refusal: ChannelRefusal) {
    super(channelRefusalMessage(refusal))
    this.name = 'ChannelRefusedError'
    this.refusal = refusal
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const CHANNELS_PATH = '/api/library/channels'
const PLATFORMS_PATH = '/api/library/platforms'

function channelPath(id: string): string {
  return `${CHANNELS_PATH}/${encodeURIComponent(id)}`
}

/** A refused response's body; a body that is not JSON falls back to the status text. */
function refusedBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({ detail: res.statusText }))
}

/** The response when it is ok; otherwise the typed refusal or the formatted error. */
async function send(method: Method, path: string, body?: unknown): Promise<Response> {
  const res = await api.sendWithLocalToken(method, path, body)
  if (res.ok) return res
  const refused = await refusedBody(res)
  const refusal = channelRefusal(res.status, refused)
  if (refusal) throw new ChannelRefusedError(refusal)
  throw api.apiError(res, refused)
}

async function json(method: Method, path: string, body?: unknown): Promise<unknown> {
  return (await send(method, path, body)).json()
}

export async function listChannels(): Promise<ChannelsList> {
  return parseChannelsList(await json('GET', CHANNELS_PATH))
}

export async function getChannel(id: string): Promise<Channel> {
  return parseChannel(await json('GET', channelPath(id)))
}

export async function createChannel(input: ChannelCreate): Promise<Channel> {
  return parseChannel(await json('POST', CHANNELS_PATH, input))
}

export async function patchChannel(id: string, patch: ChannelPatch): Promise<Channel> {
  return parseChannel(await json('PATCH', channelPath(id), patch))
}

/** `204` carries no body, so nothing is read from a success. */
export async function deleteChannel(id: string): Promise<void> {
  await send('DELETE', channelPath(id))
}

/** Answers the whole list, so every row's `primary` flag is fresh. */
export async function setPrimaryChannel(id: string): Promise<ChannelsList> {
  return parseChannelsList(await json('POST', `${channelPath(id)}/primary`))
}

export async function listPlatforms(): Promise<PlatformSpec[]> {
  return parsePlatformSpecs(await json('GET', PLATFORMS_PATH))
}
