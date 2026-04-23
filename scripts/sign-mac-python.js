/**
 * electron-builder afterPack hook — signs the entire macOS app bundle.
 *
 * We bypass electron-builder's signing because @electron/osx-sign hangs
 * indefinitely on this app's structure (likely a Gatekeeper/verification
 * wait with no timeout). This signer calls `codesign` directly in a
 * deepest-first order, which is predictable and produces notarization-ready
 * signatures.
 *
 * Signing order (mandatory — each step seals what the next step wraps):
 *   1. Every Mach-O file (executables, .dylib, .so) — deepest first
 *   2. Every .framework bundle — deepest first
 *   3. Every nested .app bundle (helpers) — deepest first
 *   4. The outer .app bundle last
 *
 * Notarization runs separately via afterSign → scripts/notarize.js.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Mach-O magic numbers (read as big-endian; codesign handles native byte order).
const MACH_O_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe, 0xbebafeca,
]);

function isMachO(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    if (bytesRead < 4) return false;
    return MACH_O_MAGICS.has(buffer.readUInt32BE(0));
  } catch {
    return false;
  }
}

function walk(dir, entries) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      entries.push({ kind: 'dir', path: fullPath, name: e.name });
      walk(fullPath, entries);
    } else if (e.isFile()) {
      entries.push({ kind: 'file', path: fullPath, name: e.name });
    }
  }
}

function byDepthDesc(a, b) {
  return b.path.split(path.sep).length - a.path.split(path.sep).length;
}

function resolveSigningIdentity(packager) {
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  const configured = packager.config.mac && packager.config.mac.identity;
  if (configured) return configured;
  const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf-8',
  });
  const match = output.match(/\s+([A-F0-9]{40})\s+"(Developer ID Application:[^"]+)"/);
  if (!match) {
    throw new Error(
      'No "Developer ID Application" certificate in the login keychain. ' +
      'Install via Xcode → Settings → Accounts → Manage Certificates.'
    );
  }
  return match[1];
}

function signOne(target, identity, entitlements, label) {
  const startedAt = Date.now();
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign', identity,
      '--timestamp',
      '--options', 'runtime',
      '--entitlements', entitlements,
      target,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const ms = Date.now() - startedAt;
  if (ms > 2000) {
    console.log(`[sign-mac] ${label}  ${path.relative(process.cwd(), target)}  (${(ms / 1000).toFixed(1)}s)`);
  }
}

function signBatch(items, identity, entitlements, label) {
  console.log(`[sign-mac] ${label}: ${items.length} items…`);
  const startedAt = Date.now();
  for (const item of items) {
    signOne(item.path, identity, entitlements, label);
  }
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[sign-mac] ${label} done in ${elapsed}s.`);
}

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn(`[sign-mac] App bundle not found at ${appPath}`);
    return;
  }

  const identity = resolveSigningIdentity(packager);
  const entitlements = path.join(packager.projectDir, 'build', 'entitlements.mac.plist');

  console.log(`[sign-mac] Identity: ${identity}`);
  console.log(`[sign-mac] Scanning ${appPath}…`);

  const entries = [];
  walk(appPath, entries);

  const machOFiles = entries.filter((e) => e.kind === 'file' && isMachO(e.path));
  const frameworks = entries.filter((e) => e.kind === 'dir' && e.name.endsWith('.framework'));
  const nestedApps = entries.filter(
    (e) => e.kind === 'dir' && e.name.endsWith('.app') && e.path !== appPath,
  );

  machOFiles.sort(byDepthDesc);
  frameworks.sort(byDepthDesc);
  nestedApps.sort(byDepthDesc);

  const overallStart = Date.now();

  signBatch(machOFiles, identity, entitlements, 'Mach-O');
  signBatch(frameworks, identity, entitlements, 'Frameworks');
  signBatch(nestedApps, identity, entitlements, 'Helper apps');

  console.log('[sign-mac] Outer app bundle…');
  signOne(appPath, identity, entitlements, 'App');

  const total = Math.round((Date.now() - overallStart) / 1000);
  console.log(`[sign-mac] All signing complete in ${total}s.`);
};
