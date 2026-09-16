/**
 * One entry of the library sidebar's tree: "All videos", "Library" or a
 * folder. A `treeitem` that is focusable and activates on click, Enter or
 * Space; ArrowRight / ArrowLeft open and close a folder with subfolders, and
 * so does its disclosure triangle.
 */

import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { DragSourceProps, DropTargetBinding } from '../../hooks/useLibraryDrag'
import { DROP_TARGET_STYLE } from './folderItemUi'

/** Left padding per level of nesting, in rem, on top of the row's own. */
const INDENT_REM_PER_LEVEL = 0.75
/** The row's own left padding, in rem (Tailwind `px-2`). */
const ROW_PADDING_REM = 0.5

export interface LibrarySidebarItemProps {
  label: ReactNode
  /** The accessible name, when `label` is not plain text. */
  name: string
  count: number
  /** 1 for "All videos" and "Library". */
  level: number
  selected: boolean
  /** Undefined: nothing to expand. */
  expanded?: boolean
  glyph?: ReactNode
  title?: string
  source?: DragSourceProps
  target?: DropTargetBinding | null
  onActivate: () => void
  onToggle?: () => void
  onContextMenu?: (e: MouseEvent) => void
}

function handleKey(e: KeyboardEvent, props: LibrarySidebarItemProps) {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    props.onActivate()
    return
  }
  const wantsOpen = e.key === 'ArrowRight' && props.expanded === false
  const wantsClose = e.key === 'ArrowLeft' && props.expanded === true
  if (props.onToggle && (wantsOpen || wantsClose)) {
    e.preventDefault()
    props.onToggle()
  }
}

export function LibrarySidebarItem(props: LibrarySidebarItemProps) {
  const { selected, expanded, target } = props
  const style: CSSProperties = {
    paddingLeft: `${ROW_PADDING_REM + (props.level - 1) * INDENT_REM_PER_LEVEL}rem`,
    background: selected ? 'var(--color-surface-2)' : 'transparent',
    color: selected ? 'var(--color-text)' : 'var(--color-text-2)',
    border: '1px solid transparent',
    ...(target?.over ? DROP_TARGET_STYLE : {}),
  }
  return (
    <div
      role="treeitem"
      aria-level={props.level}
      aria-selected={selected}
      aria-expanded={expanded}
      aria-label={props.name}
      tabIndex={0}
      title={props.title}
      className="flex cursor-pointer items-center gap-1.5 rounded py-1 pr-2 text-xs hover:bg-[var(--color-surface-2)]"
      style={style}
      {...props.source}
      {...target?.props}
      onClick={props.onActivate}
      onKeyDown={(e) => handleKey(e, props)}
      onContextMenu={props.onContextMenu}
    >
      <Disclosure expanded={expanded} name={props.name} onToggle={props.onToggle} />
      {props.glyph}
      <span className="flex min-w-0 flex-1">{props.label}</span>
      <span className="shrink-0 text-2xs tabular-nums" style={{ color: 'var(--color-text-3)' }}>
        {props.count}
      </span>
    </div>
  )
}

interface DisclosureProps {
  expanded: boolean | undefined
  name: string
  onToggle?: () => void
}

/** ▸ / ▾ — or an empty slot of the same width, so names line up. */
function Disclosure({ expanded, name, onToggle }: DisclosureProps) {
  if (expanded === undefined || !onToggle) {
    return <span aria-hidden="true" className="w-3 shrink-0" />
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
      className="w-3 shrink-0 text-2xs"
      style={{ color: 'var(--color-text-3)' }}
      // A folder dragged by its triangle is still that folder.
      onDragStart={(e: DragEvent) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {expanded ? '▾' : '▸'}
    </button>
  )
}
