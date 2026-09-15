/**
 * The Publish panel's channel tab strip — one tab per visible post, mounted
 * under the Publish header.
 *
 * Copies `tracks/TrackTabs.tsx`: `role="tablist"` with a roving tabIndex and
 * ArrowLeft/ArrowRight (stopped from propagating, because the window-level
 * playback handler maps ←/→ to frame stepping); the trailing `+` joins the ring
 * but only takes focus, it opens a menu rather than selecting a tab.
 *
 * A tab is the platform badge, the channel name and a dot once the post has a
 * published link. `×` hides the tab with no confirm — the text is kept, and
 * `+` lists hidden channels first, as "Show again". The menu is not portaled:
 * it opens inside the aside, below the strip, so static markup can render it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Channel, PlatformSpec } from '../../lib/channelTypes'
import { platformLabel } from '../../lib/channels'
import type { ChannelTab } from '../../lib/channelPublishView'
import type { AddableChannels } from '../../lib/publishPosts'
import { PlatformBadge } from '../settings/PlatformBadge'

export interface ChannelTabsProps {
  tabs: readonly ChannelTab[]
  activeId: string | null
  menu: AddableChannels<Channel>
  platforms: readonly PlatformSpec[] | null
  onSelect: (channelId: string) => void
  /** A channel was picked from the `+` menu — add it (or show it again). */
  onAdd: (channelId: string) => void
  /** Hide a tab; nothing is lost. */
  onHide: (channelId: string) => void
}

export function ChannelTabs(props: ChannelTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  return <ChannelTabsView {...props} menuOpen={menuOpen} onMenuOpen={setMenuOpen} />
}

export interface ChannelTabsViewProps extends ChannelTabsProps {
  menuOpen: boolean
  onMenuOpen: (open: boolean) => void
}

/** Close an open menu on Escape or a press outside `container`. */
function useDismiss(container: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [container, open, close])
}

export function ChannelTabsView(props: ChannelTabsViewProps) {
  const { tabs, activeId, menu, platforms, onSelect, onAdd, onHide, menuOpen, onMenuOpen } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => onMenuOpen(false), [onMenuOpen])
  useDismiss(containerRef, menuOpen, close)

  const handleArrow = useCallback(
    (index: number, dir: 1 | -1) => {
      const count = tabs.length + 1
      const next = (index + dir + count) % count
      if (next < tabs.length) onSelect(tabs[next].id)
      const ring = containerRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
      ring?.[next]?.focus()
    },
    [tabs, onSelect]
  )

  return (
    <div ref={containerRef} className="relative shrink-0 border-b border-[var(--color-border)]">
      <div
        role="tablist"
        aria-label="Channels"
        className="app-no-drag flex items-center gap-1 overflow-x-auto px-3 pt-1.5"
        style={{ fontFamily: 'var(--cf-font-ui)' }}
      >
        {tabs.map((tab, i) => (
          <ChannelTabButton
            key={tab.id}
            tab={tab}
            index={i}
            active={tab.id === activeId}
            platforms={platforms}
            onSelect={onSelect}
            onHide={onHide}
            onArrow={handleArrow}
          />
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={false}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          tabIndex={-1}
          aria-label="Add a channel"
          title="Publish this video to another channel"
          className="rounded-t border-b-2 border-transparent px-2 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ color: 'var(--color-text-3)' }}
          onClick={() => onMenuOpen(!menuOpen)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            e.stopPropagation()
            handleArrow(tabs.length, e.key === 'ArrowRight' ? 1 : -1)
          }}
        >
          +
        </button>
      </div>

      {menuOpen && (
        <ChannelAddMenu
          menu={menu}
          platforms={platforms}
          onPick={(channelId) => {
            close()
            onAdd(channelId)
          }}
        />
      )}
    </div>
  )
}

interface ChannelTabButtonProps {
  tab: ChannelTab
  index: number
  active: boolean
  platforms: readonly PlatformSpec[] | null
  onSelect: (channelId: string) => void
  onHide: (channelId: string) => void
  onArrow: (index: number, dir: 1 | -1) => void
}

function ChannelTabButton(props: ChannelTabButtonProps) {
  const { tab, index, active, platforms, onSelect, onHide, onArrow } = props
  const label = tab.platform ? platformLabel(tab.platform, platforms) : 'Channel not in Settings'
  return (
    <div role="presentation" className="flex shrink-0 items-center">
      <button
        type="button"
        id={`channel-tab-${tab.id}`}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className={[
          'flex items-center gap-1.5 rounded-t border-b-2 px-2.5 py-1.5 text-xs transition-colors hover:text-[var(--color-text)]',
          active
            ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
            : 'border-transparent',
        ].join(' ')}
        style={{ color: active ? 'var(--color-text)' : 'var(--color-text-3)' }}
        title={`${tab.name} · ${label}`}
        onClick={() => onSelect(tab.id)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          // The window-level playback handler maps ←/→ to frame stepping.
          e.stopPropagation()
          onArrow(index, e.key === 'ArrowRight' ? 1 : -1)
        }}
      >
        {tab.platform && <PlatformBadge platform={tab.platform} label={label} />}
        <span className="max-w-[8rem] truncate">{tab.name}</span>
        {tab.published && (
          <span
            role="img"
            aria-label="Published"
            title="Published — this post has a live link"
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: 'var(--color-success)' }}
          />
        )}
      </button>
      <button
        type="button"
        aria-label={`Hide ${tab.name}`}
        title="Hide this tab — its text is kept"
        className="-ml-1 rounded px-1 text-2xs transition-opacity hover:opacity-100"
        style={{ color: 'var(--color-text-3)', opacity: active ? 0.85 : 0.5 }}
        onClick={() => onHide(tab.id)}
      >
        ×
      </button>
    </div>
  )
}

interface ChannelAddMenuProps {
  menu: AddableChannels<Channel>
  platforms: readonly PlatformSpec[] | null
  onPick: (channelId: string) => void
}

export function ChannelAddMenu({ menu, platforms, onPick }: ChannelAddMenuProps) {
  const empty = menu.showAgain.length === 0 && menu.add.length === 0
  return (
    <div
      role="menu"
      aria-label="Add a channel"
      data-cf-popover=""
      className="pop-in absolute right-2 top-full z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface-2)] p-1.5 shadow-2xl"
    >
      {empty && (
        <p className="px-2 py-1.5 text-2xs" style={{ color: 'var(--color-text-3)' }}>
          This video is on every channel. Add another in Settings → Channels.
        </p>
      )}
      <MenuGroup
        label="Show again"
        channels={menu.showAgain}
        platforms={platforms}
        onPick={onPick}
      />
      <MenuGroup label="Add" channels={menu.add} platforms={platforms} onPick={onPick} />
    </div>
  )
}

interface MenuGroupProps {
  label: string
  channels: readonly Channel[]
  platforms: readonly PlatformSpec[] | null
  onPick: (channelId: string) => void
}

function MenuGroup({ label, channels, platforms, onPick }: MenuGroupProps) {
  if (channels.length === 0) return null
  return (
    <>
      <span className="label-xs px-2 pt-1">{label}</span>
      {channels.map((channel) => (
        <button
          key={channel.id}
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-[var(--color-surface-3)]"
          style={{ color: 'var(--color-text)' }}
          onClick={() => onPick(channel.id)}
        >
          <PlatformBadge
            platform={channel.platform}
            label={platformLabel(channel.platform, platforms)}
          />
          <span className="truncate">{channel.name}</span>
        </button>
      ))}
    </>
  )
}
