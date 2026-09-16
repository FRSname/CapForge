/**
 * `compareVersions` is a TypeScript twin of `electron/update-check.js`'s, so
 * the renderer can tell "newer" from "older" without a round trip. The last
 * test pins the two against each other.
 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { compareVersions } from './version'

const require_ = createRequire(import.meta.url)
const UPDATE_CHECK = resolve(__dirname, '../../../../electron/update-check.js')

describe('compareVersions', () => {
  test('equal versions compare equal', () => {
    expect(compareVersions('2.6.0', '2.6.0')).toBe(0)
  })

  test('orders by numeric part, not lexically', () => {
    expect(compareVersions('2.10.0', '2.6.0')).toBe(1)
    expect(compareVersions('2.6.0', '2.10.0')).toBe(-1)
  })

  test('a missing part counts as 0', () => {
    expect(compareVersions('2.6', '2.6.0')).toBe(0)
    expect(compareVersions('2.6.1', '2.6')).toBe(1)
    expect(compareVersions('3', '2.9.9')).toBe(1)
  })

  test('a leading v and a -suffix are ignored', () => {
    expect(compareVersions('v2.6.0', '2.6.0')).toBe(0)
    expect(compareVersions('2.7.0-beta.1', '2.7.0')).toBe(0)
    expect(compareVersions('v2.7.0-rc1', 'v2.6.0')).toBe(1)
  })

  test('garbage parts read as 0 rather than throwing', () => {
    expect(compareVersions('', '0.0.0')).toBe(0)
    expect(compareVersions('2.x.0', '2.0.0')).toBe(0)
  })

  test('agrees with the Electron twin on every pair', () => {
    // The main process exports nothing pure, so read its implementation out of
    // the module source rather than importing electron here.
    const { readFileSync } = require_('node:fs') as typeof import('node:fs')
    const source = readFileSync(UPDATE_CHECK, 'utf8')
    const body = source.slice(source.indexOf('function compareVersions'))
    const end = body.indexOf('\n}\n')
    const twin = new Function(`${body.slice(0, end + 2)}; return compareVersions`)() as (
      a: string,
      b: string
    ) => number

    const pairs: Array<[string, string]> = [
      ['2.6.0', '2.6.0'],
      ['2.10.0', '2.6.0'],
      ['2.6.0', '2.10.0'],
      ['2.6', '2.6.0'],
      ['3', '2.9.9'],
      ['2.7.0-beta.1', '2.7.0'],
      ['2.6.1', '2.6.0'],
    ]
    for (const [a, b] of pairs) {
      expect(Math.sign(twin(a, b))).toBe(compareVersions(a, b))
    }
  })
})
