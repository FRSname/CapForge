/**
 * What to tell the user when first-run setup fails.
 *
 * The dialog used to blame the internet connection and antivirus for every
 * failure, which sent the reporter of issue #77 (a Matplotlib crash, nothing
 * to do with the network) looking in the wrong place. The advice now follows
 * the error text: connection advice only when the error looks like a download
 * or connection failure, otherwise a pointer to the error itself.
 *
 * Pure, no Electron: `setup-failure.test.js` runs it under `node --test`.
 */

const ISSUES_URL = 'https://github.com/FRSname/CapForge/issues'

/** Node socket errors, our own downloader, pip/requests/huggingface wording. */
const CONNECTION_FAILURE_PATTERNS = [
  /\bE(NOTFOUND|CONNRESET|CONNREFUSED|TIMEDOUT|AI_AGAIN|HOSTUNREACH|NETUNREACH|PIPE)\b/,
  /\bHTTP \d{3}\b/,
  /\b(Read|Connect)Timeout/,
  /\b(Connection|MaxRetry|NewConnection|ProxyError|SSL)\w*Error\b/,
  /certificate verify failed/i,
  /Could not find a version that satisfies/,
  /Temporary failure in name resolution/i,
]

/**
 * @param {unknown} message
 * @returns {boolean}
 */
function looksLikeConnectionFailure(message) {
  if (typeof message !== 'string') return false
  return CONNECTION_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * The closing paragraph of the "Setup Failed" dialog.
 *
 * @param {unknown} message
 * @returns {string}
 */
function setupFailureAdvice(message) {
  const retry = 'You can retry by launching CapForge again.'
  if (looksLikeConnectionFailure(message)) {
    return `${retry} If the problem persists, check your internet connection and antivirus settings.`
  }
  return (
    `${retry} If it fails the same way, the lines above are the actual error — ` +
    `please report them at ${ISSUES_URL}.`
  )
}

module.exports = { ISSUES_URL, looksLikeConnectionFailure, setupFailureAdvice }
