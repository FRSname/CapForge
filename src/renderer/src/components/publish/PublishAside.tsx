/**
 * The right-hand column: the caption studio and the publish dossier, both
 * **mounted**, one of them hidden.
 *
 * Never swapped (vision §4). StudioPanel owns a live render controller, a
 * preset picker and its own search state; PublishPanel owns scroll positions
 * and open/closed cards. Unmounting either on a toggle would throw that away
 * and, for the render controller, drop a render in flight.
 *
 * `contents` rather than `block` on the visible wrapper so the aside keeps
 * being a direct flex child of `<main>` and its width still comes from itself.
 */

import type { Workspace } from '../../types/app'
import type { Segment } from '../../types/app'
import type { PublishWorkspaceController } from '../../hooks/usePublishWorkspace'
import type { CaptionTrack } from '../../lib/tracks'
import { StudioPanel } from '../studio/StudioPanel'
import type { StudioPanelProps } from '../studio/StudioPanel'
import type { PublishController } from '../../hooks/usePublishRecord'
import { PublishPanel } from './PublishPanel'

interface PublishAsideProps {
  /** The toggle, the player wire and the active channel tab's reporter. */
  publishWorkspace: PublishWorkspaceController
  /** Hides the whole column (the library screen has no open project). */
  hidden: boolean
  studio: StudioPanelProps
  publish: PublishController
  segments: readonly Segment[]
  tracks: readonly CaptionTrack[]
  outputDir: string
}

export function PublishAside({
  publishWorkspace,
  hidden,
  studio,
  publish,
  segments,
  tracks,
  outputDir,
}: PublishAsideProps) {
  const { workspace } = publishWorkspace
  const show = (owner: Workspace) => (hidden || workspace !== owner ? 'hidden' : 'contents')
  return (
    <>
      <div className={show('captions')}>
        <StudioPanel {...studio} />
      </div>
      <div className={show('publish')}>
        <PublishPanel
          publish={publish}
          segments={segments}
          tracks={tracks}
          outputDir={outputDir}
          onSeek={publishWorkspace.seek}
          getPlayhead={publishWorkspace.getPlayhead}
          workspace={workspace}
          onActiveChannel={publishWorkspace.setActiveChannelId}
        />
      </div>
    </>
  )
}
