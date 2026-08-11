/**
 * Results screen — shown after transcription completes.
 * Layout: main editor content (player + tabs + editor).
 * The StudioPanel sidebar is rendered by App.tsx, always visible.
 *
 * Bottom editor has two views:
 *   - Text view   → SubtitleEditor (per-sentence segments, edits source)
 *   - Groups view → GroupEditor    (display groups, merge/split/drag words)
 *
 * Groups are derived from `segments` + `wordsPerGroup` but held as state so
 * manual merge/split edits persist until the source segments or wpg change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  TranscriptionResult,
  Segment,
  WordOverrides,
  GroupPositionOverride,
} from '../../types/app'
import { buildStudioGroups, closeGroupGaps, fillGroupGaps, reconcileGroups } from '../../lib/groups'
import { joinWords, retimeWords, tokenize } from '../../lib/wordTiming'
import { adoptWordIds, ensureWordIds, withWordIds } from '../../lib/wordIds'
import { adoptEndEdited } from '../../lib/endEdited'
import { DEFAULT_PAD_V } from '../../lib/renderConstants'
import type { ProjectFile, ProjectIOHandle, WordOverrideEdit } from '../../lib/project'
import { PROJECT_VERSION, suggestProjectName } from '../../lib/project'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import { useToast } from '../../hooks/useToast'
import { api, type RealignSegmentPayload } from '../../lib/api'
import { AudioPlayer, type AudioPlayerHandle } from '../player/AudioPlayer'
import { AlignmentNotice } from './AlignmentNotice'
import { SubtitleEditor } from '../editor/SubtitleEditor'
import { GroupEditor } from '../editor/GroupEditor'
import { WordStylePopup, type WordStyleDefaults } from '../editor/WordStylePopup'
import { GroupPositionPopup } from '../editor/GroupPositionPopup'
import type { StudioSettings } from '../studio/StudioPanel'

interface ResultsScreenProps {
  result: TranscriptionResult
  /** Studio settings — owned by App.tsx, read-only here. */
  settings: StudioSettings
  /** Publish groups + edited flag up to App for StudioPanel render/export. */
  onGroupsUpdate: (groups: Segment[], edited: boolean) => void
  /** Ref that App.tsx uses to gather/restore project state for save/open. */
  projectIORef?: React.MutableRefObject<ProjectIOHandle | null>
  /** Fires whenever undo/redo availability changes so App can surface buttons in TitleBar. */
  onUndoRedoChange?: (state: {
    undo: () => void
    redo: () => void
    canUndo: boolean
    canRedo: boolean
  }) => void
}

type EditorView = 'text' | 'groups'

