/**
 * Thumbnail: the frame strip, the cover, and the idea briefs.
 *
 * Frames are stills the backend grabbed from the video, or images the user
 * uploaded ("Upload image…", `POST …/frames/upload`, which also makes the
 * upload the cover), kept in the record folder (`thumbnails/<name>.jpg`). They
 * load as `blob:` URLs (the CSP forbids `127.0.0.1` images). With
 * `coverPicking`, clicking a frame makes it the cover (the ring); the Publish
 * panel turns that off, because each channel picks its own cover on its tab
 * (`PostCoverPicker`). × asks inline, then deletes it through
 * `DELETE …/frames/{name}`. The strip's list is `thumbnail.candidates` —
 * managed by the frames routes alone, which is why every thumbnail write
 * composes it from the latest record (`lib/publishThumbnail.ts`).
 */

import type { ChangeEvent } from 'react'
import { useCallback, useRef, useState } from 'react'
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

/** What the upload picker offers — `backend/library/frame_upload.py` `ACCEPTED_FORMATS`. */
const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp'

/** The action row's buttons; the row wraps when the aside is too narrow for three. */
const ACTION_CLASS = 'flex-1 whitespace-nowrap text-xs-plus py-1 justify-center'

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
      coverPicking={false}
      busy={frames.busy}
      confirming={confirming}
      onConfirm={setConfirming}
      onGrab={frames.grabAtPlayhead}
      onUpload={frames.uploadImage}
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
  /** Clicking a tile picks the root cover (default). Off under This video: covers are per channel. */
  coverPicking?: boolean
  busy: boolean
  /** The frame whose × was clicked and awaits a yes/no, if any. */
  confirming: string | null
  onConfirm: (name: string | null) => void
  onGrab: () => void
  /** An image the user picked, to store as a frame and the cover. */
  onUpload: (file: File) => void
  onDelete: (name: string) => void
  onSaveCover: () => void
  onAssetError: (reason: string) => void
}

interface FrameActionsProps {
  busy: boolean
  hasCover: boolean
  onGrab: () => void
  onUpload: (file: File) => void
  onSaveCover: () => void
}

/** Grab, upload and save-out; the upload drives a hidden file picker. */
function FrameActions({ busy, hasCover, onGrab, onUpload, onSaveCover }: FrameActionsProps) {
  const picker = useRef<HTMLInputElement>(null)

  function handlePicked(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file) onUpload(file)
    // Cleared so choosing the same file again still fires a change.
    input.value = ''
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 mb-3">
      <Button
        variant="ghost"
        className={ACTION_CLASS}
        onClick={onGrab}
        loading={busy}
        title="Grab a still from the video at the playhead"
      >
        Grab frame
      </Button>
      <Button
        variant="ghost"
        className={ACTION_CLASS}
        onClick={() => picker.current?.click()}
        disabled={busy}
        title="Upload a JPEG, PNG or WEBP image as a frame; it becomes the cover"
      >
        Upload image…
      </Button>
      <Button
        variant="ghost"
        className={ACTION_CLASS}
        onClick={onSaveCover}
        disabled={!hasCover}
        title="Save the cover frame as a JPEG"
      >
        Save cover…
      </Button>
      <input ref={picker} type="file" accept={UPLOAD_ACCEPT} hidden onChange={handlePicked} />
    </div>
  )
}

interface FrameTileProps {
  videoId: string
  name: string
  pickable: boolean
  isCover: boolean
  confirming: boolean
  onPick: () => void
  onConfirm: (name: string | null) => void
  onDelete: (name: string) => void
  onAssetError: (reason: string) => void
}

function FrameTile(props: FrameTileProps) {
  const {
    videoId,
    name,
    pickable,
    isCover,
    confirming,
    onPick,
    onConfirm,
    onDelete,
    onAssetError,
  } = props
  const url = useLibraryAssetUrl(videoId, frameAssetPath(name), onAssetError)
  const image = url && (
    <img src={url} alt="" className="w-full h-full" style={{ objectFit: 'contain' }} />
  )

  return (
    <li className="relative flex flex-col gap-1">
      {!pickable && (
        <div
          className="block w-full rounded overflow-hidden"
          style={{
            aspectRatio: TILE_ASPECT,
            background: 'var(--color-surface-2)',
            outline: '1px solid var(--color-border)',
            outlineOffset: '-1px',
          }}
        >
          {image}
        </div>
      )}
      {pickable && (
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
          {image}
        </button>
      )}
      {pickable && isCover && (
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
          className="icon-btn absolute right-0.5 top-0.5 w-5 h-5 text-xs-plus"
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
  const { publish, busy, confirming, onConfirm, onDelete, onAssetError } = props
  const coverPicking = props.coverPicking ?? true
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
          No frames yet. Move the player to a moment worth a thumbnail and grab it, or upload an
          image you made — frames are kept with this record,{' '}
          {coverPicking
            ? 'and the one you click becomes the cover.'
            : 'and each channel picks its cover from them on its tab.'}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5" aria-label="Thumbnail frames">
          {thumbnail.candidates.map((name) => (
            <FrameTile
              key={name}
              videoId={videoId}
              name={name}
              pickable={coverPicking}
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

      <FrameActions
        busy={busy}
        hasCover={thumbnail.cover !== null}
        onGrab={props.onGrab}
        onUpload={props.onUpload}
        onSaveCover={props.onSaveCover}
      />

      <ThumbnailIdeas publish={publish} violations={ideaFindings} />
      <FieldViolations violations={unplaced} />
    </StudioCard>
  )
}
