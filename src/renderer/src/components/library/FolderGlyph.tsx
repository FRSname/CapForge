/**
 * A folder icon. A real folder is filled with the brand colour; an orphan id
 * (records point at it, no folder defines it) is a dashed, muted outline.
 */

export const FOLDER_GLYPH_SMALL_PX = 14
/** In a list row, beside the 16:9 video thumbnails. */
export const FOLDER_GLYPH_ROW_PX = 22
export const FOLDER_GLYPH_LARGE_PX = 28

const ORPHAN_DASH = '2 1.5'
const FILL_OPACITY = 0.85

export interface FolderGlyphProps {
  orphan?: boolean
  size?: number
}

export function FolderGlyph({ orphan = false, size = FOLDER_GLYPH_SMALL_PX }: FolderGlyphProps) {
  return (
    <svg
      aria-hidden="true"
      data-folder-glyph={orphan ? 'orphan' : 'folder'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="shrink-0"
    >
      <path
        d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
        fill={orphan ? 'none' : 'var(--color-brand)'}
        fillOpacity={orphan ? undefined : FILL_OPACITY}
        stroke={orphan ? 'var(--color-text-3)' : 'none'}
        strokeDasharray={orphan ? ORPHAN_DASH : undefined}
      />
    </svg>
  )
}
