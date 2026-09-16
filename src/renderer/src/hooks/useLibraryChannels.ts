/**
 * The channel names the library's list view shows in "Published on" (the list
 * summary's `publishedOn` carries channel ids only).
 *
 * Read when the list layout is first shown — the grid never needs them.
 * A failed read goes to `notify`; the column then shows the ids, which are
 * slugs of the channel names, so it still reads.
 */

import { useEffect, useRef, useState } from 'react'
import type { Channel } from '../lib/channelTypes'
import { listChannels } from '../lib/channelsApi'

export interface LibraryChannelsInput {
  /** True once the list layout is on show. */
  wanted: boolean
  notify: (message: string) => void
}

export type ChannelNames = ReadonlyArray<Pick<Channel, 'id' | 'name'>>

export function libraryChannelsFailedMessage(reason: string): string {
  return `Could not read the channel names: ${reason}`
}

export function useLibraryChannels({ wanted, notify }: LibraryChannelsInput): ChannelNames | null {
  const [channels, setChannels] = useState<ChannelNames | null>(null)
  const loaded = channels !== null
  const notifyRef = useRef(notify)
  useEffect(() => {
    notifyRef.current = notify
  })

  useEffect(() => {
    // Once loaded, never again; a failed read is retried the next time the list shows.
    if (!wanted || loaded) return
    let live = true
    listChannels().then(
      (list) => {
        if (live) setChannels(list.channels.map(({ id, name }) => ({ id, name })))
      },
      (err: unknown) => {
        if (!live) return
        const reason = err instanceof Error ? err.message : String(err)
        notifyRef.current(libraryChannelsFailedMessage(reason))
      }
    )
    return () => {
      live = false
    }
  }, [wanted, loaded])

  return channels
}
