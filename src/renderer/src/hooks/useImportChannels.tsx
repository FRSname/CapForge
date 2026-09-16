/**
 * The import "Publish to:" ask (docs/plans/multi-channel-pr4-contract.md
 * §Part C) — entered **once** per import, before any request is made, and
 * resolved by the sheet the caller mounts.
 *
 * Two callers, one question:
 *   - a batch import (`useLibraryActions.runImport`) calls `ask` between the
 *     plan and the first request, so the choice rides into every body;
 *   - Start (a single media file) calls `start`, which asks and then mints the
 *     record with the ids. The ask deliberately does **not** live inside
 *     `ensureRecordFor`: the agent's `load_video` and a project restore both
 *     call that and must stay channel-less (§4.2).
 *
 * The channels are read here, per ask — nothing caches them outside Settings.
 * A read that fails does not block the import: the sheet opens with the reason
 * and the user can still import (on no channel), or cancel.
 *
 * Cancel means **nothing is imported** — `ask` resolves to `null`, and both
 * callers stop there.
 */

import { useCallback, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { Channel, PlatformSpec } from '../lib/channelTypes'
import { listChannels, listPlatforms } from '../lib/channelsApi'
import {
  LAST_PUBLISH_CHANNELS_KEY,
  NO_CHANNELS_LINE,
  channelsUnreadableMessage,
  hasChannelsToPick,
  rememberedChannels,
  toggleChannel,
} from '../lib/importChannels'
import { PublishToSheet } from '../components/library/PublishToSheet'

/** `useLibrarySession.ensureRecordFor`, as the Start path reaches it. */
export type EnsureRecord = (path: string, channels?: readonly string[]) => Promise<string | null>

/** What the sheet calls a single video being started. */
export const START_WHAT = 'this video'

interface LoadedChannels {
  channels: Channel[] | null
  platforms: PlatformSpec[] | null
  error: string | null
}

interface PendingAsk extends LoadedChannels {
  what: string
}

export interface ImportChannelsInput {
  /** The Start path only: how the record is minted, and where to go once it is. */
  ensureRecordRef?: RefObject<EnsureRecord | null>
  onStarted?: () => void
  /**
   * An informational line — today only "Settings has no channels". The Start
   * path passes none on purpose: it would fire on every transcription, and
   * App's single relay always toasts as an error.
   */
  inform?: (message: string) => void
}

export interface ImportChannels {
  /** Ask once per import. Resolves to the ticked ids, or `null` when cancelled. */
  ask: (what: string) => Promise<readonly string[] | null>
  /** Start `path`: ask, mint the record with the ids, then move on. */
  start: (path: string | null) => Promise<void>
  /** The sheet — mounted by whoever owns the screen the ask came from. */
  sheet: ReactNode
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Settings' channels and the served platform table. Only the channels are fatal. */
async function loadChannels(): Promise<LoadedChannels> {
  const [list, specs] = await Promise.allSettled([listChannels(), listPlatforms()])
  if (list.status === 'rejected') {
    return {
      channels: null,
      platforms: null,
      error: channelsUnreadableMessage(reasonOf(list.reason)),
    }
  }
  return {
    channels: list.value.channels,
    platforms: specs.status === 'fulfilled' ? specs.value : null,
    error: null,
  }
}

/** Only ever called from an event handler, but `window` is absent under vitest's node env. */
function appState(): Window['subforge'] | null {
  return typeof window === 'undefined' ? null : (window.subforge ?? null)
}

async function readRemembered(channels: readonly Channel[] | null): Promise<string[]> {
  const bridge = appState()
  if (!bridge) return []
  return rememberedChannels(await bridge.getState<unknown>(LAST_PUBLISH_CHANNELS_KEY, []), channels)
}

export function useImportChannels(input: ImportChannelsInput = {}): ImportChannels {
  const [pending, setPending] = useState<PendingAsk | null>(null)
  const [ticked, setTicked] = useState<readonly string[]>([])
  const inputRef = useRef(input)
  inputRef.current = input
  // The sheet settles the promise `ask` handed out, long after that render.
  const resolveRef = useRef<((ids: readonly string[] | null) => void) | null>(null)

  const remember = useCallback((ids: readonly string[]) => {
    const bridge = appState()
    if (!bridge) return
    bridge.setState(LAST_PUBLISH_CHANNELS_KEY, [...ids]).catch((err: unknown) => {
      // A preference that did not stick: the import itself is unaffected.
      inputRef.current.inform?.(`Could not remember the channels: ${reasonOf(err)}`)
    })
  }, [])

  const finish = useCallback((ids: readonly string[] | null) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setPending(null)
    resolve?.(ids)
  }, [])

  const ask = useCallback(async (what: string): Promise<readonly string[] | null> => {
    const loaded = await loadChannels()
    // No channels to tick: no sheet, and the import goes ahead with none.
    if (!loaded.error && !hasChannelsToPick(loaded.channels)) {
      inputRef.current.inform?.(NO_CHANNELS_LINE)
      return []
    }
    setTicked(await readRemembered(loaded.channels))
    setPending({ what, ...loaded })
    return new Promise((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const start = useCallback(
    async (path: string | null): Promise<void> => {
      if (!path) return
      const channels = await ask(START_WHAT)
      if (channels === null) return
      await inputRef.current.ensureRecordRef?.current?.(path, channels)
      inputRef.current.onStarted?.()
    },
    [ask]
  )

  const accept = useCallback(
    (ids: readonly string[]) => {
      remember(ids)
      finish(ids)
    },
    [remember, finish]
  )

  return {
    ask,
    start,
    sheet: pending ? (
      <PublishToSheet
        what={pending.what}
        channels={pending.channels}
        platforms={pending.platforms}
        error={pending.error}
        ticked={ticked}
        onToggle={(id) => setTicked((prev) => toggleChannel(prev, id))}
        onImport={() => accept(ticked)}
        onSkip={() => accept([])}
        onCancel={() => finish(null)}
      />
    ) : null,
  }
}
