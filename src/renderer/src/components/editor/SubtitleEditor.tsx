/**
 * Word-level subtitle editor.
 *
 * - Click a word → seek to its start time
 * - Click a timestamp → seek to segment start
 * - Right-click a word → open WordStylePopup for per-word style overrides
 * - Click the pencil icon (hover) on any row → per-segment edit mode
 * - Click outside the card or press Escape → commit and exit
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Segment, Word, WordOverrides } from '../../types/app'
import { WordStylePopup, type WordStyleDefaults } from './WordStylePopup'

interface SubtitleEditorProps {
  segments: Segment[]
  currentTime: number
  onSeek:   (time: number) => void
  onChange: (segments: Segment[]) => void
  /** Called before an edit to snapshot state for undo. */
  onBeforeEdit?: () => void
  /** Global style defaults — popup uses these to compute "hasOverride". */
  defaults: WordStyleDefaults
  /** Insert a new manual segment at the current playback position. */
  onAddSegment?: () => void
  /** When set, scroll the segment with this id into view and focus its text. */
  focusSegmentId?: string | null
  /** Called once focus has been applied so the parent can clear the request. */
  onFocusConsumed?: () => void
}

interface PopupState {
  segIdx:   number
  wordIdx:  number
  anchorRect: DOMRect
}

interface WordTimingEdit {
  segIdx:  number
  wordIdx: number
}

