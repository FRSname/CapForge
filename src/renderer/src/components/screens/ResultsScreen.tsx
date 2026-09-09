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
import type { TranscriptionResult, Segment } from '../../types/app'
import { buildStudioGroups, closeGroupGaps, fillGroupGaps } from '../../lib/groups'
import { ensureWordIds } from '../../lib/wordIds'
import { DEFAULT_PAD_V } from '../../lib/renderConstants'
import type { ProjectIOHandle, WordOverrideEdit } from '../../lib/project'
import { syncSegmentsIntoTrack } from '../../lib/tracks'
import { sameSentenceSegments, sentenceSegmentsFor } from '../../lib/trackSentences'
import type { CaptionTrack, TrackEditorState, TrackGroupState } from '../../lib/tracks'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import { useTimelineEditing } from '../../hooks/useTimelineEditing'
import { useEditorShortcuts } from '../../hooks/useEditorShortcuts'
import { useToast } from '../../hooks/useToast'
import { api, type RealignSegmentPayload } from '../../lib/api'
import { AudioPlayer, type AudioPlayerHandle } from '../player/AudioPlayer'
import { AlignmentNotice } from './AlignmentNotice'
import { SubtitleEditor } from '../editor/SubtitleEditor'
import { GroupEditor } from '../editor/GroupEditor'
import { WordStylePopup, type WordStyleDefaults } from '../editor/WordStylePopup'
import { GroupPositionPopup } from '../editor/GroupPositionPopup'
import type { StudioSettings } from '../studio/StudioPanel'
import { TabButton } from './EditorViewTab'
import { ReflowBanner } from '../tracks/ReflowBanner'

