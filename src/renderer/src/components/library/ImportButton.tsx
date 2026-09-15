/**
 * The library's one "Import…" action — the toolbar and the empty state both
 * mount it.
 *
 * On macOS a single native dialog picks media files, folders and `.capforge`
 * projects together (`pickImport('any')`). Electron cannot combine files and
 * folders in one dialog on Windows or Linux (it shows a folder picker), so
 * there the same button opens a small Files… / Folder… menu. Whatever is
 * picked is sorted and imported by `useLibraryActions` (`importPlan`).
 */

import { useState } from 'react'
import { cn } from '../../lib/cn'
import type { ImportPickMode } from '../../lib/libraryImport'
import { isMacPlatform } from '../../lib/platform'
import { Button } from '../ui/Button'
import { MenuItem } from './LibraryMenuParts'

const IMPORT_LABEL = 'Import…'
const IMPORT_TITLE = 'Import videos, audio, folders of recordings or CapForge projects'

const MENU_ALIGN = {
  end: 'right-0',
  center: 'left-1/2 -translate-x-1/2',
} as const

/** The renderer's platform, read the way `TitleBar.tsx` reads it. */
function platformHasCombinedPicker(): boolean {
  return isMacPlatform(typeof navigator === 'undefined' ? undefined : navigator.platform)
}

export interface ImportButtonProps {
  onImport: (mode: ImportPickMode) => void
  /** One dialog for files and folders (macOS). Defaults to the platform check; tests pass it. */
  combinedPicker?: boolean
  /** Where the Files… / Folder… menu hangs from the button. */
  align?: keyof typeof MENU_ALIGN
  /** Start with the menu open — for static-markup tests. */
  defaultOpen?: boolean
}

export function ImportButton({
  onImport,
  combinedPicker = platformHasCombinedPicker(),
  align = 'end',
  defaultOpen = false,
}: ImportButtonProps) {
  const [open, setOpen] = useState(defaultOpen)

  if (combinedPicker) {
    return (
      <Button
        variant="ghost"
        className="whitespace-nowrap text-xs"
        title={IMPORT_TITLE}
        onClick={() => onImport('any')}
      >
        {IMPORT_LABEL}
      </Button>
    )
  }

  function choose(mode: ImportPickMode) {
    setOpen(false)
    onImport(mode)
  }

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        e.stopPropagation()
        setOpen(false)
      }}
    >
      <Button
        variant="ghost"
        className="whitespace-nowrap text-xs"
        title={IMPORT_TITLE}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {IMPORT_LABEL}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Import"
          className={cn(
            'absolute top-full z-20 mt-2 flex w-48 flex-col rounded-lg p-1 text-xs',
            MENU_ALIGN[align]
          )}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-2)',
            boxShadow: 'var(--shadow-2)',
          }}
        >
          <MenuItem
            label="Files…"
            title="Videos, audio or CapForge projects"
            onClick={() => choose('files')}
          />
          <MenuItem
            label="Folder…"
            title="Every recording in a folder"
            onClick={() => choose('folder')}
          />
        </div>
      )}
    </div>
  )
}
