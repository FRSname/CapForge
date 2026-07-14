/**
 * Pure, import-safe window-bounds geometry used by `main.js`'s
 * `createWindow()` when deciding whether to restore a saved window position.
 *
 * No Electron import lives here: `main.js` calls `screen.getAllDisplays()`
 * and passes the plain array in, so this module has zero Electron dependency
 * and can be unit-tested with `node --test electron/window-bounds.test.js` —
 * mirrors the pattern in `path-validate.js` / `preset-io.js`.
 */

/**
 * True if `bounds` overlaps at least one display's work area. Used to avoid
 * restoring a saved window position that would land the window off-screen
 * (e.g. a second monitor that's since been unplugged).
 *
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {Array<{ workArea: { x: number, y: number, width: number, height: number } }>} displays
 * @returns {boolean}
 */
function isBoundsVisibleOnAnyDisplay(bounds, displays) {
  return displays.some((d) => {
    const a = d.workArea
    return (
      bounds.x < a.x + a.width &&
      bounds.x + bounds.width > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + bounds.height > a.y
    )
  })
}

module.exports = { isBoundsVisibleOnAnyDisplay }
