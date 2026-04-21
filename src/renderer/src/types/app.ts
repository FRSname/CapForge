/** The three top-level screens of CapForge. */
export type Screen = 'file' | 'progress' | 'results'

/**
 * Per-word style overrides that take precedence over studio defaults.
 * Keys match the Python backend's renderer contract (renderSubtitleVideo).
 */
export interface WordOverrides {
  text_color?:         string
  active_word_color?:  string
  font_size_scale?:    number
  bold?:               boolean
  font_family?:        string
  custom_font_path?:   string
  word_transition?:    WordTransition
  // Per-word position nudge (px) — additive to the row layout.
  pos_offset_x?:       number
  pos_offset_y?:       number
  // Per-word transition sub-setting overrides (only used when the effective
  // transition for this word matches).
  highlight_radius?:   number
  highlight_padding_x?: number
  highlight_padding_y?: number
  highlight_opacity?:  number
  underline_thickness?: number
  underline_color?:    string
  underline_offset_y?: number
  underline_width?:    number
  bounce_strength?:    number
  scale_factor?:       number
}

export type WordTransition =
  | 'instant'
  | 'crossfade'
  | 'highlight'
  | 'underline'
  | 'bounce'
  | 'scale'
  | 'karaoke'

/** A single transcribed word with timing. */
export interface Word {
  word: string
  start: number
  end: number
  score?: number
  overrides?: WordOverrides
}

/** A subtitle segment (one block of text). */
export interface Segment {
  id: string
  start: number
  end: number
  text: string
  words: Word[]
  speaker?: string
}

/** Top-level transcription result from the backend. */
export interface TranscriptionResult {
  segments: Segment[]
  language: string
  duration: number
  audioPath: string
}

/** Progress event pushed over WebSocket from the Python backend. */
export interface ProgressEvent {
  step: 'loading_model' | 'transcribing' | 'aligning' | 'diarizing' | 'exporting' | 'done' | 'error'
  pct: number
  message: string
  sub_message?: string
}
