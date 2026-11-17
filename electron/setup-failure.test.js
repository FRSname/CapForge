/**
 * Pure-logic tests for setup-failure. Run with the built-in node runner:
 *   node --test electron/setup-failure.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { looksLikeConnectionFailure, setupFailureAdvice } = require('./setup-failure')

test('download and connection errors are recognised', () => {
  for (const message of [
    'getaddrinfo ENOTFOUND bootstrap.pypa.io',
    'read ECONNRESET',
    'connect ETIMEDOUT 151.101.0.223:443',
    'Download failed: HTTP 503',
    "ReadTimeoutError: HTTPSConnectionPool(host='files.pythonhosted.org', port=443)",
    'ssl.SSLCertVerificationError: certificate verify failed',
    'ERROR: Could not find a version that satisfies the requirement torch',
  ]) {
    assert.equal(looksLikeConnectionFailure(message), true, message)
  }
})

test('the issue #77 traceback is not mistaken for a connection problem', () => {
  const message = [
    'Command failed (4): python3 -u -c import os, sys, traceback',
    '[capforge] load_model FAILED — full cause chain:',
    '  File ".../matplotlib/font_manager.py", line 275, in _get_macos_fonts',
    '    return [Path(entry["path"]) for entry in d["_items"]]',
    "KeyError: '_items'",
  ].join('\n')
  assert.equal(looksLikeConnectionFailure(message), false)
  const advice = setupFailureAdvice(message)
  assert.doesNotMatch(advice, /antivirus|internet/i)
  assert.match(advice, /github\.com\/FRSname\/CapForge\/issues/)
})

test('a connection failure keeps the connection advice', () => {
  assert.match(setupFailureAdvice('read ECONNRESET'), /internet connection and antivirus/)
})

test('a non-string message is treated as unknown, not thrown on', () => {
  assert.equal(looksLikeConnectionFailure(undefined), false)
  assert.match(setupFailureAdvice(undefined), /issues/)
})
