/**
 * Localized: a title, description, tags, chapter titles and Shorts caption per
 * language — what each language's upload package is rendered from.
 *
 * The chips are every language the record knows except the source: stored
 * localized languages, and translated caption tracks that have no fields yet
 * ("not started" — typing starts one). "Add language" starts any other.
 *
 * Every write goes through `localizedDraft` (`lib/publishLocalized.ts`): the
 * draft names only the languages the user changed, because the backend merges
 * `localized` per language and a whole dict would clobber an agent's `de`.
 * The limits are the backend's findings (`localized.<lang>.<field>`), drawn
 * under the control they name.
 */

import { useState } from 'react'
import { StudioCard } from '../studio/StudioCard'
import { languageLabel } from '../../lib/languages'
import type { LocalizedMap } from '../../lib/publishMediaTypes'
import {
  addLanguage,
  addableLanguages,
  editableLanguages,
  isStarted,
  localizedDraft,
  removeLanguage,
} from '../../lib/publishLocalized'
import { partitionViolations } from '../../lib/publishViolations'
import type { Violation } from '../../lib/publishTypes'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'
import { LocalizedLanguageForm } from './LocalizedLanguageForm'

interface LocalizedCardProps {
  publish: PublishController
}

export function LocalizedCard({ publish }: LocalizedCardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  return (
    <LocalizedCardView
      publish={publish}
      selected={selected}
      confirmingRemove={confirmingRemove}
      onSelect={(lang) => {
        setSelected(lang)
        setConfirmingRemove(false)
      }}
      onConfirmRemove={setConfirmingRemove}
    />
  )
}

export interface LocalizedCardViewProps {
  publish: PublishController
  /** The chip the user picked; falls back to the first language when it is gone. */
  selected: string | null
  /** "Remove language" was clicked and awaits a yes/no. */
  confirmingRemove: boolean
  onSelect: (lang: string) => void
  onConfirmRemove: (confirming: boolean) => void
}

interface LanguageChipProps {
  lang: string
  active: boolean
  started: boolean
  findings: Violation[]
  onSelect: (lang: string) => void
}

function LanguageChip({ lang, active, started, findings, onSelect }: LanguageChipProps) {
  const hard = findings.some((v) => v.severity === 'hard')
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(lang)}
      title={
        started ? languageLabel(lang) : `${languageLabel(lang)} — a caption track, not started`
      }
      className="flex items-center gap-1 text-xs-plus px-2 py-0.5 rounded-full hover:bg-[var(--color-surface-2)] transition-colors"
      style={{
        color: started ? 'var(--color-text)' : 'var(--color-text-3)',
        border: `1px ${started ? 'solid' : 'dashed'} var(--color-border)`,
        background: active ? 'var(--color-accent-subtle)' : 'transparent',
      }}
    >
      <span>{languageLabel(lang)}</span>
      {!started && <span className="text-2xs">not started</span>}
      {findings.length > 0 && (
        <span
          className="text-2xs tabular-nums"
          aria-label={`${findings.length} finding(s)`}
          style={{ color: hard ? 'var(--color-danger)' : 'var(--color-amber-2)' }}
        >
          ● {findings.length}
        </span>
      )}
    </button>
  )
}

interface LanguageChipsProps {
  languages: readonly string[]
  active: string | null
  localized: LocalizedMap
  /** Findings per language, in `languages` order. */
  findings: Violation[][]
  onSelect: (lang: string) => void
}

function LanguageChips({ languages, active, localized, findings, onSelect }: LanguageChipsProps) {
  if (languages.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mb-1.5" aria-label="Languages">
      {languages.map((lang, i) => (
        <LanguageChip
          key={lang}
          lang={lang}
          active={lang === active}
          started={isStarted(localized, lang)}
          findings={findings[i]}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

interface AddLanguageProps {
  options: ReturnType<typeof addableLanguages>
  onAdd: (code: string) => void
}

function AddLanguage({ options, onAdd }: AddLanguageProps) {
  return (
    <select
      className="field-input text-xs-plus"
      aria-label="Add language"
      value=""
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value)
      }}
    >
      <option value="">Add language…</option>
      {options.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label} · {l.nativeLabel}
        </option>
      ))}
    </select>
  )
}

export function LocalizedCardView(props: LocalizedCardViewProps) {
  const { publish, selected, confirmingRemove, onSelect, onConfirmRemove } = props
  const record = publish.record
  if (!record) return null
  const localized = publish.fields.localized
  const languages = editableLanguages(record, localized)
  const active = selected && languages.includes(selected) ? selected : (languages[0] ?? null)
  const { placed, unplaced } = partitionViolations(
    publish.violationsFor('localized'),
    languages.map((lang) => [`localized.${lang}`])
  )
  // The draft is the delta from the record on screen — never the whole map.
  const write = (next: LocalizedMap) =>
    publish.setField('localized', localizedDraft(record.localized, next))

  return (
    <StudioCard title="Localized" defaultOpen={false}>
      <FieldHeader publish={publish} field="localized" label="Languages" />
      <LanguageChips
        languages={languages}
        active={active}
        localized={localized}
        findings={placed}
        onSelect={onSelect}
      />
      <FieldViolations violations={unplaced} />
      <AddLanguage
        options={addableLanguages(record, localized)}
        onAdd={(code) => {
          write(addLanguage(localized, code))
          onSelect(code)
        }}
      />

      {active === null ? (
        <p className="text-2xs mt-2" style={{ color: 'var(--color-text-3)' }}>
          No other languages yet. A translated caption track shows up here as “not started”, or add
          a language — each gets its own title, description, tags and chapter titles, and its own
          upload package.
        </p>
      ) : (
        <LocalizedLanguageForm
          publish={publish}
          lang={active}
          localized={localized}
          findings={placed[languages.indexOf(active)] ?? []}
          confirmingRemove={confirmingRemove}
          onConfirmRemove={onConfirmRemove}
          onWrite={write}
          onRemove={() => {
            onConfirmRemove(false)
            write(removeLanguage(localized, active))
          }}
        />
      )}
    </StudioCard>
  )
}
