/**
 * The soft lock's visible half (vision §3.5 tier 2): Claude wrote the field
 * you are typing in. The write is *held* — the panel keeps showing your text
 * until you answer.
 */

import { fieldLabel } from '../../lib/publishFields'
import type { AgentUpdateNotice } from '../../hooks/usePublishRecord'
import { Button } from '../ui/Button'

interface AgentUpdateBannerProps {
  notice: AgentUpdateNotice | null
  onApply: () => void
  onKeepMine: () => void
}

export function AgentUpdateBanner({ notice, onApply, onKeepMine }: AgentUpdateBannerProps) {
  if (!notice) return null
  const who = notice.by === 'agent' ? 'Claude' : notice.by || 'Someone else'
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2.5 py-2 rounded-md border"
      style={{
        borderColor: 'var(--color-brand)',
        background: 'var(--color-surface-2)',
      }}
    >
      <span className="text-xs flex-1 min-w-0" style={{ color: 'var(--color-text-2)' }}>
        {who} updated {fieldLabel(notice.field)} while you were typing.
      </span>
      <Button variant="ghost" className="text-xs-plus py-1 px-2 shrink-0" onClick={onApply}>
        Apply
      </Button>
      <Button variant="ghost" className="text-xs-plus py-1 px-2 shrink-0" onClick={onKeepMine}>
        Keep mine
      </Button>
    </div>
  )
}
