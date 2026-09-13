/**
 * Settings → General: Appearance and Logs.
 *
 * Theme state is *not* owned here. It arrives as props from `SettingsDialog`,
 * which is always mounted (see `hooks/useTheme.ts`) — this pane only exists
 * while the General category is selected.
 */

import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'

interface GeneralSettingsProps {
  lightMode: boolean
  onLightModeChange: (light: boolean) => void
}

export function GeneralSettings({ lightMode, onLightModeChange }: GeneralSettingsProps) {
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
