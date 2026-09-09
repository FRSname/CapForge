/** The three top-level screens of CapForge. */
export type Screen = 'file' | 'progress' | 'results'

/**
 * Per-word style overrides that take precedence over studio defaults.
 * Keys match the Python backend's renderer contract (renderSubtitleVideo).
 */
export interface WordOverrides {
  text_color?: string
  active_word_color?: string
  font_size_scale?: number
  bold?: boolean
  font_family?: string
  custom_font_path?: string
  word_transition?: WordTransition
  // Per-word position nudge (px) — additive to the row layout.
  pos_offset_x?: number
  pos_offset_y?: number
  // Per-word transition sub-setting overrides (only used when the effective
  // transition for this word matches).
  highlight_radius?: number
  highlight_padding_x?: number
  highlight_padding_y?: number
  highlight_opacity?: number
  highlight_offset_x?: number
  highlight_offset_y?: number
  underline_thickness?: number
  underline_color?: string
  underline_offset_y?: number
  underline_width?: number
  bounce_strength?: number
  scale_factor?: number
  // Per-word background box — the Background card's BG function scoped to one
  // word. Every field falls back to the matching GLOBAL bg_* config value when
  // unset; word_bg_opacity > 0 is what enables the box at all.
  // See docs/plans/per-word-background.md.
  word_bg_opacity?: number       // 0–1 (NOT 0–100). > 0 enables. Global: bg_opacity
  word_bg_color?: string         // hex. Global: bg_color
  word_bg_radius?: number        // px. Global: bg_corner_radius
  word_bg_padding_h?: number     // px, clamped to >= stroke_width + 2. Global: bg_padding_h
  word_bg_padding_v?: number     // px, clamped to >= stroke_width + 2. Global: bg_padding_v
  word_bg_width_extra?: number   // px. Global: bg_width_extra
  word_bg_height_extra?: number  // px. Global: bg_height_extra
  word_bg_offset_x?: number      // px, default 0 — no global equivalent
  word_bg_offset_y?: number      // px, default 0 — no global equivalent
}

export type WordTransition =
  | 'none'
  | 'instant'
  | 'crossfade'
  | 'highlight'
  | 'underline'
  | 'bounce'
  | 'scale'
  | 'karaoke'
  | 'reveal'

/**
 * Per-group caption position override — fractions of output resolution (0–1),
 * same units as VideoRenderConfig.position_x/position_y. Sparse: absent = use
 * the global StudioSettings position.
 */
export interface GroupPositionOverride {
  position_x?: number
  position_y?: number
}

/** A single transcribed word with timing. */
export interface Word {
  word: string
  start: number
  end: number
  score?: number
  overrides?: WordOverrides
  /** Stable per-word identity, minted on ingest (`lib/wordIds.ts`). Survives text
   *  edits, re-grouping and project save/load, and is what lets `reconcileGroups`
   *  match a manually-regrouped word back to its source segment word instead of
   *  falling back to array position. Optional: words loaded from an older project
   *  file or straight off the backend have none until `ensureWordIds` runs. */
  wid?: string
  /** Translated-track words only: this word's `start`/`end` were *derived* from
   *  the group span (proportionally by character count) rather than measured
   *  against the audio, so an automatic pass may re-derive them. Absent means
   *  authoritative/pinned — a source word (always measured) never carries it,
   *  and a timeline drag of a translated word deletes it. */
  timingDerived?: boolean
}

/** A subtitle segment (one block of text). */
export interface Segment {
  id: string
  start: number
  end: number
  text: string
  words: Word[]
  speaker?: string
  /** Group-only: set when the user pins this group's caption position away
   *  from the global StudioSettings position. Never set on source segments. */
  positionOverride?: GroupPositionOverride
  /** Group-only: set when the user placed this group's `end` by hand (timeline
   *  right-edge/body drag, or the Groups editor's end-time field). Exempts the
   *  group from automatic gap closing and from the final-group hold, so a
   *  deliberately carved-out gap survives. Cleared whenever the group's bounds are
   *  recomputed from its words. Never set on source segments. */
  endEdited?: boolean
  /** Translated-track groups only: the source words this group's text was
   *  written from, as `{wid, text}` pairs in source document order. It is the
   *  reference `lib/trackStaleness.ts` compares against to decide whether the
   *  source has changed under a translation — the text is part of the record
   *  because a typo fix keeps its `wid` (`lib/wordTiming.ts`), so a wid-only
   *  compare would never notice it. Never set on source segments or groups. */
  sourceWords?: Array<{ wid: string; text: string }>
  /** Translated-track groups only: default (absent) = this group's `start`/`end`
   *  follow the source span its `sourceWords` describe. Set to `false` when the
   *  user drags this group on the translated tab, which pins its own timing and
   *  exempts it from `propagateSourceTiming`. Never set on source segments. */
  timingLinked?: boolean
  /** Translated-track groups only: the translation a re-flow detached from this
   *  span, kept purely as context for whoever writes the new one. Cleared the
   *  moment text is set on the group. Never set on source segments. */
  previousText?: string
}

/** Top-level transcription result from the backend. */
export interface TranscriptionResult {
  segments: Segment[]
  language: string
  duration: number
  audioPath: string
  /** True when any word timings were approximated instead of force-aligned. */
  alignmentDegraded?: boolean
}

/** Progress event pushed over WebSocket from the Python backend. */
export interface ProgressEvent {
  step: 'loading_model' | 'transcribing' | 'aligning' | 'diarizing' | 'exporting' | 'done' | 'error'
  pct: number
  message: string
  sub_message?: string
}