export function ResultsScreen({
  result,
  settings,
  onGroupsUpdate,
  projectIORef,
  onUndoRedoChange,
}: ResultsScreenProps) {
  // Segments are mutable (user can edit timing + word overrides). Every word is
  // given a stable `wid` on the way in — group membership is reconciled by that
  // id, never by array position (see reconcileGroups / lib/wordIds.ts).
  const [segments, setSegments] = useState<Segment[]>(() => ensureWordIds(result.segments))
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | null>(null)
  const [view, setView] = useState<EditorView>('text')

  // Display groups — held as state (not useMemo) so manual merge/split edits
  // from GroupEditor stick. The useEffect below re-derives them whenever the
  // source segments or wpg change, matching vanilla's behaviour.
  // Derived from the id'd `segments` above, never from `result.segments` — the
  // two must share one word-id set or reconcileGroups can match nothing.
  const [groups, setGroups] = useState<Segment[]>(() =>
    buildStudioGroups(segments, settings.wordsPerGroup)
  )
  // True once the user manually merges/splits/reorders groups — flag is sent
  // to the backend so renderSubtitleVideo uses `custom_groups` instead of
  // re-chunking from the stored transcription.
  const [groupsEdited, setGroupsEdited] = useState(false)
  // True once the user edits segments (text, timing, etc.) — ensures the
  // re-derived groups are still sent to the backend for rendering.
  const [segmentsEdited, setSegmentsEdited] = useState(false)
  // Transient: when set, SubtitleEditor scrolls/focuses that segment's text
  // field (used right after a manual "+ Add subtitle" so the user can type).
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null)
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
  const [editorWidth, setEditorWidth] = useState(420)
  // Segment id currently being re-aligned via /api/realign (null = idle).
  const [realigningSegId, setRealigningSegId] = useState<string | null>(null)
  // Once any fallback timings enter the transcript, keep the warning visible:
  // later successful realignments do not prove every other word is precise.
  const [alignmentDegraded, setAlignmentDegraded] = useState(Boolean(result.alignmentDegraded))

  const playerRef = useRef<AudioPlayerHandle>(null)
  const { toast } = useToast()

  // ── Undo/redo for segment + group edits ───────────────────────
  const { pushUndo, undo, redo, canUndo, canRedo, isRestoringRef } = useUndoRedo(
    segments,
    setSegments,
    groups,
    setGroups,
    groupsEdited,
    setGroupsEdited
  )

  useEffect(() => {
    onUndoRedoChange?.({ undo, redo, canUndo, canRedo })
  }, [canUndo, canRedo, undo, redo, onUndoRedoChange])

  /**
   * Every write to `segments` goes through here so freshly introduced words get
   * a `wid` before reconcileGroups sees them. `ensureWordIds` is reference-stable,
   * so this costs nothing when the words already carry ids. Undo/redo restores
   * through the raw setter — its snapshots are already id'd.
   */
  const commitSegments = useCallback(
    (next: Segment[] | ((prev: Segment[]) => Segment[])): void => {
      setSegments((prev) => ensureWordIds(typeof next === 'function' ? next(prev) : next))
    },
    []
  )

  const prevWpg = useRef(settings.wordsPerGroup)
  useEffect(() => {
    // Skip when undo/redo is restoring state — groups are already set from the snapshot.
    if (isRestoringRef.current) {
      isRestoringRef.current = false
      prevWpg.current = settings.wordsPerGroup
      return
    }

    const wpgChanged = settings.wordsPerGroup !== prevWpg.current
    prevWpg.current = settings.wordsPerGroup

    if (groupsEdited && !wpgChanged) {
      // The user has arranged these groups by hand. Membership is theirs, not a
      // function of document order, so words are matched back to the segments by
      // `wid` and stay in the group the user put them in — a word moved to a
      // non-adjacent group, a reordered group, a merge or a split all survive an
      // edit to the source segments. NEVER re-slice a flat word pool by index
      // here: that silently restores document order, which is the bug this
      // replaced (docs/plans/fill-gaps-resets-custom-groups.md).
      setGroups((prev) => reconcileGroups(prev, segments, settings.wordsPerGroup))
    } else {
      // Rebuild from scratch — no manual edits or wpg changed. Position
      // overrides don't set groupsEdited (they don't change boundaries), so
      // carry them forward by group ID here; a wpg change shifts the
      // ${seg.id}:${offset} IDs, dropping overrides for regrouped chunks —
      // intentional, the old grouping no longer exists.
      setGroups((prev) => {
        const rebuilt = buildStudioGroups(segments, settings.wordsPerGroup)
        const overridesById = new Map(
          prev.filter((g) => g.positionOverride).map((g) => [g.id, g.positionOverride])
        )
        if (overridesById.size === 0) return rebuilt
        return rebuilt.map((g) => {
          const po = overridesById.get(g.id)
          return po ? { ...g, positionOverride: po } : g
        })
      })
      if (wpgChanged) setGroupsEdited(false)
    }
  }, [segments, settings.wordsPerGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The groups as the *viewer* sees them: short inter-group gaps closed, and the
   * final caption held past its last word (`lib/groups.ts` `closeGroupGaps`).
   *
   * Derived, never baked. Writing this back through `setGroups`/`handleGroupsChange`
   * would flip `groupsEdited`, make `reconcileGroups` Rule 5 carry the held end
   * forward as a manual bound, and compound the (non-idempotent) tail hold by one
   * hold per edit. So `groups` stays raw and every edit surface keeps using it;
   * only the preview and the render payload read this.
   *
   * Cosmetic consequence, decided deliberately (plan §4.4): the Groups editor and
   * the timeline show a group's *original* end while the preview holds the caption
   * longer. That asymmetry is the point — raw ends are the drag/edit target, so
   * they must stay honest. v1 ships without a "held extension" ghost on the
   * timeline; revisit only if QA says the difference confuses people.
   */
  const displayGroups = useMemo(
    () => closeGroupGaps(groups, settings.gapCloseThreshold, settings.lastGroupHold),
    [groups, settings.gapCloseThreshold, settings.lastGroupHold]
  )

  // Publish groups + edited state to App for StudioPanel. The *display* groups go
  // up, so a render that takes the `custom_groups` path (groupsEdited or a position
  // override — see render.ts) ships closed gaps too; the backend applies the same
  // pass itself only on the other path, inside `_build_groups`. `displayGroups` is
  // a useMemo and `onGroupsUpdate` is App's `handleGroupsUpdate`, a `useCallback`
  // with an empty dep list, so this effect re-runs exactly when the groups change
  // — App stores the array without feeding anything back here (ResultsScreen owns
  // `groups` and takes no groups prop), so there is no loop.
  useEffect(() => {
    onGroupsUpdate(displayGroups, groupsEdited || segmentsEdited)
  }, [displayGroups, groupsEdited, segmentsEdited, onGroupsUpdate])

  // Wrapper that GroupEditor calls — flips the edited flag the first time the
  // user touches the groups.
  const handleGroupsChange = useCallback((next: Segment[]) => {
    setGroups(next)
    setGroupsEdited(true)
  }, [])

  // "Close all gaps" — bake the gap-fill stretch into the editable groups so each
  // caption persists until the next group starts. Unlike the automatic pass
  // (closeGroupGaps) this ignores the threshold and closes every gap, however
  // long. One-shot + undoable; the user then shortens individual group ends (in
  // GroupEditor) to carve out deliberate gaps where subtitles should disappear.
  const handleFillGaps = useCallback(() => {
    pushUndo()
    handleGroupsChange(fillGroupGaps(groups))
  }, [groups, handleGroupsChange, pushUndo])

  // Position-only updates (per-group position override) — deliberately do NOT
  // flip groupsEdited: boundaries are untouched, so re-grouping must keep
  // working and the backend only needs custom_groups because of the override
  // (render.ts widens the send condition on positionOverride presence).
  const handleGroupsPositionChange = useCallback((next: Segment[]) => {
    setGroups(next)
  }, [])

  // ── Undo/redo keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  // ── Playback keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (editable) return

      // ⌘1 / ⌘2 — switch editor view (registered in lib/shortcuts.ts).
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === '1' || e.key === '2')) {
        e.preventDefault()
        setView(e.key === '1' ? 'text' : 'groups')
        return
      }

      const p = playerRef.current
      if (!p) return

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault()
          p.playPause()
          break
        case 'j':
        case 'J':
          e.preventDefault()
          p.seekRelative(-2)
          break
        case 'k':
        case 'K':
          e.preventDefault()
          p.playPause()
          break
        case 'l':
        case 'L':
          e.preventDefault()
          p.seekRelative(2)
          break
        case 'ArrowLeft':
          e.preventDefault()
          p.seekRelative(-1 / 30)
          break
        case 'ArrowRight':
          e.preventDefault()
          p.seekRelative(1 / 30)
          break
        case ',': {
          e.preventDefault()
          let gi = -1
          for (let i = groups.length - 1; i >= 0; i--) {
            if (groups[i].start < currentTime - 0.01) {
              gi = i
              break
            }
          }
          if (gi >= 0) p.seekToTime(groups[gi].start)
          break
        }
        case '.': {
          e.preventDefault()
          const gi = groups.findIndex((g) => g.start > currentTime + 0.01)
          if (gi >= 0) p.seekToTime(groups[gi].start)
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groups, currentTime])

  // ── Project I/O handle ─────────────────────────────────────────────
  useEffect(() => {
    if (!projectIORef) return
    projectIORef.current = {
      gather: () => {
        const anyEdited = groupsEdited || segmentsEdited
        // Position overrides live on groups but do NOT flip the edited flag
        // (they don't change group boundaries) — persist the groups anyway so
        // the overrides survive a save/reopen.
        const hasPosOverrides = groups.some((g) => g.positionOverride)
        return {
          version: PROJECT_VERSION,
          suggestedName: suggestProjectName(result.audioPath),
          selectedFilePath: result.audioPath,
          outputDir: 'output',
          transcriptionResult: { ...result, segments, alignmentDegraded },
          studioSettings: settings,
          customGroupsEdited: anyEdited,
          studioGroups: anyEdited || hasPosOverrides ? groups : null,
        }
      },
      restore: (file: ProjectFile) => {
        // Assumes a freshly-mounted instance: App keys ResultsScreen by
        // resultsSessionId, so segments/groups state already initialized from
        // the new `result` prop — only manually-edited groups need restoring.
        // Do NOT add a setSegments mirror here.
        if (file.studioGroups && file.studioGroups.length > 0) {
          // A project saved before word ids existed restores groups whose words
          // have none, while `segments` minted its own set on mount. Adopt the
          // segments' ids by matching text+timing so the restored manual grouping
          // is still reconcilable; a project saved after this change already has
          // matching ids on both sides and passes through untouched.
          // `adoptEndEdited` does the same retrofit for the hand-placed-end claim,
          // so gaps the user shaped before that flag existed aren't closed back up.
          setGroups(adoptEndEdited(adoptWordIds(file.studioGroups, segments)))
          // Only mark edited when boundaries were actually edited — groups
          // saved solely for position overrides keep auto-grouping semantics.
          if (file.customGroupsEdited) setGroupsEdited(true)
        }
      },
      applyAgentResult: (agentResult: TranscriptionResult) => {
        // Replace the live transcript with the agent's edit. pushUndo first so
        // the user can revert. setSegmentsEdited re-publishes derived groups.
        pushUndo()
        commitSegments(agentResult.segments)
        if (agentResult.alignmentDegraded) setAlignmentDegraded(true)
        setSegmentsEdited(true)
      },
      applyWordOverrides: (edits: WordOverrideEdit[]) => {
        // Agent emphasis: merge per-word overrides onto group words. The Canvas
        // preview and backend both read these verbatim, so the change is visible
        // immediately and survives to render. groupsEdited → sent as custom_groups.
        if (!edits.length) return
        pushUndo()
        setGroups((prev) => {
          const next = prev.map((g) => ({ ...g, words: g.words.map((w) => ({ ...w })) }))
          for (const e of edits) {
            const word = next[e.group]?.words[e.word]
            if (!word) continue
            word.overrides = { ...word.overrides, ...e.overrides }
          }
          return next
        })
        setGroupsEdited(true)
      },
    }
    return () => {
      projectIORef.current = null
    }
  })

  // Arrow-key tab switching — with exactly two tabs both directions toggle.
  // Focus follows the selection (roving tabIndex pattern, cf. SegmentedControl).
  const switchTab = useCallback(() => {
    const next = view === 'text' ? 'groups' : 'text'
    setView(next)
    requestAnimationFrame(() => {
      document.getElementById(`editor-tab-${next}`)?.focus()
    })
  }, [view])

  const handleTimeUpdate = useCallback((t: number) => setCurrentTime(t), [])

  const handleSeek = useCallback((t: number) => {
    setCurrentTime(t)
    setSeekTarget(t)
  }, [])

  const handleSeekDone = useCallback(() => setSeekTarget(null), [])

  // Insert a new manual segment at the current playback position. Used when
  // Whisper missed a sentence — the user adds it back by hand.
  const handleAddSegment = useCallback(() => {
    const start = Math.max(0, currentTime)
    const dur = playerRef.current?.getDuration() ?? 0
    const tentativeEnd = start + 2.0
    const end = dur > 0 ? Math.min(tentativeEnd, dur) : tentativeEnd
    const newSeg: Segment = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      start,
      end,
      text: '',
      words: [],
    }
    pushUndo()
    commitSegments((prev) => [...prev, newSeg].sort((a, b) => a.start - b.start))
    setSegmentsEdited(true)
    setView('text')
    setFocusSegmentId(newSeg.id)
  }, [currentTime, pushUndo, commitSegments])

  // Timeline edge-drag: adjust a group's start/end time or move the whole block.
  //
  // Dragging the right edge or the whole block *places* this group's end, so the
  // group is marked `endEdited` and from then on the automatic gap-closing pass
  // leaves it alone (a deliberately carved-out gap survives) — see closeGroupGaps.
  // A left-edge drag doesn't touch the end, so it makes no such claim. The flag is
  // cleared again whenever the group's bounds are recomputed from its words
  // (`finalizeBounds`), and GroupEditor offers a reset affordance for an
  // accidental two-pixel drag.
  const handleSegmentEdge = useCallback(
    (
      segId: string,
      edge: 'start' | 'end' | 'body',
      newVal: number | { start: number; end: number }
    ) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== segId) return g
          if (edge === 'body' && typeof newVal === 'object') {
            return { ...g, start: newVal.start, end: newVal.end, endEdited: true }
          }
          if (typeof newVal !== 'number') return g
          if (edge === 'end') return { ...g, end: newVal, endEdited: true }
          return { ...g, [edge]: newVal }
        })
      )
      setGroupsEdited(true)
    },
    []
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
  // The converse also holds: it does not *clear* an existing `endEdited` either,
  // which is a deliberate deviation from the plan's "the flag dies whenever
  // bounds are recomputed" rule. That rule is about `finalizeBounds`, which
  // re-derives a group's bounds from its whole word list and so discards
  // whatever the user placed. Here the end is only ever *widened*
  // (`Math.max(g.end, patch.end)`), so a claimed end is never contradicted — it
  // is either kept verbatim or pushed out to contain a word that now ends later.
  // Revoking the claim on that would mean a word nudge silently re-closes a gap
  // the user carved out on purpose. `resetEndEdit` in GroupEditor stays the one
  // way back out.
  const handleWordEdge = useCallback(
    (segId: string, wordIdx: number, patch: { start: number; end: number }) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== segId) return g
          const words = g.words.map((w, i) =>
            i === wordIdx ? { ...w, start: patch.start, end: patch.end } : w
          )
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
    []
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
    [pushUndo]
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
    [pushUndo]
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

  // Re-run WhisperX forced alignment on one segment. The backend re-fits word
  // timings to the audio; per-word style overrides are re-attached by index
  // (the backend preserves word count).
  const handleRealignSegment = useCallback(
    async (segId: string) => {
      const seg = segments.find((s) => s.id === segId)
      if (!seg || realigningSegId) return
      setRealigningSegId(segId)
      try {
        const payload: RealignSegmentPayload = {
          start: seg.start,
          end: seg.end,
          text: seg.text,
          words: seg.words.map(({ word, start, end, score }) => ({ word, start, end, score })),
          speaker: seg.speaker,
        }
        const res = await api.realignSegments([payload], result.language)
        const aligned = res.segments[0]
        if (!aligned) throw new Error('Backend returned no segments')
        // Snapshot only after the backend succeeded — a failed request leaves
        // both the segments and the undo stack untouched.
        pushUndo()
        commitSegments((prev) =>
          prev.map((s) => {
            if (s.id !== segId) return s
            return {
              ...s,
              start: aligned.start,
              end: aligned.end,
              text: aligned.text,
              // Word ids ride the same index carry as overrides — the backend
              // preserves word count, and re-fitting timings must not read as
              // "every word deleted and re-inserted" to reconcileGroups, which
              // would collapse the segment's groups into one.
              words: aligned.words.map((w, i) => {
                const prevWord = s.words[i]
                return {
                  ...w,
                  ...(prevWord?.wid ? { wid: prevWord.wid } : {}),
                  ...(prevWord?.overrides ? { overrides: prevWord.overrides } : {}),
                }
              }),
            }
          })
        )
        setSegmentsEdited(true)
        if (res.alignment_degraded) {
          setAlignmentDegraded(true)
          toast('Using approximate word timings — forced alignment is unavailable', 'info')
        } else {
          toast('Word timings re-aligned', 'success')
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown error'
        toast(`Re-align failed: ${detail}`, 'error')
      } finally {
        setRealigningSegId(null)
      }
    },
    [segments, realigningSegId, result.language, pushUndo, toast, commitSegments]
  )

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = editorWidth
      const onMouseMove = (ev: MouseEvent) => {
        setEditorWidth(Math.max(180, Math.min(600, startWidth + ev.clientX - startX)))
      }
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [editorWidth]
  )

  // Defaults the WordStylePopup uses to compute "hasOverride" for each field.
  const wordStyleDefaults = useMemo<WordStyleDefaults>(
    () => ({
      textColor: settings.textColor,
      activeColor: settings.activeColor,
      fontName: settings.fontName,
      wordTransition: settings.wordStyle as WordStyleDefaults['wordTransition'],
      highlightRadius: settings.highlightRadius,
      highlightPadX: settings.highlightPadX,
      highlightPadY: settings.highlightPadY,
      highlightOpacity: settings.highlightOpacity,
      highlightOffsetX: settings.highlightOffsetX,
      highlightOffsetY: settings.highlightOffsetY,
      underlineThickness: settings.underlineThickness,
      underlineColor: settings.underlineColor,
      bounceStrength: settings.bounceStrength,
      scaleFactor: settings.scaleFactor,
      // Global Background-card values the "Word background" block inherits.
      // bgOpacity stays in its 0–100 StudioSettings unit — WordStylePopup is
      // the only place that converts it to word_bg_opacity's 0–1 unit.
      bgOpacity: settings.bgOpacity,
      bgColor: settings.bgColor,
      bgRadius: settings.bgRadius,
      bgWidthExtra: settings.bgWidthExtra,
      bgHeightExtra: settings.bgHeightExtra,
      marginH: settings.marginH,
      marginV: settings.marginV ?? DEFAULT_PAD_V,
    }),
    [
      settings.textColor,
      settings.activeColor,
      settings.fontName,
      settings.wordStyle,
      settings.highlightRadius,
      settings.highlightPadX,
      settings.highlightPadY,
      settings.highlightOpacity,
      settings.highlightOffsetX,
      settings.highlightOffsetY,
      settings.underlineThickness,
      settings.underlineColor,
      settings.bounceStrength,
      settings.scaleFactor,
      settings.bgOpacity,
      settings.bgColor,
      settings.bgRadius,
      settings.bgWidthExtra,
      settings.bgHeightExtra,
      settings.marginH,
      settings.marginV,
    ]
  )

  return (
    <div className="flex-1 flex flex-row overflow-hidden min-w-0">
      {/* Left panel: tabs + editor */}
      <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: editorWidth }}>
        {/* View tabs — roving tabIndex + arrow keys (pattern from ui/SegmentedControl) */}
        <div
          role="tablist"
          aria-label="Editor view"
          className="flex items-center gap-1 px-3 pt-2 border-b border-[var(--color-border)] shrink-0"
        >
          <TabButton
            id="editor-tab-text"
            active={view === 'text'}
            onClick={() => setView('text')}
            onArrow={switchTab}
          >
            Text
          </TabButton>
          <TabButton
            id="editor-tab-groups"
            active={view === 'groups'}
            onClick={() => setView('groups')}
            onArrow={switchTab}
          >
            Groups
          </TabButton>
          {view === 'groups' && (
            <button
              className="text-2xs ml-auto px-2 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: 'var(--color-text-2)' }}
              onMouseEnter={(e) => {
                if (groups.length >= 2) e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-text-2)'
              }}
              onClick={handleFillGaps}
              disabled={groups.length < 2}
              title="Close EVERY gap, ignoring the “hold captions across gaps shorter than…” threshold — every caption is stretched to the start of the next group, including across real pauses. Short gaps are already closed automatically; use this to bake the rest, then shorten individual group end times to carve deliberate gaps back out."
            >
              Close all gaps
            </button>
          )}
          <span
            className={`text-2xs ${view === 'groups' ? 'ml-2' : 'ml-auto'}`}
            style={{ color: 'var(--color-text-3)' }}
          >
            {view === 'text'
              ? `${segments.length} segment${segments.length === 1 ? '' : 's'}`
              : `${groups.length} group${groups.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {view === 'text' ? (
          <SubtitleEditor
            segments={segments}
            currentTime={currentTime}
            onSeek={handleSeek}
            onChange={(next: Segment[]) => {
              commitSegments(next)
              setSegmentsEdited(true)
            }}
            onBeforeEdit={pushUndo}
            onAddSegment={handleAddSegment}
            focusSegmentId={focusSegmentId}
            onFocusConsumed={() => setFocusSegmentId(null)}
            onRealign={handleRealignSegment}
            realigningSegId={realigningSegId}
          />
        ) : (
          <GroupEditor
            groups={groups}
            currentTime={currentTime}
            onSeek={handleSeek}
            onChange={handleGroupsChange}
            onPositionChange={handleGroupsPositionChange}
            onBeforeEdit={pushUndo}
            defaults={wordStyleDefaults}
            positionDefaults={{ posX: settings.posX, posY: settings.posY }}
            mediaDuration={result.duration}
          />
        )}
      </div>

      {/* Resize handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Right area: player */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <AlignmentNotice visible={alignmentDegraded} />
        {/* `segments` is the timeline — raw groups, because its drag targets must
            stay on the ends the user actually owns. `overlaySegments` is the
            caption preview, which shows the derived, gap-closed ends. */}
        <AudioPlayer
          ref={playerRef}
          audioPath={result.audioPath}
          segments={groups}
          overlaySegments={displayGroups}
          settings={settings}
          resolution={settings.resolution}
          onTimeUpdate={handleTimeUpdate}
          onSeek={handleSeekDone}
          seekTo={seekTarget}
          onSegmentEdge={handleSegmentEdge}
          onSegmentEdgeDragStart={handleSegmentEdgeDragStart}
          onWordEdge={handleWordEdge}
          onWordEdgeDragStart={handleWordEdgeDragStart}
          onWordContextMenu={handleTimelineWordContextMenu}
          onGroupContextMenu={handleTimelineGroupContextMenu}
        />
      </div>

      {wordPopup && groups[wordPopup.groupIdx]?.words[wordPopup.wordIdx] && (
        <WordStylePopup
          word={groups[wordPopup.groupIdx].words[wordPopup.wordIdx].word}
          overrides={groups[wordPopup.groupIdx].words[wordPopup.wordIdx].overrides ?? {}}
          anchorRect={wordPopup.anchorRect}
          defaults={wordStyleDefaults}
          onApply={(ov) => applyTimelineWordOverride(wordPopup.groupIdx, wordPopup.wordIdx, ov)}
          onReset={() => applyTimelineWordOverride(wordPopup.groupIdx, wordPopup.wordIdx, {})}
          onTextCommit={(newText) =>
            applyTimelineWordText(wordPopup.groupIdx, wordPopup.wordIdx, newText)
          }
          onClose={() => setWordPopup(null)}
        />
      )}

      {groupPosPopup && groups[groupPosPopup.groupIdx] && (
        <GroupPositionPopup
          groupLabel={`#${groupPosPopup.groupIdx + 1} ${groups[groupPosPopup.groupIdx].text}`}
          override={groups[groupPosPopup.groupIdx].positionOverride ?? {}}
          anchorRect={groupPosPopup.anchorRect}
          defaults={{ posX: settings.posX, posY: settings.posY }}
          onApply={(ov) => applyTimelineGroupPosition(groupPosPopup.groupIdx, ov)}
          onReset={() => applyTimelineGroupPosition(groupPosPopup.groupIdx, {})}
          onClose={() => setGroupPosPopup(null)}
        />
      )}
    </div>
  )
}

// ── TabButton ─────────────────────────────────────────────────────

interface TabButtonProps {
  id: string
  active: boolean
  onClick: () => void
  /** ArrowLeft/ArrowRight pressed while the tab has focus. */
  onArrow: () => void
  children: React.ReactNode
}

function TabButton({ id, active, onClick, onArrow, children }: TabButtonProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={[
        'text-xs px-3 py-1.5 rounded-t transition-colors border-b-2',
        active ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]' : 'border-transparent',
      ].join(' ')}
      style={{
        color: active ? 'var(--color-text)' : hovered ? 'var(--color-text)' : 'var(--color-text-3)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          // Stop the event reaching the window-level playback handler,
          // which maps ←/→ to frame stepping.
          e.stopPropagation()
          onArrow()
        }
      }}
    >
      {children}
    </button>
  )
}
