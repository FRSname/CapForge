/**
 * Group editor — per-group list with merge/split/drag controls.
 *
 * Keyboard shortcuts (when editor is focused):
 *   ArrowUp / ArrowDown  — move keyboard focus between groups
 *   M                    — merge focused group with the one below
 *   Enter                — split focused group in half
 *   Escape               — clear keyboard focus
 *
 * Drag interactions:
 *   Word chip drag       — move a single word to another group
 *   #N label drag        — reorder the entire group
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GroupPositionOverride, Segment, WordOverrides } from '../../types/app'
import { mergeGroups, splitGroup, moveWord, reorderGroup } from '../../lib/groups'
import { WordStylePopup, type WordStyleDefaults } from './WordStylePopup'
import { GroupPositionPopup, type GroupPositionDefaults } from './GroupPositionPopup'
import { useToast } from '../../hooks/useToast'

interface GroupEditorProps {
  groups: Segment[]
  currentTime: number
  onSeek: (t: number) => void
  onChange: (groups: Segment[]) => void
  /**
   * Position-only group updates. Separate from onChange because a position
   * override doesn't change group boundaries and must NOT flip groupsEdited.
   */
  onPositionChange: (groups: Segment[]) => void
  /** Called before an edit to snapshot state for undo. */
  onBeforeEdit?: () => void
  /** Global style defaults — popup uses these to compute "hasOverride". */
  defaults: WordStyleDefaults
  /** Global caption position (percent) — seeds the group position popup. */
  positionDefaults: GroupPositionDefaults
  /** Source media duration (seconds) — upper bound when extending the last
   *  group's end (which has no "next group" to clamp against). */
  mediaDuration?: number
}

type DragSource =
  | { type: 'word'; groupIdx: number; wordIdx: number }
  | { type: 'group'; groupIdx: number }

interface PopupState {
  groupIdx: number
  wordIdx: number
  anchorRect: DOMRect
}

