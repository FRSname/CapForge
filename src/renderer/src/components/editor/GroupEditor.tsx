/**
 * Group editor — per-group list with merge/split/drag-to-reorder controls.
 * Ports renderGroupEditor() from app.js:2497-2616.
 *
 * Each row shows: #index, time range (click-to-seek), draggable word chips
 * with ✂ split handles between them, and a ✂ Split-in-half action. Between
 * rows, a merge button joins neighbouring groups.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Segment, WordOverrides } from '../../types/app'
import { mergeGroups, splitGroup, moveWord } from '../../lib/groups'
import { WordStylePopup, type WordStyleDefaults } from './WordStylePopup'

interface GroupEditorProps {
  groups:      Segment[]
  currentTime: number
  onSeek:      (t: number) => void
  onChange:    (groups: Segment[]) => void
  /** Called before an edit to snapshot state for undo. */
  onBeforeEdit?: () => void
  /** Global style defaults — popup uses these to compute "hasOverride". */
  defaults:    WordStyleDefaults
}

interface DragSource {
  groupIdx: number
  wordIdx:  number
}

interface PopupState {
  groupIdx:   number
  wordIdx:    number
  anchorRect: DOMRect
}

export function GroupEditor({ groups, currentTime, onSeek, onChange, onBeforeEdit, defaults }: GroupEditorProps) {
  const [drag, setDrag]         = useState<DragSource | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [popup, setPopup]       = useState<PopupState | null>(null)

  // ── Actions ──────────────────────────────────────────────────
  const handleMerge = useCallback((i: number) => {
    onBeforeEdit?.()
    onChange(mergeGroups(groups, i))
  }, [groups, onChange, onBeforeEdit])

  const handleSplit = useCallback((gi: number, wi: number) => {
    onBeforeEdit?.()
    onChange(splitGroup(groups, gi, wi))
  }, [groups, onChange, onBeforeEdit])

  const handleSplitHalf = useCallback((gi: number) => {
    const g = groups[gi]
    if (!g) return
    onBeforeEdit?.()
    const mid = Math.ceil(g.words.length / 2)
    onChange(splitGroup(groups, gi, mid))
  }, [groups, onChange, onBeforeEdit])

  const handleDrop = useCallback((destIdx: number) => {
    if (!drag) return
    if (destIdx === drag.groupIdx) return
    onBeforeEdit?.()
    onChange(moveWord(groups, drag.groupIdx, drag.wordIdx, destIdx))
    setDrag(null)
    setHoverIdx(null)
  }, [drag, groups, onChange, onBeforeEdit])

  // ── Word-style overrides ──────────────────────────────────────
  const handleWordContextMenu = useCallback((e: React.MouseEvent, gi: number, wi: number) => {
    e.preventDefault()
    setPopup({
      groupIdx: gi,
      wordIdx:  wi,
      anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
    })
  }, [])

  const applyWordOverride = useCallback((gi: number, wi: number, overrides: WordOverrides) => {
    onBeforeEdit?.()
    const next = groups.map((g, idx) =>
      idx !== gi ? g : {
        ...g,
        words: g.words.map((w, j) =>
          j !== wi ? w : { ...w, overrides: Object.keys(overrides).length ? overrides : undefined }
        ),
      }
    )
    onChange(next)
  }, [groups, onChange, onBeforeEdit])

  const resetWordOverride = useCallback((gi: number, wi: number) => {
    applyWordOverride(gi, wi, {})
  }, [applyWordOverride])

  const activePopupWord = popup ? groups[popup.groupIdx]?.words[popup.wordIdx] : null

  // ── Active-group highlight (matches vanilla highlightActiveGroup) ─
  const activeIdx = groups.findIndex(g => g.start <= currentTime && currentTime < g.end)

  // Row refs for auto-scroll.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  // Auto-scroll to keep active group visible during playback / scrubbing.
  useEffect(() => {
    if (activeIdx >= 0) {
      rowRefs.current[activeIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeIdx])

  // Which word within the active group is currently playing.
  const activeWordIdx = useMemo(() => {
    if (activeIdx < 0) return -1
    const g = groups[activeIdx]
    return g.words.findIndex(w => currentTime >= w.start && currentTime < w.end)
  }, [activeIdx, groups, currentTime])

  if (groups.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-text-3)]">
        No subtitle groups yet.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
      {groups.map((group, gi) => (
        <div key={group.id}>
          {/* Merge-with-above button — appears between rows */}
          {gi > 0 && (
            <div className="flex justify-center mb-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded text-[var(--color-text-3)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] transition-colors"
                onClick={() => handleMerge(gi - 1)}
                title="Merge with group above"
              >
                ⬆ merge ⬇
              </button>
            </div>
          )}

          {/* Row */}
          <div
            ref={el => { rowRefs.current[gi] = el }}
            className={`flex items-start gap-2 p-2 rounded border transition-colors ${
              activeIdx === gi
                ? 'border-[var(--color-accent)] bg-[var(--color-surface-3)]/50'
                : 'border-[var(--color-border)] bg-[var(--color-surface-2)]'
            } ${hoverIdx === gi ? 'ring-2 ring-[var(--color-accent)]' : ''}`}
            onDragOver={e => {
              if (drag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHoverIdx(gi) }
            }}
            onDragLeave={() => { if (hoverIdx === gi) setHoverIdx(null) }}
            onDrop={e => { e.preventDefault(); handleDrop(gi) }}
          >
            {/* Index */}
            <span className="text-[10px] shrink-0 w-6 text-[var(--color-text-3)] tabular-nums pt-0.5">
              #{gi + 1}
            </span>

            {/* Time (click = seek) */}
            <button
              className="text-[10px] shrink-0 tabular-nums text-[var(--color-text-2)] hover:text-[var(--color-accent)] transition-colors pt-0.5 font-mono"
              onClick={() => onSeek(group.start)}
              title="Seek to group start"
            >
              {formatTime(group.start)}→{formatTime(group.end)}
            </button>

            {/* Words */}
            <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
              {group.words.map((w, wi) => (
                <span key={`${group.id}-${wi}`} className="inline-flex items-center">
                  {wi > 0 && (
                    <button
                      className="text-[10px] px-1 text-[var(--color-text-3)] hover:text-[var(--color-accent)] opacity-40 hover:opacity-100"
                      onClick={() => handleSplit(gi, wi)}
                      title="Split group here"
                    >
                      ✂
                    </button>
                  )}
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-xs cursor-grab select-none transition-colors ${
                      drag?.groupIdx === gi && drag?.wordIdx === wi
                        ? 'opacity-40 bg-[var(--color-surface-3)]'
                        : gi === activeIdx && wi === activeWordIdx
                        ? 'bg-[var(--color-accent)]/25 text-[var(--color-accent)] font-medium'
                        : 'bg-[var(--color-surface-3)] hover:bg-[var(--color-accent)]/20'
                    } ${w.overrides ? 'ring-1 ring-[var(--color-accent)]/40' : ''}`}
                    draggable
                    onDragStart={() => setDrag({ groupIdx: gi, wordIdx: wi })}
                    onDragEnd={() => { setDrag(null); setHoverIdx(null) }}
                    onContextMenu={e => handleWordContextMenu(e, gi, wi)}
                    title="Right-click to style this word"
                    style={w.overrides?.text_color ? { color: w.overrides.text_color } : undefined}
                  >
                    {w.word}
                  </span>
                </span>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center shrink-0">
              {group.words.length > 1 && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded text-[var(--color-text-3)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] transition-colors"
                  onClick={() => handleSplitHalf(gi)}
                  title="Split in half"
                >
                  ✂ Split
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {popup && activePopupWord && (
        <WordStylePopup
          word={activePopupWord.word}
          overrides={activePopupWord.overrides ?? {}}
          anchorRect={popup.anchorRect}
          defaults={defaults}
          onApply={ov => applyWordOverride(popup.groupIdx, popup.wordIdx, ov)}
          onReset={() => resetWordOverride(popup.groupIdx, popup.wordIdx)}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}

function formatTime(s: number): string {
  const m   = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}
