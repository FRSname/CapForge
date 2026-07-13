/**
 * Word-level subtitle editor.
 *
 * - Click a word → seek to its start time
 * - Click a timestamp → seek to segment start
 * - Click the pencil icon (hover) on any row → per-segment edit mode
 * - Click outside the card or press Escape → commit and exit
 *
 * Per-word style overrides are authored only in the Groups editor, not here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Segment, Word } from '../../types/app'

interface SubtitleEditorProps {
  segments: Segment[]
  currentTime: number
  onSeek: (time: number) => void
  onChange: (segments: Segment[]) => void
  /** Called before an edit to snapshot state for undo. */
  onBeforeEdit?: () => void
  /** Insert a new manual segment at the current playback position. */
  onAddSegment?: () => void
  /** When set, scroll the segment with this id into view and focus its text. */
  focusSegmentId?: string | null
  /** Called once focus has been applied so the parent can clear the request. */
  onFocusConsumed?: () => void
  /** Re-run forced alignment on one segment (fixes word timings after text edits). */
  onRealign?: (segId: string) => void
  /** Segment id currently re-aligning — disables that row's button. */
  realigningSegId?: string | null
}

interface WordTimingEdit {
  segIdx: number
  wordIdx: number
}

/** Minimum word duration when snapping an edge to the playhead (matches timeline). */
const MIN_WORD_DUR = 0.04

