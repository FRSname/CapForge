/**
 * The static part of the WaveSurfer options, kept DOM-free so a test can pin
 * the interaction contract without loading wavesurfer.js in node.
 */

/** Seek on every drag event; WaveSurfer's default of 200 ms makes the
 *  waveform lag behind the pointer, and the canvas timeline seeks at once. */
export const WAVEFORM_DRAG_SEEK_DEBOUNCE_MS = 0

export const WAVEFORM_OPTIONS = {
  waveColor: '#30363d',
  progressColor: '#4f8ef7',
  cursorColor: '#4f8ef7',
  barWidth: 2,
  barGap: 1,
  barRadius: 2,
  height: 60,
  // Press-and-hold on the waveform scrubs, like the canvas timeline's playhead.
  dragToSeek: { debounceTime: WAVEFORM_DRAG_SEEK_DEBOUNCE_MS },
} as const
