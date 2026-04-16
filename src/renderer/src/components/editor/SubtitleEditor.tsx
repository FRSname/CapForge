/**
 * Word-level subtitle editor.
 * Ports the segment list rendering + word click/contextmenu logic from app.js.
 *
 * - Click a word → seek to its start time
 * - Click a timestamp → seek to segment start
 * - Right-click a word → open WordStylePopup for per-word style overrides
 * - In edit mode: timing inputs appear for each segment
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { Segment, Word } from '../../types/app'
import { WordStylePopup, type WordOverrides } from './WordStylePopup'

interface SubtitleEditorProps {
  segments: Segment[]
  currentTime: number
  onSeek:   (time: number) => void
  onChange: (segments: Segment[]) => void
}

interface PopupState {
  segIdx:   number
  wordIdx:  number
  anchorRect: DOMRect
}

export function SubtitleEditor({ segments, currentTime, onSeek, onChange }: SubtitleEditorProps) {
  const [editMode,  setEditMode]  = useState(false)
  const [popup,     setPopup]     = useState<PopupState | null>(null)
  const [hasEdits,  setHasEdits]  = useState(false)

  // Active segment index (for highlight)
  const activeSegIdx = useMemo(() => {
    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].start && currentTime < segments[i].end) return i
    }
    return -1
  }, [segments, currentTime])

  // ── Word click → seek ─────────────────────────────────────────
  function handleWordClick(word: Word) {
    if (!editMode) onSeek(word.start)
  }

  // ── Right-click → word style popup ───────────────────────────
  function handleWordContextMenu(e: React.MouseEvent, segIdx: number, wordIdx: number) {
    e.preventDefault()
    setPopup({ segIdx, wordIdx, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
  }

  // ── Apply / reset word overrides ─────────────────────────────
  function applyWordOverride(segIdx: number, wordIdx: number, overrides: WordOverrides) {
    const next = segments.map((s, si) =>
      si !== segIdx ? s : {
        ...s,
        words: s.words.map((w, wi) =>
          wi !== wordIdx ? w : { ...w, overrides }
        ),
      }
    )
    onChange(next)
    setHasEdits(true)
  }

  function resetWordOverride(segIdx: number, wordIdx: number) {
    applyWordOverride(segIdx, wordIdx, {})
  }

  // ── Timing inputs (edit mode) ─────────────────────────────────
  function handleTimingChange(segIdx: number, field: 'start' | 'end', value: string) {
    const parsed = parseTimePrecise(value)
    if (isNaN(parsed)) return
    const next = segments.map((s, i) =>
      i !== segIdx ? s : { ...s, [field]: parsed }
    )
    onChange(next)
    setHasEdits(true)
  }

  const activePopupSeg  = popup ? segments[popup.segIdx]  : null
  const activePopupWord = popup ? segments[popup.segIdx]?.words[popup.wordIdx] : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <button
          className={[
            'text-xs px-2.5 py-1 rounded transition-colors',
            editMode
              ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/40'
              : 'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/[0.04]',
          ].join(' ')}
          onClick={() => setEditMode(m => !m)}
        >
          {editMode ? '✏ Edit mode ON' : 'Edit mode'}
        </button>
        {hasEdits && editMode && (
          <span className="text-xs text-[var(--color-warning)]">Unsaved changes</span>
        )}
      </div>

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {segments.map((seg, si) => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            segIdx={si}
            isActive={si === activeSegIdx}
            editMode={editMode}
            onSeek={onSeek}
            onWordClick={handleWordClick}
            onWordContextMenu={handleWordContextMenu}
            onTimingChange={handleTimingChange}
          />
        ))}
      </div>

      {/* Word style popup */}
      {popup && activePopupWord && (
        <WordStylePopup
          word={activePopupWord.word}
          overrides={(activePopupWord as { overrides?: WordOverrides }).overrides ?? {}}
          anchorRect={popup.anchorRect}
          defaultTextColor="#ffffff"
          defaultOutlineColor="#000000"
          defaultBgColor="#D4952A"
          onApply={ov => applyWordOverride(popup.segIdx, popup.wordIdx, ov)}
          onReset={() => resetWordOverride(popup.segIdx, popup.wordIdx)}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}

// ── SegmentRow ──────────────────────────────────────────────────

interface SegmentRowProps {
  seg:       Segment
  segIdx:    number
  isActive:  boolean
  editMode:  boolean
  onSeek:    (time: number) => void
  onWordClick: (word: Word) => void
  onWordContextMenu: (e: React.MouseEvent, si: number, wi: number) => void
  onTimingChange: (si: number, field: 'start' | 'end', value: string) => void
}

function SegmentRow({ seg, segIdx, isActive, editMode, onSeek, onWordClick, onWordContextMenu, onTimingChange }: SegmentRowProps) {
  return (
    <div
      className={[
        'rounded-lg border transition-colors p-2.5 text-sm',
        isActive
          ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5'
          : 'border-[var(--color-border)] bg-[var(--color-surface-2)]',
      ].join(' ')}
    >
      {/* Speaker label */}
      {seg.speaker && (
        <span className="text-[10px] text-[var(--color-accent)] font-semibold mr-1.5">
          [{seg.speaker}]
        </span>
      )}

      {/* Timestamp + words */}
      <div className="flex items-start gap-2 flex-wrap">
        <button
          className="shrink-0 text-xs text-[var(--color-text-muted)] tabular-nums hover:text-[var(--color-accent)] transition-colors mt-0.5"
          onClick={() => onSeek(seg.start)}
          title={editMode ? 'Loop segment' : 'Seek to segment'}
        >
          {formatTime(seg.start)}
        </button>

        {/* Word chips */}
        <div className="flex flex-wrap gap-x-0.5 gap-y-0.5 leading-relaxed">
          {seg.words.length > 0
            ? seg.words.map((w, wi) => {
                const ov = (w as { overrides?: WordOverrides }).overrides
                return (
                  <span
                    key={wi}
                    className={[
                      'cursor-pointer rounded px-0.5 transition-colors',
                      ov ? 'text-[var(--color-accent)] underline decoration-dotted' : '',
                      'hover:bg-white/[0.06]',
                    ].join(' ')}
                    style={ov?.text_color ? { color: ov.text_color } : undefined}
                    onClick={() => onWordClick(w)}
                    onContextMenu={e => onWordContextMenu(e, segIdx, wi)}
                    title={`${formatTimePrecise(w.start)} → ${formatTimePrecise(w.end)}`}
                  >
                    {w.word}
                  </span>
                )
              })
            : <span className="text-[var(--color-text-muted)]">{seg.text}</span>
          }
        </div>
      </div>

      {/* Timing editor (edit mode only) */}
      {editMode && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--color-border)]">
          <TimingField
            label="Start"
            value={seg.start}
            onChange={v => onTimingChange(segIdx, 'start', v)}
          />
          <TimingField
            label="End"
            value={seg.end}
            onChange={v => onTimingChange(segIdx, 'end', v)}
          />
        </div>
      )}
    </div>
  )
}

