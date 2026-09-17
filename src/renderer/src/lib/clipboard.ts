/**
 * One clipboard write for the whole renderer. Every copy button in the app
 * (the Publish footer's package, the per-field copy buttons) reports through
 * this, so "no clipboard" and "the write failed" are said the same way
 * everywhere and never swallowed.
 *
 * The clipboard is a parameter so the outcome is assertable in a node test.
 */

/** No clipboard (an old webview, a denied permission) — say so, never swallow. */
export const NO_CLIPBOARD_MESSAGE = 'This window has no clipboard access.'

export type CopyOutcome = { ok: true } | { ok: false; message: string }

/** The subset of `navigator.clipboard` a copy needs. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>
}

function defaultClipboard(): ClipboardLike | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.clipboard
}

/**
 * Put `text` on the clipboard. `what` names the text in the failure message
 * ("Could not copy the title") when the error itself has nothing to say.
 */
export async function writeClipboard(
  text: string,
  what: string,
  clipboard: ClipboardLike | undefined = defaultClipboard()
): Promise<CopyOutcome> {
  if (!clipboard) return { ok: false, message: NO_CLIPBOARD_MESSAGE }
  try {
    await clipboard.writeText(text)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : `Could not copy ${what}`
    return { ok: false, message }
  }
}
