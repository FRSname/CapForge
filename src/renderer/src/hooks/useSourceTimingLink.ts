/**
 * The source-track timing link (D4), moved out of `App.tsx` (which is at its
 * size ceiling) the way `useScreenNavigation` was.
 *
 * Whenever the source's words or grouping move, every translated group that is
 * still linked to a source span moves with it. `propagateSourceTiming` is
 * reference-stable and returns a source track untouched, so a single-track
 * project does nothing at all here and this can never re-trigger itself. A
 * track that *did* move while its editor is up has to be remounted (its
 * revision bumped), or the editor would keep publishing the pre-move groups
 * back over the relink — which can only happen from an agent edit to the
 * source while a translated tab is open.
 */

import { useEffect } from 'react'
import type { CaptionTrack } from '../lib/tracks'
import { withSentenceSegments } from '../lib/tracks'
import { propagateSourceTiming } from '../lib/trackTiming'

export interface RelinkResult {
  /** The relinked list — the input itself when nothing moved. */
  tracks: CaptionTrack[]
  /** The ids of the tracks that moved, in store order. */
  moved: string[]
}

/**
 * Relink every track to `source`. Relinking moves group spans and re-lays their
 * words, so the derived text units move with them — `withSentenceSegments` is
 * the one place that is decided (`lib/tracks.ts`), and it is reference-stable,
 * so a track that did not move is still handed back untouched.
 */
export function relinkTracks(
  tracks: CaptionTrack[],
  source: CaptionTrack,
  widToSegment: ReadonlyMap<string, number>
): RelinkResult {
  const moved: string[] = []
  const next = tracks.map((track) => {
    const relinked = withSentenceSegments(propagateSourceTiming(track, source), widToSegment)
    if (relinked !== track) moved.push(track.id)
    return relinked
  })
  return moved.length === 0 ? { tracks, moved } : { tracks: next, moved }
}

export interface SourceTimingLinkInput {
  tracks: CaptionTrack[]
  activeTrackId: string
  sourceTrack: CaptionTrack
  widToSegment: ReadonlyMap<string, number>
  commitTracks: (tracks: CaptionTrack[], activeTrackId: string) => void
  bumpRevision: (trackId: string) => void
}

export function useSourceTimingLink(input: SourceTimingLinkInput): void {
  const { tracks, activeTrackId, sourceTrack, widToSegment, commitTracks, bumpRevision } = input
  useEffect(() => {
    const { tracks: next, moved } = relinkTracks(tracks, sourceTrack, widToSegment)
    if (moved.length === 0) return
    commitTracks(next, activeTrackId)
    for (const id of moved) bumpRevision(id)
    // Deliberately narrow: this reacts to the SOURCE moving, and reads the rest
    // of the store as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTrack.segments, sourceTrack.groups])
}
