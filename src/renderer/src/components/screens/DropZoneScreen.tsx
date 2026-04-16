import { useRef, useState } from 'react'

const ACCEPTED_EXTS = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'mp4', 'mkv', 'webm', 'mov']

interface DropZoneScreenProps {
  filePath: string | null
  onFileSelected: (path: string) => void
  onStart: () => void
}

export function DropZoneScreen({ filePath, onFileSelected, onStart }: DropZoneScreenProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.path) onFileSelected(file.path)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file?.path) onFileSelected(file.path)
  }

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">

      {/* ── Drop zone ───────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop audio or video file"
        className="relative flex flex-col items-center justify-center gap-4 w-full max-w-[440px] py-20 px-10 rounded-2xl cursor-pointer select-none transition-all duration-200"
        style={{
          background:   dragging
            ? 'linear-gradient(135deg, rgba(91,126,247,0.08) 0%, rgba(91,126,247,0.04) 100%)'
            : 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 100%)',
          border:       `2px dashed ${dragging ? 'var(--color-accent)' : 'var(--color-border-2)'}`,
          boxShadow:    dragging ? '0 0 32px 0 var(--color-accent-glow)' : 'none',
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {/* Upload icon */}
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center"
          style={{
            background: dragging ? 'var(--color-accent-subtle)' : 'var(--color-surface-2)',
            border: '1px solid var(--color-border-2)',
          }}
        >
          <svg
            width="24" height="24" viewBox="0 0 16 16" fill="currentColor"
            style={{ color: dragging ? 'var(--color-accent)' : 'var(--color-text-3)' }}
          >
            <path d="M3.75 1.5a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5Zm5.75 0v2.75c0 .138.112.25.25.25h2.75l-3-3ZM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Z"/>
          </svg>
        </div>

        <div className="text-center">
          <p className="font-semibold text-sm mb-1" style={{ color: 'var(--color-text)' }}>
            Drop your file here
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-2)' }}>or click to browse</p>
        </div>

        <p className="text-[11px] tracking-widest uppercase" style={{ color: 'var(--color-text-3)' }}>
          {ACCEPTED_EXTS.join(' · ')}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTS.map(e => `.${e}`).join(',')}
        className="hidden"
        onChange={handleInputChange}
      />

      {/* ── File info + start ────────────────────────────────── */}
      {fileName && (
        <div className="flex flex-col items-center gap-3 w-full max-w-[440px]">
          {/* File chip */}
          <div
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-2)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-accent)', flexShrink: 0 }}>
              <path d="M3.75 1.5a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5Zm5.75 0v2.75c0 .138.112.25.25.25h2.75l-3-3ZM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Z"/>
            </svg>
            <span className="flex-1 truncate text-sm" style={{ color: 'var(--color-text)' }}>{fileName}</span>
            <button
              className="icon-btn w-6 h-6 text-xs"
              onClick={e => { e.stopPropagation(); onFileSelected('') }}
              title="Remove"
              aria-label="Remove file"
            >
              ✕
            </button>
          </div>

          {/* Start button */}
          <button
            className="btn-primary w-full justify-center text-sm py-3"
            onClick={onStart}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
            </svg>
            Start Transcription
          </button>
        </div>
      )}
    </div>
  )
}
