/**
 * The collection tree (docs/plans/library-finder.md §2, §4.1): nested
 * collections — "folders" in the UI — arrive as a **flat** list where each row
 * names its `parent_id` (`null` = top level), and the renderer builds the tree.
 *
 * Every helper is generic over `{ id, parent_id }`, so Settings → Folders, the
 * library sidebar and drag-and-drop targets share one implementation. The
 * backend is the authority on where a folder may go; `canMoveInto` is only the
 * renderer's copy of its rules, used to leave a place out of a picker or to
 * grey out a drop target.
 *
 * Defensive by design: a row whose parent is unknown is shown at the top level,
 * and every walk carries a visited set, so a malformed list can never loop or
 * make a folder vanish.
 *
 * Pure module: no React, no `window`, no I/O.
 */

/** Mirrors the backend's `MAX_COLLECTION_DEPTH`: a top-level folder is depth 1. */
export const MAX_COLLECTION_DEPTH = 8

/** Between the names of a folder's path: `Events › UCK 2026 › Day 1`. */
export const PATH_SEPARATOR = ' › '

export interface TreeItem {
  id: string
  parent_id: string | null
}

export interface TreeNode<T extends TreeItem> {
  item: T
  /** 1 for a top-level folder. */
  depth: number
  children: TreeNode<T>[]
}

/** A tree node flattened into display order. */
export interface TreeRow<T extends TreeItem> {
  item: T
  depth: number
}

function indexById<T extends TreeItem>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

/**
 * The forest, top-level folders first. Siblings keep the input order unless
 * `compare` sorts them. A row whose parent is unknown — or that is only
 * reachable through a cycle — is placed at the top level rather than dropped.
 */
export function buildTree<T extends TreeItem>(
  items: readonly T[],
  compare?: (a: T, b: T) => number
): TreeNode<T>[] {
  const index = indexById(items)
  const placed = new Set<string>()
  const sorted = (rows: T[]): T[] => (compare ? [...rows].sort(compare) : rows)

  function node(item: T, depth: number): TreeNode<T> {
    placed.add(item.id)
    const kids = items.filter((c) => c.parent_id === item.id && !placed.has(c.id))
    kids.forEach((c) => placed.add(c.id))
    return { item, depth, children: sorted(kids).map((c) => node(c, depth + 1)) }
  }

  const isRoot = (item: T) => item.parent_id === null || !index.has(item.parent_id)
  const roots = sorted(items.filter(isRoot)).map((item) => node(item, 1))
  const stranded = items.filter((item) => !placed.has(item.id))
  // A cycle has no root; show its first member at the top so nothing disappears.
  return stranded.length === 0 ? roots : [...roots, ...buildTree(breakCycles(stranded), compare)]
}

/** The stranded rows with their first member lifted to the top level. */
function breakCycles<T extends TreeItem>(stranded: readonly T[]): T[] {
  const [first, ...rest] = stranded
  return [{ ...first, parent_id: null }, ...rest]
}

/** Pre-order: each folder, then its subfolders. */
export function flattenTree<T extends TreeItem>(tree: readonly TreeNode<T>[]): TreeRow<T>[] {
  return tree.flatMap((node) => [
    { item: node.item, depth: node.depth },
    ...flattenTree(node.children),
  ])
}

/** The folders above `id`, top level first; `[]` for a top-level or unknown id. */
export function ancestorsOf<T extends TreeItem>(items: readonly T[], id: string): T[] {
  const index = indexById(items)
  const chain: T[] = []
  const seen = new Set<string>([id])
  let parentId = index.get(id)?.parent_id ?? null
  while (parentId !== null && !seen.has(parentId)) {
    const parent = index.get(parentId)
    if (!parent) break
    seen.add(parentId)
    chain.unshift(parent)
    parentId = parent.parent_id
  }
  return chain
}

/** Every id below `id` at any depth, never `id` itself. */
export function descendantIds(items: readonly TreeItem[], id: string): Set<string> {
  const found = new Set<string>()
  const frontier = [id]
  while (frontier.length > 0) {
    const parent = frontier.pop()
    for (const item of items) {
      if (item.parent_id === parent && item.id !== id && !found.has(item.id)) {
        found.add(item.id)
        frontier.push(item.id)
      }
    }
  }
  return found
}

/** 1 for a top-level folder, 2 inside it…; 0 for an unknown id. */
export function depthOf(items: readonly TreeItem[], id: string): number {
  return items.some((item) => item.id === id) ? ancestorsOf(items, id).length + 1 : 0
}

/** Levels in `id`'s subtree, itself included: 1 for a folder with no subfolders. */
export function subtreeHeight(items: readonly TreeItem[], id: string): number {
  const base = depthOf(items, id)
  const depths = [...descendantIds(items, id)].map((d) => depthOf(items, d))
  return Math.max(base, ...depths) - base + 1
}

/**
 * Whether the folder `movingId` may sit inside `targetId` (`null` = the top
 * level): the target exists, is neither the folder nor one of its subfolders,
 * and the folder's whole subtree still fits under `MAX_COLLECTION_DEPTH`.
 * Its current parent is allowed (a no-op move).
 */
export function canMoveInto(
  items: readonly TreeItem[],
  movingId: string,
  targetId: string | null
): boolean {
  if (!items.some((item) => item.id === movingId)) return false
  if (targetId === null) return true
  if (!items.some((item) => item.id === targetId)) return false
  if (targetId === movingId || descendantIds(items, movingId).has(targetId)) return false
  return depthOf(items, targetId) + subtreeHeight(items, movingId) <= MAX_COLLECTION_DEPTH
}

/**
 * The folders `movingId` may move into, in tree order with their depth — what a
 * "Location" picker or a "Move to…" menu lists. The top level is not a row:
 * `canMoveInto(items, movingId, null)` is always true for a known folder.
 */
export function moveTargets<T extends TreeItem>(
  items: readonly T[],
  movingId: string,
  compare?: (a: T, b: T) => number
): TreeRow<T>[] {
  return flattenTree(buildTree(items, compare)).filter((row) =>
    canMoveInto(items, movingId, row.item.id)
  )
}

/** Whether a new folder may be created inside `targetId` (`null` = top level). */
export function canCreateInside(items: readonly TreeItem[], targetId: string | null): boolean {
  if (targetId === null) return true
  const depth = depthOf(items, targetId)
  return depth > 0 && depth < MAX_COLLECTION_DEPTH
}

/** `Events › UCK 2026 › Day 1` — the folder's names from the top level down. */
export function pathLabel<T extends TreeItem & { name: string }>(
  items: readonly T[],
  id: string
): string {
  const self = items.find((item) => item.id === id)
  if (!self) return id
  return [...ancestorsOf(items, id), self].map((item) => item.name).join(PATH_SEPARATOR)
}
