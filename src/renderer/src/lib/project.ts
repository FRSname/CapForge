/**
 * Project (.capforge) file shape + helpers.
 * Ports saveProject()/openProject() from app.js:3778-3864.
 *
 * A project snapshot captures everything needed to reopen a working session:
 * the source file path, the transcription result, the studio settings, and
 * any manual group edits the user has made. The actual file I/O happens in
 * the main process (window.subforge.saveProject / openProject).
 *
 * **Version 2 is additive.** Every v1 key keeps its v1 meaning — they describe
 * the *source* caption track — and translated tracks ride alongside in `tracks`.
 * A v1 file therefore opens as a project with exactly one track, and a v2 file
 * opened by an older build still finds its transcript, settings and groups where
 * it left them; it simply cannot see the translations. That is a deliberate
 * property, not an accident: the version gate below refuses only files from a
 * *newer* build, where a key it does not understand might change the meaning of
 * one it does.
 */

import type { TranscriptionResult, Segment, WordOverrides } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { buildStudioGroups } from './groups'
import { adoptEndEdited } from './endEdited'
import { adoptWordIds, ensureWordIds } from './wordIds'
import { sanitizeSettings } from './settingsSanitize'
import { SOURCE_TRACK_ID, SOURCE_TRACK_LABEL, type CaptionTrack } from './tracks'

export const PROJECT_VERSION = 2

/** One translated caption track as it is stored. Never the source track. */
export interface TranslatedTrackFile {
  id: string
  label: string
  lang: string
  /** Text-view units. */
  segments: Segment[]
  /** RAW groups (pre-gap-closing), with their `sourceWords` records. */
  groups: Segment[]
  settings: StudioSettings
  appliedPreset: string | null
  sourceSnapshot?: { groupWids: string[][] }
}

export interface ProjectFile {
  version: number
  /** Preferred file name shown in the native save dialog (e.g. "my-video.capforge"). */
  suggestedName?: string
  /** Absolute path that was transcribed. */
  selectedFilePath: string | null
  outputDir: string
  transcriptionResult: TranscriptionResult
  studioSettings: StudioSettings
  /** True when the user manually merged/split/reordered groups. */
  customGroupsEdited: boolean
  /** Groups snapshot — populated when customGroupsEdited is true OR any group
   *  carries a positionOverride (which doesn't flip the edited flag). */
  studioGroups: Segment[] | null
  /** v2+: translated tracks only. Absent on a v1 file, `[]` after migration. */
  tracks?: TranslatedTrackFile[]
  /** v2+: which tab was open. Absent (or unknown) means the source track. */
  activeTrackId?: string
  /** Populated by the main process on read so we know what path to save back to. */
  _filePath?: string
}

/** A project file that cannot be read at all. */
export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFileError'
  }
}

/** A project file written by a newer build than this one. */
export class ProjectVersionError extends ProjectFileError {
  readonly version: number

  constructor(version: number) {
    super(
      `This project was saved by a newer version of CapForge (file version ${version}, this build reads up to ${PROJECT_VERSION}). Update CapForge to open it.`
    )
    this.name = 'ProjectVersionError'
    this.version = version
  }
}

/**
 * What ResultsScreen exposes to its parent — the App uses this to save/load a
 * project without owning every piece of editor state directly.
 */
export interface ProjectIOHandle {
  /** Snapshot the current editor state into a ProjectFile payload. */
  gather: () => Omit<ProjectFile, '_filePath'>
  /** Apply a ProjectFile loaded from disk, restoring editor state. */
  restore: (file: ProjectFile) => void
  /** Replace the live transcript with an agent edit (pushes undo first). */
  applyAgentResult: (result: TranscriptionResult) => void
  /** Merge per-word style overrides onto group words (agent emphasis). */
  applyWordOverrides: (edits: WordOverrideEdit[]) => void
}

/** One per-word override edit, located by group + word index. */
export interface WordOverrideEdit {
  group: number
  word: number
  overrides: WordOverrides
}

/** Strip extension + folder from a path → "my-video". */
export function suggestProjectName(filePath: string | null): string {
  if (!filePath) return 'project.capforge'
  const stem = filePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  return `${stem}.capforge`
}

// ── Reading a file from disk (the trust boundary) ────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireField<T>(ok: boolean, value: T, what: string): T {
  if (!ok) throw new ProjectFileError(`This project file is damaged: ${what}.`)
  return value
}

