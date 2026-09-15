/**
 * The slice of the Publish record the editor needs — the chapters and the
 * insert — carried by context from App to the Transcript tab.
 *
 * The controller (`usePublishRecord`) is created in `App.tsx` and otherwise
 * reaches only the aside; threading it through `ResultsScreen` as props would
 * grow two files at their size ceilings for one tab.
 *
 * **Safe default:** with no provider there are no chapters, no record and the
 * insert does nothing, so the Text and Groups views and every test that
 * renders an editor without App behave exactly as before.
 *
 * `insertChapterAt` is handed on with a **stable identity**: the controller
 * builds a new arrow each render, and the Transcript tab's rows are memoised on
 * their props, so a changing callback would re-render every row.
 */

import { createContext, createElement, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Chapter } from '../lib/publishTypes'
import type { PublishController } from './usePublishRecord'

export interface PublishRecordContextValue {
  /** The chapters as the Chapters card shows them (drafts included). */
  chapters: readonly Chapter[]
  /** Insert a chapter at `seconds`, snapped back to a word start, and save it. */
  insertChapterAt: (seconds: number) => void
  /** False when the session has no library record: nothing to insert into. */
  hasRecord: boolean
}

const NO_CHAPTERS: readonly Chapter[] = []

const NO_RECORD: PublishRecordContextValue = {
  chapters: NO_CHAPTERS,
  insertChapterAt: () => {},
  hasRecord: false,
}

export const PublishRecordContext = createContext<PublishRecordContextValue>(NO_RECORD)

export function usePublishRecordContext(): PublishRecordContextValue {
  return useContext(PublishRecordContext)
}

interface PublishRecordProviderProps {
  publish: PublishController
  children?: ReactNode
}

export function PublishRecordProvider({ publish, children }: PublishRecordProviderProps) {
  const insertRef = useRef(publish.insertChapterAt)
  useEffect(() => {
    insertRef.current = publish.insertChapterAt
  })

  const hasRecord = publish.record !== null
  const chapters = hasRecord ? publish.fields.chapters : NO_CHAPTERS
  const value = useMemo<PublishRecordContextValue>(
    () => ({
      chapters,
      insertChapterAt: (seconds: number) => insertRef.current(seconds),
      hasRecord,
    }),
    [chapters, hasRecord]
  )

  // `insertRef` is read only inside `insertChapterAt`, i.e. when an insert
  // button is clicked — never during render; the rule cannot see through that.
  // eslint-disable-next-line react-hooks/refs
  return createElement(PublishRecordContext.Provider, { value }, children)
}
