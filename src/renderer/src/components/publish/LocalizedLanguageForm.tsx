/**
 * One language's fields in the Localized card: title (100-char meter),
 * description (5000-byte meter), short description, tags, hashtags, chapter
 * titles lined up with the root chapters, and the Shorts caption.
 *
 * Each placeholder is the **source** text, which is both the thing being
 * translated and what the package falls back to when the field is left empty.
 * The findings are the backend's `localized.<lang>.<field>`; a finding on the
 * language itself (`localized.<lang>`: a bad code, the source language) sits
 * under the language's header.
 */

import type { ReactNode } from 'react'
import { languageLabel } from '../../lib/languages'
import type { LocalizedFields, LocalizedMap } from '../../lib/publishMediaTypes'
import { EMPTY_LOCALIZED } from '../../lib/publishMediaTypes'
import {
  alignedChapterTitles,
  extraChapterTitles,
  isStarted,
  setChapterTitle,
  setLocalizedField,
} from '../../lib/publishLocalized'
import type { LocalizedFieldId } from '../../lib/publishLocalized'
import {
  byteLength,
  hashtagsLine,
  parseHashtags,
  parseTagsLine,
  tagsLine,
} from '../../lib/publishFields'
import { partitionViolations } from '../../lib/publishViolations'
import type { Chapter, PublishAuthored, Violation } from '../../lib/publishTypes'
import {
  DESCRIPTION_MAX_BYTES,
  TAGS_MAX_CHARS,
  TITLE_MAX_CHARS,
  formatTimestamp,
} from '../../lib/youtubeRules'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldMeter } from './FieldMeter'
import { FieldViolations } from './FieldViolations'

const DESCRIPTION_ROWS = 6
const CAPTION_ROWS = 3

/** The controls, in the order they are drawn — also the order findings are claimed in. */
const FIELD_ORDER: readonly LocalizedFieldId[] = [
  'title',
  'description',
  'short_description',
  'tags',
  'hashtags',
  'chapter_titles',
  'shorts_caption',
]

const MUTED = { color: 'var(--color-text-3)' }
const LINK_CLASS = 'text-2xs hover:underline'

/** Focus/blur wiring for the soft lock — every control here edits `localized`. */
interface EditHandlers {
  onFocus: () => void
  onBlur: () => void
}

export interface LocalizedLanguageFormProps {
  publish: PublishController
  lang: string
  /** The merged map on screen (record + drafts). */
  localized: LocalizedMap
  /** Every `localized.<lang>…` finding. */
  findings: Violation[]
  confirmingRemove: boolean
  onConfirmRemove: (confirming: boolean) => void
  onWrite: (next: LocalizedMap) => void
  onRemove: () => void
}

interface RowProps {
  label: string
  meter?: ReactNode
  findings: Violation[]
  children: ReactNode
}

function Row({ label, meter, findings, children }: RowProps) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="label-xs truncate">{label}</span>
        {meter}
      </div>
      {children}
      <FieldViolations violations={findings} />
    </div>
  )
}

interface TextControlProps {
  ariaLabel: string
  placeholder: string
  value: string
  /** A textarea of this many rows; a one-line input when omitted. */
  rows?: number
  edit: EditHandlers
  onChange: (value: string) => void
}

