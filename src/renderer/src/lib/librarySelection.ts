/**
 * The library's selection (docs/plans/library-finder.md §4.4), as a pure
 * reducer: every function takes the current `Selection` and returns a NEW one
 * (or the same object when nothing changed), so the whole behaviour is pinned
 * in the node test environment, where no click or key can be fired.
 *
 * Items are keyed `f:<id>` (a folder) and `v:<id>` (a video), because a folder
 * and a video may share an id. Every range and every arrow move is taken over
 * the **visible order**: the folders on show, then the videos in the current
 * sort, exactly as the grid or the list draws them (the Continue hero is not
 * an item — it is a one-purpose button).
 *
 * - **anchor**: where a Shift range starts (the last plain or ⌘ click);
 * - **focus**: the keyboard cursor, where the next arrow move starts.
 *
 * Pure module: no React, no DOM, no I/O.
 */

export type ItemKind = 'folder' | 'video'
export type ItemKey = string

const FOLDER_PREFIX = 'f:'
const VIDEO_PREFIX = 'v:'

export function folderKey(id: string): ItemKey {
  return `${FOLDER_PREFIX}${id}`
}

export function videoKey(id: string): ItemKey {
  return `${VIDEO_PREFIX}${id}`
}

export function parseItemKey(key: ItemKey): { kind: ItemKind; id: string } | null {
  if (key.startsWith(FOLDER_PREFIX) && key.length > FOLDER_PREFIX.length) {
    return { kind: 'folder', id: key.slice(FOLDER_PREFIX.length) }
  }
  if (key.startsWith(VIDEO_PREFIX) && key.length > VIDEO_PREFIX.length) {
    return { kind: 'video', id: key.slice(VIDEO_PREFIX.length) }
  }
  return null
}

export interface Selection {
  /** Selected keys, each once. */
  selected: readonly ItemKey[]
  anchor: ItemKey | null
  focus: ItemKey | null
}

export const EMPTY_SELECTION: Selection = { selected: [], anchor: null, focus: null }

/** The visible order: folders first, then videos, each as the caller orders them. */
export function visibleKeys(
  folders: ReadonlyArray<{ id: string }>,
  videos: ReadonlyArray<{ id: string }>
): ItemKey[] {
  return [...folders.map((f) => folderKey(f.id)), ...videos.map((v) => videoKey(v.id))]
}

export interface ClickModifiers {
  /** ⌘ on macOS, Ctrl elsewhere: add or take out one item. */
  toggle: boolean
  /** Shift: the range from the anchor. */
  range: boolean
}

export const NO_MODIFIERS: ClickModifiers = { toggle: false, range: false }

export function clickModifiers(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  mac: boolean
): ClickModifiers {
  return { toggle: mac ? e.metaKey : e.ctrlKey, range: e.shiftKey }
}

export function isSelected(state: Selection, key: ItemKey): boolean {
  return state.selected.includes(key)
}

export function selectOne(key: ItemKey): Selection {
  return { selected: [key], anchor: key, focus: key }
}

export function toggleItem(state: Selection, key: ItemKey): Selection {
  const selected = isSelected(state, key)
    ? state.selected.filter((k) => k !== key)
    : [...state.selected, key]
  return { selected, anchor: key, focus: key }
}

/** The keys from `a` to `b` inclusive, in visible order whichever comes first. */
export function rangeKeys(visible: readonly ItemKey[], a: ItemKey, b: ItemKey): ItemKey[] {
  const from = visible.indexOf(a)
  const to = visible.indexOf(b)
  if (from < 0 || to < 0) return []
  return visible.slice(Math.min(from, to), Math.max(from, to) + 1)
}

/**
 * Shift: select from the anchor to `key` (replacing the selection);
 * `additive` (⌘+Shift) adds that range to it. No visible anchor: `key` alone.
 * The anchor stays where it was, so a second Shift-click re-draws the range.
 */
export function selectRange(
  state: Selection,
  visible: readonly ItemKey[],
  key: ItemKey,
  additive: boolean
): Selection {
  if (state.anchor === null || !visible.includes(state.anchor)) return selectOne(key)
  const range = rangeKeys(visible, state.anchor, key)
  const selected = additive
    ? [...state.selected, ...range.filter((k) => !state.selected.includes(k))]
    : range
  return { selected, anchor: state.anchor, focus: key }
}

