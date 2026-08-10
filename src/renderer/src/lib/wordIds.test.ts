import { describe, expect, test } from 'vitest'
import { adoptWordIds, ensureWordIds, newWordId, withWordIds } from './wordIds'
import { retimeWords, tokenize } from './wordTiming'
import type { Segment, Word } from '../types/app'

const word = (w: string, start: number, end: number): Word => ({ word: w, start, end })

const segment = (id: string, words: Word[]): Segment => ({
  id,
  start: words[0]?.start ?? 0,
  end: words[words.length - 1]?.end ?? 0,
  text: words.map((w) => w.word).join(' '),
  words,
})

const sample = (): Segment =>
  segment('s1', [word('the', 0, 0.5), word('quick', 0.5, 1), word('fox', 1, 1.5)])

describe('newWordId', () => {
  test('never repeats', () => {
    const ids = new Set(Array.from({ length: 500 }, newWordId))
    expect(ids.size).toBe(500)
  })
})

describe('withWordIds', () => {
  test('mints an id for every word that lacks one', () => {
    const out = withWordIds(sample().words)
    expect(out.every((w) => typeof w.wid === 'string' && w.wid.length > 0)).toBe(true)
    expect(new Set(out.map((w) => w.wid)).size).toBe(3)
  })

  test('returns the same array when every word already has an id', () => {
    const once = withWordIds(sample().words)
    expect(withWordIds(once)).toBe(once)
  })

  test('leaves existing ids untouched and only fills the gaps', () => {
    const words = withWordIds(sample().words)
    const withHole = [words[0], { ...words[1], wid: undefined }, words[2]]
    const out = withWordIds(withHole)
    expect(out[0].wid).toBe(words[0].wid)
    expect(out[2].wid).toBe(words[2].wid)
    expect(out[1].wid).toBeTruthy()
    expect(out[1].wid).not.toBe(words[1].wid)
  })
})

describe('ensureWordIds', () => {
  test('is idempotent and reference-stable on a second pass', () => {
    const once = ensureWordIds([sample()])
    expect(ensureWordIds(once)).toBe(once)
  })

  test('never collides across separate segment arrays', () => {
    const a = ensureWordIds([sample()])
    const b = ensureWordIds([sample()])
    const ids = [...a[0].words, ...b[0].words].map((w) => w.wid)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('leaves untouched segments as the same objects', () => {
    const [seg] = ensureWordIds([sample()])
    const next = ensureWordIds([seg, segment('s2', [word('new', 2, 2.5)])])
    expect(next[0]).toBe(seg)
    expect(next[1].words[0].wid).toBeTruthy()
  })
})

describe('adoptWordIds', () => {
  test('takes the ids the matching segment words already carry', () => {
    const [seg] = ensureWordIds([sample()])
    // A legacy project: same words, no ids, grouped by hand.
    const legacyGroups: Segment[] = [
      segment('s1:0', [word('fox', 1, 1.5), word('the', 0, 0.5)]),
      segment('s1:2', [word('quick', 0.5, 1)]),
    ]

    const adopted = adoptWordIds(legacyGroups, [seg])
    expect(adopted[0].words[0].wid).toBe(seg.words[2].wid)
    expect(adopted[0].words[1].wid).toBe(seg.words[0].wid)
    expect(adopted[1].words[0].wid).toBe(seg.words[1].wid)
  })

  test('mints for a group word the segments do not have', () => {
    const [seg] = ensureWordIds([sample()])
    const groups: Segment[] = [segment('g', [word('elsewhere', 9, 9.5)])]
    const adopted = adoptWordIds(groups, [seg])
    expect(adopted[0].words[0].wid).toBeTruthy()
    expect(seg.words.map((w) => w.wid)).not.toContain(adopted[0].words[0].wid)
  })

  test('hands a repeated word+timing out once each, never aliased', () => {
    const dup = ensureWordIds([segment('s1', [word('so', 0, 0.5), word('so', 0, 0.5)])])
    const groups: Segment[] = [segment('g', [word('so', 0, 0.5), word('so', 0, 0.5)])]
    const adopted = adoptWordIds(groups, dup)
    expect(new Set(adopted[0].words.map((w) => w.wid)).size).toBe(2)
  })

  test('passes groups through untouched when they already have ids', () => {
    const groups = ensureWordIds([sample()])
    expect(adoptWordIds(groups, groups)).toBe(groups)
  })
})

describe('retimeWords — word identity', () => {
  test('an untouched word keeps its id', () => {
    const before = withWordIds([word('Hello', 0, 0.5), word('world', 0.5, 1)])
    const after = retimeWords(before, tokenize('Hello there'), { start: 0, end: 1 })
    expect(after[0].wid).toBe(before[0].wid)
  })

  test('a one-for-one correction keeps the id (same word slot)', () => {
    const before = withWordIds([word('teh', 0.25, 0.75)])
    const after = retimeWords(before, tokenize('the'), { start: 0, end: 1 })
    expect(after).toHaveLength(1)
    expect(after[0].wid).toBe(before[0].wid)
  })

  test('a word split into two leaves the new piece without an id to mint later', () => {
    const before = withWordIds([word('cannot', 0, 1)])
    const after = retimeWords(before, tokenize('can not'), { start: 0, end: 1 })
    expect(after).toHaveLength(2)
    expect(withWordIds(after).every((w) => w.wid)).toBe(true)
  })
})
