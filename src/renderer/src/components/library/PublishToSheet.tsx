/**
 * The import "Publish to:" sheet — asked once per import, before anything is
 * imported (docs/plans/multi-channel-pr4-contract.md §Part C).
 *
 * There is no `Modal` primitive in `components/ui/`, so this follows the
 * `ShortcutOverlay` / `RenderProgressModal` precedent: a fixed scrim, a
 * `role="dialog" aria-modal` card, and `useFocusTrap` while it is open.
 *
 * **Three outcomes, and the difference matters:** Import puts every ticked
 * channel on every imported video, Skip imports them on no channel at all, and
 * Escape (or a click on the scrim, or Cancel) imports *nothing*.
 */

import { useEffect, useRef } from 'react'
import type { Channel, PlatformSpec } from '../../lib/channelTypes'
import { CANCEL_TITLE, SKIP_TITLE, importButtonText } from '../../lib/importChannels'
import { requestSettingsCategory } from '../../lib/settingsNavigation'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ChannelChecklist } from '../publish/ChannelChecklist'
import { Button } from '../ui/Button'

/** The sentence above the list — the subject is in the heading, not here. */
export const SHEET_INTRO = 'Every ticked channel gets its own tab and its own text.'

/** Said under the buttons, so "Skip" and "Cancel" can never be confused. */
export const SHEET_ESCAPE_HINT = 'Escape imports nothing.'

export interface PublishToSheetProps {
  /** What is about to be imported ("2 folders + 3 videos"). */
  what: string
  channels: readonly Channel[] | null
  platforms: readonly PlatformSpec[] | null
  /** Why the channels could not be read; the import can still go ahead without them. */
  error: string | null
  ticked: readonly string[]
  onToggle: (channelId: string) => void
  /** Import, publishing to the ticked channels. */
  onImport: () => void
  /** Import on no channel. */
  onSkip: () => void
  /** Import nothing at all. */
  onCancel: () => void
}

export function PublishToSheet(props: PublishToSheetProps) {
  const { what, channels, platforms, error, ticked, onToggle, onImport, onSkip, onCancel } = props
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrapOnCard(cardRef, onCancel)
  const pickable = error === null && channels !== null && channels.length > 0

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Publish to"
      onClick={onCancel}
    >
      <div
        ref={cardRef}
        className="pop-in w-[420px] max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl p-5 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Importing {what}
        </h2>

        <ChannelChecklist
          channels={channels}
          platforms={platforms}
          ticked={ticked}
          error={error}
          intro={SHEET_INTRO}
          onToggle={onToggle}
          onManage={() => requestSettingsCategory('channels')}
        />

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            className="text-xs-plus py-1 px-3"
            title={CANCEL_TITLE}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            className="text-xs-plus py-1 px-3"
            title={SKIP_TITLE}
            onClick={onSkip}
          >
            Import without a channel
          </Button>
          <Button
            variant="primary"
            className="text-xs-plus py-1 px-3"
            disabled={!pickable || ticked.length === 0}
            onClick={onImport}
          >
            {importButtonText(ticked)}
          </Button>
        </div>
        <p className="text-2xs text-right" style={{ color: 'var(--color-text-3)' }}>
          {SHEET_ESCAPE_HINT}
        </p>
      </div>
    </div>
  )
}

/** The trap plus Escape, which cancels the whole import. */
function useFocusTrapOnCard(
  cardRef: React.RefObject<HTMLDivElement | null>,
  onCancel: () => void
): void {
  useFocusTrap(cardRef, true)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])
}
