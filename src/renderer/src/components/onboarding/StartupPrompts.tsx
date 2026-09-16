/**
 * The one thing App.tsx mounts for onboarding: `<StartupPrompts active={…} />`.
 *
 * It owns `useStartupPrompts` (which prompt is due, and the release notes to
 * show), renders both dialogs, and turns their two actions into the app's
 * existing seams: `requestSettingsCategory` opens Settings on a category, and
 * the main process opens links behind an allowlist.
 */

import { useToast } from '../../hooks/useToast'
import { useStartupPrompts } from '../../hooks/useStartupPrompts'
import type { AppSettingsCategoryId } from '../../lib/appSettingsIndex'
import { requestSettingsCategory } from '../../lib/settingsNavigation'
import { StartupGuideDialog } from './StartupGuideDialog'
import { WhatsNewDialog } from './WhatsNewDialog'

/** Shown when the running build predates the openExternal bridge. */
const NO_BRIDGE_MESSAGE = 'Restart CapForge to open links in your browser.'

export interface StartupPromptsProps {
  /** True on the library screen: where an automatic prompt may appear. */
  active: boolean
}

export function StartupPrompts({ active }: StartupPromptsProps) {
  const { toast } = useToast()
  const { prompt, notes, dismiss } = useStartupPrompts(active)

  function openUrl(url: string) {
    // The bridge is new, and the preload of a running dev app may predate it
    // (CLAUDE.md, "Dual preload gotcha").
    if (typeof window.subforge?.openExternal !== 'function') {
      toast(NO_BRIDGE_MESSAGE, 'error')
      return
    }
    void window.subforge
      .openExternal(url)
      .then((result) => {
        if (!result?.ok) toast(result?.error ?? 'Could not open the link.', 'error')
      })
      .catch((err: unknown) => {
        toast(err instanceof Error ? err.message : 'Could not open the link.', 'error')
      })
  }

  function openSettings(category: AppSettingsCategoryId) {
    if (!requestSettingsCategory(category)) {
      toast('Settings is not available right now.', 'error')
    }
  }

  return (
    <>
      <StartupGuideDialog
        open={prompt.kind === 'guide'}
        onClose={dismiss}
        onOpenSettings={openSettings}
        onOpenUrl={openUrl}
      />
      <WhatsNewDialog
        open={prompt.kind === 'whats-new'}
        notes={notes}
        onClose={dismiss}
        onOpenUrl={openUrl}
      />
    </>
  )
}
