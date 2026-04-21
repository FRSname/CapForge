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
import type { ProjectFile, ProjectIOHandle } from '../../lib/project'
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
}

type EditorView = 'text' | 'groups'

export function ResultsScreen({ result, settings, onGroupsUpdate, projectIORef }: ResultsScreenProps) {
  // Segments are mutable (user can edit timing + word overrides)
  const [segments, setSegments] = useState<Segment[]>(result.segments)
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | null>(null)
  const [view, setView] = useState<EditorView>('text')

  // Display groups — held as state (not useMemo) so manual merge/split edits
  // from GroupEditor stick. The useEffect below re-derives them whenever the
  // source segments or wpg change, matching vanilla's behaviour.
  const [groups, setGroups] = useState<Segment[]>(
    () => buildStudioGroups(result.segments, settings.wordsPerGroup),
  )
  // True once the user manually merges/splits/reorders groups — flag is sent
  // to the backend so renderSubtitleVideo uses `custom_groups` instead of
  // re-chunking from the stored transcription.
  const [groupsEdited, setGroupsEdited] = useState(false)
  // True once the user edits segments (text, timing, etc.) — ensures the
  // re-derived groups are still sent to the backend for rendering.
  const [segmentsEdited, setSegmentsEdited] = useState(false)

  const playerRef = useRef<AudioPlayerHandle>(null)

  // ── Undo/redo for segment edits ────────────────────────────────
  const { pushUndo, undo, redo } = useUndoRedo(segments, setSegments)

  const prevWpg = useRef(settings.wordsPerGroup)
  useEffect(() => {
    const wpgChanged = settings.wordsPerGroup !== prevWpg.current
    prevWpg.current = settings.wordsPerGroup

    if (groupsEdited && !wpgChanged) {
      // Groups were manually edited and wpg unchanged — preserve group
      // boundaries but sync updated word data from the new segments.
      const allWords = segments.flatMap(s => s.words)
      let wi = 0
      setGroups(prev => prev.map(g => {
        const count = g.words.length
        const updated = allWords.slice(wi, wi + count)
        wi += count
        if (updated.length === 0) return g
        return {
          ...g,
          start: updated[0].start,
          end:   updated[updated.length - 1].end,
          text:  updated.map(w => w.word).join(' '),
          words: updated,
        }
      }))
    } else {
      // Rebuild from scratch — either no manual edits, or user changed wpg
      // which should override manual grouping.
      setGroups(buildStudioGroups(segments, settings.wordsPerGroup))
      if (wpgChanged) setGroupsEdited(false)
    }
  }, [segments, settings.wordsPerGroup])  // eslint-disable-line react-hooks/exhaustive-deps

  // Publish groups + edited state to App for StudioPanel.
  useEffect(() => {
    onGroupsUpdate(groups, groupsEdited || segmentsEdited)
  }, [groups, groupsEdited, segmentsEdited])  // eslint-disable-line react-hooks/exhaustive-deps

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
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  // ── Playback keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (editable) return

      const p = playerRef.current
      if (!p) return

      switch (e.key) {
        case 'j': case 'J': e.preventDefault(); p.seekRelative(-2); break
        case 'k': case 'K': e.preventDefault(); p.playPause(); break
        case 'l': case 'L': e.preventDefault(); p.seekRelative(2); break
        case 'ArrowLeft':   e.preventDefault(); p.seekRelative(-1 / 30); break
        case 'ArrowRight':  e.preventDefault(); p.seekRelative(1 / 30); break
        case ',': {
          e.preventDefault()
          let gi = -1
          for (let i = groups.length - 1; i >= 0; i--) {
            if (groups[i].start < currentTime - 0.01) { gi = i; break }
          }
          if (gi >= 0) p.seekToTime(groups[gi].start)
          break
        }
        case '.': {
          e.preventDefault()
          const gi = groups.findIndex(g => g.start > currentTime + 0.01)
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
          version:             PROJECT_VERSION,
          suggestedName:       suggestProjectName(result.audioPath),
          selectedFilePath:    result.audioPath,
          outputDir:           'output',
          transcriptionResult: { ...result, segments },
          studioSettings:      settings,
          customGroupsEdited:  anyEdited,
          studioGroups:        anyEdited ? groups : null,
        }
      },
      restore: (file: ProjectFile) => {
        if (file.customGroupsEdited && file.studioGroups) {
          setGroups(file.studioGroups)
          setGroupsEdited(true)
        }
      },
    }
    return () => { projectIORef.current = null }
  })

  const handleTimeUpdate = useCallback((t: number) => setCurrentTime(t), [])

  const handleSeek = useCallback((t: number) => {
    setCurrentTime(t)
    setSeekTarget(t)
  }, [])

  const handleSeekDone = useCallback(() => setSeekTarget(null), [])

  // Timeline edge-drag: adjust a group's start or end time.
  const handleSegmentEdge = useCallback((segId: string, edge: 'start' | 'end', newTime: number) => {
    setGroups(prev => prev.map(g =>
      g.id !== segId ? g : { ...g, [edge]: newTime }
    ))
    setGroupsEdited(true)
  }, [])

  // Defaults the WordStylePopup uses to compute "hasOverride" for each field.
  const wordStyleDefaults = useMemo<WordStyleDefaults>(() => ({
    textColor:   settings.textColor,
    activeColor: settings.activeColor,
    bold:        settings.fontWeight >= 600,
    fontName:    settings.fontName,
    wordTransition:     settings.wordStyle as WordStyleDefaults['wordTransition'],
    highlightRadius:    settings.highlightRadius,
    highlightPadX:      settings.highlightPadX,
    highlightPadY:      settings.highlightPadY,
    highlightOpacity:   settings.highlightOpacity,
    underlineThickness: settings.underlineThickness,
    underlineColor:     settings.underlineColor,
    bounceStrength:     settings.bounceStrength,
    scaleFactor:        settings.scaleFactor,
  }), [
    settings.textColor, settings.activeColor, settings.fontWeight, settings.fontName,
    settings.wordStyle, settings.highlightRadius, settings.highlightPadX, settings.highlightPadY,
    settings.highlightOpacity, settings.underlineThickness, settings.underlineColor,
    settings.bounceStrength, settings.scaleFactor,
  ])

  return (
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
      />

      {/* View tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-[var(--color-border)] shrink-0">
        <TabButton active={view === 'text'} onClick={() => setView('text')}>
          Text
        </TabButton>
        <TabButton active={view === 'groups'} onClick={() => setView('groups')}>
          Groups
        </TabButton>
        <span className="ml-auto text-[10px] text-[var(--color-text-3)]">
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
          onChange={(next: Segment[]) => { setSegments(next); setSegmentsEdited(true) }}
          onBeforeEdit={pushUndo}
          defaults={wordStyleDefaults}
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
  )
}

// ── TabButton ─────────────────────────────────────────────────────

interface TabButtonProps {
  active:   boolean
  onClick:  () => void
  children: React.ReactNode
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      className={[
        'text-xs px-3 py-1.5 rounded-t transition-colors border-b-2',
        active
          ? 'border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-surface-2)]'
          : 'border-transparent text-[var(--color-text-3)] hover:text-[var(--color-text)]',
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
