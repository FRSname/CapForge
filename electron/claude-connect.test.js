/**
 * Pure-logic tests for claude-connect. Run with the built-in node runner:
 *   node --test electron/claude-connect.test.js
 * No electron required — only the import-safe helpers are exercised.
 */

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const fs = require('node:fs')
const os = require('node:os')

const {
  buildServerEntryFrom,
  mergeMcpServers,
  storeDesktopTargetsFrom,
  desktopConfigPath,
  codeConfigPath,
  skillSourceDir,
  skillTargetDir,
  planSkillInstall,
  installSkillFrom,
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

// ---------------------------------------------------------------------------
// Publish skill install
// ---------------------------------------------------------------------------

/** A temp `<source>`/`<target>` pair; source holds the bundled skill markdown. */
const tempRoots = []
after(() => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true })
})

function makeSkillDirs(files = { 'SKILL.md': '# publish\n', 'examples/basic.md': 'example\n' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-skill-'))
  tempRoots.push(root)
  const sourceDir = path.join(root, 'source')
  const targetDir = path.join(root, 'target')
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(sourceDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, body)
  }
  return { root, sourceDir, targetDir }
}

test('skillSourceDir points at the bundled skill folder under mcp_server/skills', () => {
  const dir = skillSourceDir('/proj')
  assert.ok(require('node:path').isAbsolute(dir))
  assert.equal(dir, path.join('/proj', 'mcp_server', 'skills', 'capforge-publish'))
})

test('skillTargetDir points at ~/.claude/skills/capforge-publish', () => {
  const dir = skillTargetDir('/home/me')
  assert.ok(require('node:path').isAbsolute(dir))
  assert.equal(dir, path.join('/home/me', '.claude', 'skills', 'capforge-publish'))
})

test('installSkillFrom copies nested markdown on a fresh install', () => {
  const { sourceDir, targetDir } = makeSkillDirs()
  assert.equal(planSkillInstall({ sourceDir, targetDir, fs }).status, 'install')

  const res = installSkillFrom({ sourceDir, targetDir, fs })
  assert.deepEqual(res, { ok: true, path: targetDir, status: 'installed' })
  assert.equal(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8'), '# publish\n')
  // Nested examples/ is created, not flattened or skipped.
  assert.equal(fs.readFileSync(path.join(targetDir, 'examples', 'basic.md'), 'utf-8'), 'example\n')
})

test('a second install is a no-op reported as up-to-date', () => {
  const { sourceDir, targetDir } = makeSkillDirs()
  installSkillFrom({ sourceDir, targetDir, fs })

  assert.equal(planSkillInstall({ sourceDir, targetDir, fs }).status, 'up-to-date')
  assert.deepEqual(installSkillFrom({ sourceDir, targetDir, fs }), {
    ok: true,
    path: targetDir,
    status: 'up-to-date',
  })
})

test('an edited target SKILL.md is reported and never overwritten', () => {
  const { sourceDir, targetDir } = makeSkillDirs()
  installSkillFrom({ sourceDir, targetDir, fs })
  const edited = '# publish\nmy own steps\n'
  fs.writeFileSync(path.join(targetDir, 'SKILL.md'), edited)

  assert.equal(planSkillInstall({ sourceDir, targetDir, fs }).status, 'edited')
  assert.deepEqual(installSkillFrom({ sourceDir, targetDir, fs }), {
    ok: false,
    reason: 'edited',
    path: targetDir,
  })
  // The user's bytes survive.
  assert.equal(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8'), edited)
})

test('a partially copied skill (missing example) plans as install, not up-to-date', () => {
  const { sourceDir, targetDir } = makeSkillDirs()
  installSkillFrom({ sourceDir, targetDir, fs })
  fs.rmSync(path.join(targetDir, 'examples', 'basic.md'))

  assert.equal(planSkillInstall({ sourceDir, targetDir, fs }).status, 'install')
  assert.equal(installSkillFrom({ sourceDir, targetDir, fs }).status, 'installed')
  assert.ok(fs.existsSync(path.join(targetDir, 'examples', 'basic.md')))
})

test('non-markdown files and dotfiles in the source are not copied', () => {
  const { sourceDir, targetDir } = makeSkillDirs({
    'SKILL.md': '# publish\n',
    'script.py': 'print(1)\n',
    '.DS_Store': 'junk',
    'notes.txt': 'nope',
  })

  const plan = planSkillInstall({ sourceDir, targetDir, fs })
  assert.deepEqual(plan.files, ['SKILL.md'])

  installSkillFrom({ sourceDir, targetDir, fs })
  assert.deepEqual(fs.readdirSync(targetDir), ['SKILL.md'])
})

test('a missing source dir reports not-bundled instead of throwing', () => {
  const { root, targetDir } = makeSkillDirs()
  const res = installSkillFrom({ sourceDir: path.join(root, 'absent'), targetDir, fs })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'not-bundled')
  assert.match(res.detail, /absent/)
  assert.equal(fs.existsSync(targetDir), false)
})

test('a source dir with no markdown reports not-bundled', () => {
  const { sourceDir, targetDir } = makeSkillDirs({ 'readme.txt': 'x' })
  assert.equal(installSkillFrom({ sourceDir, targetDir, fs }).reason, 'not-bundled')
})

function path_isAbsolute(p) {
  return require('node:path').isAbsolute(p)
}
