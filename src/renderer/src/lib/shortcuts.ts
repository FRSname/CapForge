/**
 * Single source of truth for the app's keyboard shortcuts.
 *
 * Rendered by both the SettingsPanel reference list and the `?` ShortcutOverlay
 * — when a shortcut is added or changed in a handler, update it here (and only
 * here) so the two surfaces never drift apart.
 *
 * Handler locations:
 *   Global    → App.tsx (⌘S/⌘O/⌘Z/?), ResultsScreen.tsx (⌘Z subtitle undo)
 *   Playback  → ResultsScreen.tsx playback keydown
 *   Editor    → ResultsScreen.tsx (⌘1/⌘2), SubtitleEditor.tsx contentEditable keydown
 *   Groups    → GroupEditor.tsx list keydown (list must be focused)
 *   Timeline  → AudioPlayer.tsx zoom/navigation keydown
 */

export interface ShortcutItem {
  /** Each entry renders as one <kbd> chip; alternatives are separate entries. */
  keys: string[]
  description: string
}

export interface ShortcutSection {
  title: string
  items: ShortcutItem[]
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘S'], description: 'Save project' },
      { keys: ['⌘O'], description: 'Open project' },
      { keys: ['⌘Z', '⌘⇧Z'], description: 'Undo / Redo' },
      { keys: ['?'], description: 'Keyboard shortcuts' },
    ],
  },
  {
    title: 'Playback',
    items: [
      { keys: ['Space', 'K'], description: 'Play · Pause' },
      { keys: ['J', 'L'], description: 'Seek ±2 s' },
      { keys: ['←', '→'], description: 'Frame step' },
      { keys: [',', '.'], description: 'Prev · Next group' },
    ],
  },
  {
    title: 'Editor',
    items: [
      { keys: ['⌘1', '⌘2'], description: 'Text · Groups view' },
      { keys: ['Enter'], description: 'Commit, edit next' },
      { keys: ['⇧Enter'], description: 'Commit, edit previous' },
      { keys: ['⌘Enter'], description: 'Split segment at cursor' },
      { keys: ['Esc'], description: 'Exit edit mode' },
    ],
  },
  {
    title: 'Groups',
    items: [
      { keys: ['↑', '↓'], description: 'Navigate' },
      { keys: ['M'], description: 'Merge below' },
      { keys: ['Enter'], description: 'Split in half' },
      { keys: ['Esc'], description: 'Deselect' },
    ],
  },
  {
    title: 'Timeline',
    items: [
      { keys: ['+', '−'], description: 'Zoom in · out' },
      { keys: ['0'], description: 'Reset zoom' },
      { keys: ['['], description: 'Prev segment' },
      { keys: [']'], description: 'Next segment' },
    ],
  },
]
