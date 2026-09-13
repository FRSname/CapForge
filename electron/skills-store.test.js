/**
 * Pure-logic tests for skills-store. Run with the built-in node runner:
 *   node --test electron/skills-store.test.js
 * No electron required — only the injectable helpers are exercised, against
 * real temp directories (the fs semantics ARE the thing under test).
 */

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  BUNDLE_HASH_FILE,
  listMarkdown,
  readFrontmatterDescription,
  bundleHash,
  ensureUserCopy,
  skillStatus,
  installSkill,
  resetUserCopy,
  acknowledgeBundle,
  isKnownSkill,
  orderSkillFiles,
} = require('./skills-store')

const tempRoots = []
after(() => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true })
})

const BUNDLE_FILES = {
  'SKILL.md': '---\nname: capforge-publish\ndescription: "Ship it"\n---\n# publish\n',
  'examples/basic.md': 'example\n',
}

/** A temp `<source>`/`<user>`/`<install>` triple; source holds the bundle. */
function makeSkillDirs(files = BUNDLE_FILES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-skills-'))
  tempRoots.push(root)
  const sourceDir = path.join(root, 'bundle')
  const userDir = path.join(root, 'user')
  const installDir = path.join(root, 'install')
  for (const [rel, body] of Object.entries(files)) write(path.join(sourceDir, rel), body)
  return { root, sourceDir, userDir, installDir }
}

function write(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, body)
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf-8')
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

test('readFrontmatterDescription strips surrounding quotes', () => {
  const text = '---\nname: x\ndescription: "Turn the video into a package"\n---\n# body\n'
  assert.equal(readFrontmatterDescription(text), 'Turn the video into a package')
  assert.equal(readFrontmatterDescription(text.replace(/"/g, "'")), 'Turn the video into a package')
})

test('readFrontmatterDescription reads an unquoted value verbatim', () => {
  const text = '---\ndescription: plain words, with a comma\nname: x\n---\nbody\n'
  assert.equal(readFrontmatterDescription(text), 'plain words, with a comma')
})

test('readFrontmatterDescription returns empty string when missing', () => {
  assert.equal(readFrontmatterDescription('---\nname: x\n---\nbody\n'), '')
  assert.equal(readFrontmatterDescription('# no frontmatter at all\n'), '')
  assert.equal(readFrontmatterDescription(''), '')
  assert.equal(readFrontmatterDescription(undefined), '')
})

test('readFrontmatterDescription ignores a description outside the frontmatter block', () => {
  assert.equal(readFrontmatterDescription('---\nname: x\n---\ndescription: nope\n'), '')
})

// ---------------------------------------------------------------------------
// listMarkdown
// ---------------------------------------------------------------------------

test('listMarkdown recurses, sorts, and skips dotfiles and non-markdown', () => {
  const { sourceDir } = makeSkillDirs({
    'SKILL.md': 'a',
    'examples/basic.md': 'b',
    'script.py': 'c',
    'notes.txt': 'd',
    '.DS_Store': 'junk',
    '.bundled-sha1': 'deadbeef',
    '.hidden/inside.md': 'e',
  })
  assert.deepEqual(listMarkdown(sourceDir, fs), ['SKILL.md', 'examples/basic.md'])
})

test('listMarkdown returns [] for a missing directory', () => {
  const { root } = makeSkillDirs()
  assert.deepEqual(listMarkdown(path.join(root, 'absent'), fs), [])
})

test('orderSkillFiles puts SKILL.md first', () => {
  assert.deepEqual(orderSkillFiles(['examples/basic.md', 'SKILL.md', 'a.md']), [
    'SKILL.md',
    'a.md',
    'examples/basic.md',
  ])
})

// ---------------------------------------------------------------------------
// bundleHash
// ---------------------------------------------------------------------------

test('bundleHash is stable across runs and changes when a file changes', () => {
  const { sourceDir } = makeSkillDirs()
  const first = bundleHash(sourceDir, fs)
  assert.equal(bundleHash(sourceDir, fs), first)

  write(path.join(sourceDir, 'examples', 'basic.md'), 'example v2\n')
  const second = bundleHash(sourceDir, fs)
  assert.notEqual(second, first)

  // Adding a file changes it too — the hash covers paths, not just contents.
  write(path.join(sourceDir, 'examples', 'extra.md'), 'example v2\n')
  assert.notEqual(bundleHash(sourceDir, fs), second)
})

test('bundleHash ignores non-markdown and dotfiles', () => {
  const { sourceDir } = makeSkillDirs()
  const before = bundleHash(sourceDir, fs)
  write(path.join(sourceDir, 'script.py'), 'print(1)\n')
  write(path.join(sourceDir, '.DS_Store'), 'junk')
  assert.equal(bundleHash(sourceDir, fs), before)
})

// ---------------------------------------------------------------------------
// ensureUserCopy
// ---------------------------------------------------------------------------

test('ensureUserCopy seeds the whole bundle plus the hash on first call', () => {
  const { sourceDir, userDir } = makeSkillDirs()
  assert.deepEqual(ensureUserCopy({ sourceDir, userDir, fs }), { seeded: true })

  assert.equal(read(path.join(userDir, 'SKILL.md')), BUNDLE_FILES['SKILL.md'])
  assert.equal(read(path.join(userDir, 'examples', 'basic.md')), 'example\n')
  assert.equal(read(path.join(userDir, BUNDLE_HASH_FILE)), bundleHash(sourceDir, fs))
})

test('ensureUserCopy is a no-op on a second call and never eats user edits', () => {
  const { sourceDir, userDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  const mine = '---\ndescription: mine\n---\n# my own steps\n'
  write(path.join(userDir, 'SKILL.md'), mine)

  assert.deepEqual(ensureUserCopy({ sourceDir, userDir, fs }), { seeded: false })
  assert.equal(read(path.join(userDir, 'SKILL.md')), mine)
})

// ---------------------------------------------------------------------------
// skillStatus
// ---------------------------------------------------------------------------

test('skillStatus reports not-installed, then up-to-date, then outdated', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })

  assert.deepEqual(skillStatus({ sourceDir, userDir, installDir, fs }), {
    installStatus: 'not-installed',
    bundleChanged: false,
  })

  installSkill({ userDir, installDir, fs })
  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).installStatus, 'up-to-date')

  write(path.join(userDir, 'SKILL.md'), '# edited after install\n')
  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).installStatus, 'outdated')
})

