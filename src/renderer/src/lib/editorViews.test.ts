import { describe, expect, test } from 'vitest'
import { EDITOR_VIEWS, nextEditorView } from './editorViews'

describe('editor views', () => {
  test('Text, Groups, Transcript in that order', () => {
    expect(EDITOR_VIEWS).toEqual(['text', 'groups', 'transcript'])
  })

  test('the arrows step through the tabs and wrap at both ends', () => {
    expect(nextEditorView('text', 1)).toBe('groups')
    expect(nextEditorView('groups', 1)).toBe('transcript')
    expect(nextEditorView('transcript', 1)).toBe('text')
    expect(nextEditorView('text', -1)).toBe('transcript')
    expect(nextEditorView('transcript', -1)).toBe('groups')
  })
})
