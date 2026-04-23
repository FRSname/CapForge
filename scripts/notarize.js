/**
 * electron-builder afterSign hook.
 * Submits the signed .app bundle to Apple's notarization service,
 * then staples the approval ticket so the DMG works offline.
 *
 * Runs automatically during `npm run dist:mac` — do not invoke directly.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // Only notarize on macOS builds
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;

  // Fail fast if credentials are missing — notarization itself takes minutes,
  // so we don't want to discover the problem after a long signing pass.
  const missing = [];
  if (!APPLE_ID) missing.push('APPLE_ID');
  if (!APPLE_APP_SPECIFIC_PASSWORD) missing.push('APPLE_APP_SPECIFIC_PASSWORD');
  if (!APPLE_TEAM_ID) missing.push('APPLE_TEAM_ID');
  if (missing.length > 0) {
    throw new Error(
      `Notarization aborted — missing env vars: ${missing.join(', ')}\n` +
      `Check that .env.local exists at the project root and is populated.`
    );
  }

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const appBundleId = packager.config.appId;

  console.log(`\n[notarize] Submitting ${appName}.app to Apple — this usually takes 1-5 minutes…`);
  const startedAt = Date.now();

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[notarize] Success (${elapsed}s). Ticket stapled to ${appBundleId}.\n`);
};
