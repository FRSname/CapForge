/**
 * Pure-logic tests for the managed-Node archive URLs + path fields.
 * Run with the built-in node runner:
 *   node --test electron/node-archive.test.js
 * No electron required — the platform modules are import-safe.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const mac = require('./platform/mac')
const win = require('./platform/win')

const V = '22.20.0'
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

test('mac archive URL is the official darwin tarball for this arch', () => {
  assert.equal(
    mac.nodeArchiveUrl(V),
    `https://nodejs.org/dist/v${V}/node-v${V}-darwin-${arch}.tar.gz`
  )
})

test('win archive URL is the official win zip for this arch', () => {
  assert.equal(win.nodeArchiveUrl(V), `https://nodejs.org/dist/v${V}/node-v${V}-win-${arch}.zip`)
})

test('archive URLs embed the requested version', () => {
  assert.match(mac.nodeArchiveUrl('22.99.1'), /v22\.99\.1/)
  assert.match(win.nodeArchiveUrl('22.99.1'), /v22\.99\.1/)
})

test('platform node exe rel paths match the official layouts', () => {
  assert.equal(mac.nodeExeRelPath, path.join('bin', 'node'))
  assert.equal(win.nodeExeRelPath, 'node.exe')
})

test('platform global node_modules dirs match the npm prefix layouts', () => {
  assert.equal(mac.globalNodeModulesRelPath, path.join('lib', 'node_modules'))
  assert.equal(win.globalNodeModulesRelPath, 'node_modules')
})
