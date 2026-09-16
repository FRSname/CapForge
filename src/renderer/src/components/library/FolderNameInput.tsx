/**
 * A folder's name, edited in place (`InlineNameInput`): an empty name is
 * refused under the input and never sent; the save is the folder rename
 * (`useFolderActions`), whose `422` stays under the input.
 */

import { COLLECTION_NAME_MAX_LENGTH } from '../../lib/collections'
import { renameProblem } from '../../lib/folderMenu'
import type { FolderEntry } from '../../lib/libraryLocation'
import type { FolderItemUi } from './folderItemUi'
import { InlineNameInput } from './InlineNameInput'

export interface FolderNameInputProps {
  folder: FolderEntry
  ui: FolderItemUi
  /** Starting error — for static-markup tests. */
  defaultError?: string | null
}

export function FolderNameInput({ folder, ui, defaultError = null }: FolderNameInputProps) {
  return (
    <InlineNameInput
      initialName={folder.name}
      label={`Rename folder ${folder.name}`}
      maxLength={COLLECTION_NAME_MAX_LENGTH}
      problem={renameProblem}
      onSave={(name) => ui.onRename(folder.id, name)}
      onClose={ui.onStopRename}
      defaultError={defaultError}
    />
  )
}
