/**
 * The results editor's tabs, in strip order, and the arrow-key step between
 * them (roving tabIndex, the `ui/SegmentedControl` pattern).
 *
 * Pure module: no React, no `window`, no I/O.
 */

export type EditorView = 'text' | 'groups' | 'transcript'

/** Left to right, as drawn. */
export const EDITOR_VIEWS: readonly EditorView[] = ['text', 'groups', 'transcript']

/** ArrowLeft is -1, ArrowRight is +1. */
export type TabStep = 1 | -1

/** The tab one step from `view`, wrapping at both ends. */
export function nextEditorView(view: EditorView, step: TabStep): EditorView {
  const count = EDITOR_VIEWS.length
  const index = EDITOR_VIEWS.indexOf(view)
  return EDITOR_VIEWS[(index + step + count) % count]
}
