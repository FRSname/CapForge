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
import {
  buildWidToSegment,
  sameSentenceSegments,
  sentenceIndexOf,
  sentenceSegmentsFor,
} from './trackSentences'
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

/**
 * Copy the group-level fields a translated skeleton inherits from a *run* of
 * consecutive source groups (one group, in the ordinary case).
 *
 * A run longer than one appears only in `reflowTrack`, where a translation that
 * was written against several source groups is carried across as the single
 * caption it is.
 */
function skeletonOf(run: readonly Segment[], id: string): Segment {
  const first = run[0]
  const last = run[run.length - 1]
  return {
    id,
    start: first.start,
    end: last.end,
    text: '',
    words: [],
    ...(first.speaker !== undefined ? { speaker: first.speaker } : {}),
    ...(first.positionOverride ? { positionOverride: first.positionOverride } : {}),
    ...(last.endEdited ? { endEdited: true } : {}),
    sourceWords: run.flatMap(recordFor),
  }
}

/**
 * **The one place a translated track's `segments` are written.**
 *
 * A translated track's text units are not authored, they are *derived*: they
 * are always `sentenceSegmentsFor(track.groups)` — one row per source sentence,
 * however many captions that sentence is currently chunked into
 * (`lib/trackSentences.ts`). Every seam that writes a translated track's groups
 * runs its result through here, so the Text view can never drift into being a
 * list of caption fragments again:
 *
 * - `createTrackFromSource` and `reflowTrack`, below (so the agent commands
 *   `create_track` / `reflow_track` inherit it);
 * - `setTrackText` (`lib/trackCommands.ts`), after baking;
 * - `syncSegmentsIntoTrack`'s translated branch, below;
 * - `useTrackStore.commitEditorState`, for what the mounted editor publishes;
 * - App's source-timing propagation effect, which moves group spans and words;
 * - `tracksFromProjectFile` (`lib/project.ts`), for a file written before this.
 *
 * Reference-stable, and a **no-op on the source track** (its segments are the
 * transcript) and when `widToSegment` is empty — with nothing to resolve, every
 * group would look like a sentence of its own and a good text view would be
 * replaced by a fragment list.
 */
export function withSentenceSegments(
  track: CaptionTrack,
  widToSegment: ReadonlyMap<string, number>
): CaptionTrack {
  if (track.isSource || widToSegment.size === 0) return track
  const segments = sentenceSegmentsFor(track.groups, widToSegment, track.id)
  return sameSentenceSegments(track.segments, segments) ? track : { ...track, segments }
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

  const groups = source.groups.map((g, i) => skeletonOf([g], `${opts.id}:${i}`))

  const track: CaptionTrack = {
    id: opts.id,
    label: opts.label ?? languageLabel(opts.lang),
    lang: opts.lang,
    isSource: false,
    // Replaced below by the sentence rows; this is only the fallback for a
    // source whose segments cannot be resolved (see `withSentenceSegments`).
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

  // The text view is a list of the source's *sentences*, never of the caption
  // fragments the skeleton is made of.
  return withSentenceSegments(track, buildWidToSegment(source.segments))
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
 * "The same span under a new name" is deliberately **not** "the same source
 * group": a translation written against a whole *sentence* (the ordinary shape
 * once `wordsPerGroup` has re-chunked one) records the wids of several source
 * groups at once, so an old caption is carried whole whenever its record equals
 * the wid lists of a **consecutive run** of current source groups, concatenated.
 * That run's skeleton entries are replaced by the one carried caption — the
 * longest matching run wins, so a sentence is never carried as its first
 * fragment with the rest dropped.
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

  const sourceWids = source.groups.map((g) => g.words.map((w) => w.wid as string))
  const longestRecord = Math.max(0, ...previous.map((g) => (g.sourceWords ?? []).length))

  /** The longest run starting at `i` whose wids are exactly an old record. */
  const carryAt = (i: number): { carried?: Segment; length: number } => {
    let best: { carried?: Segment; length: number } = { length: 1 }
    const wids: string[] = []
    for (let length = 1; i + length <= sourceWids.length; length += 1) {
      wids.push(...sourceWids[i + length - 1])
      if (wids.length > longestRecord) break
      if (wids.length === 0) continue
      const hit = oldByWids.get(wids.join(WID_KEY_SEP))
      if (hit) best = { carried: hit, length }
    }
    return best
  }

  const groups: Segment[] = []
  for (let i = 0; i < source.groups.length; ) {
    const { carried, length } = carryAt(i)
    const run = source.groups.slice(i, i + length)
    const base = skeletonOf(run, `${track.id}:r${n}:${i}`)
    i += length

    if (carried) {
      const { endEdited: _fromSource, ...rest } = base
      groups.push({
        ...rest,
        text: carried.text,
        words: carried.words,
        ...(carried.timingLinked !== undefined ? { timingLinked: carried.timingLinked } : {}),
        ...(carried.endEdited ? { endEdited: true } : {}),
      })
      continue
    }

    const overlap = new Set(run.flatMap((g) => g.words.map((w) => w.wid as string)))
    const previousText = previous
      .filter((g) => g.text.trim() !== '')
      .filter((g) => (g.sourceWords ?? []).some((s) => overlap.has(s.wid)))
      .map((g) => g.text)
      .join(' / ')

    groups.push(previousText ? { ...base, previousText } : base)
  }

  return withSentenceSegments(
    {
      ...track,
      groups,
      segments: groups.map((g) => ({ ...g })),
      sourceSnapshot: snapshotOf(source),
    },
    buildWidToSegment(source.segments)
  )
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
 * there, but something else: it re-chunks each *sentence*
 * (`chunkTranslatedGroups`, `lib/trackChunking.ts`) and never merges across a
 * sentence boundary. The track stays `groupsEdited` — its grouping is
 * authored either way, so `custom_groups` must keep being sent.
 *
 * `widToSegment` is the sentence map (`lib/trackSentences.ts`); it is what the
 * translated branch chunks by, and what re-derives that branch's text units. A
 * source track ignores it.
 */
export function syncSegmentsIntoTrack(
  track: CaptionTrack,
  segments: Segment[],
  wordsPerGroup: number,
  wpgChanged: boolean,
  widToSegment: ReadonlyMap<string, number> = new Map()
): CaptionTrack {
  const next = ensureWordIds(segments)

  if (!track.isSource) {
    // On the *current groups*, not the segments: the captions are the unit, and
    // the segments are only the text view's rendering of them — re-derived from
    // the groups either branch produces, never carried in from the caller.
    const groups = wpgChanged
      ? chunkTranslatedGroups(track.groups, wordsPerGroup, widToSegment)
      : reconcileGroups(track.groups, next, wordsPerGroup)
    return withSentenceSegments(
      { ...track, segments: next, groups, ...(wpgChanged ? { groupsEdited: true } : {}) },
      widToSegment
    )
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
  /** Translated tracks only: the index of the source *sentence* this caption
   *  belongs to. Consecutive entries sharing one `sentence` are fragments of
   *  the same sentence and must be translated together, not one by one; `null`
   *  when the source words behind the caption can no longer be resolved. */
  sentence?: number | null
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
  const widToSegment = buildWidToSegment(source.segments)

  const groups: TrackMirrorGroup[] = track.groups.map((g, i) => {
    const compact: TrackMirrorGroup = { id: g.id, start: g.start, end: g.end, text: g.text }
    if (track.isSource) return compact
    return {
      ...compact,
      // The agent's unit of translation: fragments of one sentence carry the
      // same index and are translated together (`mcp_server/tracks.py`).
      sentence: sentenceIndexOf(g, widToSegment) ?? null,
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
