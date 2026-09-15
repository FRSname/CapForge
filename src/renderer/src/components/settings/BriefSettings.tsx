/**
 * Settings → Channel: the global brief (`library_root()/brief.json`).
 *
 * This is the conference-specific prose that used to live inside the publish
 * skill, moved into user data (vision §3.2) — which is what lets one skill
 * serve a personal channel and a conference channel. Keep it *structured*:
 * prose here is read on every agent call.
 *
 * The field editors live in `BriefFields.tsx`, shared with a collection's
 * overrides. Text fields save on blur, toggles and ranges on change; every
 * failure is toasted rather than swallowed. There is no `If-Match` — it is one
 * small file with one editor.
 */

import { Fragment, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { BRIEF_OVERRIDE_FIELDS } from '../../lib/collectionTypes'
import { paletteSlots } from '../../lib/collections'
import type { Brief } from '../../lib/publishTypes'
import { parseBrief } from '../../lib/publishTypes'
import { useToast } from '../../hooks/useToast'
import { BRIEF_FIELD_SPECS, BriefFieldControl, BriefFieldRow } from './BriefFields'
import { SlotRowsEditor } from './SlotFields'

/** What the pane shows before the backend answers (and if it never does): the documented defaults. */
const EMPTY_BRIEF: Brief = parseBrief({})

const SLOTS_HELP =
  'Custom {{name}} values any description can use. A collection’s slots add to these, and win on a clash.'

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
  function save(patch: Partial<Brief>) {
    api
      .patchBrief(patch)
      .then(setBrief)
      .catch((err) => toast(err.message || 'Could not save the channel brief', 'error'))
  }

  function draft<K extends keyof Brief>(field: K, value: Brief[K]) {
    setBrief((prev) => ({ ...prev, [field]: value }))
  }

  function commit<K extends keyof Brief>(field: K, value: Brief[K]) {
    draft(field, value)
    save({ [field]: value } as Partial<Brief>)
  }

  const palette = paletteSlots(brief.slots)

  return (
    <div className="flex flex-col gap-5">
      {BRIEF_OVERRIDE_FIELDS.map((field) => (
        <Fragment key={field}>
          <BriefFieldRow
            label={BRIEF_FIELD_SPECS[field].label}
            htmlFor={`brief-${field}`}
            help={BRIEF_FIELD_SPECS[field].help}
          >
            <BriefFieldControl
              field={field}
              id={`brief-${field}`}
              value={brief[field]}
              slotNames={palette}
              onDraft={(value) => draft(field, value)}
              onCommit={(value) => commit(field, value)}
            />
          </BriefFieldRow>
          {field === 'description_template' && (
            <BriefFieldRow label="Template slots" htmlFor="brief-slot-0" help={SLOTS_HELP}>
              <SlotRowsEditor
                key={JSON.stringify(brief.slots)}
                idPrefix="brief"
                slots={brief.slots}
                onCommit={(slots) => commit('slots', slots)}
              />
            </BriefFieldRow>
          )}
        </Fragment>
      ))}
    </div>
  )
}
