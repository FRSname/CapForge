/**
 * Settings → Channels' data: the channel list (`GET /api/library/channels`)
 * and the served platform table (`GET /api/library/platforms`), plus the four
 * writes the pane makes.
 *
 * Both reads happen on mount. Every write adopts the backend's answer into the
 * list immutably and resolves to it (or `null` / `false` on failure). Every
 * failure is toasted here, so a caller never has to — and never can — swallow
 * one. `channels` and `platforms` are null until their first read lands, so a
 * caller can tell "not loaded" from "none"; a failed platform read leaves the
 * built-in labels in use (`lib/channels.ts` `platformLabel`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Channel, ChannelCreate, ChannelPatch, PlatformSpec } from '../lib/channelTypes'
import { channelFailedMessage, removeChannel, replaceChannel } from '../lib/channels'
import {
  createChannel,
  deleteChannel,
  listChannels,
  listPlatforms,
  patchChannel,
  setPrimaryChannel,
} from '../lib/channelsApi'
import { useToast } from './useToast'

export interface ChannelsState {
  channels: Channel[] | null
  platforms: PlatformSpec[] | null
  refresh: () => Promise<void>
  create: (input: ChannelCreate) => Promise<Channel | null>
  patch: (id: string, patch: ChannelPatch) => Promise<Channel | null>
  remove: (id: string) => Promise<boolean>
  makePrimary: (id: string) => Promise<boolean>
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useChannels(): ChannelsState {
  const { toast } = useToast()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [platforms, setPlatforms] = useState<PlatformSpec[] | null>(null)
  const toastRef = useRef(toast)
  useEffect(() => {
    toastRef.current = toast
  })

  /** Run a request; on failure toast "Could not <action>: <reason>" and resolve to `fallback`. */
  const attempt = useCallback(
    async <T>(action: string, run: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await run()
      } catch (err) {
        toastRef.current(channelFailedMessage(action, reasonOf(err)), 'error')
        return fallback
      }
    },
    []
  )

  const refresh = useCallback(
    (): Promise<void> =>
      attempt('read the channels', listChannels, null).then((list) => {
        if (list) setChannels(list.channels)
      }),
    [attempt]
  )

  // Both reads set state only in their `.then`, never synchronously in the effect body.
  useEffect(() => {
    void attempt('read the channels', listChannels, null).then((list) => {
      if (list) setChannels(list.channels)
    })
    void attempt('read the platform list', listPlatforms, null).then((specs) => {
      if (specs) setPlatforms(specs)
    })
  }, [attempt])

  const create = useCallback(
    async (input: ChannelCreate): Promise<Channel | null> => {
      const created = await attempt('create the channel', () => createChannel(input), null)
      if (created) setChannels((prev) => [...(prev ?? []), created])
      return created
    },
    [attempt]
  )

  const patch = useCallback(
    async (id: string, body: ChannelPatch): Promise<Channel | null> => {
      const saved = await attempt('save the channel', () => patchChannel(id, body), null)
      if (saved) setChannels((prev) => (prev ? replaceChannel(prev, saved) : [saved]))
      return saved
    },
    [attempt]
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const done = await attempt(
        'delete the channel',
        () => deleteChannel(id).then(() => true),
        false
      )
      if (done) setChannels((prev) => (prev ? removeChannel(prev, id) : prev))
      return done
    },
    [attempt]
  )

  const makePrimary = useCallback(
    async (id: string): Promise<boolean> => {
      const list = await attempt('make it the primary channel', () => setPrimaryChannel(id), null)
      if (list) setChannels(list.channels)
      return list !== null
    },
    [attempt]
  )

  return { channels, platforms, refresh, create, patch, remove, makePrimary }
}
