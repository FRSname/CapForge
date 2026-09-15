/**
 * "About this channel — for Claude": the channel's `context`, which an agent
 * reads (`get_channel`) before it writes any post for this channel. Plain
 * prose fields plus three one-per-line lists of real examples.
 *
 * Text saves on blur. A list is held as text while it is typed (so the newline
 * just pressed is not trimmed away) and becomes a list on blur.
 */

import { useState } from 'react'
import type { ChannelContext } from '../../lib/channelTypes'
import { linesToList, listToLines } from '../../lib/channels'
import { BriefFieldRow } from './BriefFields'
import type { CommitContext, DraftContext } from './ChannelEditor'

const ABOUT_ROWS = 5
const BLOCK_ROWS = 3
const LIST_ROWS = 4

type TextField = 'about' | 'audience' | 'voice' | 'title_style' | 'naming' | 'notes'
type ListField = 'example_titles' | 'example_slugs' | 'keywords'

type ContextFieldSpec =
  | { field: TextField; label: string; rows: number | null; placeholder: string; help?: string }
  | { field: ListField; label: string; placeholder: string; help: string }

function isListSpec(
  spec: ContextFieldSpec
): spec is Extract<ContextFieldSpec, { field: ListField }> {
  return !('rows' in spec)
}

/** In reading order; `rows: null` is a one-line input. */
const CONTEXT_FIELDS: readonly ContextFieldSpec[] = [
  {
    field: 'about',
    label: 'About',
    rows: ABOUT_ROWS,
    placeholder: 'What the channel is, who runs it, what it covers',
  },
  { field: 'audience', label: 'Audience', rows: null, placeholder: 'Who watches or reads it' },
  {
    field: 'voice',
    label: 'Voice',
    rows: null,
    placeholder: 'How it sounds — plain, technical, warm…',
  },
  {
    field: 'title_style',
    label: 'Title style',
    rows: BLOCK_ROWS,
    placeholder: 'Length, casing, emoji, series prefix, “Speaker — Talk” order…',
  },
  {
    field: 'example_titles',
    label: 'Example titles',
    placeholder: 'Jane Doe — Shipping AI to production',
    help: 'Real titles or captions from this channel, one per line.',
  },
  {
    field: 'naming',
    label: 'Naming',
    rows: BLOCK_ROWS,
    placeholder: 'How videos are named and slugged — URL slugs, episode codes, file names',
  },
  {
    field: 'example_slugs',
    label: 'Example slugs',
    placeholder: 'uck26-shipping-ai',
    help: 'Real slugs or file names, one per line.',
  },
  {
    field: 'keywords',
    label: 'Keywords',
    placeholder: 'dotnet',
    help: 'Recurring keywords and tags to reuse, one per line (commas stay part of a keyword).',
  },
  {
    field: 'notes',
    label: 'Notes',
    rows: BLOCK_ROWS,
    placeholder: 'Anything else — calls to action, words to avoid, pinned-comment habits',
  },
]

interface ChannelContextSectionProps {
  context: ChannelContext
  onDraft: DraftContext
  onCommit: CommitContext
}

export function ChannelContextSection({ context, onDraft, onCommit }: ChannelContextSectionProps) {
  return (
    <div role="group" aria-label="About this channel — for Claude" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm" style={{ color: 'var(--color-text)' }}>
          About this channel — for Claude
        </h3>
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          Claude reads this before it writes any post for this channel. Describe how the channel
          looks and sounds, with real examples — none of it is pasted into a post.
        </p>
      </div>
      {CONTEXT_FIELDS.map((spec) => {
        const id = `channel-context-${spec.field}`
        return (
          <BriefFieldRow key={spec.field} label={spec.label} htmlFor={id} help={spec.help}>
            {isListSpec(spec) ? (
              <LinesEditor
                // Remount when the saved list changes, so the text shows it normalised.
                key={JSON.stringify(context[spec.field])}
                id={id}
                value={context[spec.field]}
                placeholder={spec.placeholder}
                onCommit={(list) => onCommit(spec.field, list)}
              />
            ) : (
              <TextField
                spec={spec}
                id={id}
                value={context[spec.field]}
                onDraft={onDraft}
                onCommit={onCommit}
              />
            )}
          </BriefFieldRow>
        )
      })}
    </div>
  )
}

interface TextFieldProps {
  spec: Extract<ContextFieldSpec, { field: TextField }>
  id: string
  value: string
  onDraft: DraftContext
  onCommit: CommitContext
}

function TextField({ spec, id, value, onDraft, onCommit }: TextFieldProps) {
  const shared = {
    id,
    placeholder: spec.placeholder,
    value,
    onBlur: () => onCommit(spec.field, value),
  }
  if (spec.rows === null) {
    return (
      <input
        {...shared}
        type="text"
        className="field-input"
        onChange={(e) => onDraft(spec.field, e.target.value)}
      />
    )
  }
  return (
    <textarea
      {...shared}
      rows={spec.rows}
      className="field-input resize-y"
      onChange={(e) => onDraft(spec.field, e.target.value)}
    />
  )
}

interface LinesEditorProps {
  id: string
  value: readonly string[]
  placeholder: string
  onCommit: (list: string[]) => void
}

/** One entry per line; trimmed and blank lines dropped on blur. */
function LinesEditor({ id, value, placeholder, onCommit }: LinesEditorProps) {
  const [text, setText] = useState(() => listToLines(value))
  return (
    <textarea
      id={id}
      rows={LIST_ROWS}
      className="field-input resize-y"
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(linesToList(text))}
    />
  )
}
