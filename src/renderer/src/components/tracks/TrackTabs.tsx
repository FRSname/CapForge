/**
 * Caption-track tab strip — the one place a user switches, adds or closes a
 * language.
 *
 * It is mounted by `App.tsx` **above** the ResultsScreen container and never
 * inside it: ResultsScreen is re-keyed (and therefore remounted) on every tab
 * switch, so a strip living inside it would unmount itself mid-click.
 *
 * The source tab always comes first and can never be closed — it is the
 * transcript every translated track is linked to. A translated tab carries the
 * markers from `classifyTrack`: how many of its captions the source has moved
 * under (`staleCount`, brand orange), how many are still blank
 * (`untranslatedCount`, muted), and a dot when the source's *chunking* changed
 * and the track needs a re-flow.
 *
 * Keyboard: `role="tablist"` with roving tabIndex and ArrowLeft/ArrowRight, the
 * pattern from `ui/SegmentedControl` and the editor's view tabs. Focus follows
 * selection; the trailing `+` participates in the ring but only takes focus (it
 * opens a picker, it does not select a track). Arrow keys are stopped from
 * propagating because the window-level playback handler maps ←/→ to frame
 * stepping.
 */

import { useCallback, useRef, useState } from 'react'
import { LanguagePicker } from './LanguagePicker'

export interface TrackTabInfo {
  id: string
  label: string
  lang: string
  isSource: boolean
  /** Captions whose recorded source words have changed (`classifyTrack`). */
  staleCount: number
  /** Captions that still have no text. */
  untranslatedCount: number
  /** The source's grouping moved — `reflowTrack` is the repair. */
  reflowNeeded: boolean
}

export interface TrackTabsProps {
  /** Source track first, exactly as the store holds them. */
  tracks: ReadonlyArray<TrackTabInfo>
  activeTrackId: string
  onSelect: (id: string) => void
  /** A language was picked from the `+` popover — create a track for it. */
  onAdd: (lang: string) => void
  /** Close a translated track (the caller confirms first). */
  onClose: (id: string) => void
}

export function TrackTabs({ tracks, activeTrackId, onSelect, onAdd, onClose }: TrackTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null)

  /** Move focus along the roving ring; selecting as it goes, except on `+`. */
  const handleArrow = useCallback(
    (index: number, dir: 1 | -1) => {
      const count = tracks.length + 1
      const next = (index + dir + count) % count
      if (next < tracks.length) onSelect(tracks[next].id)
      const tabs = containerRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
      tabs?.[next]?.focus()
    },
    [tracks, onSelect]
  )

  const closePicker = useCallback(() => setPickerRect(null), [])

  const handlePick = useCallback(
    (code: string) => {
      setPickerRect(null)
      onAdd(code)
    },
    [onAdd]
  )

  function togglePicker() {
    setPickerRect((open) => (open ? null : (addRef.current?.getBoundingClientRect() ?? null)))
  }

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Caption tracks"
      className="app-no-drag flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1.5"
      style={{ fontFamily: 'var(--cf-font-ui)' }}
    >
      {tracks.map((track, i) => (
        <TrackTab
          key={track.id}
          track={track}
          index={i}
          active={track.id === activeTrackId}
          onSelect={onSelect}
          onClose={onClose}
          onArrow={handleArrow}
        />
      ))}

      <button
        ref={addRef}
        type="button"
        id="track-add-tab"
        role="tab"
        aria-selected={false}
        tabIndex={-1}
        aria-label="Add a caption track"
        title="Add a caption track in another language"
        className="rounded-t border-b-2 border-transparent px-2 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: 'var(--color-text-3)' }}
        onClick={togglePicker}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          e.stopPropagation()
          handleArrow(tracks.length, e.key === 'ArrowRight' ? 1 : -1)
        }}
      >
        +
      </button>

      {pickerRect && (
        <LanguagePicker
          anchorRect={pickerRect}
          anchorRef={addRef}
          addedCodes={tracks.map((t) => t.lang)}
          onPick={handlePick}
          onClose={closePicker}
        />
      )}
    </div>
  )
}

interface TrackTabProps {
  track: TrackTabInfo
  index: number
  active: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onArrow: (index: number, dir: 1 | -1) => void
}

function TrackTab({ track, index, active, onSelect, onClose, onArrow }: TrackTabProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div role="presentation" className="flex items-center">
      <button
        type="button"
        id={`track-tab-${track.id}`}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className={[
          'flex items-center gap-1.5 rounded-t border-b-2 px-3 py-1.5 text-xs transition-colors',
          active
            ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
            : 'border-transparent',
        ].join(' ')}
        style={{
          color: active || hovered ? 'var(--color-text)' : 'var(--color-text-3)',
        }}
        title={track.isSource ? 'The transcript' : `${track.label} (${track.lang})`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect(track.id)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          // The window-level playback handler maps ←/→ to frame stepping.
          e.stopPropagation()
          onArrow(index, e.key === 'ArrowRight' ? 1 : -1)
        }}
      >
        <span className="max-w-[10rem] truncate">{track.label}</span>
        <TrackBadges track={track} />
      </button>

      {!track.isSource && (
        <button
          type="button"
          aria-label={`Close ${track.label}`}
          title={`Close ${track.label}`}
          className="-ml-1 rounded px-1 text-2xs transition-opacity hover:opacity-100"
          style={{ color: 'var(--color-text-3)', opacity: active ? 0.85 : 0.5 }}
          onClick={() => onClose(track.id)}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** Stale / untranslated counts and the re-flow dot — translated tracks only. */
function TrackBadges({ track }: { track: TrackTabInfo }) {
  if (track.isSource) return null
  return (
    <>
      {track.staleCount > 0 && (
        <span
          className="rounded px-1 text-2xs tabular-nums"
          style={{ color: 'var(--color-brand)', background: 'var(--color-surface-3)' }}
          title={`${track.staleCount} captions whose source text changed since they were written`}
        >
          {track.staleCount}
        </span>
      )}
      {track.untranslatedCount > 0 && (
        <span
          className="rounded px-1 text-2xs tabular-nums"
          style={{ color: 'var(--color-text-3)', background: 'var(--color-surface-3)' }}
          title={`${track.untranslatedCount} captions with no text yet`}
        >
          {track.untranslatedCount}
        </span>
      )}
      {track.reflowNeeded && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: 'var(--color-brand)' }}
          title="The source grouping changed — re-flow this track from the source"
        />
      )}
    </>
  )
}
