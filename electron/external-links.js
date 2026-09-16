/**
 * The allowlist between a renderer-supplied string and `shell.openExternal`.
 *
 * The onboarding dialogs open exactly two kinds of link: the GitHub releases
 * page and the tutorial video. A renderer bug (or a compromised renderer)
 * must not be able to turn that bridge into "open anything on this machine",
 * so the main process refuses everything else before the shell ever sees it.
 *
 * Pure and electron-free so `external-links.test.js` can run under
 * `node --test`.
 */

/** Hosts the app is allowed to open, matched exactly and case-insensitively. */
const ALLOWED_EXTERNAL_HOSTS = new Set(['github.com', 'www.youtube.com', 'youtube.com', 'youtu.be'])

/**
 * True for an https URL on an allowlisted host with no embedded credentials.
 * Anything unparseable, any other scheme and any other host is false; this
 * never throws, because its input is untrusted by definition.
 */
function isAllowedExternalUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  // `user:pass@host` lets a URL read as one host and resolve as another.
  if (parsed.username !== '' || parsed.password !== '') return false
  return ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl }
