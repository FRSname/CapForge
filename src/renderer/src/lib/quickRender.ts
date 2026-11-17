/**
 * The quick-render buttons' MP4 quality (issue #79).
 *
 * "Render Video" used to force 40 Mbps with no way to lower it short of the
 * Custom Render panel, so a short phone clip came out many times the size of
 * its source. The footer now offers the same bitrates Custom Render does and
 * remembers the choice in app-state; the default stays 40 Mbps, so nobody's
 * output changes until they pick something else.
 *
 * Only the MP4 encode reads a bitrate — the "Subtitles Only" MOV is ProRes
 * 4444, which has none.
 */

export interface BitrateOption {
  /** What `video_bitrate` is sent as. */
  value: string
  label: string
}

/** The one list of MP4 bitrates, shared with the Custom Render panel. */
export const BITRATE_OPTIONS: readonly BitrateOption[] = [
  { value: '8M', label: '8 Mbps (Good)' },
  { value: '15M', label: '15 Mbps (High)' },
  { value: '25M', label: '25 Mbps (Very High)' },
  { value: '40M', label: '40 Mbps (Maximum)' },
]

export const DEFAULT_QUICK_RENDER_BITRATE = '40M'

/** The `app-state` key the choice is remembered under. */
export const QUICK_RENDER_BITRATE_KEY = 'quickRenderBitrate'

/**
 * The stored choice, or the default when app-state holds anything that is not
 * one of the offered bitrates (a hand-edited file, an option since removed).
 */
export function parseQuickRenderBitrate(value: unknown): string {
  return BITRATE_OPTIONS.some((option) => option.value === value)
    ? (value as string)
    : DEFAULT_QUICK_RENDER_BITRATE
}
