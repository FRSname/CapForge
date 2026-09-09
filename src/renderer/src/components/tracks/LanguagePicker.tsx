/**
 * The `+` tab's language picker — a small filterable popover over the
 * `lib/languages.ts` table. Picking a language is the whole interaction: one
 * click creates the track (D1), stamped with that ISO code, labelled with the
 * language's English name and inheriting the **active** tab's style, so
 * "style the English, then add Polish" gives you what you can already see.
 *
 * Uniqueness is UI-only: a language that already has a track is still listed —
 * so you can see it exists — but disabled. Nothing stops an agent creating two
 * Polish tracks (they would share a `.pl` output suffix; see the plan's open
 * decision 5).
 *
 * Structure note: the popover is portaled to `document.body` (the ColorSwatch
 * precedent — the tab strip lives inside two `overflow-hidden` containers that
 * would clip it), and `createPortal` cannot run under `renderToStaticMarkup`.
 * The list is therefore `LanguagePickerPanel`, a plain component that takes its
 * query as a prop; `LanguagePicker` is the stateful portal wrapper around it.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LANGUAGES, type LanguageInfo } from '../../lib/languages'

/** Popover box, in px — also what the viewport clamp reserves. */
const PANEL_W = 248
const PANEL_MAX_H = 320
const VIEWPORT_PAD = 8

/**
 * The languages matching a filter query, in table order.
 *
 * Matches the English name, the endonym and the ISO code, case-insensitively —
 * someone who thinks in "Polski" and someone who thinks in "pl" both find it.
 * An empty query lists everything.
 */
export function filterLanguages(query: string): LanguageInfo[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...LANGUAGES]
  return LANGUAGES.filter(
    (l) =>
      l.code.includes(q) ||
      l.label.toLowerCase().includes(q) ||
      l.nativeLabel.toLowerCase().includes(q)
  )
}

export interface LanguagePickerPanelProps {
  query: string
  onQueryChange: (query: string) => void
  /** Languages that already have a track — listed, but not pickable. */
  addedCodes: ReadonlyArray<string>
  onPick: (code: string) => void
  onClose: () => void
  /** Fixed-position placement, computed by the portal wrapper. */
  style?: React.CSSProperties
  panelRef?: React.Ref<HTMLDivElement>
}

export function LanguagePickerPanel({
  query,
  onQueryChange,
  addedCodes,
  onPick,
  onClose,
  style,
  panelRef,
}: LanguagePickerPanelProps) {
  const matches = useMemo(() => filterLanguages(query), [query])
  const added = useMemo(
    () => new Set(addedCodes.map((c) => c.trim().toLowerCase())),
    [addedCodes]
  )

  /** Enter picks the first language the filter left pickable. */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const first = matches.find((l) => !added.has(l.code))
    if (first) onPick(first.code)
  }

  return (
    <div
      ref={panelRef}
      data-cf-popover=""
      style={{ fontFamily: 'var(--cf-font-ui)', ...style }}
      className="pop-in flex flex-col gap-1.5 rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface-2)] p-2 shadow-2xl"
    >
      <input
        type="text"
        value={query}
        autoFocus
        placeholder="Language…"
        aria-label="Filter languages"
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
        style={{ color: 'var(--color-text)' }}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="flex flex-col overflow-y-auto" style={{ maxHeight: PANEL_MAX_H - 60 }}>
        {matches.length === 0 ? (
          <p className="px-2 py-3 text-2xs" style={{ color: 'var(--color-text-3)' }}>
            No language matches “{query}”.
          </p>
        ) : (
          matches.map((lang) => {
            const isAdded = added.has(lang.code)
            return (
              <button
                key={lang.code}
                type="button"
                disabled={isAdded}
                className="flex items-baseline gap-2 rounded px-2 py-1 text-left text-xs transition-colors enabled:hover:bg-[var(--color-surface-3)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ color: 'var(--color-text)' }}
                onClick={() => onPick(lang.code)}
                title={isAdded ? `${lang.label} already has a caption track` : undefined}
              >
                <span className="min-w-0 truncate">{lang.label}</span>
                <span className="min-w-0 flex-1 truncate text-2xs" style={{ color: 'var(--color-text-3)' }}>
                  {lang.nativeLabel}
                </span>
                {isAdded && (
                  <span className="shrink-0 text-2xs" style={{ color: 'var(--color-text-3)' }}>
                    Added
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export interface LanguagePickerProps {
  /** Bounding box of the `+` tab the popover hangs off (GroupPositionPopup precedent). */
  anchorRect: DOMRect
  /** The `+` tab itself. A mousedown in here must not count as "outside", or
   *  the click that follows would immediately re-open what it just closed. */
  anchorRef?: React.RefObject<HTMLElement | null>
  addedCodes: ReadonlyArray<string>
  onPick: (code: string) => void
  onClose: () => void
}

/** Place the panel under the anchor, flipping above and clamping to the viewport. */
function placementFor(anchorRect: DOMRect): React.CSSProperties {
  const maxHeight = Math.min(PANEL_MAX_H, window.innerHeight - 2 * VIEWPORT_PAD)
  const spaceBelow = window.innerHeight - anchorRect.bottom - VIEWPORT_PAD
  const top =
    spaceBelow >= maxHeight
      ? anchorRect.bottom + 6
      : Math.max(VIEWPORT_PAD, anchorRect.top - maxHeight - 6)
  const left = Math.min(
    Math.max(VIEWPORT_PAD, anchorRect.left),
    Math.max(VIEWPORT_PAD, window.innerWidth - PANEL_W - VIEWPORT_PAD)
  )
  return { position: 'fixed', top, left, width: PANEL_W, maxHeight, zIndex: 'var(--z-dropdown)' }
}

export function LanguagePicker({
  anchorRect,
  anchorRef,
  addedCodes,
  onPick,
  onClose,
}: LanguagePickerProps) {
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>(() => placementFor(anchorRect))

  const reposition = useCallback(() => setStyle(placementFor(anchorRect)), [anchorRect])

  // No initial reposition(): `placementFor` reads only the anchor rect and the
  // viewport, both of which the useState initializer above already had. It is
  // re-run when the *viewport* moves under the popover — the sidebar scrolls an
  // inner container, so the scroll listener is capturing (ColorSwatch precedent).
  useLayoutEffect(() => {
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [reposition])

  // Close on outside click or Escape. The panel is portaled to document.body,
  // so it is not inside the anchor's subtree — its own ref is the only guard.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef?.current?.contains(target)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  return createPortal(
    <LanguagePickerPanel
      query={query}
      onQueryChange={setQuery}
      addedCodes={addedCodes}
      onPick={onPick}
      onClose={onClose}
      style={style}
      panelRef={panelRef}
    />,
    document.body
  )
}