test('skillStatus is outdated when the install is missing a nested file', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  installSkill({ userDir, installDir, fs })
  fs.rmSync(path.join(installDir, 'examples', 'basic.md'))

  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).installStatus, 'outdated')
})

test('bundleChanged flips when the bundle changes and clears after acknowledgeBundle', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).bundleChanged, false)

  // A CapForge update ships a new version of the skill.
  write(path.join(sourceDir, 'SKILL.md'), '---\ndescription: "v2"\n---\n# publish v2\n')
  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).bundleChanged, true)

  // "Keep mine" records the new hash without touching the user's text.
  const mine = read(path.join(userDir, 'SKILL.md'))
  acknowledgeBundle({ sourceDir, userDir, fs })
  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).bundleChanged, false)
  assert.equal(read(path.join(userDir, 'SKILL.md')), mine)
})

test('a user copy with no recorded hash counts as bundleChanged', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  fs.rmSync(path.join(userDir, BUNDLE_HASH_FILE))

  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).bundleChanged, true)
})

// ---------------------------------------------------------------------------
// installSkill
// ---------------------------------------------------------------------------

test('installSkill copies nested markdown from the USER copy on a fresh install', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  const mine = '---\ndescription: mine\n---\n# my own steps\n'
  write(path.join(userDir, 'SKILL.md'), mine)

  assert.deepEqual(installSkill({ userDir, installDir, fs }), {
    ok: true,
    path: installDir,
    status: 'installed',
  })
  // The user's bytes are what landed — not the bundle's.
  assert.equal(read(path.join(installDir, 'SKILL.md')), mine)
  // Nested examples/ is created, not flattened or skipped.
  assert.equal(read(path.join(installDir, 'examples', 'basic.md')), 'example\n')
})

