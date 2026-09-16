/**
 * Pure-logic tests for external-links. Run with the built-in node runner:
 *   node --test electron/external-links.test.js
 * No electron required: the allowlist is the thing under test, and it is what
 * stands between a renderer string and `shell.openExternal`.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { isAllowedExternalUrl, ALLOWED_EXTERNAL_HOSTS } = require('./external-links')

test('the two links the app actually opens are allowed', () => {
  assert.equal(isAllowedExternalUrl('https://github.com/FRSname/CapForge/releases'), true)
  assert.equal(isAllowedExternalUrl('https://www.youtube.com/watch?v=7xxLt5FEq1E'), true)
})

test('the allowlist covers the YouTube spellings', () => {
  assert.equal(isAllowedExternalUrl('https://youtube.com/watch?v=abc'), true)
  assert.equal(isAllowedExternalUrl('https://youtu.be/abc'), true)
  assert.deepEqual([...ALLOWED_EXTERNAL_HOSTS].sort(), [
    'github.com',
    'www.youtube.com',
    'youtu.be',
    'youtube.com',
  ])
})

test('http is refused: https only', () => {
  assert.equal(isAllowedExternalUrl('http://github.com/FRSname/CapForge'), false)
})

test('an unknown host is refused, including a lookalike', () => {
  assert.equal(isAllowedExternalUrl('https://example.com/'), false)
  assert.equal(isAllowedExternalUrl('https://github.com.evil.test/FRSname'), false)
  assert.equal(isAllowedExternalUrl('https://evil.test/?x=github.com'), false)
})

test('a subdomain of an allowed host is not the allowed host', () => {
  assert.equal(isAllowedExternalUrl('https://gist.github.com/x'), false)
})

test('javascript: and file: are refused', () => {
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false)
})

test('credentials in the URL are refused even on an allowed host', () => {
  assert.equal(isAllowedExternalUrl('https://user:pass@github.com/FRSname'), false)
  assert.equal(isAllowedExternalUrl('https://user@github.com/FRSname'), false)
})

test('a non-string, an empty string and garbage are refused, never thrown', () => {
  assert.equal(isAllowedExternalUrl(''), false)
  assert.equal(isAllowedExternalUrl('not a url'), false)
  assert.equal(isAllowedExternalUrl(null), false)
  assert.equal(isAllowedExternalUrl(undefined), false)
  assert.equal(isAllowedExternalUrl({ href: 'https://github.com' }), false)
})

test('the host match is case-insensitive, as hosts are', () => {
  assert.equal(isAllowedExternalUrl('https://GitHub.com/FRSname/CapForge/releases'), true)
})
