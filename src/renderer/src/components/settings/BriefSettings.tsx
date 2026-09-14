/**
 * Settings → Channel: the global brief (`library_root()/brief.json`).
 *
 * This is the conference-specific prose that used to live inside the publish
 * skill, moved into user data (vision §3.2) — which is what lets one skill
 * serve a personal channel and a conference channel. Keep it *structured*:
 * prose here is read on every agent call.
 *
 * Text fields save on blur, toggles and ranges on change; every failure is
 * toasted rather than swallowed. There is no `If-Match` — it is one small file
 * with one editor.
 */

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { hashtagsLine, parseHashtags } from '../../lib/publishFields'
import type { Brief, HouseRules, LinkRow } from '../../lib/publishTypes'
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'

/** What the pane shows before the backend answers (and if it never does). */
const EMPTY_BRIEF: Brief = {
  channel: '',
  audience: '',
  voice: '',
  language: '',
  footer: '',
  recorded_at_line: '',
  speaker_block: '',
  default_hashtags: [],
  link_rows: [],
  house_rules: {
    no_em_dashes: false,
    description_chars: null,
    keywords_terms: null,
    hook_first_150: true,
  },
}

const TEXT_ROWS = 3

/** The single-line fields, in the order they are asked for. */
const TEXT_FIELDS: ReadonlyArray<{
  key: 'channel' | 'audience' | 'voice' | 'language'
  label: string
  placeholder: string
}> = [
  { key: 'channel', label: 'Channel', placeholder: 'The channel these videos ship to' },
  { key: 'audience', label: 'Audience', placeholder: 'Who watches it' },
  { key: 'voice', label: 'Voice', placeholder: 'How it sounds — plain, technical, warm…' },
  { key: 'language', label: 'Language', placeholder: 'Empty = the transcript’s language' },
]

/** The multi-line templates. */
const BLOCK_FIELDS: ReadonlyArray<{
  key: 'recorded_at_line' | 'speaker_block' | 'footer'
  label: string
  placeholder: string
}> = [
  {
    key: 'recorded_at_line',
    label: 'Recorded-at line',
    placeholder: 'Recorded at …, {{event}} {{year}}',
  },
  {
    key: 'speaker_block',
    label: 'Speaker block',
    placeholder: 'How a speaker is introduced in the description',
  },
  { key: 'footer', label: 'Footer', placeholder: 'The block every description ends with' },
]

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

export function BriefSettings() {
  const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    api
      .getBrief()
      .then((loaded) => {
        if (!cancelled) setBrief(loaded)
      })
      .catch((err) => toast(err.message || 'Could not read the channel brief', 'error'))
    return () => {
      cancelled = true
    }
    // Loaded once per open of this pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Write a patch through, and adopt whatever the backend merged. */
  function save(patch: Record<string, unknown>) {
    api
      .patchBrief(patch)
      .then(setBrief)
      .catch((err) => toast(err.message || 'Could not save the channel brief', 'error'))
  }

  function setLocal(patch: Partial<Brief>) {
    setBrief((prev) => ({ ...prev, ...patch }))
  }

  function saveRules(patch: Partial<HouseRules>) {
    const next = { ...brief.house_rules, ...patch }
    setLocal({ house_rules: next })
    save({ house_rules: next })
  }

  function saveLinks(rows: LinkRow[]) {
    setLocal({ link_rows: rows })
    save({ link_rows: rows })
  }

  const rules = brief.house_rules

  return (
    <div className="flex flex-col gap-5">
      {TEXT_FIELDS.map(({ key, label, placeholder }) => (
        <div key={key} className="flex flex-col gap-2">
          <label className="label-xs" htmlFor={`brief-${key}`}>
            {label}
          </label>
          <input
            id={`brief-${key}`}
            type="text"
            className="field-input"
            placeholder={placeholder}
            value={brief[key]}
            onChange={(e) => setLocal({ [key]: e.target.value } as Partial<Brief>)}
            onBlur={() => save({ [key]: brief[key] })}
          />
        </div>
      ))}

      {BLOCK_FIELDS.map(({ key, label, placeholder }) => (
        <div key={key} className="flex flex-col gap-2">
          <label className="label-xs" htmlFor={`brief-${key}`}>
            {label}
          </label>
          <textarea
            id={`brief-${key}`}
            rows={TEXT_ROWS}
            className="field-input resize-y"
            placeholder={placeholder}
            value={brief[key]}
            onChange={(e) => setLocal({ [key]: e.target.value } as Partial<Brief>)}
            onBlur={() => save({ [key]: brief[key] })}
          />
        </div>
      ))}

      {/* Default hashtags */}
      <div className="flex flex-col gap-2">
        <label className="label-xs" htmlFor="brief-hashtags">
          Default hashtags
        </label>
        <input
          id="brief-hashtags"
          type="text"
          className="field-input"
          placeholder="#ai #captions"
          value={hashtagsLine(brief.default_hashtags)}
          onChange={(e) => setLocal({ default_hashtags: parseHashtags(e.target.value) })}
          onBlur={() => save({ default_hashtags: brief.default_hashtags })}
        />
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          Written first, before whatever the video itself asks for.
        </p>
      </div>

      {/* Link rows */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Link rows</label>
        {brief.link_rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              className="field-input"
              aria-label={`Link ${i + 1} label`}
              placeholder="Label"
              value={row.label}
              onChange={(e) =>
                setLocal({
                  link_rows: brief.link_rows.map((r, j) =>
                    j === i ? { ...r, label: e.target.value } : r
                  ),
                })
              }
              onBlur={() => save({ link_rows: brief.link_rows })}
            />
            <input
              type="text"
              className="field-input"
              aria-label={`Link ${i + 1} URL`}
              placeholder="https://"
              value={row.url}
              onChange={(e) =>
                setLocal({
                  link_rows: brief.link_rows.map((r, j) =>
                    j === i ? { ...r, url: e.target.value } : r
                  ),
                })
              }
              onBlur={() => save({ link_rows: brief.link_rows })}
            />
            <button
              type="button"
              className="icon-btn w-5 h-5 text-[11px] shrink-0"
              aria-label={`Remove link row ${i + 1}`}
              onClick={() => saveLinks(brief.link_rows.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          className="text-xs justify-center"
          onClick={() => setLocal({ link_rows: [...brief.link_rows, { label: '', url: '' }] })}
        >
          Add link row
        </Button>
      </div>

      {/* House rules */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">House rules</label>
        <Toggle
          checked={rules.no_em_dashes}
          onChange={(checked) => saveRules({ no_em_dashes: checked })}
          label="No em or en dashes (outside numeric ranges)"
        />
        <Toggle
          checked={rules.hook_first_150}
          onChange={(checked) => saveRules({ hook_first_150: checked })}
          label="The first 150 characters must be a hook"
        />
        <RangeRow
          label="Description length"
          range={rules.description_chars}
          onCommit={(range) => saveRules({ description_chars: range })}
        />
        <RangeRow
          label="Keyword terms"
          range={rules.keywords_terms}
          onCommit={(range) => saveRules({ keywords_terms: range })}
        />
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          Leave a pair empty for no window. These are style rules — only checked because the brief
          asks for them; YouTube’s own limits always apply.
        </p>
      </div>
    </div>
  )
}
