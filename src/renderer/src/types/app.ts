/** The three top-level screens of CapForge. */
export type Screen = 'file' | 'progress' | 'results'

/** A single transcribed word with timing. */
export interface Word {
  word: string
  start: number
  end: number
  score?: number
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
