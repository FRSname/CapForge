import { describe, expect, test } from 'vitest'
import { chapterLines } from './publishChapters'

describe('chapterLines', () => {
  test('one MM:SS Title per line, the package format', () => {
    expect(
      chapterLines([
        { start_s: 0, title: 'Intro' },
        { start_s: 95, title: ' Setup ' },
        { start_s: 3725, title: 'Wrap-up' },
      ])
    ).toBe('00:00 Intro\n01:35 Setup\n1:02:05 Wrap-up')
  })

  test('an untitled chapter is left out, as the package leaves it out', () => {
    expect(
      chapterLines([
        { start_s: 0, title: 'Intro' },
        { start_s: 30, title: '  ' },
      ])
    ).toBe('00:00 Intro')
  })

  test('no chapters is an empty string, which disables the copy', () => {
    expect(chapterLines([])).toBe('')
  })
})
