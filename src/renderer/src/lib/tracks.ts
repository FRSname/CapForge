/**
 * Caption tracks — the pure core of multi-language captioning.
 *
 * A **track** is a named bundle of exactly the three things
 * `buildRenderBody()` consumes: settings, groups, and the edited flag. That is
 * the whole design: none of the three caption renderers know tracks exist, and
 * no field is added to `VideoRenderConfig`. Rendering a Polish track is
 * rendering the same body with a different bundle in it.
 *
 * The source track is the transcript (`result.segments` *are* its `segments`).
 * A translated track is a parallel list of caption groups written by hand or by
 * an agent, each one remembering the **source words it was written from**
 * (`Segment.sourceWords`). That record is what makes every later question
 * answerable without guessing:
 *
 * - "has the source changed under this translation?" → `lib/trackStaleness.ts`
 * - "where does this translation sit in time?"       → `lib/trackTiming.ts`
 * - "the source was re-chunked, rebuild my skeleton" → `reflowTrack` below
 *
 * Identity is all-or-nothing, exactly as in `reconcileGroups`: a source whose
 * words have no `wid` cannot be tracked, so `createTrackFromSource` refuses it
 * rather than half-linking a translation that would silently drift.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { buildStudioGroups, closeGroupGaps, reconcileGroups } from './groups'
import { ensureWordIds } from './wordIds'
import { chunkTranslatedGroups, coalesceSiblingRuns } from './trackChunking'
import { languageLabel } from './languages'
import { sanitizeSettings } from './settingsSanitize'
import { buildRenderBody, type RenderBody } from './render'
import {
  buildSourceIndex,
  recordedWids,
  sourceTextFor,
  type TrackClassification,
} from './trackStaleness'

/** The id of the one track that is never created, deleted or translated. */
export const SOURCE_TRACK_ID = 'src'

/** Its default tab label — the transcript, in whatever language was spoken. */
export const SOURCE_TRACK_LABEL = 'Original'

/** How a translated group relates to the source it was written from (§D). */
export type TrackGroupState = 'clean' | 'stale' | 'untranslated'

export interface CaptionTrack {
  id: string
  /** Tab label. Defaults to the language's English name; user-editable later. */
  label: string
  /** ISO 639-1 code (`lib/languages.ts`). */
  lang: string
  isSource: boolean
  /** The text-view edit units. Source: the transcript segments. Translated: one
   *  per group at create time, edited as prose in the text view. */
  segments: Segment[]
  /** RAW groups — pre-`closeGroupGaps`, exactly what `ResultsScreen` holds.
   *  Never store `displayGroupsFor()` output here: the tail hold is not
   *  idempotent (`lib/groups.ts`). */
  groups: Segment[]
  /** Translated tracks are always "edited": their grouping is authored, not
   *  derived, so `custom_groups` must always be sent. */
  groupsEdited: boolean
  segmentsEdited: boolean
  settings: StudioSettings
  appliedPreset: string | null
  /** Translated only: the source grouping recorded at create/reflow, as wid
   *  lists in order. `classifyTrack` compares it to decide `reflowNeeded`. */
  sourceSnapshot?: { groupWids: string[][] }
}

/**
 * The four pieces of a track the editor owns while it is mounted.
 *
 * `ResultsScreen` holds exactly this and publishes it upward on every change
 * (`onTrackStateChange`), so the store never has to reach into the editor to
 * checkpoint it. `groups` are **raw** — publishing `displayGroupsFor()` output
 * would bake the non-idempotent tail hold back into editable state.
 */
export interface TrackEditorState {
  segments: Segment[]
  groups: Segment[]
  groupsEdited: boolean
  segmentsEdited: boolean
}

export interface CreateTrackOptions {
  id: string
  lang: string
  /** Defaults to the language's English name. */
  label?: string
  /** Defaults to the source track's style (D1: "style the English, then add
   *  Polish" inherits what you can see). Always sanitized. */
  settings?: StudioSettings
}