export function SubtitleEditor({
  segments,
  currentTime,
  onSeek,
  onChange,
  onBeforeEdit,
  onAddSegment,
  focusSegmentId,
  onFocusConsumed,
  onRealign,
  realigningSegId,
}: SubtitleEditorProps) {
  const [editingSegId, setEditingSegId] = useState<string | null>(null)
  const [wordTimingEdit, setWordTimingEdit] = useState<WordTimingEdit | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const lowerQuery = searchQuery.toLowerCase().trim()
  const matchCount = lowerQuery
    ? segments.filter((s) => s.text.toLowerCase().includes(lowerQuery)).length
    : segments.length

  // When parent requests focus on a freshly-added segment, enter edit mode for it.
  useEffect(() => {
    if (!focusSegmentId) return
    setEditingSegId(focusSegmentId)
    onFocusConsumed?.()
  }, [focusSegmentId, onFocusConsumed])

  // Clear word timing edit when the editing segment changes.
  const prevEditingRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevEditingRef.current !== editingSegId) {
      prevEditingRef.current = editingSegId
      setWordTimingEdit(null)
    }
  }, [editingSegId])

  const handleAddClick = useCallback(() => {
    onAddSegment?.()
  }, [onAddSegment])

  const activeSegIdx = useMemo(() => {
    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].start && currentTime < segments[i].end) return i
    }
    return -1
  }, [segments, currentTime])

  function handleTimingChange(segIdx: number, field: 'start' | 'end', value: string) {
    const parsed = parseTimePrecise(value)
    if (isNaN(parsed)) return
    onBeforeEdit?.()
    onChange(segments.map((s, i) => (i !== segIdx ? s : { ...s, [field]: parsed })))
  }

  function handleWordTimingChange(
    segIdx: number,
    wordIdx: number,
    field: 'start' | 'end',
    value: string
  ) {
    const parsed = parseTimePrecise(value)
    if (isNaN(parsed)) return
    onBeforeEdit?.()
    onChange(
      segments.map((s, si) =>
        si !== segIdx
          ? s
          : {
              ...s,
              words: s.words.map((w, wi) => (wi !== wordIdx ? w : { ...w, [field]: parsed })),
            }
      )
    )
  }

  // One-click timing: set a word edge to the current playhead position.
  // Clamped to sibling words and to MIN_WORD_DUR so the word can't invert.
  function handleWordSetToPlayhead(segIdx: number, wordIdx: number, field: 'start' | 'end') {
    const seg = segments[segIdx]
    const w = seg?.words[wordIdx]
    if (!w) return
    const prevEnd = wordIdx > 0 ? seg.words[wordIdx - 1].end : 0
    const nextStart = wordIdx < seg.words.length - 1 ? seg.words[wordIdx + 1].start : Infinity
    const t =
      field === 'start'
        ? Math.min(Math.max(currentTime, prevEnd), w.end - MIN_WORD_DUR)
        : Math.max(Math.min(currentTime, nextStart), w.start + MIN_WORD_DUR)
    if (t === w[field]) return
    onBeforeEdit?.()
    onChange(
      segments.map((s, si) =>
        si !== segIdx
          ? s
          : {
              ...s,
              words: s.words.map((word, wi) => (wi !== wordIdx ? word : { ...word, [field]: t })),
            }
      )
    )
  }

  function handleDeleteSegment(segIdx: number) {
    onBeforeEdit?.()
    onChange(segments.filter((_, i) => i !== segIdx))
    setEditingSegId(null)
  }

  function handleMergeSegment(segIdx: number, direction: 'prev' | 'next') {
    const otherIdx = direction === 'prev' ? segIdx - 1 : segIdx + 1
    if (otherIdx < 0 || otherIdx >= segments.length) return
    onBeforeEdit?.()
    const a = direction === 'prev' ? segments[otherIdx] : segments[segIdx]
    const b = direction === 'prev' ? segments[segIdx] : segments[otherIdx]
    const merged: Segment = {
      ...a,
      end: b.end,
      text: [a.text, b.text].filter(Boolean).join(' '),
      words: [...a.words, ...b.words],
    }
    const firstIdx = Math.min(segIdx, otherIdx)
    onChange([...segments.slice(0, firstIdx), merged, ...segments.slice(firstIdx + 2)])
    setEditingSegId(merged.id)
  }

  // Split segment at cursor: textBefore/After are the two halves of the current
  // contentEditable content at the cursor position.
  function handleSplitSegment(segIdx: number, currentText: string, charOffset: number) {
    const textA = currentText.slice(0, charOffset).trim()
    const textB = currentText.slice(charOffset).trim()
    if (!textA || !textB) return

    onBeforeEdit?.()
    const seg = segments[segIdx]
    const allWords = remapWordsFromText(seg, currentText)
    const wordsInA = textA.split(/\s+/).filter(Boolean).length
    const wordsA = allWords.slice(0, wordsInA)
    const wordsB = allWords.slice(wordsInA)
    const splitTime = wordsA.length > 0 ? wordsA[wordsA.length - 1].end : (seg.start + seg.end) / 2

    const segA: Segment = { ...seg, end: splitTime, text: textA, words: wordsA }
    const segB: Segment = {
      id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      start: splitTime,
      end: seg.end,
      text: textB,
      words: wordsB.length > 0 ? wordsB : [{ word: textB, start: splitTime, end: seg.end }],
      speaker: seg.speaker,
    }

    onChange([...segments.slice(0, segIdx), segA, segB, ...segments.slice(segIdx + 1)])
    setEditingSegId(segB.id)
  }

  function handleTextEdit(segIdx: number, newText: string) {
    onBeforeEdit?.()
    const seg = segments[segIdx]
    const words = newText.split(/\s+/).filter(Boolean)
    const newWords = words.map((word, i) => {
      if (i < seg.words.length) return { ...seg.words[i], word }
      const last = seg.words[seg.words.length - 1]
      if (last) return { ...last, word }
      return { word, start: seg.start, end: seg.end }
    })
    onChange(
      segments.map((s, si) => (si !== segIdx ? s : { ...s, text: newText, words: newWords }))
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-subtle)]"
            style={{ color: 'var(--color-text)' }}
          />
          {lowerQuery && (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs tabular-nums pointer-events-none"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              {matchCount}/{segments.length}
            </span>
          )}
        </div>
        {onAddSegment && (
          <button
            className="shrink-0 text-xs px-2.5 py-1 rounded transition-colors border border-[var(--color-border)] hover:bg-white/[0.04] hover:text-[var(--color-text)]"
            style={{ color: 'var(--color-text-muted)' }}
            onClick={handleAddClick}
            title="Insert a new subtitle at the current playback time"
          >
            + Add
          </button>
        )}
      </div>

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {segments.map((seg, si) => {
          if (lowerQuery && !seg.text.toLowerCase().includes(lowerQuery)) return null
          return (
            <SegmentRow
              key={seg.id}
              seg={seg}
              segIdx={si}
              isActive={si === activeSegIdx}
              isEditing={seg.id === editingSegId}
              currentTime={currentTime}
              onSeek={onSeek}
              onTimingChange={handleTimingChange}
              onTextEdit={handleTextEdit}
              wordTimingEdit={wordTimingEdit}
              onWordTimingEditToggle={setWordTimingEdit}
              onWordTimingChange={handleWordTimingChange}
              onWordSetPlayhead={handleWordSetToPlayhead}
              onDelete={handleDeleteSegment}
              onStartEdit={() => setEditingSegId(seg.id)}
              onStopEdit={() => setEditingSegId(null)}
              onFocusNext={
                si < segments.length - 1 ? () => setEditingSegId(segments[si + 1].id) : undefined
              }
              onFocusPrev={si > 0 ? () => setEditingSegId(segments[si - 1].id) : undefined}
              onSplit={handleSplitSegment}
              onMerge={handleMergeSegment}
              onRealign={onRealign}
              isRealigning={seg.id === realigningSegId}
              isFirst={si === 0}
              isLast={si === segments.length - 1}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── SegmentRow ──────────────────────────────────────────────────

interface SegmentRowProps {
  seg: Segment
  segIdx: number
  isActive: boolean
  isEditing: boolean
  currentTime: number
  onSeek: (time: number) => void
  onTimingChange: (si: number, field: 'start' | 'end', value: string) => void
  onTextEdit: (si: number, newText: string) => void
  wordTimingEdit: WordTimingEdit | null
  onWordTimingEditToggle: (edit: WordTimingEdit | null) => void
  onWordTimingChange: (si: number, wi: number, field: 'start' | 'end', value: string) => void
  onWordSetPlayhead: (si: number, wi: number, field: 'start' | 'end') => void
  onDelete: (si: number) => void
  onStartEdit: () => void
  onStopEdit: () => void
  onFocusNext?: () => void
  onFocusPrev?: () => void
  onSplit?: (si: number, currentText: string, charOffset: number) => void
  onMerge?: (si: number, direction: 'prev' | 'next') => void
  onRealign?: (segId: string) => void
  isRealigning: boolean
  isFirst: boolean
  isLast: boolean
}

function SegmentRow({
  seg,
  segIdx,
  isActive,
  isEditing,
  currentTime,
  onSeek,
  onTimingChange,
  onTextEdit,
  wordTimingEdit,
  onWordTimingEditToggle,
  onWordTimingChange,
  onWordSetPlayhead,
  onDelete,
  onStartEdit,
  onStopEdit,
  onFocusNext,
  onFocusPrev,
  onSplit,
  onMerge,
  onRealign,
  isRealigning,
  isFirst,
  isLast,
}: SegmentRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isActive && !isEditing) {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isActive, isEditing])

  const activeWordIdx = useMemo(() => {
    if (!isActive) return -1
    return seg.words.findIndex((w) => currentTime >= w.start && currentTime < w.end)
  }, [isActive, seg.words, currentTime])

  // Focus the contentEditable when entering edit mode.
  // textContent is set imperatively here rather than via dangerouslySetInnerHTML so
  // that React cannot stomp the user's in-progress edits on every re-render (e.g.
  // every currentTime tick while audio is playing).  seg is intentionally absent
  // from deps: we initialise once on entry, never on subsequent renders.
  useEffect(() => {
    if (!isEditing) return
    const id = requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      const el = textRef.current
      if (!el) return
      el.textContent = seg.words.map((w) => w.word).join(' ') || seg.text
      el.focus()
      const range = document.createRange()
      const sel = window.getSelection()
      range.selectNodeContents(el)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    return () => cancelAnimationFrame(id)
  }, [isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Exit edit mode when focus leaves the card entirely.
  // React's onBlur bubbles (unlike native blur), so this fires on any child blur.
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!isEditing) return
    if (!rowRef.current?.contains(e.relatedTarget as Node | null)) {
      onStopEdit()
    }
  }

  // Escape exits edit mode.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && isEditing) {
      ;(document.activeElement as HTMLElement | null)?.blur()
      onStopEdit()
    }
  }

  return (
    <div
      ref={rowRef}
      className={[
        'group rounded-lg border transition-colors p-2.5 text-sm',
        isActive
          ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5'
          : 'border-[var(--color-border)] bg-[var(--color-surface-2)]',
        isEditing ? 'ring-1 ring-[var(--color-accent)]/30' : '',
      ].join(' ')}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {seg.speaker && (
        <span className="text-2xs font-semibold mr-1.5" style={{ color: 'var(--color-accent)' }}>
          [{seg.speaker}]
        </span>
      )}

      <div className="flex items-start gap-2 flex-wrap">
        <button
          className="shrink-0 text-xs tabular-nums hover:text-[var(--color-accent)] transition-colors mt-0.5"
          style={{ color: 'var(--color-text-muted)' }}
          onClick={() => onSeek(seg.start)}
        >
          {formatTime(seg.start)}
        </button>

        {isEditing ? (
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div
              ref={textRef}
              className="text-sm leading-relaxed px-1 py-0.5 rounded border border-transparent focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] min-h-[1.5em]"
              contentEditable
              suppressContentEditableWarning
              spellCheck
              onBlur={(e) => {
                const text = (e.currentTarget.textContent ?? '').trim()
                if (text !== seg.text) onTextEdit(segIdx, text)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  const sel = window.getSelection()
                  const offset = sel?.rangeCount ? sel.getRangeAt(0).startOffset : 0
                  const text = (e.currentTarget as HTMLElement).textContent ?? ''
                  onSplit?.(segIdx, text, offset)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.currentTarget as HTMLElement).blur()
                  if (e.shiftKey) onFocusPrev?.()
                  else onFocusNext?.()
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  rowRef.current?.querySelector<HTMLInputElement>('input')?.focus()
                }
              }}
            />
            {seg.words.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {seg.words.map((w, wi) => {
                  const isEditingThis =
                    wordTimingEdit?.segIdx === segIdx && wordTimingEdit?.wordIdx === wi
                  return (
                    <div key={wi} className="flex flex-col items-center">
                      <button
                        type="button"
                        className={[
                          'text-2xs px-1.5 py-0.5 rounded transition-colors tabular-nums',
                          isEditingThis
                            ? 'bg-[var(--color-accent)]/20 border border-[var(--color-accent)]/40'
                            : 'bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40',
                        ].join(' ')}
                        style={{
                          color: isEditingThis ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        }}
                        onClick={() =>
                          onWordTimingEditToggle(isEditingThis ? null : { segIdx, wordIdx: wi })
                        }
                        title="Edit word timing"
                      >
                        {w.word}
                      </button>
                      {isEditingThis && (
                        <div className="flex items-center gap-1 mt-1">
                          <TimingField
                            label="S"
                            value={w.start}
                            onChange={(v) => onWordTimingChange(segIdx, wi, 'start', v)}
                          />
                          <PlayheadButton
                            title="Set start to playhead"
                            onClick={() => onWordSetPlayhead(segIdx, wi, 'start')}
                          />
                          <TimingField
                            label="E"
                            value={w.end}
                            onChange={(v) => onWordTimingChange(segIdx, wi, 'end', v)}
                          />
                          <PlayheadButton
                            title="Set end to playhead"
                            onClick={() => onWordSetPlayhead(segIdx, wi, 'end')}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-0.5 gap-y-0.5 leading-relaxed flex-1 min-w-0">
            {seg.words.length > 0 ? (
              seg.words.map((w, wi) => (
                <span
                  key={wi}
                  // Keyboard access on the ACTIVE segment's chips only —
                  // tabbing through every word of every segment would bury
                  // the rest of the UI in tab stops. Focus ring comes from
                  // the global :focus-visible style.
                  role={isActive ? 'button' : undefined}
                  tabIndex={isActive ? 0 : undefined}
                  onKeyDown={
                    isActive
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            onSeek(w.start)
                          }
                        }
                      : undefined
                  }
                  className={[
                    'cursor-pointer rounded px-0.5 transition-colors',
                    wi === activeWordIdx ? 'bg-[var(--color-accent)]/20 font-medium' : '',
                    'hover:bg-white/[0.06]',
                  ].join(' ')}
                  style={wi === activeWordIdx ? { color: 'var(--color-accent)' } : undefined}
                  onClick={() => onSeek(w.start)}
                  title={`${formatTimePrecise(w.start)} → ${formatTimePrecise(w.end)}`}
                >
                  {w.word}
                </span>
              ))
            ) : (
              <span style={{ color: 'var(--color-text-muted)' }}>{seg.text}</span>
            )}
          </div>
        )}

        {/* Pencil icon — hover-revealed, only in read mode */}
        {!isEditing && (
          <button
            className="shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity hover:text-[var(--color-accent)] mt-0.5 p-0.5 rounded"
            style={{ color: 'var(--color-text-muted)' }}
            onClick={onStartEdit}
            title="Edit this subtitle"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
            </svg>
          </button>
        )}
      </div>

      {/* Timing + actions (edit mode only) */}
      {isEditing && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--color-border)]">
          <TimingField
            label="Start"
            value={seg.start}
            onChange={(v) => onTimingChange(segIdx, 'start', v)}
          />
          <TimingField
            label="End"
            value={seg.end}
            onChange={(v) => onTimingChange(segIdx, 'end', v)}
          />
          <div className="ml-auto flex items-center gap-1.5">
            {onRealign && seg.text.trim() !== '' && (
              <button
                className="text-xs px-2 py-0.5 rounded border border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
                style={{ color: 'var(--color-accent)' }}
                onClick={() => onRealign(seg.id)}
                disabled={isRealigning}
                title="Re-fit word timings to the audio with forced alignment"
              >
                {isRealigning ? 'Aligning…' : '⟳ Re-align'}
              </button>
            )}
            {!isFirst && (
              <button
                className="text-xs px-2 py-0.5 rounded border border-[var(--color-border)] hover:bg-white/[0.06] hover:text-[var(--color-text)] transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
                onClick={() => onMerge?.(segIdx, 'prev')}
                title="Merge with segment above"
              >
                ↑ Merge
              </button>
            )}
            {!isLast && (
              <button
                className="text-xs px-2 py-0.5 rounded border border-[var(--color-border)] hover:bg-white/[0.06] hover:text-[var(--color-text)] transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
                onClick={() => onMerge?.(segIdx, 'next')}
                title="Merge with segment below"
              >
                ↓ Merge
              </button>
            )}
            <button
              className="text-xs px-2 py-0.5 rounded border border-[var(--color-danger)]/40 hover:bg-[var(--color-danger)]/10 transition-colors"
              style={{ color: 'var(--color-danger)' }}
              onClick={() => onDelete(segIdx)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PlayheadButton ──────────────────────────────────────────────

/** Tiny "grab the playhead time" button rendered beside a TimingField. */
function PlayheadButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="shrink-0 p-0.5 rounded hover:text-[var(--color-accent)] hover:bg-white/[0.06] transition-colors"
      style={{ color: 'var(--color-text-subtle)' }}
      onClick={onClick}
      title={title}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 1h8v4.5L8 9.5 4 5.5Z" />
        <rect x="7.25" y="8.5" width="1.5" height="6.5" rx="0.75" />
      </svg>
    </button>
  )
}

// ── TimingField ─────────────────────────────────────────────────

function TimingField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: string) => void
}) {
  const [raw, setRaw] = useState(formatTimePrecise(value))
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync from props when the value changes externally (e.g. playhead-set button),
  // but never while the user is typing in this field.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setRaw(formatTimePrecise(value))
      setInvalid(false)
    }
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setRaw(v)
    const parsed = parseTimePrecise(v)
    setInvalid(isNaN(parsed))
    if (!isNaN(parsed)) onChange(v)
  }

  return (
    <div className="flex items-center gap-1.5">
      <label
        className="text-2xs uppercase tracking-wider"
        style={{ color: 'var(--color-text-subtle)' }}
      >
        {label}
      </label>
      <input
        ref={inputRef}
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
  const m = Math.floor(s / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return `${m}:${sec}`
}

function formatTimePrecise(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(3).padStart(6, '0')
  return `${m}:${sec}`
}

function remapWordsFromText(seg: Segment, text: string): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i < seg.words.length) return { ...seg.words[i], word }
      const last = seg.words[seg.words.length - 1]
      if (last) return { ...last, word }
      return { word, start: seg.start, end: seg.end }
    })
}

function parseTimePrecise(str: string): number {
  const s = str.trim()
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s)
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2])
  return NaN
}
