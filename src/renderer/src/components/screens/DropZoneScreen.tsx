import { useRef, useState } from 'react'

interface DropZoneScreenProps {
  filePath: string | null
  onFileSelected: (path: string) => void
  onStart: () => void
}

const ACCEPTED_EXTS = ['mp3', 'wav', 'm4a', 'flac', 'mp4', 'mkv', 'webm', 'mov', 'aac', 'ogg']

export function DropZoneScreen({ filePath, onFileSelected, onStart }: DropZoneScreenProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFileSelected(file.path)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onFileSelected(file.path)
  }

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        className={[
          'flex flex-col items-center justify-center gap-3 w-full max-w-md',
          'rounded-xl border-2 border-dashed transition-colors duration-150 cursor-pointer py-16 px-8',
          dragging
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]',
        ].join(' ')}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <svg className="text-white/20" width="40" height="40" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.75 1.5a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5Zm5.75 0v2.75c0 .138.112.25.25.25h2.75l-3-3ZM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Z" />
        </svg>
        <p className="text-[var(--color-text)] font-medium">Drop audio or video file here</p>
        <p className="text-[var(--color-text-muted)] text-xs">or click to browse</p>
        <p className="text-[var(--color-text-subtle)] text-xs tracking-wide">
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

      {/* File info + start button */}
      {fileName && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <div className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08]">
            <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.75 1.5a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5Zm5.75 0v2.75c0 .138.112.25.25.25h2.75l-3-3ZM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Z" />
            </svg>
            <span className="flex-1 truncate text-sm">{fileName}</span>
            <button
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] ml-1 text-xs"
              onClick={() => onFileSelected('')}
              title="Remove file"
            >
              ✕
            </button>
          </div>

          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors"
            onClick={onStart}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
            </svg>
            Start Transcription
          </button>
        </div>
      )}
    </div>
  )
}
