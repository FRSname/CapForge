/**
 * `copy(text, what)` — put text on the clipboard and toast the outcome, the
 * way every copy control in the app reports ("Copied the title", or why not).
 */

import { useCallback } from 'react'
import { writeClipboard } from '../lib/clipboard'
import { useToast } from './useToast'

export type CopyText = (text: string, what: string) => Promise<boolean>

export function useCopyText(): CopyText {
  const { toast } = useToast()
  return useCallback(
    async (text: string, what: string) => {
      const outcome = await writeClipboard(text, what)
      if (outcome.ok) toast(`Copied ${what}`, 'success')
      else toast(outcome.message, 'error')
      return outcome.ok
    },
    [toast]
  )
}