export function SubtitleEditor({ segments, currentTime, onSeek, onChange, onBeforeEdit, defaults, onAddSegment, focusSegmentId, onFocusConsumed }: SubtitleEditorProps) {
  const [editingSegId, setEditingSegId] = useState<string | null>(null)
  const [popup,        setPopup]        = useState<PopupState | null>(null)
  const [wordTimingEdit, setWordTimingEdit] = useState<WordTimingEdit | null>(null)
  const [searchQuery, setSearchQuery]   = useState('')

  const lowerQuery = searchQuery.toLowerCase().trim()
  const matchCount = lowerQuery ? segments.filter(s => s.text.toLowerCase().includes(lowerQuery)).length : segments.length

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

  function handleWordContextMenu(e: React.MouseEvent, segIdx: number, wordIdx: number) {
    e.preventDefault()
    setPopup({ segIdx, wordIdx, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
  }

  function applyWordOverride(segIdx: number, wordIdx: number, overrides: WordOverrides) {
    onBeforeEdit?.()
    onChange(segments.map((s, si) =>
      si !== segIdx ? s : {
        ...s,
        words: s.words.map((w, wi) => wi !== wordIdx ? w : { ...w, overrides }),
      }
    ))
  }

  function handleTimingChange(segIdx: number, field: 'start' | 'end', value: string) {
    const parsed = parseTimePrecise(value)
    if (isNaN(parsed)) return
    onBeforeEdit?.()
    onChange(segments.map((s, i) => i !== segIdx ? s : { ...s, [field]: parsed }))
  }

  function handleWordTimingChange(segIdx: number, wordIdx: number, field: 'start' | 'end', value: string) {
    const parsed = parseTimePrecise(value)
    if (isNaN(parsed)) return
    onBeforeEdit?.()
    onChange(segments.map((s, si) =>
      si !== segIdx ? s : {
        ...s,
        words: s.words.map((w, wi) => wi !== wordIdx ? w : { ...w, [field]: parsed }),
      }
    ))
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
    const b = direction === 'prev' ? segments[segIdx]  : segments[otherIdx]
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
    onChange(segments.map((s, si) => si !== segIdx ? s : { ...s, text: newText, words: newWords }))
  }

  const activePopupWord = popup ? segments[popup.segIdx]?.words[popup.wordIdx] : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full text-xs px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
          />
          {lowerQuery && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-text-subtle)] tabular-nums pointer-events-none">
              {matchCount}/{segments.length}
            </span>
          )}
        </div>
        {onAddSegment && (
          <button
            className="shrink-0 text-xs px-2.5 py-1 rounded transition-colors border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/[0.04] hover:text-[var(--color-text)]"
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
            onWordContextMenu={handleWordContextMenu}
            onTimingChange={handleTimingChange}
            onTextEdit={handleTextEdit}
            wordTimingEdit={wordTimingEdit}
            onWordTimingEditToggle={setWordTimingEdit}
            onWordTimingChange={handleWordTimingChange}
            onDelete={handleDeleteSegment}
            onStartEdit={() => setEditingSegId(seg.id)}
            onStopEdit={() => setEditingSegId(null)}
            onFocusNext={si < segments.length - 1 ? () => setEditingSegId(segments[si + 1].id) : undefined}
            onFocusPrev={si > 0 ? () => setEditingSegId(segments[si - 1].id) : undefined}
            onSplit={handleSplitSegment}
            onMerge={handleMergeSegment}
            isFirst={si === 0}
            isLast={si === segments.length - 1}
          />
          )
        })}
      </div>

      {/* Word style popup */}
      {popup && activePopupWord && (
        <WordStylePopup
          word={activePopupWord.word}
          overrides={activePopupWord.overrides ?? {}}
          anchorRect={popup.anchorRect}
          defaults={defaults}
          onApply={ov => applyWordOverride(popup.segIdx, popup.wordIdx, ov)}
          onReset={() => applyWordOverride(popup.segIdx, popup.wordIdx, {})}
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
  isEditing: boolean
  currentTime: number
  onSeek:    (time: number) => void
  onWordContextMenu: (e: React.MouseEvent, si: number, wi: number) => void
  onTimingChange: (si: number, field: 'start' | 'end', value: string) => void
  onTextEdit: (si: number, newText: string) => void
  wordTimingEdit: WordTimingEdit | null
  onWordTimingEditToggle: (edit: WordTimingEdit | null) => void
  onWordTimingChange: (si: number, wi: number, field: 'start' | 'end', value: string) => void
  onDelete: (si: number) => void
  onStartEdit: () => void
  onStopEdit: () => void
  onFocusNext?: () => void
  onFocusPrev?: () => void
  onSplit?: (si: number, currentText: string, charOffset: number) => void
  onMerge?: (si: number, direction: 'prev' | 'next') => void
  isFirst: boolean
  isLast: boolean
}

function SegmentRow({ seg, segIdx, isActive, isEditing, currentTime, onSeek, onWordContextMenu, onTimingChange, onTextEdit, wordTimingEdit, onWordTimingEditToggle, onWordTimingChange, onDelete, onStartEdit, onStopEdit, onFocusNext, onFocusPrev, onSplit, onMerge, isFirst, isLast }: SegmentRowProps) {
  const rowRef  = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isActive && !isEditing) {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isActive, isEditing])

  const activeWordIdx = useMemo(() => {
    if (!isActive) return -1
    return seg.words.findIndex(w => currentTime >= w.start && currentTime < w.end)
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
      el.textContent = seg.words.map(w => w.word).join(' ') || seg.text
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
        <span className="text-[10px] text-[var(--color-accent)] font-semibold mr-1.5">
          [{seg.speaker}]
        </span>
      )}

      <div className="flex items-start gap-2 flex-wrap">
        <button
          className="shrink-0 text-xs text-[var(--color-text-muted)] tabular-nums hover:text-[var(--color-accent)] transition-colors mt-0.5"
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
              onBlur={e => {
                const text = (e.currentTarget.textContent ?? '').trim()
                if (text !== seg.text) onTextEdit(segIdx, text)
              }}
              onKeyDown={e => {
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
                  const isEditingThis = wordTimingEdit?.segIdx === segIdx && wordTimingEdit?.wordIdx === wi
                  return (
                    <div key={wi} className="flex flex-col items-center">
                      <button
                        type="button"
                        className={[
                          'text-[10px] px-1.5 py-0.5 rounded transition-colors tabular-nums',
                          isEditingThis
                            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/40'
                            : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40',
                        ].join(' ')}
                        onClick={() => onWordTimingEditToggle(isEditingThis ? null : { segIdx, wordIdx: wi })}
                        title="Edit word timing"
                      >
                        {w.word}
                      </button>
                      {isEditingThis && (
                        <div className="flex items-center gap-1 mt-1">
                          <TimingField label="S" value={w.start} onChange={v => onWordTimingChange(segIdx, wi, 'start', v)} />
                          <TimingField label="E" value={w.end}   onChange={v => onWordTimingChange(segIdx, wi, 'end', v)} />
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
            {seg.words.length > 0
              ? seg.words.map((w, wi) => {
                  const ov = w.overrides
                  return (
                    <span
                      key={wi}
                      className={[
                        'cursor-pointer rounded px-0.5 transition-colors',
                        wi === activeWordIdx
                          ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] font-medium'
                          : ov ? 'text-[var(--color-accent)] underline decoration-dotted' : '',
                        'hover:bg-white/[0.06]',
                      ].join(' ')}
                      style={ov?.text_color ? { color: ov.text_color } : undefined}
                      onClick={() => onSeek(w.start)}
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
        )}

        {/* Pencil icon — hover-revealed, only in read mode */}
        {!isEditing && (
          <button
            className="shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-[var(--color-text-muted)] hover:text-[var(--color-accent)] mt-0.5 p-0.5 rounded"
            onClick={onStartEdit}
            title="Edit this subtitle"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Timing + actions (edit mode only) */}
      {isEditing && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--color-border)]">
          <TimingField label="Start" value={seg.start} onChange={v => onTimingChange(segIdx, 'start', v)} />
          <TimingField label="End"   value={seg.end}   onChange={v => onTimingChange(segIdx, 'end', v)} />
          <div className="ml-auto flex items-center gap-1.5">
            {!isFirst && (
              <button
                className="text-xs px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-text)] transition-colors"
                onClick={() => onMerge?.(segIdx, 'prev')}
                title="Merge with segment above"
              >
                ↑ Merge
              </button>
            )}
            {!isLast && (
              <button
                className="text-xs px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-text)] transition-colors"
                onClick={() => onMerge?.(segIdx, 'next')}
                title="Merge with segment below"
              >
                ↓ Merge
              </button>
            )}
            <button
              className="text-xs px-2 py-0.5 rounded border border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
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

function remapWordsFromText(seg: Segment, text: string): Word[] {
  return text.split(/\s+/).filter(Boolean).map((word, i) => {
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
