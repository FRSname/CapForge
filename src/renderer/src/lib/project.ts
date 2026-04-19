/**
 * Project (.capforge) file shape + helpers.
 * Ports saveProject()/openProject() from app.js:3778-3864.
 *
 * A project snapshot captures everything needed to reopen a working session:
 * the source file path, the transcription result, the studio settings, and
 * any manual group edits the user has made. The actual file I/O happens in
 * the main process (window.subforge.saveProject / openProject).
 */

import type { TranscriptionResult, Segment } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'

export const PROJECT_VERSION = 1

export interface ProjectFile {
  version:              number
  /** Preferred file name shown in the native save dialog (e.g. "my-video.capforge"). */
  suggestedName?:       string
  /** Absolute path that was transcribed. */
  selectedFilePath:     string | null
  outputDir:            string
  transcriptionResult:  TranscriptionResult
  studioSettings:       StudioSettings
  /** True when the user manually merged/split/reordered groups. */
  customGroupsEdited:   boolean
  /** Manually-edited groups — only populated when customGroupsEdited is true. */
  studioGroups:         Segment[] | null
  /** Populated by the main process on read so we know what path to save back to. */
  _filePath?:           string
}

/**
 * What ResultsScreen exposes to its parent — the App uses this to save/load a
 * project without owning every piece of editor state directly.
 */
export interface ProjectIOHandle {
  /** Snapshot the current editor state into a ProjectFile payload. */
  gather:  () => Omit<ProjectFile, '_filePath'>
  /** Apply a ProjectFile loaded from disk, restoring editor state. */
  restore: (file: ProjectFile) => void
}

/** Strip extension + folder from a path → "my-video". */
export function suggestProjectName(filePath: string | null): string {
  if (!filePath) return 'project.capforge'
  const stem = filePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  return `${stem}.capforge`
}
