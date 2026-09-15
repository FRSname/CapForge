/**
 * The brief's field editors, shared by Settings → Channels (a channel's
 * profile, `ChannelProfileSection`) and a collection's overrides
 * (`CollectionOverrides`) — one control per brief field, so an override is
 * edited exactly like the channel value it replaces.
 *
 * Every control is controlled and stateless about saving: `onDraft` is a
 * keystroke (local only), `onCommit` is a write (blur for text, change for
 * toggles and removals). The pane that mounts it owns the I/O and its toasts.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { BriefOverrideField } from '../../lib/collectionTypes'
import { hashtagsLine, parseHashtags } from '../../lib/publishFields'
import type { Brief, HouseRules, LinkRow } from '../../lib/publishTypes'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { TemplateEditor } from './SlotFields'

const TEXT_ROWS = 3

type FieldKind = 'text' | 'block' | 'template' | 'hashtags' | 'links' | 'rules'

export interface BriefFieldSpec {
  label: string
  kind: FieldKind
  placeholder?: string
  help?: string
}

export const BRIEF_FIELD_SPECS: { readonly [K in BriefOverrideField]: BriefFieldSpec } = {
  channel: { label: 'Channel', kind: 'text', placeholder: 'The channel these videos ship to' },
  audience: { label: 'Audience', kind: 'text', placeholder: 'Who watches it' },
  voice: { label: 'Voice', kind: 'text', placeholder: 'How it sounds — plain, technical, warm…' },
  language: { label: 'Language', kind: 'text', placeholder: 'Empty = the transcript’s language' },
  recorded_at_line: {
    label: 'Recorded-at line',
    kind: 'block',
    placeholder: 'Recorded at …, {{event}} {{year}}',
  },
  speaker_block: {
    label: 'Speaker block',
    kind: 'block',
    placeholder: 'How a speaker is introduced in the description',
  },
  footer: { label: 'Footer', kind: 'block', placeholder: 'The block every description ends with' },
  description_template: {
    label: 'Description template',
    kind: 'template',
    placeholder: 'Empty = the built-in layout',
    help: 'Lays out the DESCRIPTION block. Click a slot to insert it at the cursor; slots also expand inside the footer and the recorded-at line.',
  },
  default_hashtags: {
    label: 'Default hashtags',
    kind: 'hashtags',
    placeholder: '#ai #captions',
    help: 'Written first, before whatever the video itself asks for.',
  },
  link_rows: { label: 'Link rows', kind: 'links' },
  house_rules: {
    label: 'House rules',
    kind: 'rules',
    help: 'Leave a pair empty for no window. These are style rules — only checked because the brief asks for them; YouTube’s own limits always apply.',
  },
}

interface BriefFieldRowProps {
  label: string
  /** The control's id, for a label that focuses it. */
  htmlFor?: string
  /** Right of the label — the collection editor's "Inherit from channel" toggle. */
  aside?: ReactNode
  help?: string
  children: ReactNode
}

export function BriefFieldRow({ label, htmlFor, aside, help, children }: BriefFieldRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label className="label-xs" htmlFor={htmlFor}>
          {label}
        </label>
        {aside}
      </div>
      {children}
      {help && (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {help}
        </p>
      )}
    </div>
  )
}

interface ControlProps<T> {
  id: string
  value: T
  onDraft: (value: T) => void
  onCommit: (value: T) => void
}

export interface BriefFieldControlProps<K extends BriefOverrideField> extends ControlProps<
  Brief[K]
> {
  field: K
  /** The template palette's names. */
  slotNames: readonly string[]
}

/** The editor for one brief field, picked by the field's kind. */
export function BriefFieldControl<K extends BriefOverrideField>(props: BriefFieldControlProps<K>) {
  const { field, slotNames, id, value, onDraft, onCommit } = props
  const spec = BRIEF_FIELD_SPECS[field]
  const base = { id, value, onDraft, onCommit } as unknown
  switch (spec.kind) {
    case 'text':
      return <TextControl {...(base as ControlProps<string>)} placeholder={spec.placeholder} />
    case 'block':
      return <BlockControl {...(base as ControlProps<string>)} placeholder={spec.placeholder} />
    case 'template':
      return (
        <TemplateEditor
          {...(base as ControlProps<string>)}
          slotNames={slotNames}
          placeholder={spec.placeholder}
        />
      )
    case 'hashtags':
      return <HashtagsControl {...(base as ControlProps<string[]>)} />
    case 'links':
      return <LinkRowsControl {...(base as ControlProps<LinkRow[]>)} />
    case 'rules':
      return <HouseRulesControl {...(base as ControlProps<HouseRules>)} />
  }
}

