/**
 * A channel's cover: pick one of the video's frames (`thumbnail.candidates`,
 * shared by every channel and managed under This video → Thumbnail). The pick
 * writes `posts.<id>.cover`; clicking the picked frame again clears it.
 *
 * Frames load as `blob:` URLs, like the Thumbnail strip (the CSP forbids
 * `127.0.0.1` images).
 */

import { useCallback } from 'react'
import { StudioCard } from '../studio/StudioCard'
import type { ChannelPublishController } from '../../lib/channelPublishView'
import { frameAssetPath } from '../../lib/framesApi'
import { useLibraryAssetUrl } from '../../hooks/useLibraryAssetUrl'
import { useToast } from '../../hooks/useToast'
import { FieldViolations } from './FieldViolations'

/** The tiles are 16:9 boxes; a vertical frame is letterboxed inside. */
const TILE_ASPECT = '16 / 9'

interface PostCoverPickerProps {
  view: ChannelPublishController
}

export function PostCoverPicker({ view }: PostCoverPickerProps) {
  const { toast } = useToast()
  const onAssetError = useCallback(
    (reason: string) => toast(`A thumbnail frame could not be loaded: ${reason}`, 'error'),
    [toast]
  )
  const candidates = view.fields.thumbnail.candidates
  const cover = view.post.cover
  const videoId = view.record?.id ?? ''

  return (
    <StudioCard title="Cover" defaultOpen={false}>
      {candidates.length === 0 ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          No frames yet. Grab or upload one under This video → Thumbnail, then pick this
          channel’s cover here.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5" aria-label="Cover frames">
          {candidates.map((name) => (
            <CoverTile
              key={name}
              videoId={videoId}
              name={name}
              picked={cover === name}
              onPick={() => view.setPostField('cover', cover === name ? null : name)}
              onAssetError={onAssetError}
            />
          ))}
        </ul>
      )}
      <FieldViolations violations={view.postViolations('cover')} />
    </StudioCard>
  )
}

interface CoverTileProps {
  videoId: string
  name: string
  picked: boolean
  onPick: () => void
  onAssetError: (reason: string) => void
}

function CoverTile({ videoId, name, picked, onPick, onAssetError }: CoverTileProps) {
  const url = useLibraryAssetUrl(videoId, frameAssetPath(name), onAssetError)
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        aria-label={picked ? 'This channel’s cover — click to unset' : 'Use this frame as the cover'}
        onClick={onPick}
        className="block w-full rounded overflow-hidden"
        style={{
          aspectRatio: TILE_ASPECT,
          background: 'var(--color-surface-2)',
          outline: picked ? '2px solid var(--color-brand)' : '1px solid var(--color-border)',
          outlineOffset: picked ? '1px' : '-1px',
        }}
      >
        {url && <img src={url} alt="" className="w-full h-full" style={{ objectFit: 'contain' }} />}
      </button>
    </li>
  )
}
