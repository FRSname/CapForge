/**
 * Editing the Shorts card's clip suggestions — spans of the source video,
 * timestamps only (vision §4).
 *
 * Nothing here validates: `0 ≤ start < end ≤ duration` is Python's hard rule
 * and "longer than 60 s" its style rule, rendered under the row. These only
 * edit, and return `null` for an edit that would put a clip's end at or before
 * its start, so the caller can say why nothing happened.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Word } from '../types/app'
import type { ClipSuggestion } from './publishMediaTypes'
import { snapToWordStart } from './youtubeRules'

/** A new clip's length when added at the playhead. */
export const DEFAULT_CLIP_S = 30

/** Decimal places in the length readout. */
const LENGTH_DECIMALS = 1

export const CLIP_AT_END_MESSAGE =
  'The playhead is at the end of the video — move it back to start a clip there.'

export const CLIP_ORDER_MESSAGE =
  'A clip has to start before it ends — move the playhead to the other side first.'

/** Clips are held in time order. */
export function sortClips(clips: readonly ClipSuggestion[]): ClipSuggestion[] {
  return [...clips].sort((a, b) => a.start_s - b.start_s)
}

function clampToDuration(seconds: number, duration: number | null): number {
  const floor = Math.max(0, seconds)
  return duration === null ? floor : Math.min(floor, duration)
}

/**
 * A clip starting on the word at or before the playhead, `DEFAULT_CLIP_S`
 * long, clamped to the duration. Null when that leaves no room (the playhead
 * is at the very end).
 */
export function addClipAt(
  clips: readonly ClipSuggestion[],
  seconds: number,
  words: readonly Word[],
  duration: number | null
): ClipSuggestion[] | null {
  const start = snapToWordStart(Math.max(0, seconds), words)
  const end = clampToDuration(start + DEFAULT_CLIP_S, duration)
  if (end <= start) return null
  return sortClips([...clips, { start_s: start, end_s: end, why: '' }])
}

function replaceAt(
  clips: readonly ClipSuggestion[],
  index: number,
  next: ClipSuggestion
): ClipSuggestion[] {
  return sortClips(clips.map((clip, i) => (i === index ? next : clip)))
}

/** Move a clip's start to the playhead, snapped back to a word. Null if it would not precede the end. */
export function setClipStartAt(
  clips: readonly ClipSuggestion[],
  index: number,
  seconds: number,
  words: readonly Word[]
): ClipSuggestion[] | null {
  const clip = clips[index]
  if (!clip) return null
  const start = snapToWordStart(Math.max(0, seconds), words)
  if (start >= clip.end_s) return null
  return replaceAt(clips, index, { ...clip, start_s: start })
}

/**
 * Move a clip's end to the playhead, clamped to the duration. Not snapped:
 * snapping back to a word start would cut that word off. Null if it would not
 * follow the start.
 */
export function setClipEndAt(
  clips: readonly ClipSuggestion[],
  index: number,
  seconds: number,
  duration: number | null
): ClipSuggestion[] | null {
  const clip = clips[index]
  if (!clip) return null
  const end = clampToDuration(seconds, duration)
  if (end <= clip.start_s) return null
  return replaceAt(clips, index, { ...clip, end_s: end })
}

export function removeClip(clips: readonly ClipSuggestion[], index: number): ClipSuggestion[] {
  return clips.filter((_, i) => i !== index)
}

export function setClipWhy(
  clips: readonly ClipSuggestion[],
  index: number,
  why: string
): ClipSuggestion[] {
  return clips.map((clip, i) => (i === index ? { ...clip, why } : clip))
}

/** The length readout, `30.0 s`. A clip that ends before it starts reads as zero. */
export function formatClipLength(clip: ClipSuggestion): string {
  return `${Math.max(0, clip.end_s - clip.start_s).toFixed(LENGTH_DECIMALS)} s`
}

/** The field name the backend files a row's findings under. */
export function clipRowField(index: number): string {
  return `shorts.clip_suggestions[${index}]`
}
