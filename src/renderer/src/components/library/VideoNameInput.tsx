/**
 * A video's name, edited in place (`InlineNameInput`) on its card or list row:
 * the save is `runRenameRecord` (read the rev, `PATCH {title}` with
 * `If-Match`, one retry on a 409). The length cap is the backend's hard title
 * rule, so the input cannot type past what the record accepts.
 */

import type { LibraryVideo } from '../../lib/libraryTypes'
import { displayTitle } from '../../lib/libraryView'
import { titleProblem } from '../../lib/recordRename'
import { TITLE_MAX_CHARS } from '../../lib/youtubeRules'
import { InlineNameInput } from './InlineNameInput'
import type { LibraryItemUi } from './libraryItemUi'

export interface VideoNameInputProps {
  video: LibraryVideo
  item: LibraryItemUi
  /** Starting error — for static-markup tests. */
  defaultError?: string | null
}

export function VideoNameInput({ video, item, defaultError = null }: VideoNameInputProps) {
  const title = displayTitle(video)
  return (
    <InlineNameInput
      initialName={title}
      label={`Rename ${title}`}
      maxLength={TITLE_MAX_CHARS}
      problem={titleProblem}
      onSave={(name) => item.onRenameVideo(video, name)}
      onClose={item.onStopRename}
      defaultError={defaultError}
    />
  )
}
