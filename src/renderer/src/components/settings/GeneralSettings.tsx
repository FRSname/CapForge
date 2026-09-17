/**
 * Settings → General: Appearance, the library folder, the watch folder, Logs
 * and About (the version, and the two onboarding prompts).
 *
 * Theme state is *not* owned here. It arrives as props from `SettingsDialog`,
 * which is always mounted (see `hooks/useTheme.ts`) — this pane only exists
 * while the General category is selected.
 */

import { useEffect, useState } from 'react'
import { useLibraryWatch } from '../../hooks/useLibraryWatch'
import { useToast } from '../../hooks/useToast'
import { WATCH_FOLDER_HELP, watchFolderView } from '../../lib/libraryImport'
import type { OnboardingKind } from '../../lib/onboardingRequests'
import { requestOnboarding } from '../../lib/onboardingRequests'
import type { WatchStatus } from '../../lib/libraryTypes'
import type { ThemeMode } from '../../lib/themeMode'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'

/**
 * The default library location. The real path is `capforge_home()/library`,
 * which only the backend/main process can resolve — the renderer shows the
 * documented default and says what overrides it, and Reveal opens the actual
 * folder through Electron.
 */
const LIBRARY_FOLDER_LABEL = '~/.capforge/library'

/** Stands in for the version until the main process answers. */
const UNKNOWN_VERSION = '…'

/** The Appearance control's segments, in `THEME_MODES` order. */
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

interface GeneralSettingsProps {
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
}

export function GeneralSettings({ mode, onModeChange }: GeneralSettingsProps) {
  const { toast } = useToast()
  const watch = useLibraryWatch({ notify: (message) => toast(message, 'error') })
  const version = useAppVersion()

  /** The dialogs live in `StartupPrompts`, which paints above this one. */
  function showPrompt(kind: OnboardingKind) {
    if (!requestOnboarding(kind)) toast('That is not available right now.', 'error')
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Theme */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Appearance</label>
        <SegmentedControl
          options={THEME_OPTIONS}
          value={mode}
          onChange={onModeChange}
          ariaLabel="Appearance"
        />
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          System follows your OS setting.
        </p>
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

      {/* About */}
      <AboutBlock version={version} onShow={showPrompt} />
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

/**
 * `app.getVersion()` over the bridge. Null until it answers, and null forever
 * on a build whose preload predates the channel (CLAUDE.md, "Dual preload
 * gotcha") — the About line shows a placeholder rather than an error.
 */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window.subforge?.getVersion !== 'function') return
    let cancelled = false
    window.subforge
      .getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value ?? null)
      })
      .catch((err: unknown) => {
        console.warn('[CapForge] Could not read the app version:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return version
}

export interface AboutBlockProps {
  /** Null while unknown. */
  version: string | null
  onShow: (kind: OnboardingKind) => void
}

/** Settings → General's last block: the version, and the two one-shot prompts. */
export function AboutBlock({ version, onShow }: AboutBlockProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="label-xs">About</label>
      <span
        className="text-xs"
        style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-2)' }}
      >
        CapForge {version ?? UNKNOWN_VERSION}
      </span>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 text-xs justify-center"
          onClick={() => onShow('whats-new')}
        >
          What's new
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-xs justify-center"
          onClick={() => onShow('guide')}
        >
          Startup guide
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-xs justify-center"
          onClick={() => onShow('first-video')}
        >
          Editor guide
        </Button>
      </div>
      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        The tours shown on a fresh install and after the first video, and the release highlights.
        The startup guide runs on the library, the editor guide with a video open.
      </p>
    </div>
  )
}
