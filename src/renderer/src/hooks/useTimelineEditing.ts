/**
 * Timeline editing: group/word edge drags and the two right-click popups.
 *
 * Extracted verbatim from `ResultsScreen` — a behaviour-preserving move to keep
 * that component within the file-size ceiling. Everything here operates on the
 * **raw** groups the editor owns; the caller supplies the group setters and the
 * undo push so the semantics (which gesture flips `groupsEdited`, which pushes
 * an undo entry, and when) are unchanged.
 *
 * Popup identity is deliberately *positional* (`groupIdx`/`wordIdx`) rather than
 * id-based, which is why the two stale-index guards at the bottom exist: any
 * reshape of the groups array closes a popup whose target no longer holds.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GroupPositionOverride, Segment, WordOverrides } from '../types/app'
import { joinWords, retimeWords, tokenize } from '../lib/wordTiming'
import { withWordIds } from '../lib/wordIds'

interface UseTimelineEditingArgs {
  /** The raw groups the editor owns. */
  groups: Segment[]
  setGroups: React.Dispatch<React.SetStateAction<Segment[]>>
  setGroupsEdited: React.Dispatch<React.SetStateAction<boolean>>
  /** The position-only path, which must never flip `groupsEdited`. */
  onPositionChange: (next: Segment[]) => void
  /** Snapshot the editor state before a change (one per gesture). */
  pushUndo: () => void
  /**
   * True on a translated caption track. Both timeline drags then also *pin* what
   * they touch, because on a translated track timing is derived rather than
   * authored: a group's span follows the source words it was written from
   * (`timingLinked`), and a word's span is distributed across that span by
   * character count (`Word.timingDerived`). A drag is the user saying "no, this
   * one goes here", so the derived claim has to be dropped — otherwise the next
   * source edit, or the next re-bake of the text, would quietly undo it.
   * Inert on the source track, whose timings are authoritative already.
   */
  translated?: boolean
}

