/**
 * Binds the library's keys and empty-space clicks to its contents container —
 * never to `window`, so a key typed anywhere else (Settings, the search field,
 * the title bar) is not the library's. Every decision is pure
 * (`lib/libraryKeyboard.ts`, `lib/libraryNavigation.ts`); this hook reads the
 * event and the document for it:
 *
 * - whether a dialog or a menu is showing (a `[aria-modal="true"]` or a
 *   `[role="menu"]` with a box — a hidden one does not count);
 * - how many columns the grid has right now, from a grid section's computed
 *   `grid-template-columns`, so Up/Down follow the icon-size slider and the
 *   window width;
 * - where the focus goes after an arrow key (the item element carrying
 *   `data-library-item`).
 */

import { useRef } from 'react'
import type { KeyboardEvent, MouseEvent, RefObject } from 'react'
import type { LibraryKeyAction } from '../lib/libraryKeyboard'
import {
  GRID_SECTION_ATTRIBUTE,
  ITEM_ATTRIBUTE,
  isEmptySpaceClick,
  keyOriginOf,
  libraryKeyAction,
  libraryTakesKey,
} from '../lib/libraryKeyboard'
import type { ItemLayout } from '../lib/libraryNavigation'
import { columnCountOf } from '../lib/libraryNavigation'
import type { LibraryLayout } from '../lib/libraryPrefs'
import type { ItemKey, KeyOrigin } from '../lib/librarySelection'
import { isMacPlatform } from '../lib/platform'

export interface LibraryKeyboardInput {
  layout: LibraryLayout
  /** Item counts per grid section: folders, then videos. */
  sections: readonly number[]
  /** Run an action; true when it did something (the key's default is then prevented). */
  onAction: (action: LibraryKeyAction, layout: ItemLayout, origin: KeyOrigin) => boolean
  onEmptySpaceClick: () => void
}

export interface LibraryContainerProps {
  ref: RefObject<HTMLDivElement | null>
  tabIndex: number
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  onClick: (e: MouseEvent<HTMLDivElement>) => void
}

export interface LibraryKeyboard {
  containerProps: LibraryContainerProps
  /** Move the keyboard focus to an item and scroll it into view. */
  focusItem: (key: ItemKey | null) => void
}

export function onMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && isMacPlatform(navigator.platform)
}

/** A matching element that is actually on screen (a hidden one has no boxes). */
function isShowing(selector: string): boolean {
  return Array.from(document.querySelectorAll(selector)).some(
    (el) => el.getClientRects().length > 0
  )
}

function measuredColumns(container: HTMLElement | null): number {
  const grid = container?.querySelector(`[${GRID_SECTION_ATTRIBUTE}]`)
  return grid ? columnCountOf(getComputedStyle(grid).gridTemplateColumns) : 1
}

export function useLibraryKeyboard(input: LibraryKeyboardInput): LibraryKeyboard {
  const ref = useRef<HTMLDivElement>(null)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const action = libraryKeyAction(e, onMacPlatform())
    if (!action) return
    const context = {
      modalOpen: isShowing('[aria-modal="true"]'),
      menuOpen: isShowing('[role="menu"]'),
    }
    if (!libraryTakesKey(e.target as HTMLElement, context)) return
    const layout: ItemLayout =
      input.layout === 'list'
        ? { kind: 'list' }
        : { kind: 'grid', columns: measuredColumns(ref.current), sections: input.sections }
    const origin = keyOriginOf(e.target as Element)
    if (input.onAction(action, layout, origin)) e.preventDefault()
  }

  function focusItem(key: ItemKey | null) {
    if (key === null || !ref.current) return
    const el = ref.current.querySelector<HTMLElement>(`[${ITEM_ATTRIBUTE}="${CSS.escape(key)}"]`)
    el?.focus()
    el?.scrollIntoView({ block: 'nearest' })
  }

  return {
    containerProps: {
      ref,
      tabIndex: -1,
      onKeyDown,
      onClick: (e) => {
        if (isEmptySpaceClick(e.target as Element)) input.onEmptySpaceClick()
      },
    },
    focusItem,
  }
}
