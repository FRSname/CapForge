/**
 * Settings → Transcription: hardware readout, language, Whisper model (plus
 * the free-memory-after-each-job switch) and speaker diarization.
 *
 * Moved verbatim out of the old slide-over `SettingsPanel`, including the
 * port/local-token bootstrap that has to run before `api.getLanguages()`. The
 * only behavioural difference is *when* it runs: the pane mounts when the
 * Transcription category is first selected, not at app start. Every value is
 * persisted through `window.subforge.setState`, so nothing is lost when the
 * pane unmounts.
 */

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { WHISPER_MODELS, formatModelSize } from '../../lib/whisperModels'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'

interface SystemInfo {
  gpu_name?: string
  cpu_name?: string
  vram_gb?: number
}

export function TranscriptionSettings() {
  const [languages, setLanguages] = useState<string[]>([])
  const [language, setLanguage] = useState('')
  const [whisperModel, setWhisperModel] = useState('')
  const [diarize, setDiarize] = useState(false)
  const [freeModelAfterJob, setFreeModelAfterJob] = useState(false)
  const [hfToken, setHfToken] = useState('')
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    async function init() {
      try {
        const port = await window.subforge.getBackendPort()
        api.setPort(port)
        api.setLocalToken(await window.subforge.getLocalToken())
        const [langs, info, savedLang, savedModel, savedDiarize, savedToken, savedFreeModel] =
          await Promise.all([
            api.getLanguages(),
            api.getSystemInfo() as Promise<SystemInfo>,
            window.subforge.getState('language', ''),
            window.subforge.getState('whisper_model', ''),
            window.subforge.getState('diarize', false),
            window.subforge.getState('hf_token', ''),
            window.subforge.getState('free_model_after_job', false),
          ])
        setLanguages(Array.isArray(langs) ? langs : [])
        setSysInfo(info)
        setLanguage(savedLang as string)
        setWhisperModel(savedModel as string)
        setDiarize(savedDiarize as boolean)
        setHfToken(savedToken as string)
        setFreeModelAfterJob(savedFreeModel as boolean)
      } catch {
        /* backend may not be up yet */
      }
    }
    void init()
  }, [])

  async function handleLanguageChange(lang: string) {
    setLanguage(lang)
    await window.subforge.setState('language', lang)
  }

  async function handleWhisperModelChange(id: string) {
    setWhisperModel(id)
    await window.subforge.setState('whisper_model', id)
  }

  async function handleDiarizeChange(v: boolean) {
    setDiarize(v)
    await window.subforge.setState('diarize', v)
  }

  async function handleFreeModelAfterJobChange(v: boolean) {
    setFreeModelAfterJob(v)
    await window.subforge.setState('free_model_after_job', v)
  }

  async function handleTokenChange(token: string) {
    setHfToken(token)
    await window.subforge.setState('hf_token', token)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Hardware info */}
      {sysInfo && (
        <div className="rounded-lg p-3 text-xs flex flex-col gap-1 bg-[var(--color-surface)] border border-[var(--color-border)]">
          <span className="label-xs mb-1">Hardware</span>
          {sysInfo.gpu_name ? (
            <>
              <span style={{ color: 'var(--color-accent-2)' }}>{sysInfo.gpu_name}</span>
              {sysInfo.vram_gb && (
                <span style={{ color: 'var(--color-text-3)' }}>{sysInfo.vram_gb} GB VRAM</span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--color-text-2)' }}>CPU mode</span>
          )}
        </div>
      )}

      {/* Language */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Language</label>
        <Select value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
          <option value="">Auto-detect</option>
          {(Array.isArray(languages) ? languages : []).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      {/* Transcription model */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Transcription Model</label>
        <Select value={whisperModel} onChange={(e) => handleWhisperModelChange(e.target.value)}>
          <option value="">Auto (match my hardware)</option>
          {WHISPER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.blurb} ({formatModelSize(m.sizeMb)})
            </option>
          ))}
        </Select>
        <p className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
          Smaller models are faster and use less memory. A model you haven&apos;t used yet downloads
          the first time you transcribe with it.
        </p>
        <Toggle
          checked={freeModelAfterJob}
          onChange={handleFreeModelAfterJobChange}
          label="Free model memory after each job"
        />
        <p className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
          Unloads the Whisper model when a transcription finishes. Slower next start, less memory
          held while you edit — for machines with little RAM.
        </p>
      </div>

      {/* Diarization */}
      <div className="flex flex-col gap-2">
        <label className="label-xs">Speaker Diarization</label>
        <Toggle checked={diarize} onChange={handleDiarizeChange} label="Identify speakers" />
        {diarize && (
          <div className="flex flex-col gap-1.5 mt-1">
            <label className="label-xs">HuggingFace Token</label>
            <input
              type="password"
              value={hfToken}
              onChange={(e) => handleTokenChange(e.target.value)}
              placeholder="hf_…"
              className="field-input text-xs font-mono"
            />
            <p className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
              Required for pyannote diarization. Get a token at huggingface.co.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
