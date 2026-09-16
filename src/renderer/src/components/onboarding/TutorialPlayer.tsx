/**
 * The tutorial video, inside the startup guide.
 *
 * Click to load: while it is collapsed there is no iframe in the tree at all,
 * so simply opening the guide never talks to YouTube. Expanding mounts the
 * nocookie player, which is the one origin `index.html`'s CSP allows in a
 * frame. "Open in browser" stays for anyone who would rather watch it there,
 * and goes through the main process allowlist like every other link.
 */

import type { ReactNode } from 'react'
import { TUTORIAL_EMBED_URL, TUTORIAL_URL } from '../../lib/startupGuide'

export interface TutorialPlayerProps {
  expanded: boolean
  onToggle: () => void
  onOpenUrl: (url: string) => void
}

export function TutorialPlayer({ expanded, onToggle, onOpenUrl }: TutorialPlayerProps) {
  return (
    <div className="flex flex-col gap-2">
      {expanded && (
        <div
          className="aspect-video w-full rounded-md overflow-hidden border border-[var(--color-border)]"
          style={{ background: 'var(--color-bg)' }}
        >
          <iframe
            src={TUTORIAL_EMBED_URL}
            title="CapForge tutorial"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="w-full h-full"
          />
        </div>
      )}

      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        Prefer to watch?{' '}
        <TextButton onClick={onToggle}>
          {expanded ? 'Hide the tutorial' : '▶ Watch the tutorial'}
        </TextButton>{' '}
        · <TextButton onClick={() => onOpenUrl(TUTORIAL_URL)}>Open in browser</TextButton>
      </p>
    </div>
  )
}

interface TextButtonProps {
  onClick: () => void
  children: ReactNode
}

function TextButton({ onClick, children }: TextButtonProps) {
  return (
    <button
      type="button"
      className="underline underline-offset-2 hover:opacity-80"
      style={{ color: 'var(--color-text-2)' }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
