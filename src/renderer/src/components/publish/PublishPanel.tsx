/**
 * The Publish aside — the dossier editor, same width and shape as StudioPanel,
 * built from the same `StudioCard` shells so the two workspaces feel like one
 * app rather than two.
 *
 * Top to bottom: the header, the channel tabs (or, for a video on no channel
 * yet, the "Publish to:" checklist), the active channel's cards, the fields the
 * whole video shares ("This video"), and the pinned footer, which copies the
 * active tab's package.
 *
 * It owns no record state. Everything it draws comes from `usePublishRecord`
 * and `usePublishChannels`, and every rule it appears to enforce (limits,
 * chapter legality, house style) is the backend's answer rendered under a field.
 */

import type { ReactNode } from 'react'
import type { CaptionTrack } from '../../lib/tracks'
import type { Segment, Workspace } from '../../types/app'
import type { PublishController } from '../../hooks/usePublishRecord'
import type { PublishChannels } from '../../hooks/usePublishChannels'
import { usePublishChannels } from '../../hooks/usePublishChannels'
import type { ChannelTab } from '../../lib/channelPublishView'
import { packageLanguages } from '../../lib/publishLocalized'
import type { PublishRecord } from '../../lib/publishTypes'
import { AgentUpdateBanner } from './AgentUpdateBanner'
import { ChannelSection } from './ChannelSection'
import { ChannelTabs } from './ChannelTabs'
import type { FooterChannel } from './PublishFooter'
import { PublishFooter } from './PublishFooter'
import { PublishToChecklist } from './PublishToChecklist'
import { PublishVideoSection } from './PublishVideoSection'
import { ASIDE_PANEL_WIDTH } from '../../lib/panelResize'

interface PublishPanelBaseProps {
  /**
   * What heads the panel. Defaults to its own "Publish" label; the aside hands
   * it the workspace toggle instead (docs/plans/ux-ui-refresh.md §4).
   */
  title?: ReactNode
  /** The column's width in px; the aside's drag handle sets it (`lib/panelResize.ts`). */
  width?: number
  publish: PublishController
  /** The source transcript — speaker rows, snapping, the plain-transcript copy. */
  segments: readonly Segment[]
  /** Every caption track, for the per-track subtitle exports. */
  tracks: readonly CaptionTrack[]
  outputDir: string
  /** Move the player (a chapter row was clicked). */
  onSeek: (seconds: number) => void
  /** Where the player is now ("Insert at playhead"). */
  getPlayhead: () => number
}

interface PublishPanelProps extends PublishPanelBaseProps {
  /** Entering the Publish workspace re-reads the channels. */
  workspace: Workspace
  /** Told the active channel tab, for the UI-state mirror. */
  onActiveChannel: (channelId: string | null) => void
}

export function PublishPanel({ workspace, onActiveChannel, ...props }: PublishPanelProps) {
  const channels = usePublishChannels({ publish: props.publish, workspace, onActiveChannel })
  return <PublishPanelView {...props} channels={channels} />
}

export interface PublishPanelViewProps extends PublishPanelBaseProps {
  channels: PublishChannels
}

function footerChannel(tab: ChannelTab | null): FooterChannel | null {
  return tab?.platform ? { id: tab.id, platform: tab.platform } : null
}

/** A YouTube tab's package languages: the source, then that post's stored translations. */
function footerLanguages(record: PublishRecord | null, tab: ChannelTab | null) {
  if (!record || tab?.platform !== 'youtube') return []
  return packageLanguages({
    language: record.language,
    localized: record.posts[tab.id]?.localized ?? {},
  })
}

export function PublishPanelView(props: PublishPanelViewProps) {
  const { publish, segments, tracks, outputDir, onSeek, getPlayhead, channels } = props
  const record = publish.record
  const active = channels.active
  const hasTabs = record !== null && channels.tabs.length > 0

  return (
    <aside
      data-tour="publish-panel"
      className="shrink-0 flex flex-col min-h-0 overflow-hidden border-l border-[var(--color-border)]"
      style={{ width: props.width ?? ASIDE_PANEL_WIDTH.initial }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0 border-b border-[var(--color-border)]">
        {props.title ?? <span className="label-xs">Publish</span>}
        <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {publish.saving ? 'Saving…' : publish.dirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>

      {hasTabs && (
        <ChannelTabs
          tabs={channels.tabs}
          activeId={active?.id ?? null}
          menu={channels.menu}
          platforms={channels.platforms}
          onSelect={channels.select}
          onAdd={(channelId) => channels.addChannels([channelId])}
          onHide={channels.hideChannel}
        />
      )}

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col gap-2 [&>*]:shrink-0">
        <AgentUpdateBanner
          notice={publish.pendingAgentUpdate}
          onApply={publish.applyAgentUpdate}
          onKeepMine={publish.keepMine}
        />

        {!record ? (
          <p className="text-xs px-1 py-2" style={{ color: 'var(--color-text-3)' }}>
            {publish.loading
              ? 'Opening this video’s record…'
              : 'This session has no library record yet, so there is nothing to publish.'}
          </p>
        ) : (
          <>
            {hasTabs && active ? (
              <ChannelSection key={active.id} publish={publish} tab={active} channels={channels} />
            ) : (
              <PublishToChecklist
                key={record.id}
                channels={channels.channels}
                platforms={channels.platforms}
                onAdd={channels.addChannels}
              />
            )}
            <PublishVideoSection
              publish={publish}
              segments={segments}
              onSeek={onSeek}
              getPlayhead={getPlayhead}
            />
          </>
        )}
      </div>

      {/* Pinned actions — the active tab's package and the subtitle files. */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
        <PublishFooter
          videoId={record?.id ?? null}
          channel={footerChannel(active)}
          languages={footerLanguages(record, active)}
          segments={segments}
          tracks={tracks}
          outputDir={outputDir}
        />
      </div>
    </aside>
  )
}
