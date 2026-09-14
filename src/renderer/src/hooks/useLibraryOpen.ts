/**
 * The React half of `open_video` (v3 library).
 *
 * Thin on purpose — every rule, refusal and message lives in
 * `lib/libraryOpen.ts`, which is pure and tested. This hook only owns the one
 * piece of state the mirror publishes (`activeVideoId`: the record the agent
 * last installed) and binds the I/O: the library route and App's project
 * restore.
 *
 * Inputs are held in a ref so `applyEchoedCommand` is stable for the whole
 * session — `AgentLiveSync`'s control socket is created once and reads its
 * callbacks from refs, so a fresh closure per render would be pointless churn
 * and a captured one would go stale.
 */

import { useCallback, useRef, useState } from 'react'
import { api, type AgentCommand } from '../lib/api'
import { applyEchoedCommandWith, openVideoFromLibrary } from '../lib/libraryOpen'

export interface LibraryOpenInput {
  /** The current screen — `openVideoFromLibrary` refuses while transcribing. */
  screen: string
  /** App's restore: true when the store was replaced, false when rejected. */
  restoreFromProjectFile: (raw: unknown) => Promise<boolean>
  /** The synchronous track-write applier (`create_track` / … ). */
  applyTrackCommand: (cmd: AgentCommand) => string
}

export interface LibraryOpen {
  /** The library record `open_video` installed; null until one is opened. */
  activeVideoId: string | null
  /** Applies a polled command, returning its toast copy. Throws on refusal. */
  applyEchoedCommand: (cmd: AgentCommand) => Promise<string>
}

export function useLibraryOpen(input: LibraryOpenInput): LibraryOpen {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const inputRef = useRef(input)
  inputRef.current = input

  const openVideo = useCallback(async (videoId: string): Promise<string> => {
    const { screen, restoreFromProjectFile } = inputRef.current
    const message = await openVideoFromLibrary({
      videoId,
      screen,
      getProject: (id) => api.getLibraryProject(id),
      restore: restoreFromProjectFile,
    })
    // Only a completed open is published: the mirror's `activeVideoId` is what
    // the MCP tool confirms against, so it must never run ahead of the store.
    setActiveVideoId(videoId.trim())
    return message
  }, [])

  const applyEchoedCommand = useCallback(
    (cmd: AgentCommand): Promise<string> =>
      applyEchoedCommandWith({
        cmd,
        applyTrackCommand: inputRef.current.applyTrackCommand,
        openVideo,
      }),
    [openVideo]
  )

  return { activeVideoId, applyEchoedCommand }
}
