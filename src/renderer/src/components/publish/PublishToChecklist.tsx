/**
 * "Publish to:" — shown in place of the channel tabs while the video has no
 * visible post. Tick the Settings channels this video goes to and Add: one
 * write gives it a post on each (`usePublishChannels.addChannels`).
 *
 * The list itself is `ChannelChecklist`, shared with the import sheet; this is
 * the panel's half — the ticked state and the Add button.
 */

import { useState } from 'react'
import type { Channel, PlatformSpec } from '../../lib/channelTypes'
import { MANAGE_CHANNELS_FALLBACK, toggleChannel } from '../../lib/importChannels'
import { requestSettingsCategory } from '../../lib/settingsNavigation'
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'
import { ChannelChecklist } from './ChannelChecklist'

export { MANAGE_CHANNELS_FALLBACK } from '../../lib/importChannels'

/** The sentence above the list when one video is being placed. */
export const PUBLISH_TO_INTRO =
  'Pick where this video goes. Each channel gets its own tab and its own text.'

interface PublishToChecklistProps {
  /** Settings channels; null while they load. */
  channels: readonly Channel[] | null
  platforms: readonly PlatformSpec[] | null
  onAdd: (channelIds: readonly string[]) => void
}

export function PublishToChecklist({ channels, platforms, onAdd }: PublishToChecklistProps) {
  const { toast } = useToast()
  const [ticked, setTicked] = useState<readonly string[]>([])
  return (
    <ChannelChecklist
      channels={channels}
      platforms={platforms}
      ticked={ticked}
      intro={PUBLISH_TO_INTRO}
      onToggle={(id) => setTicked((prev) => toggleChannel(prev, id))}
      onManage={() => {
        if (!requestSettingsCategory('channels')) toast(MANAGE_CHANNELS_FALLBACK, 'info')
      }}
    >
      {channels !== null && channels.length > 0 && (
        <Button
          variant="primary"
          className="self-start text-xs-plus py-1 px-3"
          disabled={ticked.length === 0}
          onClick={() => {
            onAdd(ticked)
            setTicked([])
          }}
        >
          Add
        </Button>
      )}
    </ChannelChecklist>
  )
}