export function clickItem(
  state: Selection,
  visible: readonly ItemKey[],
  key: ItemKey,
  mods: ClickModifiers
): Selection {
  if (mods.range) return selectRange(state, visible, key, mods.toggle)
  if (mods.toggle) return toggleItem(state, key)
  return selectOne(key)
}

/** ⌘A: every visible **video** (folders are left out: they cannot be removed or deleted in bulk). */
export function selectAllVideos(state: Selection, visible: readonly ItemKey[]): Selection {
  const videos = visible.filter((k) => parseItemKey(k)?.kind === 'video')
  if (videos.length === 0) return EMPTY_SELECTION
  const focus = state.focus !== null && videos.includes(state.focus) ? state.focus : videos[0]
  return { selected: videos, anchor: videos[0], focus }
}

export function clearSelection(): Selection {
  return EMPTY_SELECTION
}

/** Drop whatever is no longer visible; the same object when nothing left. */
export function pruneSelection(state: Selection, visible: readonly ItemKey[]): Selection {
  const shown = new Set(visible)
  const selected = state.selected.filter((k) => shown.has(k))
  const anchor = state.anchor !== null && shown.has(state.anchor) ? state.anchor : null
  const focus = state.focus !== null && shown.has(state.focus) ? state.focus : null
  const same =
    selected.length === state.selected.length && anchor === state.anchor && focus === state.focus
  return same ? state : { selected, anchor, focus }
}

/** Right-click: an item outside the selection becomes the selection; inside, nothing changes. */
export function contextSelect(state: Selection, key: ItemKey): Selection {
  return isSelected(state, key) ? state : selectOne(key)
}

/** Enter / double-click: the one item to open, or null when zero or several are selected. */
export function openableKey(state: Selection): ItemKey | null {
  return state.selected.length === 1 ? state.selected[0] : null
}

/** Where a key was pressed: on an item, on another control (a `…`, the hero), or the container. */
export type KeyOrigin = { kind: 'item'; key: ItemKey } | { kind: 'control' } | { kind: 'container' }

/**
 * What Enter opens. On an item: that item — unless it is one of several
 * selected, which is ambiguous. On the container: the one selected item.
 * On any other control: nothing, so the control's own Enter still works.
 */
export function enterTarget(state: Selection, origin: KeyOrigin): ItemKey | null {
  if (origin.kind === 'control') return null
  if (origin.kind === 'container') return openableKey(state)
  if (state.selected.length > 1 && isSelected(state, origin.key)) return null
  return origin.key
}

export interface SelectionParts {
  folderIds: string[]
  videoIds: string[]
}

/** The selected folder and video ids, in visible order. */
export function selectionParts(state: Selection, visible: readonly ItemKey[]): SelectionParts {
  const parts: SelectionParts = { folderIds: [], videoIds: [] }
  for (const key of visible) {
    if (!state.selected.includes(key)) continue
    const item = parseItemKey(key)
    if (item?.kind === 'folder') parts.folderIds.push(item.id)
    if (item?.kind === 'video') parts.videoIds.push(item.id)
  }
  return parts
}

/**
 * Starting a drag on a video: a selected one drags every selected **video**
 * (folders drag one at a time); an unselected one becomes the selection and
 * drags alone.
 */
export function dragStart(
  state: Selection,
  visible: readonly ItemKey[],
  videoId: string
): { selection: Selection; ids: string[] } {
  const key = videoKey(videoId)
  if (!isSelected(state, key)) return { selection: selectOne(key), ids: [videoId] }
  return { selection: state, ids: selectionParts(state, visible).videoIds }
}

/** How long a click on a selected item's name waits before it becomes a rename. */
export const RENAME_CLICK_DELAY_MS = 500

/**
 * A plain single click on the name of the item that was **already** the one
 * selected item starts a rename (after `RENAME_CLICK_DELAY_MS`, cancelled by a
 * double-click). `clickCount` is the event's `detail`: the second click of a
 * double-click never starts one.
 */
export function nameClickStartsRename(
  state: Selection,
  key: ItemKey,
  mods: ClickModifiers,
  clickCount: number
): boolean {
  if (clickCount !== 1 || mods.toggle || mods.range) return false
  return state.selected.length === 1 && state.selected[0] === key
}