function TextControl({ ariaLabel, placeholder, value, rows, edit, onChange }: TextControlProps) {
  const shared = { 'aria-label': ariaLabel, placeholder, value, ...edit }
  return rows ? (
    <textarea
      className="field-input resize-y"
      rows={rows}
      {...shared}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input
      type="text"
      className="field-input"
      {...shared}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

interface HeaderProps {
  lang: string
  started: boolean
  confirming: boolean
  onConfirm: (confirming: boolean) => void
  onRemove: () => void
}

function RemoveLanguage({ lang, confirming, onConfirm, onRemove }: Omit<HeaderProps, 'started'>) {
  if (!confirming) {
    return (
      <button type="button" className={LINK_CLASS} style={MUTED} onClick={() => onConfirm(true)}>
        Remove language
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-2xs" style={{ color: 'var(--color-text-2)' }}>
      <span>Remove {languageLabel(lang)} and its fields?</span>
      <button
        type="button"
        className={LINK_CLASS}
        style={{ color: 'var(--color-danger)' }}
        onClick={onRemove}
      >
        Remove
      </button>
      <button type="button" className={LINK_CLASS} onClick={() => onConfirm(false)}>
        Keep
      </button>
    </span>
  )
}

function LanguageHeader({ lang, started, ...remove }: HeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs" style={{ color: 'var(--color-text)' }}>
        {languageLabel(lang)}{' '}
        <span style={{ ...MUTED, fontFamily: 'var(--cf-font-mono)' }}>{lang}</span>
      </span>
      {started ? (
        <RemoveLanguage lang={lang} {...remove} />
      ) : (
        <span className="text-2xs" style={MUTED}>
          Not started — typing starts it
        </span>
      )}
    </div>
  )
}

interface ChapterTitlesProps {
  lang: string
  chapters: readonly Chapter[]
  titles: readonly string[]
  edit: EditHandlers
  onChange: (titles: string[]) => void
}

function ChapterTitles({ lang, chapters, titles, edit, onChange }: ChapterTitlesProps) {
  if (chapters.length === 0) {
    return (
      <p className="text-2xs" style={MUTED}>
        The source has no chapters yet. Chapter titles line up with them by position.
      </p>
    )
  }
  const extra = extraChapterTitles(chapters, titles)
  return (
    <>
      <ol className="flex flex-col gap-1" aria-label={`Chapter titles (${lang})`}>
        {alignedChapterTitles(chapters, titles).map((row, i) => (
          <li key={`${i}:${row.start_s}`} className="flex items-center gap-1.5">
            <span
              className="text-[11px] tabular-nums shrink-0"
              style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-2)' }}
            >
              {formatTimestamp(row.start_s)}
            </span>
            <TextControl
              ariaLabel={`Chapter title at ${formatTimestamp(row.start_s)} (${lang})`}
              placeholder={row.sourceTitle || 'Chapter title'}
              value={row.title}
              edit={edit}
              onChange={(title) => onChange(setChapterTitle(titles, i, title))}
            />
          </li>
        ))}
      </ol>
      {extra > 0 && (
        <p className="text-2xs mt-1" style={MUTED}>
          {extra} title(s) past the last chapter are ignored by the package.
        </p>
      )}
    </>
  )
}

/** What the row groups share: the language, its fields, the source, and one write. */
interface RowGroupProps {
  lang: string
  fields: LocalizedFields
  source: PublishAuthored
  /** Findings per control, in `FIELD_ORDER`. */
  findings: Violation[][]
  edit: EditHandlers
  set: <K extends LocalizedFieldId>(field: K, value: LocalizedFields[K]) => void
}

function TextRows({ lang, fields, source, findings, edit, set }: RowGroupProps) {
  const [title, description, short] = findings
  return (
    <>
      <Row
        label="Title"
        meter={<FieldMeter used={fields.title.length} limit={TITLE_MAX_CHARS} />}
        findings={title}
      >
        <TextControl
          ariaLabel={`Title (${lang})`}
          placeholder={source.title || 'The translated title'}
          value={fields.title}
          edit={edit}
          onChange={(value) => set('title', value)}
        />
      </Row>
      <Row
        label="Description"
        meter={
          <FieldMeter
            used={byteLength(fields.description)}
            limit={DESCRIPTION_MAX_BYTES}
            unit="bytes"
          />
        }
        findings={description}
      >
        <TextControl
          ariaLabel={`Description (${lang})`}
          placeholder={source.description || 'The translated description'}
          value={fields.description}
          rows={DESCRIPTION_ROWS}
          edit={edit}
          onChange={(value) => set('description', value)}
        />
      </Row>
      <Row label="Short description" findings={short}>
        <TextControl
          ariaLabel={`Short description (${lang})`}
          placeholder="One line for the platforms that want one"
          value={fields.short_description}
          edit={edit}
          onChange={(value) => set('short_description', value)}
        />
      </Row>
    </>
  )
}

function ListRows({ lang, fields, source, findings, edit, set }: RowGroupProps) {
  const [tags, hashtags, chapterTitles, caption] = findings.slice(3)
  const tagLine = tagsLine(fields.tags)
  return (
    <>
      <Row
        label="Tags"
        meter={<FieldMeter used={tagLine.length} limit={TAGS_MAX_CHARS} />}
        findings={tags}
      >
        <TextControl
          ariaLabel={`Tags (${lang})`}
          placeholder={tagsLine(source.tags) || 'comma, separated, tags'}
          value={tagLine}
          edit={edit}
          onChange={(value) => set('tags', parseTagsLine(value))}
        />
      </Row>
      <Row label="Hashtags" findings={hashtags}>
        <TextControl
          ariaLabel={`Hashtags (${lang})`}
          placeholder={hashtagsLine(source.hashtags) || '#hashtags'}
          value={hashtagsLine(fields.hashtags)}
          edit={edit}
          onChange={(value) => set('hashtags', parseHashtags(value))}
        />
      </Row>
      <Row label="Chapter titles" findings={chapterTitles}>
        <ChapterTitles
          lang={lang}
          chapters={source.chapters}
          titles={fields.chapter_titles}
          edit={edit}
          onChange={(next) => set('chapter_titles', next)}
        />
      </Row>
      <Row label="Shorts caption" findings={caption}>
        <TextControl
          ariaLabel={`Shorts caption (${lang})`}
          placeholder={source.shorts.caption || 'The caption posted with the Short'}
          value={fields.shorts_caption}
          rows={CAPTION_ROWS}
          edit={edit}
          onChange={(value) => set('shorts_caption', value)}
        />
      </Row>
    </>
  )
}

export function LocalizedLanguageForm(props: LocalizedLanguageFormProps) {
  const { publish, lang, localized, findings, onWrite } = props
  const { placed, unplaced } = partitionViolations(
    findings,
    FIELD_ORDER.map((field) => [`localized.${lang}.${field}`])
  )
  const group: RowGroupProps = {
    lang,
    fields: localized[lang] ?? EMPTY_LOCALIZED,
    source: publish.fields,
    findings: placed,
    edit: { onFocus: () => publish.beginEdit('localized'), onBlur: publish.endEdit },
    set: (field, value) => onWrite(setLocalizedField(localized, lang, field, value)),
  }

  return (
    <section
      className="mt-2 pt-2 border-t border-[var(--color-border)]"
      aria-label={`${languageLabel(lang)} fields`}
    >
      <LanguageHeader
        lang={lang}
        started={isStarted(localized, lang)}
        confirming={props.confirmingRemove}
        onConfirm={props.onConfirmRemove}
        onRemove={props.onRemove}
      />
      <FieldViolations violations={unplaced} />
      <TextRows {...group} />
      <ListRows {...group} />
    </section>
  )
}
