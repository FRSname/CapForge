/**
 * The library's selection reducer: every click, range, toggle, select-all,
 * prune, right-click, drag and rename-click decision, over a visible order of
 * two folders then four videos.
 */

import { describe, expect, test } from 'vitest'
import type { Selection } from './librarySelection'
import {
  EMPTY_SELECTION,
  NO_MODIFIERS,
  RENAME_CLICK_DELAY_MS,
  clearSelection,
  clickItem,
  clickModifiers,
  contextSelect,
  dragStart,
  enterTarget,
  folderKey,
  isSelected,
  nameClickStartsRename,
  openableKey,
  parseItemKey,
  pruneSelection,
  rangeKeys,
  selectAllVideos,
  selectOne,
  selectRange,
  selectionParts,
  toggleItem,
  videoKey,
  visibleKeys,
} from './librarySelection'

const VISIBLE = visibleKeys(
  [{ id: 'events' }, { id: 'talks' }],
  [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
)
const [F1, F2, A, B, C, D] = VISIBLE
const SHIFT = { toggle: false, range: true }
const CMD = { toggle: true, range: false }
const CMD_SHIFT = { toggle: true, range: true }

describe('keys', () => {
  test('folders and videos are keyed apart, and parse back', () => {
    expect(folderKey('x')).toBe('f:x')
    expect(videoKey('x')).toBe('v:x')
    expect(folderKey('x')).not.toBe(videoKey('x'))
    expect(parseItemKey('f:events')).toEqual({ kind: 'folder', id: 'events' })
    expect(parseItemKey('v:a:b')).toEqual({ kind: 'video', id: 'a:b' })
  })

  test.each(['', 'f:', 'v:', 'x:1', 'events'])('%j is no key', (key) => {
    expect(parseItemKey(key)).toBeNull()
  })

  test('the visible order is folders, then videos, as given', () => {
    expect(VISIBLE).toEqual(['f:events', 'f:talks', 'v:a', 'v:b', 'v:c', 'v:d'])
  })
})

describe('clickModifiers', () => {
  const event = { metaKey: true, ctrlKey: false, shiftKey: false }

  test('⌘ toggles on macOS, Ctrl does not', () => {
    expect(clickModifiers(event, true)).toEqual({ toggle: true, range: false })
    expect(clickModifiers({ ...event, metaKey: false, ctrlKey: true }, true).toggle).toBe(false)
  })

  test('Ctrl toggles on Windows and Linux, ⌘ (the Windows key) does not', () => {
    expect(clickModifiers(event, false).toggle).toBe(false)
    expect(clickModifiers({ ...event, metaKey: false, ctrlKey: true }, false).toggle).toBe(true)
  })

  test('Shift is the range everywhere', () => {
    expect(clickModifiers({ ...event, metaKey: false, shiftKey: true }, false)).toEqual(SHIFT)
  })
})

describe('click', () => {
  test('selects one and sets the anchor and focus', () => {
    const state = clickItem(EMPTY_SELECTION, VISIBLE, B, NO_MODIFIERS)
    expect(state).toEqual({ selected: [B], anchor: B, focus: B })
  })

  test('replaces an existing selection', () => {
    const before: Selection = { selected: [A, C, D], anchor: A, focus: D }
    expect(clickItem(before, VISIBLE, F1, NO_MODIFIERS).selected).toEqual([F1])
  })

  test('never mutates the state it was given', () => {
    const before: Selection = { selected: [A], anchor: A, focus: A }
    const frozen = Object.freeze({ ...before, selected: Object.freeze([...before.selected]) })
    clickItem(frozen, VISIBLE, C, SHIFT)
    clickItem(frozen, VISIBLE, C, CMD)
    clickItem(frozen, VISIBLE, C, CMD_SHIFT)
    expect(frozen.selected).toEqual([A])
  })
})

describe('toggle (⌘/Ctrl-click)', () => {
  test('adds an item and moves the anchor to it', () => {
    const state = clickItem(selectOne(A), VISIBLE, C, CMD)
    expect(state).toEqual({ selected: [A, C], anchor: C, focus: C })
  })

  test('takes a selected item out', () => {
    const state = toggleItem({ selected: [A, C], anchor: C, focus: C }, A)
    expect(state.selected).toEqual([C])
    expect(state.anchor).toBe(A)
  })

  test('takes one item out of a range, keeping the rest', () => {
    const range = clickItem(selectOne(F2), VISIBLE, C, SHIFT)
    expect(range.selected).toEqual([F2, A, B, C])
    expect(clickItem(range, VISIBLE, A, CMD).selected).toEqual([F2, B, C])
  })

  test('toggling the only item out leaves nothing selected', () => {
    expect(toggleItem(selectOne(A), A).selected).toEqual([])
  })
})

describe('range (Shift-click)', () => {
  test('forwards: anchor to target, inclusive', () => {
    const state = clickItem(selectOne(A), VISIBLE, C, SHIFT)
    expect(state).toEqual({ selected: [A, B, C], anchor: A, focus: C })
  })

  test('backwards: target to anchor, in visible order', () => {
    const state = clickItem(selectOne(C), VISIBLE, F2, SHIFT)
    expect(state.selected).toEqual([F2, A, B, C])
    expect(state.anchor).toBe(C)
  })

  test('crosses from the videos into the folders', () => {
    expect(clickItem(selectOne(B), VISIBLE, F1, SHIFT).selected).toEqual([F1, F2, A, B])
  })

  test('a second Shift-click redraws the range from the same anchor', () => {
    const first = clickItem(selectOne(B), VISIBLE, D, SHIFT)
    const second = clickItem(first, VISIBLE, A, SHIFT)
    expect(second.selected).toEqual([A, B])
    expect(second.anchor).toBe(B)
  })

  test('replaces ⌘-picked items outside the range', () => {
    const picked = clickItem(clickItem(selectOne(F1), VISIBLE, C, CMD), VISIBLE, D, SHIFT)
    expect(picked.selected).toEqual([C, D])
  })

  test('⌘+Shift adds the range to what is selected', () => {
    const picked = clickItem(selectOne(F1), VISIBLE, B, CMD)
    const state = clickItem(picked, VISIBLE, D, CMD_SHIFT)
    expect(state.selected).toEqual([F1, B, C, D])
    expect(state.anchor).toBe(B)
  })

  test('with no anchor it selects the target alone', () => {
    expect(selectRange(EMPTY_SELECTION, VISIBLE, C, false)).toEqual(selectOne(C))
  })

  test('an anchor that is no longer visible counts as none', () => {
    const state = { selected: ['v:gone'], anchor: 'v:gone', focus: 'v:gone' }
    expect(selectRange(state, VISIBLE, B, false)).toEqual(selectOne(B))
  })

  test('rangeKeys is empty when either end is not visible', () => {
    expect(rangeKeys(VISIBLE, A, 'v:gone')).toEqual([])
    expect(rangeKeys(VISIBLE, D, D)).toEqual([D])
  })
})

describe('select all (⌘/Ctrl+A)', () => {
  test('selects every visible video, never a folder', () => {
    const state = selectAllVideos(selectOne(F1), VISIBLE)
    expect(state.selected).toEqual([A, B, C, D])
    expect(state.anchor).toBe(A)
    expect(state.focus).toBe(A)
  })

  test('keeps the focus when it is on a video', () => {
    expect(selectAllVideos(selectOne(C), VISIBLE).focus).toBe(C)
  })

  test('only folders on show: nothing is selected', () => {
    expect(selectAllVideos(selectOne(F1), [F1, F2])).toEqual(EMPTY_SELECTION)
  })
})

describe('clear and prune', () => {
  test('clear empties everything', () => {
    expect(clearSelection()).toEqual(EMPTY_SELECTION)
  })

  test('prune drops keys that left the view, and an anchor/focus that did', () => {
    const state: Selection = { selected: [A, B, C], anchor: B, focus: C }
    const pruned = pruneSelection(state, [F1, A, D])
    expect(pruned).toEqual({ selected: [A], anchor: null, focus: null })
  })

  test('prune returns the same object when everything is still visible', () => {
    const state: Selection = { selected: [A, B], anchor: A, focus: B }
    expect(pruneSelection(state, VISIBLE)).toBe(state)
  })

  test('prune of an empty view empties the selection', () => {
    expect(pruneSelection(selectOne(A), [])).toEqual(EMPTY_SELECTION)
  })
})

describe('right-click', () => {
  test('an unselected item becomes the whole selection', () => {
    const state: Selection = { selected: [A, B], anchor: A, focus: B }
    expect(contextSelect(state, D)).toEqual(selectOne(D))
  })

  test('a selected item keeps the selection as it is', () => {
    const state: Selection = { selected: [A, B], anchor: A, focus: B }
    expect(contextSelect(state, B)).toBe(state)
  })
})

describe('open', () => {
  test('exactly one selected item opens', () => {
    expect(openableKey(selectOne(F2))).toBe(F2)
  })

  test('none or several open nothing', () => {
    expect(openableKey(EMPTY_SELECTION)).toBeNull()
    expect(openableKey({ selected: [A, B], anchor: A, focus: B })).toBeNull()
  })
})

describe('enterTarget', () => {
  test('on an item: that item, selected or not', () => {
    expect(enterTarget(selectOne(A), { kind: 'item', key: A })).toBe(A)
    expect(enterTarget(selectOne(A), { kind: 'item', key: C })).toBe(C)
    expect(enterTarget(EMPTY_SELECTION, { kind: 'item', key: F1 })).toBe(F1)
  })

  test('on an item that is one of several selected: nothing (which one?)', () => {
    const state: Selection = { selected: [A, B], anchor: A, focus: B }
    expect(enterTarget(state, { kind: 'item', key: B })).toBeNull()
    expect(enterTarget(state, { kind: 'item', key: D })).toBe(D)
  })

  test('on the container: the one selected item', () => {
    expect(enterTarget(selectOne(F2), { kind: 'container' })).toBe(F2)
    expect(enterTarget({ selected: [A, B], anchor: A, focus: B }, { kind: 'container' })).toBeNull()
  })

  test('on another control (a menu button, the hero): nothing', () => {
    expect(enterTarget(selectOne(A), { kind: 'control' })).toBeNull()
  })
})

describe('selectionParts', () => {
  test('splits folders from videos, in visible order', () => {
    const state: Selection = { selected: [D, F2, A], anchor: D, focus: A }
    expect(selectionParts(state, VISIBLE)).toEqual({ folderIds: ['talks'], videoIds: ['a', 'd'] })
  })

  test('ignores keys that are not visible', () => {
    expect(selectionParts({ ...selectOne('v:gone') }, VISIBLE)).toEqual({
      folderIds: [],
      videoIds: [],
    })
  })
})

describe('dragStart', () => {
  test('a selected video drags every selected video, and no folder', () => {
    const state: Selection = { selected: [F1, B, D], anchor: B, focus: D }
    const started = dragStart(state, VISIBLE, 'd')
    expect(started.ids).toEqual(['b', 'd'])
    expect(started.selection).toBe(state)
  })

  test('an unselected video becomes the selection and drags alone', () => {
    const state: Selection = { selected: [B, D], anchor: B, focus: D }
    const started = dragStart(state, VISIBLE, 'a')
    expect(started.ids).toEqual(['a'])
    expect(started.selection).toEqual(selectOne(A))
  })
})

describe('clicking a name to rename', () => {
  test('waits long enough to tell a double-click apart', () => {
    expect(RENAME_CLICK_DELAY_MS).toBeGreaterThanOrEqual(400)
  })

  test('starts on a plain single click on the one selected item', () => {
    expect(nameClickStartsRename(selectOne(B), B, NO_MODIFIERS, 1)).toBe(true)
  })

  test('not on an item that was not selected before the click', () => {
    expect(nameClickStartsRename(selectOne(A), B, NO_MODIFIERS, 1)).toBe(false)
    expect(nameClickStartsRename(EMPTY_SELECTION, B, NO_MODIFIERS, 1)).toBe(false)
  })

  test('not while several items are selected', () => {
    const state: Selection = { selected: [A, B], anchor: A, focus: B }
    expect(nameClickStartsRename(state, B, NO_MODIFIERS, 1)).toBe(false)
  })

  test('not on the second click of a double-click, nor with a modifier', () => {
    expect(nameClickStartsRename(selectOne(B), B, NO_MODIFIERS, 2)).toBe(false)
    expect(nameClickStartsRename(selectOne(B), B, CMD, 1)).toBe(false)
    expect(nameClickStartsRename(selectOne(B), B, SHIFT, 1)).toBe(false)
  })
})

describe('isSelected', () => {
  test('reads membership', () => {
    expect(isSelected(selectOne(A), A)).toBe(true)
    expect(isSelected(selectOne(A), B)).toBe(false)
  })
})