function TextControl({
  id,
  value,
  onDraft,
  onCommit,
  placeholder,
}: ControlProps<string> & { placeholder?: string }) {
  return (
    <input
      id={id}
      type="text"
      className="field-input"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={() => onCommit(value)}
    />
  )
}

function BlockControl({
  id,
  value,
  onDraft,
  onCommit,
  placeholder,
}: ControlProps<string> & { placeholder?: string }) {
  return (
    <textarea
      id={id}
      rows={TEXT_ROWS}
      className="field-input resize-y"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={() => onCommit(value)}
    />
  )
}

function HashtagsControl({ id, value, onDraft, onCommit }: ControlProps<string[]>) {
  return (
    <input
      id={id}
      type="text"
      className="field-input"
      placeholder={BRIEF_FIELD_SPECS.default_hashtags.placeholder}
      value={hashtagsLine(value)}
      onChange={(e) => onDraft(parseHashtags(e.target.value))}
      onBlur={() => onCommit(value)}
    />
  )
}

function LinkRowsControl({ value, onDraft, onCommit }: ControlProps<LinkRow[]>) {
  const edit = (index: number, patch: Partial<LinkRow>) =>
    onDraft(value.map((row, j) => (j === index ? { ...row, ...patch } : row)))
  return (
    <div className="flex flex-col gap-2">
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            className="field-input"
            aria-label={`Link ${i + 1} label`}
            placeholder="Label"
            value={row.label}
            onChange={(e) => edit(i, { label: e.target.value })}
            onBlur={() => onCommit(value)}
          />
          <input
            type="text"
            className="field-input"
            aria-label={`Link ${i + 1} URL`}
            placeholder="https://"
            value={row.url}
            onChange={(e) => edit(i, { url: e.target.value })}
            onBlur={() => onCommit(value)}
          />
          <button
            type="button"
            className="icon-btn w-5 h-5 text-[11px] shrink-0"
            aria-label={`Remove link row ${i + 1}`}
            onClick={() => onCommit(value.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        className="text-xs justify-center"
        onClick={() => onDraft([...value, { label: '', url: '' }])}
      >
        Add link row
      </Button>
    </div>
  )
}

function HouseRulesControl({ value, onCommit }: ControlProps<HouseRules>) {
  const commit = (patch: Partial<HouseRules>) => onCommit({ ...value, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Toggle
        checked={value.no_em_dashes}
        onChange={(checked) => commit({ no_em_dashes: checked })}
        label="No em or en dashes (outside numeric ranges)"
      />
      <Toggle
        checked={value.hook_first_150}
        onChange={(checked) => commit({ hook_first_150: checked })}
        label="The first 150 characters must be a hook"
      />
      <RangeRow
        // Remount when the saved window changes, so a loaded brief is shown.
        key={`chars-${String(value.description_chars)}`}
        label="Description length"
        range={value.description_chars}
        onCommit={(range) => commit({ description_chars: range })}
      />
      <RangeRow
        key={`terms-${String(value.keywords_terms)}`}
        label="Keyword terms"
        range={value.keywords_terms}
        onCommit={(range) => commit({ keywords_terms: range })}
      />
    </div>
  )
}

function rangeValue(range: [number, number] | null, index: 0 | 1): string {
  return range ? String(range[index]) : ''
}

/** Both ends set and usable, or no window at all. */
function toRange(min: string, max: string): [number, number] | null {
  const lo = Number(min)
  const hi = Number(max)
  if (!min.trim() || !max.trim() || !Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return [lo, hi]
}

interface RangeRowProps {
  label: string
  range: [number, number] | null
  /** Called once the pair is complete (or cleared) — both ends or neither. */
  onCommit: (range: [number, number] | null) => void
}

/**
 * A `[min, max]` house-rule window. Held locally while it is half-typed, so a
 * min without a max is not read as "no window" on every keystroke.
 */
function RangeRow({ label, range, onCommit }: RangeRowProps) {
  const [min, setMin] = useState(rangeValue(range, 0))
  const [max, setMax] = useState(rangeValue(range, 1))

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs flex-1" style={{ color: 'var(--color-text-2)' }}>
        {label}
      </span>
      <input
        type="number"
        className="field-input w-20"
        aria-label={`Minimum ${label.toLowerCase()}`}
        value={min}
        onChange={(e) => setMin(e.target.value)}
        onBlur={() => onCommit(toRange(min, max))}
      />
      <input
        type="number"
        className="field-input w-20"
        aria-label={`Maximum ${label.toLowerCase()}`}
        value={max}
        onChange={(e) => setMax(e.target.value)}
        onBlur={() => onCommit(toRange(min, max))}
      />
    </div>
  )
}
