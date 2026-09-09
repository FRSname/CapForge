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
import type { CaptionTrack, TrackEditorState } from '../../lib/tracks'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import { useTimelineEditing } from '../../hooks/useTimelineEditing'
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
  /** The active track's transcript: project metadata + that track's segments. */
  result: TranscriptionResult
  /** Which caption track this editor is mounted on (App re-keys on a switch). */
  trackId: string
  /** Studio settings — owned by App.tsx, read-only here. */
  settings: StudioSettings
  /**
   * True on the source track: groups may be rebuilt from document order when
   * the transcript or `wordsPerGroup` changes. False on a translated track,
   * whose grouping is inherited from the source (`reflowTrack` is the only way
   * it changes) — a rebuild there would re-chunk the translation into arbitrary
   * N-word blocks and throw the source links away.
   */
  autoGroup: boolean
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

export function ResultsScreen({
  result,
  trackId,
  settings,
  autoGroup,
  initialGroups,
  initialGroupsEdited,
  initialSegmentsEdited,
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
      return syncSegmentsIntoTrack(shim, segments, settings.wordsPerGroup, wpgChanged).groups
    })
    // A wpg change hands the groups back to the automatic pass — the same flag
    // `syncSegmentsIntoTrack` returns on the rebuild branch.
    if (wpgChanged && autoGroup) setGroupsEdited(false)
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