/** Validate one stored translated track. Throws rather than dropping it. */
function readTrackFile(raw: unknown, i: number): TranslatedTrackFile {
  const where = `track ${i + 1}`
  if (!isRecord(raw)) throw new ProjectFileError(`This project file is damaged: ${where} is not an object.`)

  const str = (key: string): string =>
    requireField(typeof raw[key] === 'string', raw[key] as string, `${where} has no ${key}`)
  const list = (key: string): Segment[] =>
    requireField(Array.isArray(raw[key]), raw[key] as Segment[], `${where}'s ${key} is not a list`)

  const appliedPreset = raw.appliedPreset
  const snapshot = raw.sourceSnapshot

  return {
    id: str('id'),
    label: str('label'),
    lang: str('lang'),
    segments: list('segments'),
    groups: list('groups'),
    settings: requireField(
      isRecord(raw.settings),
      raw.settings as unknown as StudioSettings,
      `${where} has no settings`
    ),
    appliedPreset: typeof appliedPreset === 'string' ? appliedPreset : null,
    ...(isRecord(snapshot) && Array.isArray(snapshot.groupWids)
      ? { sourceSnapshot: { groupWids: snapshot.groupWids as string[][] } }
      : {}),
  }
}

/**
 * Validate a raw parsed `.capforge` payload and lift it to the current version.
 *
 * This is the boundary: everything past it may assume the shape. A v1 file comes
 * back as a v2 file with an empty track list; a file from a newer build is
 * refused with a typed error the caller can turn into a real message instead of
 * a half-restored session. Never mutates the object it was given.
 */
export function migrateProjectFile(raw: unknown): ProjectFile {
  if (!isRecord(raw)) throw new ProjectFileError('This file is not a CapForge project.')

  const rawVersion = raw.version === undefined ? 1 : raw.version
  if (typeof rawVersion !== 'number' || !Number.isFinite(rawVersion)) {
    throw new ProjectFileError('This project file is damaged: its version is not a number.')
  }
  if (rawVersion > PROJECT_VERSION) throw new ProjectVersionError(rawVersion)

  const result = raw.transcriptionResult
  if (!isRecord(result) || !Array.isArray(result.segments)) {
    throw new ProjectFileError('This project file is damaged: it has no transcription.')
  }
  if (!isRecord(raw.studioSettings)) {
    throw new ProjectFileError('This project file is damaged: it has no studio settings.')
  }
  if (raw.studioGroups !== null && raw.studioGroups !== undefined && !Array.isArray(raw.studioGroups)) {
    throw new ProjectFileError('This project file is damaged: its groups are not a list.')
  }
  if (raw.tracks !== undefined && !Array.isArray(raw.tracks)) {
    throw new ProjectFileError('This project file is damaged: its track list is not a list.')
  }

  const tracks = ((raw.tracks as unknown[]) ?? []).map(readTrackFile)
  const known = new Set<string>([SOURCE_TRACK_ID, ...tracks.map((t) => t.id)])

  // Unknown future keys (and `_filePath`, written by the main process on read)
  // ride through untouched — this is a migration, not a rewrite.
  const file = {
    ...raw,
    version: PROJECT_VERSION,
    studioGroups: (raw.studioGroups ?? null) as Segment[] | null,
    customGroupsEdited: Boolean(raw.customGroupsEdited),
    tracks,
  } as unknown as ProjectFile

  // A tab pointer naming a track this file does not contain is stale bookkeeping,
  // not damage: drop it and open on the source rather than refusing the project.
  if (typeof file.activeTrackId !== 'string' || !known.has(file.activeTrackId)) {
    delete file.activeTrackId
  }

  return file
}

// ── The track store ↔ the file ───────────────────────────────────

/** Project-level metadata that is not owned by any single track. */
export interface ProjectMeta {
  /** Language, duration, audio path and the alignment flag. Its `segments` are
   *  ignored — the source track's are authoritative. */
  result: TranscriptionResult
  selectedFilePath?: string | null
  outputDir?: string
  suggestedName?: string
}

