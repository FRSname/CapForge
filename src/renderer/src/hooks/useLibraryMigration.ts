/**
 * First-launch migration into the v3 library.
 *
 * Everything a pre-v3 install has that names a video becomes a record: the
 * studio workspaces whose co-author marker still points at an existing source
 * (the backend does that pass), plus the last project file the app had open.
 * Runs **once** — guarded by the `library_migrated_v3` app-state flag, which is
 * only set after the backend pass succeeded, so a launch with the backend down
 * retries next time instead of silently skipping the migration forever.
 *
 * Importing `lastProjectPath` is best-effort *and reported*: the file may have
 * been moved or its media deleted, which must not hold the flag hostage.
 */

import { useEffect, useRef } from 'react'
import { api } from '../lib/api'

/** `app-state` keys this pass reads and writes. */
export const MIGRATED_FLAG_KEY = 'library_migrated_v3'
export const LAST_PROJECT_PATH_KEY = 'lastProjectPath'

export interface LibraryMigrationInput {
  /** Re-read the list once records have been created. */
  refresh: () => Promise<void>
  /** App's toast relay — every failure here is reported, none swallowed. */
  notify: (message: string) => void
}

export function migrationFailedMessage(reason: string): string {
  return `Could not import your earlier CapForge sessions: ${reason}`
}

export function projectImportFailedMessage(path: string, reason: string): string {
  return `Could not import ${path} into the library: ${reason}`
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useLibraryMigration({ refresh, notify }: LibraryMigrationInput): void {
  const inputRef = useRef({ refresh, notify })
  inputRef.current = { refresh, notify }

  useEffect(() => {
    let cancelled = false

    async function migrate(): Promise<void> {
      const done = await window.subforge.getState<boolean>(MIGRATED_FLAG_KEY, false)
      if (done || cancelled) return

      await api.migrateStudioWorkspaces()

      const lastProject = await window.subforge.getState<string>(LAST_PROJECT_PATH_KEY, '')
      if (lastProject) {
        // A missing/renamed file must not block the flag — report and move on.
        await api.importLibraryProject(lastProject).catch((err) => {
          inputRef.current.notify(projectImportFailedMessage(lastProject, reasonOf(err)))
        })
      }

      await window.subforge.setState(MIGRATED_FLAG_KEY, true)
      if (!cancelled) await inputRef.current.refresh()
    }

    migrate().catch((err) => {
      // The flag is still unset, so the next launch tries again.
      inputRef.current.notify(migrationFailedMessage(reasonOf(err)))
    })

    return () => {
      cancelled = true
    }
  }, [])
}
