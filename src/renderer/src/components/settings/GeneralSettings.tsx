/**
 * Settings → General: Appearance, the library folder, the watch folder and Logs.
 *
 * Theme state is *not* owned here. It arrives as props from `SettingsDialog`,
 * which is always mounted (see `hooks/useTheme.ts`) — this pane only exists
 * while the General category is selected.
 */

import { useLibraryWatch } from '../../hooks/useLibraryWatch'
import { useToast } from '../../hooks/useToast'
import { WATCH_FOLDER_HELP, watchFolderView } from '../../lib/libraryImport'
import type { WatchStatus } from '../../lib/libraryTypes'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'

/**
 * The default library location. The real path is `capforge_home()/library`,
 * which only the backend/main process can resolve — the renderer shows the
 * documented default and says what overrides it, and Reveal opens the actual
 * folder through Electron.
 */
const LIBRARY_FOLDER_LABEL = '~/.capforge/library'

interface GeneralSettingsProps {
  lightMode: boolean
  onLightModeChange: (light: boolean) => void
}

export function GeneralSettings({ lightMode, onLightModeChange }: GeneralSettingsProps) {
  const { toast } = useToast()
  const watch = useLibraryWatch({ notify: (message) => toast(message, 'error') })
  return (
    <div className="flex flex-col gap-5">
      {/* Theme */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Appearance</label>
        <Toggle
          checked={lightMode}
          onChange={onLightModeChange}
          label={lightMode ? 'Light Mode' : 'Dark Mode'}
        />
      </div>

      {/* Library */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Library folder</label>
        <div className="flex items-center gap-2">
          <span
            className="flex-1 truncate text-xs"
            style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-2)' }}
            title="Every video record lives here. Set CAPFORGE_HOME to move it."
          >
            {LIBRARY_FOLDER_LABEL}
          </span>
          <Button
            variant="ghost"
            className="text-xs justify-center"
            onClick={() => window.subforge.revealLibraryFolder()}
          >
            Reveal
          </Button>
        </div>
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          Records, transcripts and session snapshots. <code>CAPFORGE_HOME</code> overrides the
          location.
        </p>
      </div>

      {/* Watch folder */}
      <WatchFolderRow
        status={watch.status}
        busy={watch.busy}
        onChoose={() => void watch.choose()}
        onStop={() => void watch.stop()}
      />

      {/* Logs */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Logs</label>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1 text-xs justify-center"
            onClick={() => window.subforge.openLogsFolder()}
          >
            Open folder
          </Button>
          <Button
            variant="ghost"
            className="flex-1 text-xs justify-center"
            onClick={() => window.subforge.openLogFile()}
          >
            Open log
          </Button>
        </div>
      </div>
    </div>
  )
}

export interface WatchFolderRowProps {
  /** Null while the first status loads. */
  status: WatchStatus | null
  busy: boolean
  onChoose: () => void
  onStop: () => void
}

/** The watch folder row — the "Library folder" row's layout, with Choose…/Stop. */
export function WatchFolderRow({ status, busy, onChoose, onStop }: WatchFolderRowProps) {
  const view = watchFolderView(status)
  const unavailable = status !== null && status.folder !== null && !status.available
  return (
    <div className="flex flex-col gap-2">
      <label className="label-xs">Watch folder</label>
      <div className="flex items-center gap-2">
        <span
          className="flex-1 truncate text-xs"
          style={{
            fontFamily: view.watching ? 'var(--cf-font-mono)' : 'var(--cf-font-ui)',
            color: view.watching ? 'var(--color-text-2)' : 'var(--color-text-3)',
          }}
          title={view.watching ? view.label : undefined}
        >
          {view.label}
        </span>
        <Button
          variant="ghost"
          className="text-xs justify-center"
          disabled={busy}
          onClick={onChoose}
        >
          Choose…
        </Button>
        {view.watching && (
          <Button
            variant="ghost"
            className="text-xs justify-center"
            disabled={busy}
            onClick={onStop}
          >
            Stop
          </Button>
        )}
      </div>
      {view.note && (
        <p
          className="text-2xs"
          style={{ color: unavailable ? 'var(--color-danger)' : 'var(--color-text-3)' }}
        >
          {view.note}
        </p>
      )}
      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {WATCH_FOLDER_HELP}
      </p>
    </div>
  )
}