interface ResultsScreenProps {
  /** The active track's transcript: project metadata + that track's segments. */
  result: TranscriptionResult
  /** Which caption track this editor is mounted on (App re-keys on a switch). */
  trackId: string
  /** Studio settings — owned by App.tsx, read-only here. */
  settings: StudioSettings
  /**
   * True on the source track: groups may be rebuilt from document order when
   * the transcript or `wordsPerGroup` changes. False on a translated track,
   * whose grouping is inherited — a rebuild there would re-chunk the translation
   * into arbitrary N-word blocks and throw the source links away. A translated
   * `wordsPerGroup` change is *not* that rebuild: `syncSegmentsIntoTrack`
   * re-chunks each *sentence* in place (`lib/trackChunking.ts`).
   */
  autoGroup: boolean
  /**
   * `wid → source segment index` (`lib/trackSentences.ts`), from App's store.
   * On a translated track it is what says which *sentence* a caption belongs
   * to, which is both what the Text view lists and what `wordsPerGroup`
   * re-chunks. Unused on the source track, whose segments are the transcript.
   */
  widToSegment?: ReadonlyMap<string, number>
  /**
   * The track's stored raw groups, adopted verbatim. Read **only** by the
   * `useState` initializer: a prop change must never reset editor state, or a
   * project restore/agent write would clobber whatever the user is doing. The
   * remount key is the one reset.
   */
  initialGroups: Segment[] | null
  initialGroupsEdited: boolean
  /** The stored "segments were edited" claim. Seeded, not assumed false: an
   *  agent transcript edit can land on a track while another tab is up, and
   *  losing the flag on the switch back would drop `custom_groups` from the
   *  render and let the backend re-chunk the transcript. */
  initialSegmentsEdited: boolean
  /**
   * Translated tracks only: each group's state against the source words it was
   * written from (`classifyTrack`), keyed by group id. Threaded straight to
   * `GroupEditor`, which renders a chip per row.
   */
  groupStates?: ReadonlyMap<string, TrackGroupState>
  /** The source's *chunking* moved since this track was created/re-flowed, so
   *  its groups no longer line up with anything — `onReflow` is the repair. */
  reflowNeeded?: boolean
  /** How many of this track's captions are stale — the banner's second line. */
  staleCount?: number
  /** Run `reflowTrack` on this track. App owns the store, so it owns the write;
   *  this component only pushes an undo entry first. Absent on the source. */
  onReflow?: () => void
  /** Publish the editor's raw state back to the track store on every change. */
  onTrackStateChange: (state: TrackEditorState) => void
  /** Fires once the transcript is known to carry approximate word timings, so
   *  App can persist the flag with the project. */
  onAlignmentDegraded?: () => void
  /** Ref App.tsx uses to reach into the mounted editor (agent edits + undo). */
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

/** A stable empty map, so the default prop cannot churn the derive effect. */
const NO_SENTENCES: ReadonlyMap<string, number> = new Map()

export function ResultsScreen({
  result,
  trackId,
  settings,
  autoGroup,
  widToSegment = NO_SENTENCES,
  initialGroups,
  initialGroupsEdited,
  initialSegmentsEdited,
  groupStates,
  reflowNeeded = false,
  staleCount = 0,
  onReflow,
  onTrackStateChange,
  onAlignmentDegraded,
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
  // A track that already has groups (restored project, translated skeleton,
  // a tab switched back to) hands them in; otherwise they are chunked here.
  const [groups, setGroups] = useState<Segment[]>(
    () => initialGroups ?? buildStudioGroups(segments, settings.wordsPerGroup)
  )
  // True once the user manually merges/splits/reorders groups — flag is sent
  // to the backend so renderSubtitleVideo uses `custom_groups` instead of
  // re-chunking from the stored transcription.
  const [groupsEdited, setGroupsEdited] = useState(initialGroupsEdited)
  // True once the user edits segments (text, timing, etc.) — ensures the
  // re-derived groups are still sent to the backend for rendering.
  const [segmentsEdited, setSegmentsEdited] = useState(initialSegmentsEdited)
  // Transient: when set, SubtitleEditor scrolls/focuses that segment's text
  // field (used right after a manual "+ Add subtitle" so the user can type).
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null)
  const [editorWidth, setEditorWidth] = useState(420)
  // Segment id currently being re-aligned via /api/realign (null = idle).
  const [realigningSegId, setRealigningSegId] = useState<string | null>(null)
  // Once any fallback timings enter the transcript, keep the warning visible:
  // later successful realignments do not prove every other word is precise.
  const [alignmentDegraded, setAlignmentDegraded] = useState(Boolean(result.alignmentDegraded))

  const playerRef = useRef<AudioPlayerHandle>(null)
  const { toast } = useToast()

  // Degraded alignment is a property of the *transcript*, not of this editor, so
  // App is told as well — it owns `result`, and the project file must remember
  // that these timings are approximate.
  const markAlignmentDegraded = useCallback(() => {
    setAlignmentDegraded(true)
    onAlignmentDegraded?.()
  }, [onAlignmentDegraded])

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

    // Both branches live in `syncSegmentsIntoTrack` (lib/tracks.ts) so the store
    // can run the same reconciliation on a track that is *not* mounted (an agent
    // transcript edit while another tab is up). Restating what it guarantees,
    // because it is the reason this code exists:
    //
    // When the user has arranged these groups by hand, membership is theirs, not
    // a function of document order, so words are matched back to the segments by
    // `wid` and stay in the group the user put them in — a word moved to a
    // non-adjacent group, a reordered group, a merge or a split all survive an
    // edit to the source segments. NEVER re-slice a flat word pool by index:
    // that silently restores document order, which is the bug this replaced
    // (docs/plans/fill-gaps-resets-custom-groups.md).
    //
    // On a translated track a wpg change takes neither path — it re-chunks each
    // *sentence* (`lib/trackChunking.ts`). This effect fires for both
    // kinds of track; `isSource: autoGroup` below is the only switch.
    //
    // Otherwise the groups are rebuilt from scratch. Position overrides don't
    // set groupsEdited (they don't change boundaries), so they are carried
    // forward by group ID; a wpg change shifts the ${seg.id}:${offset} IDs,
    // dropping overrides for regrouped chunks — intentional, the old grouping no
    // longer exists.
    setGroups((prev) => {
      const shim: CaptionTrack = {
        id: trackId,
        label: '',
        lang: '',
        // The rebuild branch is the source track's alone (see `autoGroup`).
        isSource: autoGroup,
        segments,
        groups: prev,
        groupsEdited,
        segmentsEdited,
        settings,
        appliedPreset: null,
      }
      return syncSegmentsIntoTrack(shim, segments, settings.wordsPerGroup, wpgChanged, widToSegment)
        .groups
    })
    // A wpg change hands the source's groups back to the automatic pass; a
    // translated re-chunk is still authored grouping. Either way, the flag
    // `syncSegmentsIntoTrack` returns.
    if (wpgChanged) setGroupsEdited(!autoGroup)
  }, [segments, settings.wordsPerGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A translated track's Text view is a list of the source's **sentences**, and
   * that list is *derived* from the groups — one row per sentence, however many
   * captions the sentence is chunked into (`lib/trackSentences.ts`). So it is
   * re-derived after every group change, which closes the loop with the effect
   * above: a Text-view edit retimes inside the sentence's span, reconciles by
   * `wid` into the chunked groups, and comes back as the same sentence list.
   *
   * `sameSentenceSegments` is what makes the pair converge — the derivation
   * builds fresh arrays, so without a content comparison the two effects would
   * trigger each other forever. The source track keeps its transcript.
   */
  useEffect(() => {
    if (autoGroup || widToSegment.size === 0) return
    // Deriving state from state, deliberately and in exactly the same shape as
    // the groups effect above: `segments` is *edited* here (the Text view), so
    // it cannot become a `useMemo`, and the content guard stops the cascade at
    // one render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSegments((prev) => {
      const derived = sentenceSegmentsFor(groups, widToSegment, trackId)
      return sameSentenceSegments(prev, derived) ? prev : derived
    })
  }, [groups, widToSegment, autoGroup, trackId])

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
   * Deliberate cosmetic consequence: the Groups editor and the timeline show a
   * group's *original* end while the preview holds the caption longer. Raw ends
   * are the drag/edit target, so they must stay honest.
   */
  const displayGroups = useMemo(
    () => closeGroupGaps(groups, settings.gapCloseThreshold, settings.lastGroupHold),
    [groups, settings.gapCloseThreshold, settings.lastGroupHold]
  )

  // Publish the editor's state into the track store on every change, so the
  // store is always a checkpoint of this tab and nothing has to be gathered out
  // of the component at save time.
  //
  // **Raw** groups go up, never `displayGroups`: gap closing and the tail hold
  // are a derived view (see the comment above), and writing them back as state
  // would compound the hold by one per edit. App re-derives the display groups
  // from the store with the very same call.
  //
  // Requires `onTrackStateChange` to be referentially stable, or this effect
  // re-runs on every App render.
  useEffect(() => {
    onTrackStateChange({ segments, groups, groupsEdited, segmentsEdited })
  }, [segments, groups, groupsEdited, segmentsEdited, onTrackStateChange])

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

  // "Re-flow from source" — the UI twin of the agent's `reflow_track`. App owns
  // the store, so it does the rewrite and bumps this track's revision, which
  // remounts this component with the new skeleton as `initialGroups`.
  //
  // The undo push is what the plan asks for and costs nothing, but be honest
  // about its reach: the remount replaces this editor's undo stack, so it only
  // protects an undo taken before the click lands, not the re-flow itself.
  // Re-flowing back is `reflowTrack` again once the source is put back.
  const handleReflow = useCallback(() => {
    if (!onReflow) return
    pushUndo()
    onReflow()
  }, [onReflow, pushUndo])

  // Position-only updates (per-group position override) — deliberately do NOT
  // flip groupsEdited: boundaries are untouched, so re-grouping must keep
  // working and the backend only needs custom_groups because of the override
  // (render.ts widens the send condition on positionOverride presence).
  const handleGroupsPositionChange = useCallback((next: Segment[]) => {
    setGroups(next)
  }, [])

  // Keyboard: undo/redo, playback transport, ⌘1/⌘2 view switch
  // (`hooks/useEditorShortcuts.ts` — lifted out of this file verbatim).
  useEditorShortcuts({ undo, redo, playerRef, groups, currentTime, setView })

  // ── Project I/O handle ─────────────────────────────────────────────
  // Save/restore are NOT here: App composes the project file from the track
  // store (which this component checkpoints on every change) and restores by
  // re-keying this component with fresh initial props. What remains is the pair
  // of agent reach-ins that must land in the *mounted* editor, because they push
  // an undo entry the user can revert.
  useEffect(() => {
    if (!projectIORef) return
    projectIORef.current = {
      applyAgentResult: (agentResult: TranscriptionResult) => {
        // Replace the live transcript with the agent's edit. pushUndo first so
        // the user can revert. setSegmentsEdited re-publishes derived groups.
        pushUndo()
        commitSegments(agentResult.segments)
        if (agentResult.alignmentDegraded) markAlignmentDegraded()
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

  // Timeline edge drags + the word/group right-click popups (hooks/useTimelineEditing.ts).
  const {
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
  } = useTimelineEditing({
    groups,
    setGroups,
    setGroupsEdited,
    onPositionChange: handleGroupsPositionChange,
    pushUndo,
    // `autoGroup` is exactly `track.isSource` (see the prop's doc), so its
    // inverse is "this editor is mounted on a translated track".
    translated: !autoGroup,
  })

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
          markAlignmentDegraded()
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
    [segments, realigningSegId, result.language, pushUndo, toast, commitSegments, markAlignmentDegraded]
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
              title="Close EVERY gap, ignoring the “Gap close” slider in the Layout card — every caption is stretched to the start of the next group, including across real pauses. Short gaps are already closed automatically; use this to bake the rest, then shorten individual group end times to carve deliberate gaps back out."
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

        {/* Translated track whose source was re-chunked (§G-6). Shown in both
            views: the mismatch is a property of the track, not of the view. */}
        {!autoGroup && reflowNeeded && onReflow && (
          <ReflowBanner staleCount={staleCount} onReflow={handleReflow} />
        )}

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
            groupStates={groupStates}
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