test('installSkill reports up-to-date, then updated after a user edit', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  assert.equal(installSkill({ userDir, installDir, fs }).status, 'installed')
  assert.equal(installSkill({ userDir, installDir, fs }).status, 'up-to-date')

  write(path.join(userDir, 'SKILL.md'), '# v2 of my steps\n')
  assert.deepEqual(installSkill({ userDir, installDir, fs }), {
    ok: true,
    path: installDir,
    status: 'updated',
  })
  assert.equal(read(path.join(installDir, 'SKILL.md')), '# v2 of my steps\n')
})

test('installSkill skips the .bundled-sha1 dotfile and non-markdown files', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs({ 'SKILL.md': '# publish\n' })
  ensureUserCopy({ sourceDir, userDir, fs })
  write(path.join(userDir, 'scratch.txt'), 'nope')
  write(path.join(userDir, 'script.py'), 'print(1)\n')
  assert.ok(fs.existsSync(path.join(userDir, BUNDLE_HASH_FILE)))

  installSkill({ userDir, installDir, fs })
  assert.deepEqual(fs.readdirSync(installDir), ['SKILL.md'])
})

test('installSkill reports write-failed instead of lying when the user copy is empty', () => {
  const { root, installDir } = makeSkillDirs()
  const res = installSkill({ userDir: path.join(root, 'absent'), installDir, fs })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'write-failed')
  assert.match(res.detail, /absent/)
  assert.equal(fs.existsSync(installDir), false)
})

// ---------------------------------------------------------------------------
// resetUserCopy
// ---------------------------------------------------------------------------

test('resetUserCopy discards the user edits and restores the bundle', () => {
  const { sourceDir, userDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  write(path.join(userDir, 'SKILL.md'), '# my own steps\n')
  write(path.join(userDir, 'examples', 'basic.md'), 'my example\n')
  write(path.join(userDir, 'examples', 'mine.md'), 'a file the bundle never had\n')

  resetUserCopy({ sourceDir, userDir, fs })

  assert.equal(read(path.join(userDir, 'SKILL.md')), BUNDLE_FILES['SKILL.md'])
  assert.equal(read(path.join(userDir, 'examples', 'basic.md')), 'example\n')
  // Nothing of the user's survives — including files they added.
  assert.equal(fs.existsSync(path.join(userDir, 'examples', 'mine.md')), false)
  assert.equal(read(path.join(userDir, BUNDLE_HASH_FILE)), bundleHash(sourceDir, fs))
})

test('resetUserCopy also clears a stale bundleChanged flag', () => {
  const { sourceDir, userDir, installDir } = makeSkillDirs()
  ensureUserCopy({ sourceDir, userDir, fs })
  write(path.join(sourceDir, 'SKILL.md'), '# publish v2\n')
  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).bundleChanged, true)

  resetUserCopy({ sourceDir, userDir, fs })
  assert.equal(skillStatus({ sourceDir, userDir, installDir, fs }).bundleChanged, false)
  assert.equal(read(path.join(userDir, 'SKILL.md')), '# publish v2\n')
})

// ---------------------------------------------------------------------------
// Name validation (the path-traversal guard on every IPC entry point)
// ---------------------------------------------------------------------------

test('isKnownSkill only accepts a name that is actually bundled', () => {
  const names = ['capforge-publish', 'other']
  assert.equal(isKnownSkill('capforge-publish', names), true)
  assert.equal(isKnownSkill('other', names), true)

  assert.equal(isKnownSkill('../x', names), false)
  assert.equal(isKnownSkill('../../.ssh', names), false)
  assert.equal(isKnownSkill('capforge-publish/../../x', names), false)
  assert.equal(isKnownSkill('/etc/passwd', names), false)
  assert.equal(isKnownSkill('', names), false)
  assert.equal(isKnownSkill(undefined, names), false)
  assert.equal(isKnownSkill(null, names), false)
  assert.equal(isKnownSkill(42, names), false)
  // Prototype keys are not names either.
  assert.equal(isKnownSkill('__proto__', names), false)
  assert.equal(isKnownSkill('constructor', names), false)
})
