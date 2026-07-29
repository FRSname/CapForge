import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { sortFavoritesFirst, type FontInfo, type FontSource } from '../../lib/fonts'

interface FontComboboxProps {
  fonts: FontInfo[]
  value: string
  emptyLabel: string
  onChange: (font: FontInfo | null) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
  /** Starred family names, pinned to the top of the list. */
  favorites?: ReadonlySet<string>
  /** Omit to hide the star affordance entirely. */
  onToggleFavorite?: (fontName: string) => void
}

const NO_FAVORITES: ReadonlySet<string> = new Set()

const SOURCE_LABELS: Record<FontSource, string> = {
  system: 'Installed',
  bundled: 'CapForge',
  custom: 'Custom',
}

export function filterFonts(fonts: FontInfo[], query: string): FontInfo[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return fonts
  return fonts.filter((font) => {
    const source = SOURCE_LABELS[font.source].toLocaleLowerCase()
    return font.name.toLocaleLowerCase().includes(needle) || source.includes(needle)
  })
}

export function resolveFontSelection(fonts: FontInfo[], value: string): FontInfo | null {
  return fonts.find((font) => font.name === value) ?? null
}

export function FontCombobox({
  fonts,
  value,
  emptyLabel,
  onChange,
  disabled = false,
  ariaLabel = 'Font',
  className = '',
  favorites = NO_FAVORITES,
  onToggleFavorite,
}: FontComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const openingSelectionRef = useRef<FontInfo | null>(null)
  const listboxId = useId()
  const optionIdBase = useId()

  const selected = resolveFontSelection(fonts, value)
  // Favorites reorder the list the user is looking at, so pinning happens
  // *after* the search filter — a query still narrows to matches, and the
  // matching favorites simply lead. Keeping filterFonts pure also keeps it
  // independently testable.
  const filtered = useMemo(
    () => sortFavoritesFirst(searching ? filterFonts(fonts, query) : fonts, favorites),
    [fonts, query, searching, favorites]
  )
  const favoriteCount = useMemo(
    () => filtered.filter((font) => favorites.has(font.name)).length,
    [filtered, favorites]
  )
  const showEmptyOption =
    !searching ||
    !query.trim() ||
    emptyLabel.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const optionOffset = showEmptyOption ? 1 : 0
  const optionCount = filtered.length + optionOffset
  const activeOptionIndex = Math.min(activeIndex, Math.max(0, optionCount - 1))
  const displayValue = open ? query : value || emptyLabel

  function updatePopupPosition() {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const width = Math.max(240, rect.width)
    const maxHeight = Math.min(300, window.innerHeight - 24)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const top =
      spaceBelow >= Math.min(maxHeight, 220)
        ? rect.bottom + 4
        : Math.max(8, rect.top - maxHeight - 4)
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
    setPopupStyle({ position: 'fixed', top, left, width, maxHeight, zIndex: 'var(--z-dropdown)' })
  }

  function openPicker() {
    if (disabled || open) return
    openingSelectionRef.current = resolveFontSelection(fonts, value)
    setOpen(true)
    setQuery(value)
    setSearching(false)
    const selectedIndex = fonts.findIndex((font) => font.name === value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex + 1 : 0)
  }

  function closePicker() {
    setOpen(false)
    setQuery('')
    setSearching(false)
    setActiveIndex(0)
  }

  function selectFont(font: FontInfo | null) {
    onChange(font)
    closePicker()
    requestAnimationFrame(() => inputRef.current?.blur())
  }

  function cancelPicker() {
    // Arrow-key navigation previews through onChange. Escape is a cancellation,
    // so restore the complete original entry (including path/source), not just
    // the family name.
    onChange(openingSelectionRef.current)
    closePicker()
    inputRef.current?.blur()
  }

  function previewOption(index: number) {
    if (index < 0 || index >= optionCount) return
    const font = showEmptyOption && index === 0 ? null : filtered[index - optionOffset]
    if (font === undefined) return
    setActiveIndex(index)
    if (!searching) setQuery(font?.name ?? '')
    onChange(font)
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePopupPosition()
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleOutsidePointer(event: MouseEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) closePicker()
    }
    function handleViewportChange() {
      updatePopupPosition()
    }
    document.addEventListener('mousedown', handleOutsidePointer)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    document
      .getElementById(`${optionIdBase}-${activeOptionIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionIndex, open, optionIdBase])

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && optionCount > 0 ? `${optionIdBase}-${activeOptionIndex}` : undefined
        }
        autoComplete="off"
        value={displayValue}
        disabled={disabled}
        onFocus={openPicker}
        onClick={openPicker}
        onChange={(event) => {
          if (!open) openPicker()
          setQuery(event.target.value)
          setSearching(true)
          setActiveIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!open) openPicker()
            else if (optionCount > 0) {
              previewOption(Math.min(optionCount - 1, activeOptionIndex + 1))
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) openPicker()
            else if (optionCount > 0) {
              previewOption(Math.max(0, activeOptionIndex - 1))
            }
          } else if (event.key === 'Enter' && open) {
            event.preventDefault()
            if (optionCount > 0) {
              selectFont(
                showEmptyOption && activeOptionIndex === 0
                  ? null
                  : filtered[activeOptionIndex - optionOffset]
              )
            }
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            cancelPicker()
          }
        }}
        className="field-input w-full pr-7 text-xs"
        style={!open && selected ? { fontFamily: `"${selected.name}", sans-serif` } : undefined}
      />
      <svg
        width="10"
        height="6"
        viewBox="0 0 10 6"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
      >
        <path
          d="M1 1l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: 'var(--color-text-3)' }}
        />
      </svg>

      {/* Portaled to document.body (below), so any ancestor popup with its own
          "outside click closes" handler must ignore clicks in here via
          [data-cf-popover] — otherwise a mousedown on an option looks like an
          outside click to the ancestor and closes it before onSelect commits. */}
      {open &&
        createPortal(
          <div
            ref={popupRef}
            data-cf-popover=""
            style={popupStyle}
            className="pop-in flex flex-col overflow-hidden rounded-md border border-[var(--color-border-2)] bg-[var(--color-surface-2)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-2.5 py-1.5">
              <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
                {query ? `${filtered.length} matches` : `${fonts.length} fonts`}
              </span>
              <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
                Type to search
              </span>
            </div>
            <div id={listboxId} role="listbox" className="min-h-0 overflow-y-auto py-1">
              {showEmptyOption && (
                <FontOption
                  id={`${optionIdBase}-0`}
                  label={emptyLabel}
                  sourceLabel="Default"
                  selected={!value}
                  active={activeOptionIndex === 0}
                  onSelect={() => selectFont(null)}
                />
              )}
              {filtered.map((font, index) => (
                <FontOption
                  key={`${font.source}|${font.name}|${font.path}`}
                  id={`${optionIdBase}-${index + optionOffset}`}
                  label={font.name}
                  sourceLabel={SOURCE_LABELS[font.source]}
                  selected={font.name === value}
                  active={activeOptionIndex === index + optionOffset}
                  fontFamily={font.name}
                  favorite={favorites.has(font.name)}
                  // Separates the pinned bucket from the rest of the catalog.
                  dividerAfter={favoriteCount > 0 && index === favoriteCount - 1}
                  onToggleFavorite={
                    onToggleFavorite ? () => onToggleFavorite(font.name) : undefined
                  }
                  onPointerMove={() => setActiveIndex(index + optionOffset)}
                  onSelect={() => selectFont(font)}
                />
              ))}
              {filtered.length === 0 && (
                <div
                  className="px-3 py-4 text-center text-xs"
                  style={{ color: 'var(--color-text-3)' }}
                >
                  No fonts match “{query}”.
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

interface FontOptionProps {
  id: string
  label: string
  sourceLabel: string
  selected: boolean
  active: boolean
  fontFamily?: string
  favorite?: boolean
  dividerAfter?: boolean
  onToggleFavorite?: () => void
  onPointerMove?: () => void
  onSelect: () => void
}

function FontOption({
  id,
  label,
  sourceLabel,
  selected,
  active,
  fontFamily,
  favorite = false,
  dividerAfter = false,
  onToggleFavorite,
  onPointerMove,
  onSelect,
}: FontOptionProps) {
  // The star is a sibling button, not a child of the option: nesting one
  // interactive element inside another is invalid HTML and breaks the click
  // target. role="presentation" keeps the wrapper transparent to assistive
  // tech so the option stays an effective child of the listbox.
  return (
    <div
      role="presentation"
      className="flex w-full items-center"
      style={{
        background: active ? 'var(--color-surface-3)' : 'transparent',
        borderBottom: dividerAfter ? '1px solid var(--color-border)' : undefined,
      }}
      onPointerMove={onPointerMove}
    >
      <button
        id={id}
        type="button"
        role="option"
        aria-selected={selected}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 text-left text-xs"
        style={{ background: 'transparent', color: 'var(--color-text)' }}
      >
        <span className="w-3 shrink-0 text-center" style={{ color: 'var(--color-accent)' }}>
          {selected ? '✓' : ''}
        </span>
        <span
          className="min-w-0 flex-1 truncate"
          style={fontFamily ? { fontFamily: `"${fontFamily}", sans-serif` } : undefined}
        >
          {label}
        </span>
        <span className="shrink-0 text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {sourceLabel}
        </span>
      </button>
      {onToggleFavorite && (
        <button
          type="button"
          aria-label={favorite ? `Unfavorite ${label}` : `Favorite ${label}`}
          aria-pressed={favorite}
          title={favorite ? 'Remove from favorites' : 'Pin to the top of the list'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // Must not select the font or close the portal dropdown.
            event.stopPropagation()
            onToggleFavorite()
          }}
          className="shrink-0 px-2 py-1.5 text-xs leading-none"
          style={{ color: favorite ? '#D4952A' : 'var(--color-text-3)' }}
        >
          {favorite ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}
