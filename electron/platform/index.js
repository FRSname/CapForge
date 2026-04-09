/**
 * Platform dispatcher. Selects the correct implementation module based on
 * `process.platform` and re-exports it as the single platform API.
 *
 * The platform contract (see JSDoc in win.js / mac.js) covers every piece of
 * behaviour that differs between Windows and macOS. Everything else — the
 * FastAPI backend, renderer, IPC, state file, update check, model download —
 * lives in the shared layer and knows nothing about the host OS.
 *
 * To add a new feature that happens to need platform-specific code:
 *   1. Add the new function to BOTH platform modules (keeping the contract
 *      symmetric is what makes cross-platform features cheap).
 *   2. Call it from the shared layer through this module.
 *
 * Never sprinkle `if (process.platform === "darwin")` into shared files —
 * push the branch into the platform module instead.
 */

const impl = process.platform === "darwin"
  ? require("./mac")
  : require("./win");

module.exports = impl;
