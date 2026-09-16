/**
 * Fixtures shared by the library screen's static-markup tests.
 */

import type { FolderActions } from '../../hooks/useFolderActions'
import type { LibrarySelectionActions } from '../../hooks/useLibraryItems'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { EMPTY_OVERRIDES } from '../../lib/collectionTypes'
import type { LibraryVideo } from '../../lib/libraryTypes'

export function libraryVideo(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: 'a'.repeat(32),
    title: '',
    sourcePath: '/media/Talk.mp4',
    duration: 125,
    language: 'en',
    status: 'imported',
    collection_id: null,
    scratch: false,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    missing_media: false,
    hasProject: false,
    poster: false,
    cover: null,
    ...overrides,
  }
}

export function folderFixture(
  id: string,
  name: string,
  parent_id: string | null = null,
  counts: { members?: number; total?: number } = {}
): CollectionSummary {
  const members = counts.members ?? 0
  return {
    id,
    name,
    slots: {},
    overrides: EMPTY_OVERRIDES,
    createdAt: '',
    updatedAt: '',
    members,
    parent_id,
    total_members: counts.total ?? members,
    path: [name],
  }
}

export const NOOP_FOLDER_ACTIONS: FolderActions = {
  renameFolder: () => Promise.resolve({ kind: 'renamed' }),
  moveFolder: () => {},
  deleteFolder: () => {},
  adoptOrphan: () => {},
  openFolderSettings: () => {},
}

export const NOOP_SELECTION_ACTIONS: Omit<LibrarySelectionActions, 'onOpen'> = {
  onRenameVideo: () => Promise.resolve({ kind: 'renamed' }),
  onRemoveVideos: () => {},
  onDeleteVideos: () => {},
  onMoveSelection: () => {},
}
