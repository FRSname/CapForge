/**
 * Settings → Skills card.
 *
 * A skill is a plain-text workflow (SKILL.md) that CapForge bundles and Claude
 * runs against the app. CapForge keeps a **per-user copy** of every bundled
 * skill; this card is the editor over that copy, plus the four things a user
 * ever wants to do with it: save, reset to the bundled text, install/update the
 * copy into Claude Code, and reveal the folder (the route Claude Desktop users
 * take, since Desktop adds skills through its own settings UI).
 *
 * The container owns *all* state — list, loaded detail, draft, dirty, busy —
 * and `SkillEditor` is a pure view over it. Everything goes through
 * `window.subforge.skills`, which is absent on an older preload (a renderer-only
 * reload after an update), so the API is looked up per call and a missing one
 * degrades to a "restart" line rather than crashing the panel.
 */

import { useEffect, useState } from 'react'
import type { SkillDetail, SkillSummary } from '../../../../preload/index'
import { useToast } from '../../hooks/useToast'
import { SkillEditor, SkillStatusChip } from './SkillEditor'

interface SkillsPanelProps {
  /** The Skills UI is visible — (re)load the list when it becomes so. */
  open: boolean
}

export function SkillsPanel({ open }: SkillsPanelProps) {
  const { toast } = useToast()
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [listed, setListed] = useState(false)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [showBundled, setShowBundled] = useState(false)

  // Looked up on every render: an older preload has no `skills` at all. The
  // optional chain is for the render path only — outside Electron there is no
  // bridge at all, and this card should still paint its "restart" line.
  const available = !!window.subforge?.skills
  const dirty = detail !== null && draft !== detail.text

  useEffect(() => {
    if (!open) return
    const api = window.subforge.skills
    if (!api) return
    let cancelled = false
    api
      .list()
      .then((list) => {
        if (cancelled) return
        setSkills(list)
        setListed(true)
      })
      .catch(() => {
        if (cancelled) return
        setListed(true)
        toast("Couldn't load skills.", 'error')
      })
    return () => {
      cancelled = true
    }
  }, [open, toast])

  /** The bridge, or a toast explaining why nothing happened. */
  function requireApi() {
    const api = window.subforge.skills
    if (!api) toast('Restart CapForge to enable skills.', 'error')
    return api
  }

  /** Run one bridge call with the busy lock on; a rejection becomes a toast. */
  async function withBusy<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(true)
    try {
      return await fn()
    } catch (err) {
      toast(`${what} failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  /** Adopt a refreshed detail as the new baseline, and re-sync the list chips. */
  async function adopt(next: SkillDetail) {
    setDetail(next)
    setDraft(next.text)
    const api = window.subforge.skills
    if (!api) return
    try {
      setSkills(await api.list())
    } catch {
      toast("Couldn't refresh the skill list.", 'error')
    }
  }

  async function handleSelect(name: string) {
    if (detail?.name === name) return
    // Switching away from an edited draft would drop it silently.
    if (dirty && !window.confirm('Discard unsaved changes to this skill?')) return
    const api = requireApi()
    if (!api) return
    const next = await withBusy('Opening the skill', () => api.read(name))
    if (!next) return
    setShowBundled(false)
    setDetail(next)
    setDraft(next.text)
  }

  async function handleSave() {
    const api = requireApi()
    if (!api || !detail) return
    const next = await withBusy('Saving', () => api.write(detail.name, draft))
    if (!next) return
    await adopt(next)
    toast('Skill saved.', 'success')
  }

  /** Reset / "Take new" — both replace the user copy with the bundled text. */
  async function takeBundled() {
    const api = requireApi()
    if (!api || !detail) return
    if (!window.confirm('Replace your copy with the bundled version? Your edits are lost.')) return
    const next = await withBusy('Resetting', () => api.reset(detail.name))
    if (!next) return
    setShowBundled(false)
    await adopt(next)
    toast('Skill reset to the bundled version.', 'success')
  }

  /** "Keep mine" — clear the changed flag without touching the user's text. */
  async function handleKeepMine() {
    const api = requireApi()
    if (!api || !detail) return
    const next = await withBusy('Updating the skill', () => api.acknowledgeBundle(detail.name))
    if (!next) return
    await adopt(next)
  }

  async function handleInstall() {
    const api = requireApi()
    if (!api || !detail) return
    const res = await withBusy('Installing', () => api.install(detail.name))
    if (!res) return
    if (res.ok) {
      if (res.status === 'installed') {
        toast('Installed — restart Claude Code to load it.', 'success')
      } else if (res.status === 'updated') {
        toast('Updated — restart Claude Code to load it.', 'success')
      } else {
        toast('Already up to date.', 'info')
      }
    } else if (res.reason === 'unknown-skill') {
      toast('That skill is no longer available. Reopen Settings to refresh.', 'error')
      return
    } else {
      toast(`Couldn't install the skill.${res.detail ? ` ${res.detail}` : ''}`, 'error')
    }
    // Install status lives on the detail as well as the row, so re-read.
    const next = await withBusy('Refreshing the skill', () => api.read(detail.name))
    if (next) await adopt(next)
  }

  async function handleReveal() {
    const api = requireApi()
    if (!api || !detail) return
    await withBusy('Revealing the folder', () => api.reveal(detail.name))
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="label-xs">Skills</label>
      <p className="text-xs-plus" style={{ color: 'var(--color-text-3)' }}>
        Workflows Claude runs against CapForge. Edit them here; Install copies your version into
        Claude Code. Claude Desktop users: Reveal the folder and add it through Desktop&apos;s
        skills settings.
      </p>

      {!available && (
        <p className="text-xs-plus" style={{ color: 'var(--color-accent-2)' }}>
          Restart CapForge to enable skills.
        </p>
      )}

      {available && listed && skills.length === 0 && (
        <p className="text-xs-plus" style={{ color: 'var(--color-text-3)' }}>
          No skills are bundled in this build.
        </p>
      )}

      {/* With a skill open the dialog is wide enough for list-beside-editor;
          with none open the list gets the full width. */}
      <div className={detail ? 'grid grid-cols-[240px_1fr] gap-4 items-start' : undefined}>
        {skills.length > 0 && (
          <div className="flex flex-col gap-1">
            {skills.map((s) => {
              const selected = detail?.name === s.name
              return (
                <button
                  key={s.name}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => handleSelect(s.name)}
                  className="flex w-full flex-col gap-0.5 rounded border px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{
                    borderColor: selected ? 'var(--color-border-3)' : 'var(--color-border)',
                    background: selected ? 'var(--color-surface-2)' : 'transparent',
                  }}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span
                      className="min-w-0 truncate text-xs-plus"
                      style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text)' }}
                    >
                      {s.name}
                    </span>
                    <SkillStatusChip status={s.installStatus} bundleChanged={s.bundleChanged} />
                  </span>
                  <span
                    className="line-clamp-2 text-xs-plus"
                    style={{ color: 'var(--color-text-3)' }}
                  >
                    {s.description}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <SkillEditor
          skill={detail}
          draft={draft}
          dirty={dirty}
          busy={busy}
          showBundled={showBundled}
          onChange={setDraft}
          onSave={handleSave}
          onReset={takeBundled}
          onInstall={handleInstall}
          onReveal={handleReveal}
          onKeepMine={handleKeepMine}
          onTakeNew={takeBundled}
          onOpenBoth={() => setShowBundled((v) => !v)}
        />
      </div>
    </div>
  )
}
