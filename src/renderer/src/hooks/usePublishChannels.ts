/**
 * The Publish panel's channel tabs: which channels exist, which tab is active,
 * the active post's own validation, and the two writes that add or hide a tab.
 *
 * Kept out of `usePublishRecord` (at its size ceiling) and out of `App.tsx`:
 * it is called by `PublishPanel`, and reports the active tab up through
 * `onActiveChannel` so the UI-state mirror can carry `activeChannelId`.
 *
 * - **Channels + platforms** are read each time the Publish workspace is
 *   entered, so a channel made in Settings meanwhile shows up.
 * - **The active tab** is the one last used for this video (this session),
 *   else the primary channel when the video has a post for it, else the first.
 * - **Validation** of the active post runs on the record writer's debounce,
 *   over its drafted fields (`POST /validate` with `channel`).
 * - **Adding / hiding** flushes the drafts first (a hide bumps `rev`), then
 *   writes at once through `publish.patchNow`.
 *
 * Every failure is toasted; nothing is swallowed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Workspace } from '../types/app'
import type { Channel, ChannelsList, PlatformSpec } from '../lib/channelTypes'
import { listChannels, listPlatforms } from '../lib/channelsApi'
import { channelFailedMessage } from '../lib/channels'
import type { ChannelTab } from '../lib/channelPublishView'
import { channelTabs } from '../lib/channelPublishView'
import type { AddableChannels, PostsMap } from '../lib/publishPosts'
import {
  addPostsPatch,
  addableChannels,
  postDraftFields,
  resolveActiveChannel,
} from '../lib/publishPosts'
import type { Violation } from '../lib/publishTypes'
import { validateChannelPost } from '../lib/postsApi'
import type { PublishController } from './usePublishRecord'
import { PUBLISH_PATCH_DEBOUNCE_MS } from './usePublishWriter'
import { useToast } from './useToast'

const NO_POSTS: PostsMap = {}
const NO_VIOLATIONS: Violation[] = []

export interface PublishChannelsInput {
  publish: PublishController
  /** Entering `'publish'` re-reads the channels. */
  workspace: Workspace
  /** Told the active tab's channel id (null: no visible post) whenever it changes. */
  onActiveChannel: (channelId: string | null) => void
}

export interface PublishChannels {
  /** Settings channels; null until the first read lands. */
  channels: Channel[] | null
  platforms: PlatformSpec[] | null
  tabs: ChannelTab[]
  active: ChannelTab | null
  /** What the `+` menu offers. */
  menu: AddableChannels<Channel>
  select: (channelId: string) => void
  /** Give the video a post on each channel (or show a hidden one again). */
  addChannels: (channelIds: readonly string[]) => void
  /** Hide a tab; its text is kept. */
  hideChannel: (channelId: string) => void
  /** The active post's findings from `POST /validate` with `channel`. */
  channelViolations: Violation[]
  notify: (message: string) => void
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function useChannelList(workspace: Workspace, notify: (message: string) => void) {
  const [list, setList] = useState<ChannelsList | null>(null)
  const [platforms, setPlatforms] = useState<PlatformSpec[] | null>(null)
  useEffect(() => {
    if (workspace !== 'publish') return undefined
    let cancelled = false
    const failed = (action: string) => (err: unknown) => {
      if (!cancelled) notify(channelFailedMessage(action, reasonOf(err)))
    }
    listChannels()
      .then((next) => !cancelled && setList(next))
      .catch(failed('read the channels'))
    listPlatforms()
      .then((next) => !cancelled && setPlatforms(next))
      .catch(failed('read the platform list'))
    return () => {
      cancelled = true
    }
  }, [workspace, notify])
  return { list, platforms }
}

interface ValidationInput {
  publish: PublishController
  channelId: string | null
  workspace: Workspace
  notify: (message: string) => void
}

function useChannelValidation({ publish, channelId, workspace, notify }: ValidationInput) {
  const [result, setResult] = useState<{ key: string; violations: Violation[] }>({
    key: '',
    violations: NO_VIOLATIONS,
  })
  const sequence = useRef(0)
  const record = publish.record
  const videoId = record?.id ?? null
  const rev = record?.rev ?? 0
  const fieldsJson =
    record && channelId
      ? JSON.stringify(postDraftFields(record, publish.fields.posts, channelId))
      : ''
  const key = `${videoId}/${channelId}`

  useEffect(() => {
    if (!videoId || !channelId || workspace !== 'publish') return undefined
    const timer = setTimeout(() => {
      const seq = ++sequence.current
      validateChannelPost(videoId, channelId, JSON.parse(fieldsJson) as Record<string, unknown>)
        .then((violations) => {
          if (seq === sequence.current) setResult({ key: `${videoId}/${channelId}`, violations })
        })
        .catch((err) => notify(`Could not check this post: ${reasonOf(err)}`))
    }, PUBLISH_PATCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [videoId, channelId, fieldsJson, rev, workspace, notify])

  return result.key === key ? result.violations : NO_VIOLATIONS
}

export function usePublishChannels({
  publish,
  workspace,
  onActiveChannel,
}: PublishChannelsInput): PublishChannels {
  const { toast } = useToast()
  const notify = useCallback((message: string) => toast(message, 'error'), [toast])
  const { list, platforms } = useChannelList(workspace, notify)
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({})

  const record = publish.record
  const videoId = record?.id ?? null
  const posts = record?.posts ?? NO_POSTS
  const primaryId = list?.primary_id ?? ''
  const channels = list?.channels ?? null
  const tabs = useMemo(() => channelTabs(posts, channels, primaryId), [posts, channels, primaryId])
  const lastUsed = videoId ? chosen[videoId] : undefined
  const activeId = resolveActiveChannel(
    tabs.map((t) => t.id),
    lastUsed,
    primaryId
  )
  const active = tabs.find((t) => t.id === activeId) ?? null

  useEffect(() => {
    onActiveChannel(activeId)
  }, [activeId, onActiveChannel])

  const channelViolations = useChannelValidation({
    publish,
    channelId: active?.platform ? active.id : null,
    workspace,
    notify,
  })

  const select = useCallback(
    (channelId: string) => {
      if (videoId) setChosen((prev) => ({ ...prev, [videoId]: channelId }))
    },
    [videoId]
  )

  const addChannels = (channelIds: readonly string[]) => {
    if (!record || channelIds.length === 0) return
    void publish
      .flushDrafts()
      .then(() => publish.patchNow({ posts: addPostsPatch(channelIds, record.posts) }))
      .then(() => select(channelIds[0]))
  }

  const hideChannel = (channelId: string) => {
    void publish
      .flushDrafts()
      .then(() => publish.patchNow({ posts: { [channelId]: { hidden: true } } }))
  }

  return {
    channels,
    platforms,
    tabs,
    active,
    menu: addableChannels(posts, channels),
    select,
    addChannels,
    hideChannel,
    channelViolations,
    notify,
  }
}
