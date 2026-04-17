/**
 * Results screen — shown after transcription completes.
 * Layout: results-main (flex-1) | results-sidebar (StudioPanel, 380px).
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
import { api } from '../../lib/api'
import { buildStudioGroups } from '../../lib/groups'
import type { ProjectFile, ProjectIOHandle } from '../../lib/project'
import { PROJECT_VERSION, suggestProjectName } from '../../lib/project'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import { AudioPlayer } from '../player/AudioPlayer'
import { SubtitleEditor } from '../editor/SubtitleEditor'
import { GroupEditor } from '../editor/GroupEditor'
import type { WordStyleDefaults } from '../editor/WordStylePopup'
import { StudioPanel, STUDIO_DEFAULTS, snapFps } from '../studio/StudioPanel'
import type { StudioSettings } from '../studio/StudioPanel'

interface ResultsScreenProps {
  result: TranscriptionResult
  /** Ref that App.tsx uses to gather/restore project state for save/open. */
  projectIORef?: React.MutableRefObject<ProjectIOHandle | null>
}

type EditorView = 'text' | 'groups'

export function ResultsScreen({ result, projectIORef }: ResultsScreenProps) {
  // Segments are mutable (user can edit timing + word overrides)
  const [segments, setSegments] = useState<Segment[]>(result.segments)
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | null>(null)
  const [settings, setSettings] = useState<StudioSettings>({ ...STUDIO_DEFAULTS })
  const [view, setView] = useState<EditorView>('text')

  // Display groups — held as state (not useMemo) so manual merge/split edits
  // from GroupEditor stick. The useEffect below re-derives them whenever the
  // source segments or wpg change, matching vanilla's behaviour.
  const [groups, setGroups] = useState<Segment[]>(
    () => buildStudioGroups(result.segments, STUDIO_DEFAULTS.wordsPerGroup),
  )
  // True once the user manually merges/splits/reorders groups — flag is sent
  // to the backend so renderSubtitleVideo uses `custom_groups` instead of
  // re-chunking from the stored transcription.
  const [groupsEdited, setGroupsEdited] = useState(false)

  // ── Undo/redo for segment edits ────────────────────────────────
  const { pushUndo, undo, redo, clear: clearUndo, canUndo, canRedo } = useUndoRedo(segments, setSegments)

  useEffect(() => {
    // Source changed → reset to the auto-chunked groups and clear the edited
    // flag. Any manual edits are discarded (matches vanilla's rebuild on wpg).
    setGroups(buildStudioGroups(segments, settings.wordsPerGroup))
    setGroupsEdited(false)
  }, [segments, settings.wordsPerGroup])

  // Wrapper that GroupEditor calls — flips the edited flag the first time the
  // user touches the groups. Referential equality of `next` vs `groups` would
  // be ideal but React's setState comparison is fine; we just set the flag.
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

  // ── Project I/O handle ─────────────────────────────────────────────
  // Expose gather/restore so App can save/open .capforge files without
  // owning every piece of editor state directly.
  useEffect(() => {
    if (!projectIORef) return
    projectIORef.current = {
      gather: () => ({
        version:             PROJECT_VERSION,
        suggestedName:       suggestProjectName(result.audioPath),
        selectedFilePath:    result.audioPath,
        outputDir:           'output',
        transcriptionResult: result,
        studioSettings:      settings,
        customGroupsEdited:  groupsEdited,
        studioGroups:        groupsEdited ? groups : null,
      }),
      restore: (file: ProjectFile) => {
        setSettings(file.studioSettings)
        if (file.customGroupsEdited && file.studioGroups) {
          setGroups(file.studioGroups)
          setGroupsEdited(true)
        }
      },
    }
    return () => { projectIORef.current = null }
  })

  // Auto-load source video info (width/height/fps) — ports applyVideoInfo()
  // from app.js:781-810. Runs once per audioPath, tolerant of audio-only files.
  useEffect(() => {
    if (!result.audioPath) return
    let cancelled = false
    api.getVideoInfo(result.audioPath)
      .then(info => {
        if (cancelled) return
        setSettings(prev => {
          const next = { ...prev }
          if (info.width && info.height) {
            next.resolution = [info.width, info.height]
            next.resolutionIsSource = true
          }
          if (info.fps) next.fps = snapFps(info.fps)
          return next
        })
      })
      .catch(() => { /* ignore — likely audio-only */ })
    return () => { cancelled = true }
  }, [result.audioPath])

  const handleTimeUpdate = useCallback((t: number) => setCurrentTime(t), [])

  const handleSeek = useCallback((t: number) => {
    setCurrentTime(t)
    setSeekTarget(t)   // AudioPlayer reads this to imperatively seek WaveSurfer
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
  // Derived from the current global studio settings, not frozen constants —
  // that matches vanilla, where overrides are relative to the live globals.
  const wordStyleDefaults = useMemo<WordStyleDefaults>(() => ({
    textColor:   settings.textColor,
    activeColor: settings.activeColor,
    bold:        settings.fontWeight >= 600,
    fontName:    settings.fontName,
  }), [settings.textColor, settings.activeColor, settings.fontWeight, settings.fontName])

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <AudioPlayer
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
            onChange={setSegments}
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

      {/* ── Studio sidebar ────────────────────────────────────────── */}
      <StudioPanel
        settings={settings}
        onChange={setSettings}
        groups={groups}
        groupsEdited={groupsEdited}
      />
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