let trackCounter = 0

/**
 * Mint a fresh track id. Same shape and reasoning as `newWordId`
 * (`lib/wordIds.ts`): opaque, counter for in-session uniqueness, random suffix
 * so it cannot collide with an id restored from a saved project whose counter
 * started over. Nothing may parse it.
 */
export function newTrackId(): string {
  trackCounter += 1
  return `t${trackCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The `{wid, text}` record a translated group keeps for one source group. */
function recordFor(group: Segment): Array<{ wid: string; text: string }> {
  return group.words.map((w) => ({ wid: w.wid as string, text: w.word }))
}

/** Copy the group-level fields a translated skeleton inherits from its source. */
function skeletonOf(sourceGroup: Segment, id: string): Segment {
  return {
    id,
    start: sourceGroup.start,
    end: sourceGroup.end,
    text: '',
    words: [],
    ...(sourceGroup.speaker !== undefined ? { speaker: sourceGroup.speaker } : {}),
    ...(sourceGroup.positionOverride ? { positionOverride: sourceGroup.positionOverride } : {}),
    ...(sourceGroup.endEdited ? { endEdited: true } : {}),
    sourceWords: recordFor(sourceGroup),
  }
}

/** The grouping fingerprint `classifyTrack` compares against for `reflowNeeded`. */
function snapshotOf(source: CaptionTrack): { groupWids: string[][] } {
  return { groupWids: source.groups.map((g) => g.words.map((w) => w.wid as string)) }
}

/**
 * Create a blank translated track shaped like the source: one empty group per
 * source group, same timing, same speaker/position/end claims, each one
 * recording the source words behind it.
 *
 * **Throws** when any source word has no `wid`. The caller surfaces that as a
 * toast and creates nothing — a translation linked to words it cannot name
 * would silently unlink itself on the first edit.
 */
export function createTrackFromSource(
  source: CaptionTrack,
  opts: CreateTrackOptions
): CaptionTrack {
  const index = buildSourceIndex(source)
  if (!index.complete) {
    throw new Error(
      'This transcript has words with no word id yet, so a translated track cannot be linked to it. Make an edit (or reopen the project) and try again.'
    )
  }

  const groups = source.groups.map((g, i) => skeletonOf(g, `${opts.id}:${i}`))

  return {
    id: opts.id,
    label: opts.label ?? languageLabel(opts.lang),
    lang: opts.lang,
    isSource: false,
    // The text view edits these; they start 1:1 with the groups.
    segments: groups.map((g) => ({ ...g })),
    groups,
    // Authored grouping — `custom_groups` must always be sent.
    groupsEdited: true,
    segmentsEdited: false,
    settings: sanitizeSettings(opts.settings ?? source.settings),
    // A style that came from somewhere other than the source is no longer the
    // source's preset.
    appliedPreset: opts.settings ? null : source.appliedPreset,
    sourceSnapshot: snapshotOf(source),
  }
}

/** Separator for the "same wid list" key — `\0` cannot occur in a wid. */
const WID_KEY_SEP = '\u0000'

/** How many reflows this track's ids already record. Ids are `${id}:r${n}:${i}`. */
function nextReflowCounter(groups: readonly Segment[]): number {
  let max = 0
  for (const g of groups) {
    const m = /:r(\d+):/.exec(g.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/**
 * Rebuild a translated track's skeleton from the source's *current* grouping,
 * carrying every translation it can and keeping the rest as context.
 *
 * This is the repair for `reflowNeeded` — the source was re-chunked (a
 * `wordsPerGroup` change, a manual merge/split, an inserted word), so the
 * translated groups no longer line up with anything. A new group whose source
 * wid list is **exactly** an old group's recorded list is the same span under a
 * new name and carries its text, words, `timingLinked` and `endEdited`
 * verbatim. Every other new group comes back blank, with `previousText` holding
 * the translations whose recorded words it now overlaps (joined by `' / '`) so
 * whoever rewrites it can see what was there.
 *
 * It is a wid-set carry-over, never a re-slice by index or word count — that is
 * the bug `lib/wordIds.ts` exists to prevent. New group ids embed a reflow
 * counter so they can never collide with the ids they replace, and the source
 * snapshot is re-recorded so `reflowNeeded` clears.
 *
 * **Throws** on a source it cannot identify, like `createTrackFromSource`.
 */
export function reflowTrack(track: CaptionTrack, source: CaptionTrack): CaptionTrack {
  const index = buildSourceIndex(source)
  if (!index.complete) {
    throw new Error(
      'This transcript has words with no word id yet, so this track cannot be re-flowed from it.'
    )
  }

  const n = nextReflowCounter(track.groups)

  // Match against whole captions, not chunks: a caption cut up by
  // `wordsPerGroup` is several groups sharing one record, and matching them
  // individually would carry the first chunk's text and drop the rest.
  const previous = coalesceSiblingRuns(track.groups)

  // First recorded list wins, so a duplicated record can never claim two groups.
  const oldByWids = new Map<string, Segment>()
  for (const g of previous) {
    const key = (g.sourceWords ?? []).map((s) => s.wid).join(WID_KEY_SEP)
    if (!oldByWids.has(key)) oldByWids.set(key, g)
  }

  const groups = source.groups.map((sourceGroup, i) => {
    const wids = sourceGroup.words.map((w) => w.wid as string)
    const base = skeletonOf(sourceGroup, `${track.id}:r${n}:${i}`)
    const carried = wids.length > 0 ? oldByWids.get(wids.join(WID_KEY_SEP)) : undefined

    if (carried) {
      const { endEdited: _fromSource, ...rest } = base
      return {
        ...rest,
        text: carried.text,
        words: carried.words,
        ...(carried.timingLinked !== undefined ? { timingLinked: carried.timingLinked } : {}),
        ...(carried.endEdited ? { endEdited: true } : {}),
      }
    }

    const overlap = new Set(wids)
    const previousText = previous
      .filter((g) => g.text.trim() !== '')
      .filter((g) => (g.sourceWords ?? []).some((s) => overlap.has(s.wid)))
      .map((g) => g.text)
      .join(' / ')

    return previousText ? { ...base, previousText } : base
  })

  return {
    ...track,
    groups,
    segments: groups.map((g) => ({ ...g })),
    sourceSnapshot: snapshotOf(source),
  }
}

/**
 * The groups as the *viewer* sees them: short gaps closed and the final caption
 * held, per this track's own settings. The single renderer-side call site of
 * `closeGroupGaps` — it is a derived view and must never be written back into
 * `track.groups` (the tail hold is not idempotent; see `lib/groups.ts`).
 */
export function displayGroupsFor(track: CaptionTrack): Segment[] {
  return closeGroupGaps(track.groups, track.settings.gapCloseThreshold, track.settings.lastGroupHold)
}

/**
 * Flow a new `segments` array into a track's groups — the pure form of
 * `ResultsScreen`'s reconcile-or-rebuild effect.
 *
 * Manually-edited groups are reconciled by word identity so membership survives
 * (`reconcileGroups`); otherwise the groups are rebuilt from document order,
 * carrying position overrides across by group id, and a `wordsPerGroup` change
 * hands the groups back to the automatic pass.
 *
 * A **translated** track never takes the rebuild branch: its grouping is
 * inherited from the source (that is what `reflowTrack` is for), so a rebuild
 * from document order would re-chunk the translation into arbitrary N-word
 * blocks and throw the source links away. `wordsPerGroup` still means something
 * there, but something else: it re-chunks each *inherited caption*
 * (`chunkTranslatedGroups`, `lib/trackChunking.ts`) and never merges across a
 * boundary the source set. The track stays `groupsEdited` — its grouping is
 * authored either way, so `custom_groups` must keep being sent.
 */
export function syncSegmentsIntoTrack(
  track: CaptionTrack,
  segments: Segment[],
  wordsPerGroup: number,
  wpgChanged: boolean
): CaptionTrack {
  const next = ensureWordIds(segments)

  if (!track.isSource) {
    // On the *current groups*, not the segments: the captions are the unit, and
    // the segments are only the text view's copy of them.
    if (wpgChanged) {
      return {
        ...track,
        segments: next,
        groups: chunkTranslatedGroups(track.groups, wordsPerGroup),
        groupsEdited: true,
      }
    }
    return { ...track, segments: next, groups: reconcileGroups(track.groups, next, wordsPerGroup) }
  }

  if (track.groupsEdited && !wpgChanged) {
    return { ...track, segments: next, groups: reconcileGroups(track.groups, next, wordsPerGroup) }
  }

  const rebuilt = buildStudioGroups(next, wordsPerGroup)
  const overridesById = new Map(
    track.groups.filter((g) => g.positionOverride).map((g) => [g.id, g.positionOverride])
  )
  const groups =
    overridesById.size === 0
      ? rebuilt
      : rebuilt.map((g) => {
          const po = overridesById.get(g.id)
          return po ? { ...g, positionOverride: po } : g
        })

  return {
    ...track,
    segments: next,
    groups,
    groupsEdited: wpgChanged ? false : track.groupsEdited,
  }
}

/** One group in the mirror's compact track inventory — **never** carries words. */
export interface TrackMirrorGroup {
  id: string
  start: number
  end: number
  text: string
  /** Translated tracks only. */
  state?: TrackGroupState
  /** Translated tracks only: the source text this group is written from, now. */
  sourceText?: string
  /** Translated tracks only: what a reflow detached from this span, or null. */
  previousText?: string | null
}

/** One element of the mirror's `tracks[]` (plan §E). */
export interface TrackMirrorEntry {
  id: string
  label: string
  lang: string
  isSource: boolean
  groupCount: number
  staleCount: number
  untranslatedCount: number
  reflowNeeded: boolean
  appliedPreset: string | null
  groups: TrackMirrorGroup[]
  render: RenderBody
}

/**
 * Project a track into the `PUT /api/ui-state` mirror.
 *
 * `render` is the *same* body the UI's own render/export uses — gaps closed,
 * `custom_groups` and all — so an agent rendering a track cannot get a
 * different frame than the user sees. The compact `groups` list carries the
 * **raw** ends instead, because those are what the Groups editor and the agent's
 * `set_track_text` address; and it never carries words, both for the LLM token
 * budget and because words belong in `render.custom_groups` only.
 */
export function trackToMirrorEntry(
  track: CaptionTrack,
  source: CaptionTrack,
  classification: TrackClassification
): TrackMirrorEntry {
  const index = buildSourceIndex(source)
  const allRecorded = recordedWids(track)

  const groups: TrackMirrorGroup[] = track.groups.map((g, i) => {
    const compact: TrackMirrorGroup = { id: g.id, start: g.start, end: g.end, text: g.text }
    if (track.isSource) return compact
    return {
      ...compact,
      state: classification.byGroup.get(g.id) ?? 'clean',
      sourceText: sourceTextFor(g, index, { allRecorded, isFirstGroup: i === 0 }),
      previousText: g.previousText ?? null,
    }
  })

  return {
    id: track.id,
    label: track.label,
    lang: track.lang,
    isSource: track.isSource,
    groupCount: track.groups.length,
    staleCount: classification.staleCount,
    untranslatedCount: classification.untranslatedCount,
    reflowNeeded: classification.reflowNeeded,
    appliedPreset: track.appliedPreset,
    groups,
    render: buildRenderBody(
      track.settings,
      displayGroupsFor(track),
      track.groupsEdited,
      {},
      undefined,
      track.isSource ? '' : `.${track.lang}`
    ),
  }
}
