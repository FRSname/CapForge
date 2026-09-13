/**
 * Pure-logic tests for claude-connect. Run with the built-in node runner:
 *   node --test electron/claude-connect.test.js
 * No electron required — only the import-safe helpers are exercised.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildServerEntryFrom,
  mergeMcpServers,
  storeDesktopTargetsFrom,
  desktopConfigPath,
  codeConfigPath,
} = require('./claude-connect')

test('buildServerEntryFrom wires command, sys.path bootstrap, cwd and PYTHONPATH', () => {
  const entry = buildServerEntryFrom('/runtime/python', '/proj')
  assert.equal(entry.command, '/runtime/python')
  assert.equal(entry.args[0], '-c')
  // The bootstrap puts projectDir on sys.path explicitly (cwd/PYTHONPATH are
  // unreliable across clients/platforms) then runs the package entry point.
  assert.match(entry.args[1], /sys\.path\.insert\(0, "\/proj"\)/)
  assert.match(entry.args[1], /from mcp_server\.server import main; main\(\)/)
  assert.equal(entry.cwd, '/proj')
  assert.equal(entry.env.PYTHONPATH, '/proj')
})

test('buildServerEntryFrom escapes Windows backslash paths into a valid Python literal', () => {
  const winPath = 'C:\\Program Files\\CapForge\\resources\\app.asar.unpacked'
  const entry = buildServerEntryFrom('C:\\py\\python.exe', winPath)
  // JSON.stringify yields a Python-valid double-quoted literal: backslashes
  // doubled, so Python un-escapes back to the original path.
  assert.ok(entry.args[1].includes(`sys.path.insert(0, ${JSON.stringify(winPath)})`))
})

test('storeDesktopTargetsFrom builds MSIX package config paths, ignoring non-Claude packages', () => {
  const local = path.join('C:\\Users\\me\\AppData\\Local')
  const targets = storeDesktopTargetsFrom(local, [
    'Claude_pzs8sxrjxfjjc',
    'Microsoft.WindowsCalculator_8wekyb3d8bbwe',
    'AnthropicClaude_abc123',
  ])
  // Only the two Claude packages survive the filter.
  assert.equal(targets.length, 2)
  // dir is the package folder (proof of install); config is the virtualized path.
  assert.equal(targets[0].dir, path.join(local, 'Packages', 'Claude_pzs8sxrjxfjjc'))
  assert.equal(
    targets[0].config,
    path.join(
      local,
      'Packages',
      'Claude_pzs8sxrjxfjjc',
      'LocalCache',
      'Roaming',
      'Claude',
      'claude_desktop_config.json'
    )
  )
})

test('storeDesktopTargetsFrom returns nothing when no Claude package is present', () => {
  assert.deepEqual(storeDesktopTargetsFrom('C:\\x', ['Foo_1', 'Bar_2']), [])
})

test('mergeMcpServers adds capforge to an empty config', () => {
  const out = mergeMcpServers({}, { command: 'py' })
  assert.deepEqual(out, { mcpServers: { capforge: { command: 'py' } } })
})

test('mergeMcpServers preserves existing servers and other top-level keys', () => {
  const existing = {
    theme: 'dark',
    mcpServers: { other: { command: 'x' } },
  }
  const out = mergeMcpServers(existing, { command: 'py' })
  assert.equal(out.theme, 'dark')
  assert.deepEqual(out.mcpServers.other, { command: 'x' })
  assert.deepEqual(out.mcpServers.capforge, { command: 'py' })
  // input not mutated
  assert.equal(existing.mcpServers.capforge, undefined)
})

test('mergeMcpServers overwrites a stale capforge entry', () => {
  const out = mergeMcpServers({ mcpServers: { capforge: { command: 'old' } } }, { command: 'new' })
  assert.deepEqual(out.mcpServers.capforge, { command: 'new' })
})

test('mergeMcpServers tolerates a null/garbage config', () => {
  assert.deepEqual(mergeMcpServers(null, { command: 'py' }), {
    mcpServers: { capforge: { command: 'py' } },
  })
})

test('config paths are absolute and client-correct', () => {
  assert.ok(path_isAbsolute(desktopConfigPath()))
  assert.match(desktopConfigPath(), /claude_desktop_config\.json$/)
  assert.match(codeConfigPath(), /\.claude\.json$/)
})

function path_isAbsolute(p) {
  return require('node:path').isAbsolute(p)
}