export function useTimelineEditing({
  groups,
  setGroups,
  setGroupsEdited,
  onPositionChange: handleGroupsPositionChange,
  pushUndo,
  translated = false,
}: UseTimelineEditingArgs) {
  // Timeline right-click on a word in the word lane → style/text popup.
  // Word identity is positional (groupIdx + wordIdx), not id-based — see the
  // stale-index guard effect below.
  const [wordPopup, setWordPopup] = useState<{
    groupIdx: number
    wordIdx: number
    anchorRect: DOMRect
    /** Word count of the target group when the popup opened. A text commit that
     *  splits the word changes it, invalidating wordIdx. */
    wordCount: number
  } | null>(null)
  // Timeline right-click on a group block → position-override popup. Group
  // identity is positional (groupIdx), not id-based — see the stale-index
  // guard effect below (mirrors the word popup's guard).
  const [groupPosPopup, setGroupPosPopup] = useState<{
    groupIdx: number
    anchorRect: DOMRect
  } | null>(null)
  // Timeline edge-drag: adjust a group's start/end time or move the whole block.
  //
  // Dragging the right edge or the whole block *places* this group's end, so the
  // group is marked `endEdited` and from then on the automatic gap-closing pass
  // leaves it alone (a deliberately carved-out gap survives) — see closeGroupGaps.
  // A left-edge drag doesn't touch the end, so it makes no such claim. The flag is
  // cleared again whenever the group's bounds are recomputed from its words
  // (`finalizeBounds`), and GroupEditor offers a reset affordance for an
  // accidental two-pixel drag.
  //
  // On a translated track the same gesture also unlinks the group from its
  // source span (`timingLinked: false`), so `propagateSourceTiming` stops
  // moving it when the source does — the drag IS the user placing this caption.
  const handleSegmentEdge = useCallback(
    (
      segId: string,
      edge: 'start' | 'end' | 'body',
      newVal: number | { start: number; end: number }
    ) => {
      const unlink = translated ? { timingLinked: false } : {}
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== segId) return g
          if (edge === 'body' && typeof newVal === 'object') {
            return { ...g, ...unlink, start: newVal.start, end: newVal.end, endEdited: true }
          }
          if (typeof newVal !== 'number') return g
          if (edge === 'end') return { ...g, ...unlink, end: newVal, endEdited: true }
          return { ...g, ...unlink, [edge]: newVal }
        })
      )
      setGroupsEdited(true)
    },
    [setGroups, setGroupsEdited, translated]
  )

  // Called once at the start of each drag — snapshot state before any movement.
  const handleSegmentEdgeDragStart = useCallback(() => {
    pushUndo()
  }, [pushUndo])

  // Word-lane drag: retime one word inside a group. The group's own bounds
  // widen if the first/last word is pushed past them (never into a neighbour —
  // the timeline clamps to adjacent groups before calling this).
  //
  // Deliberately does NOT set `endEdited`, unlike handleSegmentEdge above. The
  // end moves here as a *side effect* of retiming a word, not as a statement
  // about where this caption should stop: the user is placing a word, and the
  // group bound follows because it has to contain it. Only a gesture aimed at
  // the group's own end (right-edge/body drag, or the Groups editor's end field)
  // is a claim. Flagging it here would silently exempt the group from gap
  // closing forever because someone nudged a word.
  //
  // It does not *clear* an existing `endEdited` either: the end is only ever
  // widened here (`Math.max`), so a hand-placed end is never contradicted, and
  // revoking the claim would let a word nudge silently re-close a gap the user
  // carved out on purpose. `resetEndEdit` in GroupEditor is the one way out.
  //
  // On a translated track it does one extra thing: the dragged word loses its
  // `timingDerived` flag, i.e. it becomes pinned. Re-baking the group's text
  // and re-linking its span both re-distribute only the *derived* words between
  // their pinned neighbours, so this is what makes a hand-placed word stay put.
  const handleWordEdge = useCallback(
    (segId: string, wordIdx: number, patch: { start: number; end: number }) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== segId) return g
          const words = g.words.map((w, i) => {
            if (i !== wordIdx) return w
            const next = { ...w, start: patch.start, end: patch.end }
            // A fresh copy — `w` itself is never mutated.
            if (translated) delete next.timingDerived
            return next
          })
          return {
            ...g,
            words,
            start: Math.min(g.start, patch.start),
            end: Math.max(g.end, patch.end),
          }
        })
      )
      setGroupsEdited(true)
    },
    [setGroups, setGroupsEdited, translated]
  )

  const handleWordEdgeDragStart = useCallback(() => {
    pushUndo()
  }, [pushUndo])

  // Timeline word lane right-click → open the style/text popup for that
  // word. One undo snapshot per popup "session" (mirrors the drag-start
  // pattern above) rather than one per keystroke/slider tick — the popup's
  // onApply fires continuously while it's open. The snapshot itself is taken
  // lazily on the first real change (see wordPopupUndoPushedRef below) so an
  // inspect-only open/close (Escape, outside click, no edits) doesn't push a
  // no-op undo entry.
  const wordPopupUndoPushedRef = useRef(false)
  const handleTimelineWordContextMenu = useCallback(
    (segId: string, wordIdx: number, rect: DOMRect) => {
      const groupIdx = groups.findIndex((g) => g.id === segId)
      if (groupIdx === -1) return
      wordPopupUndoPushedRef.current = false
      setWordPopup({ groupIdx, wordIdx, anchorRect: rect, wordCount: groups[groupIdx].words.length })
    },
    [groups]
  )

  // Style override apply/reset for the timeline word popup — same sparse-
  // storage + groupsEdited mechanics as handleWordEdge (setGroups directly,
  // flip groupsEdited). The undo snapshot is pushed once, on the first apply
  // of the popup session (see wordPopupUndoPushedRef above).
  const applyTimelineWordOverride = useCallback(
    (gi: number, wi: number, overrides: WordOverrides) => {
      if (!wordPopupUndoPushedRef.current) {
        pushUndo()
        wordPopupUndoPushedRef.current = true
      }
      setGroups((prev) =>
        prev.map((g, idx) =>
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
      )
      setGroupsEdited(true)
    },
    [pushUndo, setGroups, setGroupsEdited]
  )

  // Text correction from the timeline word popup — preserves start/end/
  // overrides via spread (SubtitleEditor.tsx's word-edit pattern) and rebuilds
  // the group's joined text. A boundary-locking edit (Open decision #1): it
  // flips groupsEdited exactly like GroupEditor/SubtitleEditor text edits.
  // Same lazy one-snapshot-per-session undo push as applyTimelineWordOverride.
  const applyTimelineWordText = useCallback(
    (gi: number, wi: number, newText: string) => {
      if (!wordPopupUndoPushedRef.current) {
        pushUndo()
        wordPopupUndoPushedRef.current = true
      }
      setGroups((prev) =>
        prev.map((g, idx) => {
          if (idx !== gi) return g
          const target = g.words[wi]
          if (!target) return g
          const tokens = tokenize(newText)
          // One token in, one token out — the common typo fix. Spread so the
          // word keeps its exact timing and overrides.
          const replacement =
            tokens.length === 1
              ? [{ ...target, word: tokens[0] }]
              : // Typing two words splits this word: retime strictly inside its
                // own span so no neighbour moves (lib/wordTiming.ts). The first
                // piece keeps the original `wid` so the group still anchors to a
                // word the segments know about; the extras get fresh ids. This
                // edit is group-only (segments are untouched), so a later
                // segments edit still refreshes the first piece's text from the
                // source and drops the extras — the same divergence the previous
                // index-based sync had, deliberately not widened here.
                withWordIds(
                  retimeWords([target], tokens, {
                    start: target.start,
                    end: target.end,
                  }).map((w, k) => (k === 0 && target.wid ? { ...w, wid: target.wid } : w))
                )
          const words = [...g.words.slice(0, wi), ...replacement, ...g.words.slice(wi + 1)]
          return { ...g, words, text: joinWords(words) }
        })
      )
      setGroupsEdited(true)
    },
    [pushUndo, setGroups, setGroupsEdited]
  )

  // Timeline group block right-click → open the position-override popup for
  // that group. Same lazy one-snapshot-per-session undo pattern as the word
  // popup above (wordPopupUndoPushedRef) rather than GroupEditor's per-apply
  // onBeforeEdit — the popup's onApply fires continuously while sliders move.
  const groupPosUndoPushedRef = useRef(false)
  const handleTimelineGroupContextMenu = useCallback(
    (segId: string, rect: DOMRect) => {
      const groupIdx = groups.findIndex((g) => g.id === segId)
      if (groupIdx === -1) return
      groupPosUndoPushedRef.current = false
      setGroupPosPopup({ groupIdx, anchorRect: rect })
    },
    [groups]
  )

  // Position-override apply/reset for the timeline group popup — mirrors
  // GroupEditor's applyPositionOverride (sparse storage: an override with no
  // keys collapses to undefined) but routes through handleGroupsPositionChange
  // instead of the boundary-edit path, so groupsEdited is never flipped — a
  // position override doesn't change group boundaries, and re-grouping must
  // keep working. The undo snapshot is pushed once, lazily, on the first
  // apply of the popup session (see groupPosUndoPushedRef above).
  const applyTimelineGroupPosition = useCallback(
    (gi: number, override: GroupPositionOverride) => {
      if (!groupPosUndoPushedRef.current) {
        pushUndo()
        groupPosUndoPushedRef.current = true
      }
      handleGroupsPositionChange(
        groups.map((g, idx) =>
          idx !== gi
            ? g
            : { ...g, positionOverride: Object.keys(override).length ? override : undefined }
        )
      )
    },
    [groups, handleGroupsPositionChange, pushUndo]
  )

  // Stale-index guard: close the popup if the groups array changed shape
  // (re-grouping, merge/split, undo/redo) such that the target word no
  // longer exists — word identity here is positional, not id-based. A text
  // commit that splits the word into two also invalidates wordIdx without
  // removing it, so the group's word count is checked too.
  useEffect(() => {
    if (!wordPopup) return
    const group = groups[wordPopup.groupIdx]
    if (!group?.words[wordPopup.wordIdx] || group.words.length !== wordPopup.wordCount) {
      setWordPopup(null)
    }
  }, [groups, wordPopup])

  // Same stale-index guard for the group position popup — group identity is
  // also positional (groupIdx), not id-based.
  useEffect(() => {
    if (groupPosPopup && !groups[groupPosPopup.groupIdx]) {
      setGroupPosPopup(null)
    }
  }, [groups, groupPosPopup])
  return {
    wordPopup,
    setWordPopup,
    groupPosPopup,
    setGroupPosPopup,
    handleSegmentEdge,
    handleSegmentEdgeDragStart,
    handleWordEdge,
    handleWordEdgeDragStart,
    handleTimelineWordContextMenu,
    applyTimelineWordOverride,
    applyTimelineWordText,
    handleTimelineGroupContextMenu,
    applyTimelineGroupPosition,
  }
}
