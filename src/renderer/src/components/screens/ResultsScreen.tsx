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
import { buildStudioGroups } from '../../lib/groups'
import type { ProjectFile, ProjectIOHandle, WordOverrideEdit } from '../../lib/project'
import { PROJECT_VERSION, suggestProjectName } from '../../lib/project'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import { AudioPlayer, type AudioPlayerHandle } from '../player/AudioPlayer'
import { SubtitleEditor } from '../editor/SubtitleEditor'
import { GroupEditor } from '../editor/GroupEditor'
import type { WordStyleDefaults } from '../editor/WordStylePopup'
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
  // Segments are mutable (user can edit timing + word overrides)
  const [segments, setSegments] = useState<Segment[]>(result.segments)
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | null>(null)
  const [view, setView] = useState<EditorView>('text')

  // Display groups — held as state (not useMemo) so manual merge/split edits
  // from GroupEditor stick. The useEffect below re-derives them whenever the
  // source segments or wpg change, matching vanilla's behaviour.
  const [groups, setGroups] = useState<Segment[]>(() =>
    buildStudioGroups(result.segments, settings.wordsPerGroup)
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
  const [editorWidth, setEditorWidth] = useState(420)

  const playerRef = useRef<AudioPlayerHandle>(null)

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

  const prevWpg = useRef(settings.wordsPerGroup)
  const prevSegCount = useRef(segments.length)
  useEffect(() => {
    // Skip when undo/redo is restoring state — groups are already set from the snapshot.
    if (isRestoringRef.current) {
      isRestoringRef.current = false
      prevWpg.current = settings.wordsPerGroup
      prevSegCount.current = segments.length
      return
    }

    const wpgChanged = settings.wordsPerGroup !== prevWpg.current
    prevWpg.current = settings.wordsPerGroup
    const segCountChanged = segments.length !== prevSegCount.current
    prevSegCount.current = segments.length

    if (groupsEdited && !wpgChanged && !segCountChanged) {
      // Groups were manually edited, wpg unchanged, and no segments added/removed —
      // preserve group boundaries but sync updated word data from the new segments.
      // The word-index sync is only safe when the total word pool is stable; adding
      // or removing a segment shifts the pool and misaligns the wi counter.
      const allWords = segments.flatMap((s) => s.words)
      // wi must live inside the updater so React Strict Mode's double-invocation
      // of the updater function starts fresh each time rather than indexing past
      // the end of allWords on the second call (which would return prev unchanged).
      setGroups((prev) => {
        let wi = 0
        return prev.map((g) => {
          const count = g.words.length
          const slice = allWords.slice(wi, wi + count)
          wi += count
          if (slice.length === 0) return g
          // Per-word style overrides are authored only in the Groups editor and
          // live solely on the group word (never on the source segment word), so
          // carry them forward by index — the sync refreshes word text/timing
          // while the user's styling persists.
          const updated = slice.map((w, j) => {
            const prevOv = g.words[j]?.overrides
            return prevOv ? { ...w, overrides: prevOv } : w
          })
          // Preserve g.start / g.end — manual timeline drags live there and
          // must not be overwritten by word-level timestamps from segments.
          return {
            ...g,
            text: updated.map((w) => w.word).join(' '),
            words: updated,
          }
        })
      })
    } else if (groupsEdited && !wpgChanged && segCountChanged) {
      // Segment count changed (add/delete/split) while user had manual edits.
      // Rebuild structure from scratch but restore manually-dragged start/end for
      // any group whose ID survived the change. Group IDs are ${seg.id}:${offset},
      // so segments that weren't touched keep stable IDs and their timing is preserved.
      setGroups((prev) => {
        const oldById = new Map(prev.map((g) => [g.id, g]))
        return buildStudioGroups(segments, settings.wordsPerGroup).map((g) => {
          const saved = oldById.get(g.id)
          if (!saved) return g
          // Restore manual timing AND per-word overrides for any group whose ID
          // survived the segment change. buildStudioGroups re-chunks untouched
          // segments identically, so word index j maps to the same word.
          return {
            ...g,
            start: saved.start,
            end: saved.end,
            words: g.words.map((w, j) => {
              const ov = saved.words[j]?.overrides
              return ov ? { ...w, overrides: ov } : w
            }),
          }
        })
      })
    } else {
      // Rebuild from scratch — no manual edits or wpg changed.
      setGroups(buildStudioGroups(segments, settings.wordsPerGroup))
      if (wpgChanged) setGroupsEdited(false)
    }
  }, [segments, settings.wordsPerGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  // Publish groups + edited state to App for StudioPanel.
  useEffect(() => {
    onGroupsUpdate(groups, groupsEdited || segmentsEdited)
  }, [groups, groupsEdited, segmentsEdited]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wrapper that GroupEditor calls — flips the edited flag the first time the
  // user touches the groups.
  const handleGroupsChange = useCallback((next: Segment[]) => {
    setGroups(next)
    setGroupsEdited(true)
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
        return {
          version: PROJECT_VERSION,
          suggestedName: suggestProjectName(result.audioPath),
          selectedFilePath: result.audioPath,
          outputDir: 'output',
          transcriptionResult: { ...result, segments },
          studioSettings: settings,
          customGroupsEdited: anyEdited,
          studioGroups: anyEdited ? groups : null,
        }
      },
      restore: (file: ProjectFile) => {
        if (file.customGroupsEdited && file.studioGroups) {
          setGroups(file.studioGroups)
          setGroupsEdited(true)
        }
      },
      applyAgentResult: (agentResult: TranscriptionResult) => {
        // Replace the live transcript with the agent's edit. pushUndo first so
        // the user can revert. setSegmentsEdited re-publishes derived groups.
        pushUndo()
        setSegments(agentResult.segments)
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
    setSegments((prev) => [...prev, newSeg].sort((a, b) => a.start - b.start))
    setSegmentsEdited(true)
    setView('text')
    setFocusSegmentId(newSeg.id)
  }, [currentTime, pushUndo])

  // Timeline edge-drag: adjust a group's start/end time or move the whole block.
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
            return { ...g, start: newVal.start, end: newVal.end }
          }
          return typeof newVal === 'number' ? { ...g, [edge]: newVal } : g
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
      underlineThickness: settings.underlineThickness,
      underlineColor: settings.underlineColor,
      bounceStrength: settings.bounceStrength,
      scaleFactor: settings.scaleFactor,
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
      settings.underlineThickness,
      settings.underlineColor,
      settings.bounceStrength,
      settings.scaleFactor,
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
          <span className="text-2xs text-[var(--color-text-3)] ml-auto">
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
              setSegments(next)
              setSegmentsEdited(true)
            }}
            onBeforeEdit={pushUndo}
            onAddSegment={handleAddSegment}
            focusSegmentId={focusSegmentId}
            onFocusConsumed={() => setFocusSegmentId(null)}
          />
        ) : (
          <GroupEditor
            groups={groups}
            currentTime={currentTime}
            onSeek={handleSeek}
            onChange={handleGroupsChange}
            onBeforeEdit={pushUndo}
            defaults={wordStyleDefaults}
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
        <AudioPlayer
          ref={playerRef}
          audioPath={result.audioPath}
          segments={groups}
          settings={settings}
          resolution={settings.resolution}
          onTimeUpdate={handleTimeUpdate}
          onSeek={handleSeekDone}
          seekTo={seekTarget}
          onSegmentEdge={handleSegmentEdge}
          onSegmentEdgeDragStart={handleSegmentEdgeDragStart}
        />
      </div>
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
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={[
        'text-xs px-3 py-1.5 rounded-t transition-colors border-b-2',
        active
          ? 'border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-surface-2)]'
          : 'border-transparent text-[var(--color-text-3)] hover:text-[var(--color-text)]',
      ].join(' ')}
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
