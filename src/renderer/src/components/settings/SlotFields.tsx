/**
 * The two template editors shared by Settings → Channels and Settings →
 * Collections: the description template (a textarea with a slot palette that
 * inserts `{{name}}` at the cursor) and the custom slot rows.
 *
 * Both only *hint*. Which slot names are legal and what the template renders
 * to is the backend's call; a refused save comes back as a toast from the pane
 * that owns the write.
 */

import { useRef, useState } from 'react'
import type { SlotRow } from '../../lib/collections'
import {
  BUILTIN_SLOTS,
  insertSlotToken,
  slotNameProblem,
  slotRows,
  slotToken,
  slotsFromRows,
} from '../../lib/collections'
import { Button } from '../ui/Button'

const TEMPLATE_ROWS = 6
const BUILTIN: ReadonlySet<string> = new Set(BUILTIN_SLOTS)

interface TemplateEditorProps {
  id: string
  value: string
  /** Every name the palette offers — `paletteSlots(...)`. */
  slotNames: readonly string[]
  placeholder?: string
  onDraft: (value: string) => void
  onCommit: (value: string) => void
}

export function TemplateEditor({
  id,
  value,
  slotNames,
  placeholder,
  onDraft,
  onCommit,
}: TemplateEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function insert(name: string) {
    const el = ref.current
    const next = insertSlotToken(
      value,
      name,
      el?.selectionStart ?? value.length,
      el?.selectionEnd ?? value.length
    )
    onDraft(next.text)
    onCommit(next.text)
    if (!el) return
    // After React has written the new value, put the caret behind the token.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        id={id}
        rows={TEMPLATE_ROWS}
        className="field-input resize-y"
        style={{ fontFamily: 'var(--cf-font-mono)' }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={() => onCommit(value)}
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Insert a slot">
        {slotNames.map((name) => (
          <button
            key={name}
            type="button"
            className="rounded px-1.5 py-0.5 text-2xs hover:bg-[var(--color-surface-2)]"
            style={{
              fontFamily: 'var(--cf-font-mono)',
              color: BUILTIN.has(name) ? 'var(--color-text-2)' : 'var(--color-brand)',
              background: 'var(--color-surface-3)',
            }}
            title={`Insert ${slotToken(name)}`}
            // Keep the textarea's selection: insertion happens where the cursor was.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(name)}
          >
            {slotToken(name)}
          </button>
        ))}
      </div>
    </div>
  )
}

interface SlotRowsEditorProps {
  /** Prefixes the row ids; one editor per pane. */
  idPrefix: string
  slots: Record<string, string>
  /** Called on blur and on remove, only when the slot map actually changed. */
  onCommit: (slots: Record<string, string>) => void
}

/**
 * `name = value` rows, held locally while typed so a half-typed name is not a
 * write. Mount it with `key={JSON.stringify(slots)}` so a saved map resets it.
 */
export function SlotRowsEditor({ idPrefix, slots, onCommit }: SlotRowsEditorProps) {
  const [rows, setRows] = useState<SlotRow[]>(() => slotRows(slots))

  function commit(next: readonly SlotRow[]) {
    const nextSlots = slotsFromRows(next)
    if (JSON.stringify(nextSlots) !== JSON.stringify(slots)) onCommit(nextSlots)
  }

  function setRow(index: number, patch: Partial<SlotRow>) {
    setRows((prev) => prev.map((row, j) => (j === index ? { ...row, ...patch } : row)))
  }

  function remove(index: number) {
    const next = rows.filter((_, j) => j !== index)
    setRows(next)
    commit(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => {
        const name = row.key.trim()
        const others = rows.filter((_, j) => j !== i).map((r) => r.key.trim())
        const problem = name === '' ? null : slotNameProblem(name, others)
        return (
          <div key={i} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <input
                id={`${idPrefix}-slot-${i}`}
                type="text"
                className="field-input w-36 shrink-0"
                style={{ fontFamily: 'var(--cf-font-mono)' }}
                aria-label={`Slot ${i + 1} name`}
                aria-invalid={problem ? true : undefined}
                placeholder="event"
                value={row.key}
                onChange={(e) => setRow(i, { key: e.target.value })}
                onBlur={() => commit(rows)}
              />
              <input
                type="text"
                className="field-input"
                aria-label={`Slot ${i + 1} value`}
                placeholder="UCK 26"
                value={row.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
                onBlur={() => commit(rows)}
              />
              <button
                type="button"
                className="icon-btn w-5 h-5 text-[11px] shrink-0"
                aria-label={`Remove slot ${i + 1}`}
                onClick={() => remove(i)}
              >
                ✕
              </button>
            </div>
            {problem && (
              <p className="text-2xs" style={{ color: 'var(--color-danger)' }}>
                {problem}
              </p>
            )}
          </div>
        )
      })}
      <Button
        variant="ghost"
        className="text-xs justify-center"
        onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}
      >
        Add slot
      </Button>
    </div>
  )
}
