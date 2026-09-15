/**
 * Thumbnail: the frame strip, the cover, and the idea briefs.
 *
 * Frames are stills the backend grabbed from the video into the record folder
 * (`thumbnails/<name>.jpg`). They load as `blob:` URLs (the CSP forbids
 * `127.0.0.1` images). Clicking a frame makes it the cover (the ring); × asks
 * inline, then deletes it through `DELETE …/frames/{name}`. The strip's list
 * is `thumbnail.candidates` — managed by the frames routes alone, which is why
 * every thumbnail write composes it from the latest record
 * (`lib/publishThumbnail.ts`).
 */

import { useCallback, useState } from 'react'
import { StudioCard } from '../studio/StudioCard'
import { Button } from '../ui/Button'
import { frameAssetPath } from '../../lib/framesApi'
import { setCover } from '../../lib/publishThumbnail'
import { partitionViolations } from '../../lib/publishViolations'
import type { PublishController } from '../../hooks/usePublishRecord'
import { useLibraryAssetUrl } from '../../hooks/useLibraryAssetUrl'
import { useThumbnailFrames } from '../../hooks/useThumbnailFrames'
import { useToast } from '../../hooks/useToast'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'
import { ThumbnailIdeas } from './ThumbnailIdeas'

/** The strip's tiles are 16:9 boxes; a vertical frame is letterboxed inside. */
const TILE_ASPECT = '16 / 9'

interface ThumbnailCardProps {
  publish: PublishController
  getPlayhead: () => number
}

export function ThumbnailCard({ publish, getPlayhead }: ThumbnailCardProps) {
  const { toast } = useToast()
  const frames = useThumbnailFrames({ publish, getPlayhead, toast })
  const [confirming, setConfirming] = useState<string | null>(null)
  const onAssetError = useCallback(
    (reason: string) => toast(`A thumbnail frame could not be loaded: ${reason}`, 'error'),
    [toast]
  )

  return (
    <ThumbnailCardView
      publish={publish}
      busy={frames.busy}
      confirming={confirming}
      onConfirm={setConfirming}
      onGrab={frames.grabAtPlayhead}
      onDelete={(name) => {
        setConfirming(null)
        frames.removeFrame(name)
      }}
      onSaveCover={frames.saveCover}
      onAssetError={onAssetError}
    />
  )
}

export interface ThumbnailCardViewProps {
  publish: PublishController
  busy: boolean
  /** The frame whose × was clicked and awaits a yes/no, if any. */
  confirming: string | null
  onConfirm: (name: string | null) => void
  onGrab: () => void
  onDelete: (name: string) => void
  onSaveCover: () => void
  onAssetError: (reason: string) => void
}

interface FrameTileProps {
  videoId: string
  name: string
  isCover: boolean
  confirming: boolean
  onPick: () => void
  onConfirm: (name: string | null) => void
  onDelete: (name: string) => void
  onAssetError: (reason: string) => void
}

function FrameTile(props: FrameTileProps) {
  const { videoId, name, isCover, confirming, onPick, onConfirm, onDelete, onAssetError } = props
  const url = useLibraryAssetUrl(videoId, frameAssetPath(name), onAssetError)

  return (
    <li className="relative flex flex-col gap-1">
      <button
        type="button"
        aria-pressed={isCover}
        aria-label={isCover ? 'The cover — click to unset' : 'Use this frame as the cover'}
        onClick={onPick}
        className="block w-full rounded overflow-hidden"
        style={{
          aspectRatio: TILE_ASPECT,
          background: 'var(--color-surface-2)',
          outline: isCover ? '2px solid var(--color-brand)' : '1px solid var(--color-border)',
          outlineOffset: isCover ? '1px' : '-1px',
        }}
      >
        {url && <img src={url} alt="" className="w-full h-full" style={{ objectFit: 'contain' }} />}
      </button>
      {isCover && (
        <span
          className="absolute left-1 top-1 text-2xs px-1 rounded"
          style={{ background: 'var(--color-brand)', color: 'var(--color-bg)' }}
        >
          Cover
        </span>
      )}
      {confirming ? (
        <div className="flex items-center gap-1 text-2xs" style={{ color: 'var(--color-text-2)' }}>
          <span>Delete this frame?</span>
          <button
            type="button"
            className="hover:underline"
            style={{ color: 'var(--color-danger)' }}
            onClick={() => onDelete(name)}
          >
            Delete
          </button>
          <button type="button" className="hover:underline" onClick={() => onConfirm(null)}>
            Keep
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="icon-btn absolute right-0.5 top-0.5 w-5 h-5 text-[11px]"
          style={{ background: 'var(--color-surface)' }}
          aria-label="Delete this frame"
          title="Delete this frame"
          onClick={() => onConfirm(name)}
        >
          ✕
        </button>
      )}
    </li>
  )
}

export function ThumbnailCardView(props: ThumbnailCardViewProps) {
  const { publish, busy, confirming, onConfirm, onGrab, onDelete, onSaveCover, onAssetError } =
    props
  const thumbnail = publish.fields.thumbnail
  const videoId = publish.record?.id ?? ''
  const {
    placed: [stripFindings, ideaFindings],
    unplaced,
  } = partitionViolations(publish.violationsFor('thumbnail'), [
    ['thumbnail.cover', 'thumbnail.candidates'],
    ['thumbnail.ideas'],
  ])
  const pick = (name: string) =>
    publish.setField('thumbnail', setCover(thumbnail, thumbnail.cover === name ? null : name))

  return (
    <StudioCard title="Thumbnail" defaultOpen={false}>
      <FieldHeader publish={publish} field="thumbnail" label="Frames" />
      {thumbnail.candidates.length === 0 ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          No frames yet. Move the player to a moment worth a thumbnail and grab it — frames are
          stills from the video, kept with this record, and the one you click becomes the cover.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5" aria-label="Thumbnail frames">
          {thumbnail.candidates.map((name) => (
            <FrameTile
              key={name}
              videoId={videoId}
              name={name}
              isCover={thumbnail.cover === name}
              confirming={confirming === name}
              onPick={() => pick(name)}
              onConfirm={onConfirm}
              onDelete={onDelete}
              onAssetError={onAssetError}
            />
          ))}
        </ul>
      )}
      <FieldViolations violations={stripFindings} />

      <div className="flex gap-1.5 mt-2 mb-3">
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={onGrab}
          loading={busy}
          title="Grab a still from the video at the playhead"
        >
          Grab frame at playhead
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={onSaveCover}
          disabled={!thumbnail.cover}
          title="Save the cover frame as a JPEG"
        >
          Save cover…
        </Button>
      </div>

      <ThumbnailIdeas publish={publish} violations={ideaFindings} />
      <FieldViolations violations={unplaced} />
    </StudioCard>
  )
}