export function GroupEditor({
  groups,
  currentTime,
  onSeek,
  onChange,
  onPositionChange,
  onBeforeEdit,
  defaults,
  positionDefaults,
  mediaDuration,
}: GroupEditorProps) {
  const { toast } = useToast()

  const [drag, setDrag] = useState<DragSource | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [posPopup, setPosPopup] = useState<{ groupIdx: number; anchorRect: DOMRect } | null>(null)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)

  // Speaker inline-edit state
  const [editingSpeakerIdx, setEditingSpeakerIdx] = useState<number | null>(null)
  const [speakerDraft, setSpeakerDraft] = useState('')

  // Per-group end-time inline-edit state. Editing a group's end shortens the
  // caption (creating a deliberate gap) or extends it up to the next group.
  const [editingEndIdx, setEditingEndIdx] = useState<number | null>(null)
  const [endDraft, setEndDraft] = useState('')
  // The string the field was seeded with when it opened. Used to tell "the user
  // typed something" from "the user opened the field and clicked away" — see
  // commitEndEdit, which must not turn an inspect-only click into a timing claim.
  const endSeedRef = useRef('')
  // Set by Escape so the blur that may follow the input's removal is swallowed
  // instead of committing the abandoned draft.
  const endCancelledRef = useRef(false)

  // ── Actions ──────────────────────────────────────────────────
  const handleMerge = useCallback(
    (i: number) => {
      onBeforeEdit?.()
      onChange(mergeGroups(groups, i))
    },
    [groups, onChange, onBeforeEdit]
  )

  const handleSplit = useCallback(
    (gi: number, wi: number) => {
      onBeforeEdit?.()
      onChange(splitGroup(groups, gi, wi))
    },
    [groups, onChange, onBeforeEdit]
  )

  const handleSplitHalf = useCallback(
    (gi: number) => {
      const g = groups[gi]
      if (!g) return
      if (g.words.length <= 1) {
        toast('Need at least 2 words to split', 'error')
        return
      }
      onBeforeEdit?.()
      const mid = Math.ceil(g.words.length / 2)
      onChange(splitGroup(groups, gi, mid))
    },
    [groups, onChange, onBeforeEdit, toast]
  )

  const handleDrop = useCallback(
    (destIdx: number) => {
      if (!drag) return
      setDrag(null)
      setHoverIdx(null)

      if (drag.type === 'group') {
        const from = drag.groupIdx
        if (destIdx !== from && destIdx !== from + 1) {
          onBeforeEdit?.()
          onChange(reorderGroup(groups, from, destIdx))
        }
        return
      }

      if (destIdx === drag.groupIdx) return
      onBeforeEdit?.()
      onChange(moveWord(groups, drag.groupIdx, drag.wordIdx, destIdx))
    },
    [drag, groups, onChange, onBeforeEdit]
  )

  // ── Speaker editing ──────────────────────────────────────────
  const startSpeakerEdit = useCallback(
    (gi: number) => {
      setEditingSpeakerIdx(gi)
      setSpeakerDraft(groups[gi]?.speaker ?? '')
    },
    [groups]
  )

  const commitSpeakerEdit = useCallback(
    (gi: number) => {
      const trimmed = speakerDraft.trim() || undefined
      onBeforeEdit?.()
      onChange(groups.map((g, i) => (i !== gi ? g : { ...g, speaker: trimmed })))
      setEditingSpeakerIdx(null)
    },
    [groups, speakerDraft, onChange, onBeforeEdit]
  )

  // ── End-time editing ──────────────────────────────────────────
  // Natural end = the group's last word's end (the shortest sensible end, where
  // the caption disappears right after the last word). The editable range is
  // [naturalEnd, nextGroup.start] — pull to the min for a maximal gap, push to
  // the max to hold the caption until the next group. The last group has no
  // next start, so it can extend up to the media duration.
  const naturalEnd = useCallback(
    (g: Segment) => (g.words.length ? Math.max(...g.words.map((w) => w.end)) : g.end),
    []
  )

  const startEndEdit = useCallback(
    (gi: number) => {
      const seed = formatTime(groups[gi]?.end ?? 0)
      setEditingEndIdx(gi)
      setEndDraft(seed)
      endSeedRef.current = seed
      endCancelledRef.current = false
    },
    [groups]
  )

  // Escape = cancel. The flag (rather than just closing the field) is what makes
  // it a real cancel: browsers may fire blur when the focused input is removed,
  // and that blur would otherwise commit the draft the user just abandoned.
  const cancelEndEdit = useCallback(() => {
    endCancelledRef.current = true
    setEditingEndIdx(null)
  }, [])

  // Committing an end here *places* it, so the group is marked `endEdited` and
  // the automatic gap-closing pass leaves it alone from then on (lib/groups.ts
  // `closeGroupGaps`) — that is what makes a deliberately shortened end, i.e. a
  // carved-out gap, survive. `resetEndEdit` below is the way back out.
  //
  // Which interactions count as a claim, and why:
  //   - typed a different value, then Enter *or* blur → a claim (the value moved)
  //   - left the seeded value untouched and pressed Enter → a claim. This is the
  //     only way to claim an end that already *is* the natural end, which is how
  //     a user turns the final-group hold off ("stop right here"): there
  //     `min === naturalEnd(g) === g.end`, so whatever is typed clamps straight
  //     back to `g.end` and no value comparison could ever detect the intent.
  //   - left the seeded value untouched and blurred → NOT a claim. Clicking a
  //     group's end time and then clicking elsewhere is an inspect-only gesture;
  //     treating it as a claim would push an undo entry, flip `groupsEdited`, and
  //     silently exempt the group from gap closing until the user found the `↺`.
  const commitEndEdit = useCallback(
    (gi: number, confirmed: boolean) => {
      setEditingEndIdx(null)
      if (endCancelledRef.current) {
        endCancelledRef.current = false
        return
      }
      const parsed = parseTime(endDraft)
      const g = groups[gi]
      if (parsed == null || !g) return
      if (!confirmed && endDraft === endSeedRef.current) return // inspect-only blur
      const min = naturalEnd(g)
      const max = groups[gi + 1] ? groups[gi + 1].start : (mediaDuration ?? g.end)
      if (max <= min) return // degenerate (overlap) — leave the end untouched
      const end = Math.min(max, Math.max(min, parsed))
      // Nothing left to record: the end is unchanged *and* the claim is already
      // on the group.
      if (end === g.end && g.endEdited) return
      onBeforeEdit?.()
      onChange(groups.map((x, i) => (i === gi ? { ...x, end, endEdited: true } : x)))
    },
    [groups, endDraft, naturalEnd, mediaDuration, onChange, onBeforeEdit]
  )

  // Undo the "I placed this end by hand" claim: drop the flag and put the end
  // back on the group's last word, so automatic gap closing and the final-group
  // hold apply again. Without this an accidental two-pixel timeline drag would
  // exempt a group forever.
  const resetEndEdit = useCallback(
    (gi: number) => {
      const g = groups[gi]
      if (!g) return
      onBeforeEdit?.()
      onChange(
        groups.map((x, i) => {
          if (i !== gi) return x
          const { endEdited: _cleared, ...rest } = x
          return { ...rest, end: naturalEnd(x) }
        })
      )
    },
    [groups, naturalEnd, onChange, onBeforeEdit]
  )

  // ── Word-style overrides ──────────────────────────────────────
  const handleWordContextMenu = useCallback((e: React.MouseEvent, gi: number, wi: number) => {
    e.preventDefault()
    setPopup({
      groupIdx: gi,
      wordIdx: wi,
      anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
    })
  }, [])

  const applyWordOverride = useCallback(
    (gi: number, wi: number, overrides: WordOverrides) => {
      onBeforeEdit?.()
      const next = groups.map((g, idx) =>
        idx !== gi
          ? g
          : {
              ...g,
              words: g.words.map((w, j) =>
                j !== wi
                  ? w
                  : { ...w, overrides: Object.keys(overrides).length ? overrides : undefined }
              ),
            }
      )
      onChange(next)
    },
    [groups, onChange, onBeforeEdit]
  )

  const resetWordOverride = useCallback(
    (gi: number, wi: number) => {
      applyWordOverride(gi, wi, {})
    },
    [applyWordOverride]
  )

  const activePopupWord = popup ? groups[popup.groupIdx]?.words[popup.wordIdx] : null

  // ── Group position override ───────────────────────────────────
  const handleGroupContextMenu = useCallback((e: React.MouseEvent, gi: number) => {
    e.preventDefault()
    setPosPopup({
      groupIdx: gi,
      anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
    })
  }, [])

  const applyPositionOverride = useCallback(
    (gi: number, override: GroupPositionOverride) => {
      onBeforeEdit?.()
      onPositionChange(
        groups.map((g, idx) =>
          idx !== gi
            ? g
            : { ...g, positionOverride: Object.keys(override).length ? override : undefined }
        )
      )
    },
    [groups, onPositionChange, onBeforeEdit]
  )

  const posPopupGroup = posPopup ? groups[posPopup.groupIdx] : null

  // ── Active-group highlight ─────────────────────────────────────
  const activeIdx = groups.findIndex((g) => g.start <= currentTime && currentTime < g.end)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  // Scroll active group into view during playback.
  useEffect(() => {
    if (activeIdx >= 0)
      rowRefs.current[activeIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeIdx])

  // Scroll keyboard-focused group into view.
  useEffect(() => {
    if (focusedIdx !== null)
      rowRefs.current[focusedIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedIdx])

  const activeWordIdx = useMemo(() => {
    if (activeIdx < 0) return -1
    return groups[activeIdx].words.findIndex((w) => currentTime >= w.start && currentTime < w.end)
  }, [activeIdx, groups, currentTime])

  // ── Keyboard navigation ────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setFocusedIdx((i) => (i === null ? groups.length - 1 : Math.max(0, i - 1)))
          break
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setFocusedIdx((i) => (i === null ? 0 : Math.min(groups.length - 1, i + 1)))
          break
        case 'm':
        case 'M':
          if (focusedIdx !== null && focusedIdx < groups.length - 1) {
            e.preventDefault()
            e.stopPropagation()
            handleMerge(focusedIdx)
          }
          break
        case 'Enter':
          if (focusedIdx !== null) {
            e.preventDefault()
            e.stopPropagation()
            handleSplitHalf(focusedIdx)
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setFocusedIdx(null)
          break
      }
    },
    [focusedIdx, groups.length, handleMerge, handleSplitHalf]
  )

  if (groups.length === 0) {
    return (
      <div className="p-6 text-center">
        <p
          className="text-base"
          style={{
            fontFamily: 'var(--cf-font-display)',
            fontStyle: 'italic',
            color: 'var(--color-text-2)',
          }}
        >
          No subtitle groups yet.
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {groups.map((group, gi) => {
        const isGroupDragTarget =
          drag?.type === 'group' &&
          hoverIdx === gi &&
          gi !== drag.groupIdx &&
          gi !== drag.groupIdx + 1
        const isWordDragTarget = drag?.type === 'word' && hoverIdx === gi

        return (
          <div key={group.id}>
            {/* Merge-with-above button — appears between rows */}
            {gi > 0 && (
              <div className="flex justify-center mb-1">
                <button
                  className="text-2xs px-2 py-0.5 rounded hover:bg-[var(--color-surface-3)] transition-colors"
                  style={{ color: 'var(--color-text-3)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--color-text)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--color-text-3)'
                  }}
                  onClick={() => handleMerge(gi - 1)}
                  title="Merge with group above (M)"
                >
                  merge
                </button>
              </div>
            )}

            {/* Row */}
            <div
              ref={(el) => {
                rowRefs.current[gi] = el
              }}
              className={[
                'flex items-start gap-2 p-2 rounded border transition-colors',
                isGroupDragTarget
                  ? 'border-t-2 border-[var(--color-accent)] bg-[var(--color-surface-2)]'
                  : activeIdx === gi
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface-3)]/50'
                    : focusedIdx === gi
                      ? 'border-[var(--color-accent)]/60 bg-[var(--color-surface-2)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface-2)]',
                isWordDragTarget ? 'ring-2 ring-[var(--color-accent)]' : '',
              ].join(' ')}
              onClick={() => setFocusedIdx(gi)}
              onContextMenu={(e) => handleGroupContextMenu(e, gi)}
              title="Right-click to set caption position for this group"
              onDragOver={(e) => {
                if (drag) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setHoverIdx(gi)
                }
              }}
              onDragLeave={() => {
                if (hoverIdx === gi) setHoverIdx(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(gi)
              }}
            >
              {/* Index — drag handle for full-group reorder */}
              <span
                className={`text-2xs shrink-0 w-6 tabular-nums pt-0.5 transition-opacity ${
                  drag?.type === 'group' && drag.groupIdx === gi ? 'opacity-40' : 'cursor-grab'
                }`}
                style={{ color: 'var(--color-text-3)' }}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  setDrag({ type: 'group', groupIdx: gi })
                }}
                onDragEnd={() => {
                  setDrag(null)
                  setHoverIdx(null)
                }}
                title="Drag to reorder group"
              >
                #{gi + 1}
              </span>

              {/* Time — start seeks; end is click-to-edit (shorten to create a
                  gap, or extend up to the next group). Accent = held/extended. */}
              <span className="text-2xs shrink-0 tabular-nums pt-0.5 font-mono inline-flex items-center gap-0.5">
                <button
                  className="transition-colors"
                  style={{ color: 'var(--color-text-2)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--color-accent)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--color-text-2)'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSeek(group.start)
                  }}
                  title="Seek to group start"
                >
                  {formatTime(group.start)}
                </button>
                <span style={{ color: 'var(--color-text-3)' }}>→</span>
                {editingEndIdx === gi ? (
                  <input
                    className="w-14 px-1 rounded bg-[var(--color-surface-3)] border border-[var(--color-accent)] outline-none font-mono text-2xs tabular-nums"
                    style={{ color: 'var(--color-text)' }}
                    value={endDraft}
                    autoFocus
                    onChange={(e) => setEndDraft(e.target.value)}
                    onBlur={() => commitEndEdit(gi, false)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitEndEdit(gi, true)
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEndEdit()
                      }
                    }}
                  />
                ) : (
                  <EndTimeButton
                    label={formatTime(group.end)}
                    isDirty={group.end !== naturalEnd(group)}
                    title="Click to edit this caption's end time — shorten to create a gap where subtitles disappear, or extend up to the next group"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEndEdit(gi)
                    }}
                  />
                )}
                {/* Hand-placed end → this group is exempt from automatic gap
                    closing. Click to give it back. */}
                {group.endEdited && editingEndIdx !== gi && (
                  <button
                    className="px-0.5 hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-accent)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      resetEndEdit(gi)
                    }}
                    title="End time set by hand — this caption keeps its gap instead of being closed automatically. Click to restore the end of its last word."
                    aria-label="Restore automatic end time for this group"
                  >
                    ↺
                  </button>
                )}
              </span>

              {/* Position-override indicator — click to edit */}
              {group.positionOverride && (
                <button
                  className="text-2xs shrink-0 pt-0.5 hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-accent)' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPosPopup({
                      groupIdx: gi,
                      anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                    })
                  }}
                  title="Custom caption position — click to edit"
                >
                  ⌖
                </button>
              )}

              {/* Speaker badge — shown when set; or as +spk prompt when row is focused */}
              {editingSpeakerIdx === gi ? (
                <input
                  className="text-2xs px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] border border-[var(--color-accent)] outline-none w-20 shrink-0"
                  style={{ color: 'var(--color-text)' }}
                  value={speakerDraft}
                  autoFocus
                  placeholder="Speaker…"
                  onChange={(e) => setSpeakerDraft(e.target.value)}
                  onBlur={() => commitSpeakerEdit(gi)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitSpeakerEdit(gi)
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingSpeakerIdx(null)
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : group.speaker ? (
                <span
                  className="text-2xs px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] shrink-0 cursor-pointer transition-colors"
                  style={{ color: 'var(--color-text-2)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--color-text)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--color-text-2)'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    startSpeakerEdit(gi)
                  }}
                  title="Click to edit speaker"
                >
                  {group.speaker}
                </span>
              ) : focusedIdx === gi ? (
                <button
                  className="text-2xs px-1 py-0.5 transition-colors shrink-0"
                  style={{ color: 'var(--color-text-3)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--color-text-2)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--color-text-3)'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    startSpeakerEdit(gi)
                  }}
                  title="Add speaker label"
                >
                  +spk
                </button>
              ) : null}

              {/* Words */}
              <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
                {group.words.map((w, wi) => (
                  <span key={`${group.id}-${w.start}`} className="inline-flex items-center">
                    {wi > 0 && (
                      <button
                        className="text-2xs px-1 opacity-40 hover:opacity-100"
                        style={{ color: 'var(--color-text-3)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--color-accent)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--color-text-3)'
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSplit(gi, wi)
                        }}
                        title="Split group here"
                      >
                        ✂
                      </button>
                    )}
                    <span
                      className={[
                        'inline-block px-1.5 py-0.5 rounded text-xs cursor-grab select-none transition-colors',
                        drag?.type === 'word' && drag.groupIdx === gi && drag.wordIdx === wi
                          ? 'opacity-40 bg-[var(--color-surface-3)]'
                          : gi === activeIdx && wi === activeWordIdx
                            ? 'bg-[var(--color-accent)]/25 font-medium'
                            : 'bg-[var(--color-surface-3)] hover:bg-[var(--color-accent)]/20',
                        w.overrides ? 'ring-1 ring-[var(--color-accent)]/40' : '',
                      ].join(' ')}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation()
                        setDrag({ type: 'word', groupIdx: gi, wordIdx: wi })
                      }}
                      onDragEnd={() => {
                        setDrag(null)
                        setHoverIdx(null)
                      }}
                      onContextMenu={(e) => {
                        e.stopPropagation()
                        handleWordContextMenu(e, gi, wi)
                      }}
                      title="Right-click to style this word"
                      style={
                        w.overrides?.text_color
                          ? { color: w.overrides.text_color }
                          : gi === activeIdx && wi === activeWordIdx
                            ? { color: 'var(--color-accent)' }
                            : undefined
                      }
                    >
                      {w.word}
                    </span>
                  </span>
                ))}
              </div>

              {/* Split-in-half — always visible, disabled when only 1 word */}
              <div className="flex items-center shrink-0">
                <button
                  className={`text-2xs px-2 py-0.5 rounded transition-colors ${
                    group.words.length <= 1
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-[var(--color-surface-3)]'
                  }`}
                  style={{ color: 'var(--color-text-3)' }}
                  onMouseEnter={(e) => {
                    if (group.words.length > 1) e.currentTarget.style.color = 'var(--color-text)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--color-text-3)'
                  }}
                  disabled={group.words.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSplitHalf(gi)
                  }}
                  title={
                    group.words.length <= 1 ? 'Need 2+ words to split' : 'Split in half (Enter)'
                  }
                >
                  ✂ Split
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {popup && activePopupWord && (
        <WordStylePopup
          word={activePopupWord.word}
          overrides={activePopupWord.overrides ?? {}}
          anchorRect={popup.anchorRect}
          defaults={defaults}
          onApply={(ov) => applyWordOverride(popup.groupIdx, popup.wordIdx, ov)}
          onReset={() => resetWordOverride(popup.groupIdx, popup.wordIdx)}
          onClose={() => setPopup(null)}
        />
      )}

      {posPopup && posPopupGroup && (
        <GroupPositionPopup
          groupLabel={`#${posPopup.groupIdx + 1} ${posPopupGroup.text}`}
          override={posPopupGroup.positionOverride ?? {}}
          anchorRect={posPopup.anchorRect}
          defaults={positionDefaults}
          onApply={(ov) => applyPositionOverride(posPopup.groupIdx, ov)}
          onReset={() => applyPositionOverride(posPopup.groupIdx, {})}
          onClose={() => setPosPopup(null)}
        />
      )}
    </div>
  )
}

// ── EndTimeButton ────────────────────────────────────────────────
// Extracted so `hovered` can be local `useState` — this button lives
// inside `groups.map(...)`, and hooks can't be called in a loop callback.
// Hover color is derived declaratively each render (not an imperative
// `.style.color` write) so an external change to `isDirty` while hovered
// (e.g. the group's end time is dragged on the timeline) can't be
// silently clobbered by a stale mouseleave value.
interface EndTimeButtonProps {
  label: string
  isDirty: boolean
  title: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}

function EndTimeButton({ label, isDirty, title, onClick }: EndTimeButtonProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      className="transition-colors"
      style={{ color: hovered || isDirty ? 'var(--color-accent)' : 'var(--color-text-2)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}

// Inverse of formatTime — "m:ss.s" or plain seconds → seconds. null if unparseable.
function parseTime(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const mins = m[1] ? parseInt(m[1], 10) : 0
  return mins * 60 + parseFloat(m[2])
}
