/**
 * The one decision the debounced autosave and its explicit flush share: is
 * there a snapshot worth writing, and what is its serialized form.
 */

import { describe, expect, test } from 'vitest'
import { serializeIfChanged } from './autosave'

describe('serializeIfChanged', () => {
  test('no session means nothing to write', () => {
    expect(serializeIfChanged(null, null)).toBeNull()
    expect(serializeIfChanged(undefined, '{"a":1}')).toBeNull()
  })

  test('a first snapshot is written', () => {
    expect(serializeIfChanged({ a: 1 }, null)).toBe('{"a":1}')
  })

  test('an unchanged snapshot is skipped', () => {
    expect(serializeIfChanged({ a: 1 }, '{"a":1}')).toBeNull()
  })

  test('a changed snapshot is written', () => {
    expect(serializeIfChanged({ a: 2 }, '{"a":1}')).toBe('{"a":2}')
  })
})