/**
 * Rebuild the track store from a (migrated) project file.
 *
 * The source track is assembled in exactly the order `ResultsScreen`'s `restore`
 * uses, and for the same reasons: `ensureWordIds` first so the segments own a
 * full id set, then `adoptWordIds` so groups saved before word ids existed adopt
 * the segments' ids instead of minting a disjoint set (which the first reconcile
 * would throw away), then `adoptEndEdited` so a gap the user shaped before that
 * flag existed is not closed back up.
 *
 * `adoptEndEdited` is deliberately **not** applied to translated tracks: their
 * ends are *derived* from the source span (`lib/trackTiming.ts`), so "this end
 * is not the last word's end" is not evidence of a hand edit there — it is the
 * normal state — and inferring the claim would silently exempt the group from
 * gap closing forever. Translated tracks record `endEdited` explicitly.
 */
/** One stored translated track, back as a live `CaptionTrack`. */
function restoreTranslatedTrack(stored: TranslatedTrackFile): CaptionTrack {
  const segments = ensureWordIds(stored.segments)
  return {
    id: stored.id,
    label: stored.label,
    lang: stored.lang,
    isSource: false,
    segments,
    groups: adoptWordIds(stored.groups, segments),
    // Authored grouping — always sent as custom_groups.
    groupsEdited: true,
    segmentsEdited: false,
    settings: sanitizeSettings({ ...STUDIO_DEFAULTS, ...stored.settings }),
    appliedPreset: stored.appliedPreset,
    ...(stored.sourceSnapshot ? { sourceSnapshot: stored.sourceSnapshot } : {}),
  }
}

export function tracksFromProjectFile(file: ProjectFile): {
  tracks: CaptionTrack[]
  activeTrackId: string
} {
  // Merge over the defaults (an older file has no value for fields added since)
  // and sanitize (a value that IS present may be out of the backend's range).
  const settings = sanitizeSettings({ ...STUDIO_DEFAULTS, ...file.studioSettings })
  const segments = ensureWordIds(file.transcriptionResult.segments)
  const saved = file.studioGroups

  const source: CaptionTrack = {
    id: SOURCE_TRACK_ID,
    label: SOURCE_TRACK_LABEL,
    lang: file.transcriptionResult.language || 'en',
    isSource: true,
    segments,
    groups:
      saved && saved.length > 0
        ? adoptEndEdited(adoptWordIds(saved, segments))
        : buildStudioGroups(segments, settings.wordsPerGroup),
    // Groups saved solely for a position override keep auto-grouping semantics.
    groupsEdited: Boolean(file.customGroupsEdited),
    segmentsEdited: false,
    settings,
    // A restored project's style came from the file, not from a preset.
    appliedPreset: null,
  }

  const tracks = [source, ...(file.tracks ?? []).map(restoreTranslatedTrack)]
  const active =
    file.activeTrackId && tracks.some((t) => t.id === file.activeTrackId)
      ? file.activeTrackId
      : SOURCE_TRACK_ID

  return { tracks, activeTrackId: active }
}

/**
 * Compose the file to write from the track store — the v2 counterpart of
 * `ResultsScreen`'s `gather()`, and bit-for-bit the same decisions for the v1
 * keys: a groups snapshot is stored when the boundaries were edited **or** any
 * group carries a position override, and a segments-only edit counts as edited
 * so the transcript's own groups are preserved.
 */
export function projectFileFromTracks(
  meta: ProjectMeta,
  tracks: readonly CaptionTrack[],
  activeTrackId: string
): ProjectFile {
  const source = tracks.find((t) => t.isSource)
  if (!source) throw new ProjectFileError('Cannot save a project with no source track.')

  const anyEdited = source.groupsEdited || source.segmentsEdited
  const hasPositionOverrides = source.groups.some((g) => g.positionOverride)
  const selectedFilePath = meta.selectedFilePath ?? meta.result.audioPath ?? null

  return {
    version: PROJECT_VERSION,
    suggestedName: meta.suggestedName ?? suggestProjectName(selectedFilePath),
    selectedFilePath,
    outputDir: meta.outputDir ?? 'output',
    transcriptionResult: { ...meta.result, segments: source.segments },
    studioSettings: source.settings,
    customGroupsEdited: anyEdited,
    studioGroups: anyEdited || hasPositionOverrides ? source.groups : null,
    tracks: tracks
      .filter((t) => !t.isSource)
      .map((t) => ({
        id: t.id,
        label: t.label,
        lang: t.lang,
        segments: t.segments,
        groups: t.groups,
        settings: t.settings,
        appliedPreset: t.appliedPreset,
        ...(t.sourceSnapshot ? { sourceSnapshot: t.sourceSnapshot } : {}),
      })),
    activeTrackId,
  }
}