// ── TimingField ─────────────────────────────────────────────────

function TimingField({ label, value, onChange }: {
  label: string
  value: number
  onChange: (v: string) => void
}) {
  const [raw, setRaw] = useState(formatTimePrecise(value))
  const [invalid, setInvalid] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setRaw(v)
    const parsed = parseTimePrecise(v)
    setInvalid(isNaN(parsed))
    if (!isNaN(parsed)) onChange(v)
  }

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[10px] text-[var(--color-text-subtle)] uppercase tracking-wider">{label}</label>
      <input
        type="text"
        value={raw}
        onChange={handleChange}
        onFocus={() => setRaw(formatTimePrecise(value))}
        className={[
          'w-20 text-xs tabular-nums px-1.5 py-0.5 rounded border bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]',
          invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]',
        ].join(' ')}
      />
    </div>
  )
}

// ── Time formatting ─────────────────────────────────────────────

function formatTime(s: number): string {
  const m   = Math.floor(s / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return `${m}:${sec}`
}

function formatTimePrecise(s: number): string {
  const m   = Math.floor(s / 60)
  const sec = (s % 60).toFixed(3).padStart(6, '0')
  return `${m}:${sec}`
}

function parseTimePrecise(str: string): number {
  const m = str.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (!m) return NaN
  return parseInt(m[1], 10) * 60 + parseFloat(m[2])
}
