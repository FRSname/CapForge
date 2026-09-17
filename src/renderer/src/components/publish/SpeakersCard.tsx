/**
 * One row per diarized speaker (`SPEAKER_00`, `SPEAKER_01`, …) → a name, a
 * handle and a URL.
 *
 * The ids come from the *transcript*, not from the record: diarization is what
 * knows how many voices there are, and naming them is what turns the
 * description's speaker block from `[SPEAKER NAME]` into a person.
 */

import { StudioCard } from '../studio/StudioCard'
import type { SpeakerInfo } from '../../lib/publishTypes'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'

const EMPTY_SPEAKER: SpeakerInfo = { name: '', handle: '', url: '' }

interface SpeakersCardProps {
  publish: PublishController
}

export function SpeakersCard({ publish }: SpeakersCardProps) {
  const { fields, speakerIds } = publish
  // Rows the transcript knows about, plus any the agent named for a speaker
  // this session's transcript no longer has.
  const ids = [
    ...speakerIds,
    ...Object.keys(fields.speakers).filter((id) => !speakerIds.includes(id)),
  ]

  function patchSpeaker(id: string, patch: Partial<SpeakerInfo>) {
    const current = fields.speakers[id] ?? EMPTY_SPEAKER
    publish.setField('speakers', { ...fields.speakers, [id]: { ...current, ...patch } })
  }

  return (
    <StudioCard title="Speakers" defaultOpen={false}>
      <FieldHeader publish={publish} field="speakers" hideLabel />
      {ids.length === 0 ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          This transcript has no diarized speakers. Turn on speaker diarization before transcribing
          to name them here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {ids.map((id) => {
            const info = fields.speakers[id] ?? EMPTY_SPEAKER
            return (
              <div key={id} className="flex flex-col gap-1">
                <span
                  className="text-2xs"
                  style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
                >
                  {id}
                </span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    className="field-input"
                    aria-label={`${id} name`}
                    placeholder="Name"
                    value={info.name}
                    onFocus={() => publish.beginEdit('speakers')}
                    onBlur={publish.endEdit}
                    onChange={(e) => patchSpeaker(id, { name: e.target.value })}
                  />
                  <input
                    type="text"
                    className="field-input"
                    aria-label={`${id} handle`}
                    placeholder="@handle"
                    value={info.handle}
                    onFocus={() => publish.beginEdit('speakers')}
                    onBlur={publish.endEdit}
                    onChange={(e) => patchSpeaker(id, { handle: e.target.value })}
                  />
                </div>
                <input
                  type="text"
                  className="field-input"
                  aria-label={`${id} URL`}
                  placeholder="https://"
                  value={info.url}
                  onFocus={() => publish.beginEdit('speakers')}
                  onBlur={publish.endEdit}
                  onChange={(e) => patchSpeaker(id, { url: e.target.value })}
                />
              </div>
            )
          })}
        </div>
      )}
      <FieldViolations violations={publish.violationsFor('speakers')} />
    </StudioCard>
  )
}
