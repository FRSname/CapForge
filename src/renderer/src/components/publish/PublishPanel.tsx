/**
 * The Publish aside — the dossier editor, same width and shape as StudioPanel,
 * built from the same `StudioCard` shells so the two workspaces feel like one
 * app rather than two.
 *
 * It owns no state. Everything it draws comes from `usePublishRecord`, and
 * every rule it appears to enforce (limits, chapter legality, house style) is
 * the backend's answer rendered under a field.
 */

import type { CaptionTrack } from '../../lib/tracks'
import type { Segment } from '../../types/app'
import type { PublishController } from '../../hooks/usePublishRecord'
import { AgentUpdateBanner } from './AgentUpdateBanner'
import { ChaptersCard } from './ChaptersCard'
import { CollectionCard } from './CollectionCard'
import { DescriptionCard } from './DescriptionCard'
import { PublishFooter } from './PublishFooter'
import { PublishStateCard } from './PublishStateCard'
import { SpeakersCard } from './SpeakersCard'
import { SummaryCard } from './SummaryCard'
import { TagsCard } from './TagsCard'
import { TitleCard } from './TitleCard'

interface PublishPanelProps {
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

export function PublishPanel({
  publish,
  segments,
  tracks,
  outputDir,
  onSeek,
  getPlayhead,
}: PublishPanelProps) {
  return (
    <aside className="w-[380px] shrink-0 flex flex-col min-h-0 overflow-hidden border-l border-[var(--color-border)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0 border-b border-[var(--color-border)]">
        <span className="label-xs">Publish</span>
        <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {publish.saving ? 'Saving…' : publish.dirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col gap-2 [&>*]:shrink-0">
        <AgentUpdateBanner
          notice={publish.pendingAgentUpdate}
          onApply={publish.applyAgentUpdate}
          onKeepMine={publish.keepMine}
        />

        {!publish.record ? (
          <p className="text-xs px-1 py-2" style={{ color: 'var(--color-text-3)' }}>
            {publish.loading
              ? 'Opening this video’s record…'
              : 'This session has no library record yet, so there is nothing to publish.'}
          </p>
        ) : (
          <>
            <TitleCard publish={publish} />
            <DescriptionCard publish={publish} />
            <CollectionCard publish={publish} />
            <ChaptersCard publish={publish} onSeek={onSeek} getPlayhead={getPlayhead} />
            <TagsCard publish={publish} />
            <SpeakersCard publish={publish} />
            <SummaryCard publish={publish} />
            <PublishStateCard publish={publish} />
          </>
        )}
      </div>

      {/* Pinned actions — the package and the subtitle files. */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
        <PublishFooter
          videoId={publish.record?.id ?? null}
          segments={segments}
          tracks={tracks}
          outputDir={outputDir}
        />
      </div>
    </aside>
  )
}
