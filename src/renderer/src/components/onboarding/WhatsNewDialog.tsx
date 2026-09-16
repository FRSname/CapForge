/**
 * "What's new": the highlights of every release the user has not seen yet,
 * newest first. Shown once after an update and reopenable from
 * Settings -> General.
 *
 * The notes come from `lib/releaseNotes.ts` (a typed list, pinned to
 * CHANGELOG.md by its test), never parsed from markdown at runtime.
 */

import type { ReleaseNotes } from '../../lib/releaseNotes'
import { RELEASES_URL } from '../../lib/releaseNotes'
import { Button } from '../ui/Button'
import { ModalShell } from '../ui/ModalShell'

/** Narrower than the guide: this card is a list, not a page of prose. */
const CARD_WIDTH_CLASS = 'w-[520px]'

export interface WhatsNewDialogProps {
  open: boolean
  /** Newest first; empty means the user is up to date. */
  notes: ReleaseNotes[]
  onClose: () => void
  onOpenUrl: (url: string) => void
}

export function WhatsNewDialog({ open, notes, onClose, onOpenUrl }: WhatsNewDialogProps) {
  const heading = notes.length === 1 ? `What's new in CapForge ${notes[0].version}` : "What's new"

  return (
    <ModalShell open={open} onClose={onClose} label={heading} width={CARD_WIDTH_CLASS}>
      <h2
        className="text-base"
        style={{ fontFamily: 'var(--cf-font-display)', color: 'var(--color-text)' }}
      >
        {heading}
      </h2>

      {notes.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-text-2)' }}>
          You're up to date. There is nothing new since you last looked.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {notes.map((release) => (
            <ReleaseSection
              key={release.version}
              release={release}
              showVersion={notes.length > 1}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="ghost" className="text-xs" onClick={() => onOpenUrl(RELEASES_URL)}>
          Full changelog
        </Button>
        <Button variant="primary" className="text-xs" onClick={onClose}>
          Got it
        </Button>
      </div>
    </ModalShell>
  )
}

interface ReleaseSectionProps {
  release: ReleaseNotes
  /** With one release the version is already in the header. */
  showVersion: boolean
}

function ReleaseSection({ release, showVersion }: ReleaseSectionProps) {
  return (
    <section aria-label={`CapForge ${release.version}`} className="flex flex-col gap-2">
      {showVersion && (
        <p
          className="text-2xs uppercase tracking-wider"
          style={{ color: 'var(--color-text-3)', fontFamily: 'var(--cf-font-mono)' }}
        >
          {release.version}
        </p>
      )}
      <p className="text-xs" style={{ color: 'var(--color-text-2)' }}>
        {release.headline}
      </p>
      <ul className="flex flex-col gap-2.5 m-0 p-0 list-none">
        {release.highlights.map((highlight) => (
          <li key={highlight.title} className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
              {highlight.title}
            </span>
            <span className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
              {highlight.body}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
